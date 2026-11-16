import * as THREE from "three";
import type { Accessory, AccessoryCatalog, Catalog, Design, Part } from "./schema";
import type { SceneBounds, Vec3 } from "./scene-fit";
import { combineBounds } from "./scene-fit";
import { beamDims } from "./materials";
import { designBounds, partRotation } from "./tslot";

type Instance = NonNullable<Design["accessories"][number]["instances"]>[number];
export type AccessoryVisual = NonNullable<Accessory["visual"]>;
export type ResolvedAccessoryInstance = {
  instance: Instance;
  accessory: Accessory;
  visual: AccessoryVisual;
  position: Vec3;
  rotation: Vec3;
  bounds: SceneBounds;
};

type ConnectionIssue = { level: "error"; path: string; message: string; partId?: string };
const CONTACT_EPSILON_MM = 0.5;

function rotationMatrix(rotation: Vec3): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation.map(THREE.MathUtils.degToRad) as Vec3));
}

export function accessoryInstanceBounds(visual: AccessoryVisual, position: Vec3, rotation: Vec3): SceneBounds {
  const [x, y, z] = visual.size;
  const box = new THREE.Box3(new THREE.Vector3(0, 0, -z / 2), new THREE.Vector3(x, y, z / 2));
  box.applyMatrix4(rotationMatrix(rotation).setPosition(...position));
  return {
    min: box.min.toArray() as Vec3,
    max: box.max.toArray() as Vec3,
    center: box.getCenter(new THREE.Vector3()).toArray() as Vec3,
    radius: box.getSize(new THREE.Vector3()).length() / 2,
  };
}

/** 实例只跟随一个锚定构件；连接不是可随零件编辑自动求解的装配约束。 */
export function resolveAccessoryInstances(
  design: Pick<Design, "accessories">,
  catalog?: AccessoryCatalog,
  offsets?: ReadonlyMap<string, Vec3>,
): ResolvedAccessoryInstance[] {
  const items = new Map(catalog?.accessories?.map((item) => [item.id, item]));
  return design.accessories.flatMap((entry) => {
    const accessory = items.get(entry.ref);
    const visual = accessory?.visual;
    if (!accessory || !visual) return [];
    return (entry.instances ?? []).map((instance) => {
      const offset = offsets?.get(instance.anchorPartId);
      const position = instance.position.map((value, axis) => value + (offset?.[axis] ?? 0)) as Vec3;
      return { instance, accessory, visual, position, rotation: instance.rotation, bounds: accessoryInstanceBounds(visual, position, instance.rotation) };
    });
  });
}

/** 取景与配件绘制使用同一变换；整体尺寸标注仍只描述装配态主体构件。 */
export function displayedDesignBounds(design: Design, accessories?: AccessoryCatalog, offsets?: ReadonlyMap<string, Vec3>): SceneBounds {
  return resolveAccessoryInstances(design, accessories, offsets)
    .reduce((bounds, item) => combineBounds(bounds, item.bounds), designBounds(design.parts, offsets));
}

function partMatrix(part: Part): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...partRotation(part))).setPosition(...part.position);
}

/** 检查整个安装面落在构件包围盒表面；不把槽口示意当作孔位或强度认证。 */
function faceTouchesPart(part: Part, instance: Instance, visual: AccessoryVisual, face: 0 | 1): boolean {
  const { sectionW, sectionH, length } = beamDims(part);
  const size = part.kind === "beam" ? [sectionW, sectionH, length] : part.size;
  const half = size.map((value) => value / 2);
  const transform = partMatrix(part).invert().multiply(rotationMatrix(instance.rotation).setPosition(...instance.position));
  const [x, y, z] = visual.size;
  const localPoints = face === 0
    ? [[0, visual.thickness, -z / 2], [0, y, -z / 2], [0, visual.thickness, z / 2], [0, y, z / 2]]
    : [[visual.thickness, 0, -z / 2], [x, 0, -z / 2], [visual.thickness, 0, z / 2], [x, 0, z / 2]];
  const points = localPoints.map((point) => new THREE.Vector3(...point as Vec3).applyMatrix4(transform).toArray());
  const normal = new THREE.Vector3(face === 0 ? 1 : 0, face === 1 ? 1 : 0, 0).transformDirection(transform).toArray();
  return [0, 1, 2].some((axis) => {
    if (Math.abs(Math.abs(normal[axis]) - 1) > 1e-7) return false;
    const surface = Math.sign(normal[axis]) * half[axis];
    return points.every((point) => Math.abs(point[axis] - surface) <= CONTACT_EPSILON_MM
      && point.every((value, i) => i === axis || Math.abs(value) <= half[i] + CONTACT_EPSILON_MM));
  });
}

export function inspectAccessoryConnections(design: Design, catalog: Catalog, accessories: AccessoryCatalog): ConnectionIssue[] {
  const issues: ConnectionIssue[] = [];
  const partMap = new Map(design.parts.map((part) => [part.id, part]));
  const profileMap = new Map(catalog.profiles.map((profile) => [profile.id, profile]));
  const accessoryMap = new Map(accessories.accessories.map((item) => [item.id, item]));
  const ids = new Set<string>();
  const refs = new Set<string>();
  for (const [index, entry] of design.accessories.entries()) {
    const path = `accessories.${index}`;
    const error = (field: string, message: string, partId?: string) => issues.push({ level: "error", path: `${path}.${field}`, message, ...(partId ? { partId } : {}) });
    const item = accessoryMap.get(entry.ref);
    if (refs.has(entry.ref) && entry.instances) error("ref", `带安装实例的配件引用重复: ${entry.ref}`);
    refs.add(entry.ref);
    if (!entry.instances) continue;
    if (!item?.visual) error("instances", "此配件没有可定位的角码示意，不能填写安装实例");
    if (entry.qty !== entry.instances.length) error("qty", "采购数量必须等于安装实例数量");
    for (const [instanceIndex, instance] of entry.instances.entries()) {
      const at = `instances.${instanceIndex}`;
      if (ids.has(instance.id) || partMap.has(instance.id)) error(`${at}.id`, `安装实例 id 重复或与构件冲突: ${instance.id}`);
      ids.add(instance.id);
      if (instance.partIds[0] === instance.partIds[1]) error(`${at}.partIds`, "角码必须连接两个不同构件");
      if (!instance.partIds.includes(instance.anchorPartId)) error(`${at}.anchorPartId`, "锚定构件必须属于此连接的两个构件");
      const connected = instance.partIds.map((id) => partMap.get(id));
      for (const [face, part] of connected.entries()) {
        const id = instance.partIds[face];
        if (!part) {
          error(`${at}.partIds.${face}`, `连接引用的构件不存在: ${id}`);
          continue;
        }
        if (item?.mounting === "profile-profile" && part.kind !== "beam") error(`${at}.partIds.${face}`, "型材角码只能连接具有匹配槽口的型材", id);
        if (item?.mounting === "profile-panel" && (face === 0 ? part.kind !== "beam" : part.kind !== "plate")) error(`${at}.partIds.${face}`, "板材挂接须依次连接型材侧面与板材底面", id);
        if (part.kind === "beam" && item) {
          const profile = part.profile ? profileMap.get(part.profile) : undefined;
          if (!part.profile || !item.fitsSlot.includes(part.profile)
            || (item.connectionFamily && profile?.connectionFamily !== item.connectionFamily)) {
            error(`${at}.partIds.${face}`, `配件 ${item.name} 与型材 ${part.profile ?? "未指定"} 的槽口族不匹配`, id);
          }
        }
        if (item?.visual && !faceTouchesPart(part, instance, item.visual, face as 0 | 1)) {
          error(`${at}.position`, `角码安装面未贴合构件 ${id}；修改构件后须同步调整实例位置/朝向`, id);
        }
      }
      if (item?.visual) {
        const bounds = accessoryInstanceBounds(item.visual, instance.position, instance.rotation);
        if (![...bounds.min, ...bounds.max].every(Number.isFinite)) error(`${at}.position`, "安装实例包围盒超出可计算范围");
        else if (bounds.min[1] < -0.5) error(`${at}.position`, `角码低于地面 ${(-bounds.min[1]).toFixed(1)}mm`);
        const anchor = partMap.get(instance.anchorPartId);
        if (anchor && bounds.min[1] < designBounds([anchor]).min[1] - CONTACT_EPSILON_MM) {
          error(`${at}.anchorPartId`, "角码低于锚定构件底面，拆解跟随时可能穿地；请调整安装或锚定关系", anchor.id);
        }
      }
    }
  }
  return issues;
}
