import * as THREE from "three";
import { OBB } from "three/addons/math/OBB.js";
import { DesignSchema } from "./schema";
import type { AccessoryCatalog, Catalog, Design, Part } from "./schema";
import { beamDims } from "./materials";
import type { ValidationIssue } from "./projects";
import type { SceneBounds } from "./scene-fit";
import { designBounds, partRotation } from "./tslot";
import { inspectAccessoryConnections } from "./accessory-connections";

// 保留原有阈值：AABB 各轴交叠须超过 0.5mm；包围盒或地面间距超过 10mm 才提示可能悬空。
const INTERFERENCE_EPSILON_MM = 0.5;
const FLOATING_GAP_THRESHOLD_MM = 10;
// 上限同时约束密集场景的运算和返回给 CLI/Web 的数据量，不影响独立的错误校验。
const MAX_GEOMETRY_PAIRS = 50_000;
const MAX_GEOMETRY_WARNINGS = 100;
const COAXIAL_TOLERANCE_MM = 1e-7;
const PARALLEL_TOLERANCE = 1e-12;

type PartBox = { index: number; part: Part; bounds: SceneBounds; obb?: OBB };

/** 与 PartMesh/designBounds 使用完全相同的局部尺寸和 Euler，型材槽口仍只是包围盒。 */
function orientedBox(box: PartBox): OBB {
  if (!box.obb) {
    const { part } = box;
    const { sectionW, sectionH, length } = beamDims(part);
    const localSize = part.kind === "beam" ? [sectionW, sectionH, length] : part.size;
    const matrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...partRotation(part)));
    box.obb = new OBB(
      new THREE.Vector3(...part.position),
      new THREE.Vector3(...localSize as [number, number, number]).multiplyScalar(0.5),
      new THREE.Matrix3().setFromMatrix4(matrix),
    );
  }
  return box.obb;
}

function isCoaxialNestedColumnPair(a: PartBox, b: PartBox): boolean {
  if (a.part.kind !== "column" || b.part.kind !== "column") return false;
  const boxA = orientedBox(a);
  const boxB = orientedBox(b);
  const axesA = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const axesB = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  boxA.rotation.extractBasis(axesA[0], axesA[1], axesA[2]);
  boxB.rotation.extractBasis(axesB[0], axesB[1], axesB[2]);

  // column 的实际轴为旋转后的局部 Y 轴，不能仅凭世界 XZ 中心或 AABB 截面推断套管。
  const tilt = new THREE.Vector3().crossVectors(axesA[1], axesB[1]).length();
  const delta = new THREE.Vector3().subVectors(boxB.center, boxA.center);
  const radialOffset = new THREE.Vector3().crossVectors(delta, axesA[1]).length();
  if (!Number.isFinite(radialOffset) || tilt > PARALLEL_TOLERANCE || radialOffset > COAXIAL_TOLERANCE_MM
    || tilt * (boxA.halfSize.y + boxB.halfSize.y + Math.abs(delta.dot(axesA[1]))) > COAXIAL_TOLERANCE_MM) {
    return false;
  }

  // 将内管的旋转矩形截面投影到外管的局部截面；两方向均严格包含才可豁免。
  const containsSection = (outer: OBB, outerAxes: THREE.Vector3[], inner: OBB, innerAxes: THREE.Vector3[]) => {
    const offset = new THREE.Vector3().subVectors(inner.center, outer.center);
    const extent = (axis: THREE.Vector3) => Math.abs(offset.dot(axis))
      + inner.halfSize.x * Math.abs(innerAxes[0].dot(axis))
      + inner.halfSize.z * Math.abs(innerAxes[2].dot(axis))
      + inner.halfSize.y * Math.abs(innerAxes[1].dot(axis));
    return extent(outerAxes[0]) < outer.halfSize.x && extent(outerAxes[2]) < outer.halfSize.z;
  };
  return containsSection(boxA, axesA, boxB, axesB) || containsSection(boxB, axesB, boxA, axesA);
}

function boxGapMm(a: SceneBounds, b: SceneBounds): number {
  const gx = Math.max(0, a.min[0] - b.max[0], b.min[0] - a.max[0]);
  const gy = Math.max(0, a.min[1] - b.max[1], b.min[1] - a.max[1]);
  const gz = Math.max(0, a.min[2] - b.max[2], b.min[2] - a.max[2]);
  return Math.hypot(gx, gy, gz);
}

function inspectGeometry(boxes: PartBox[], issues: ValidationIssue[]): void {
  const near = boxes.map(({ bounds }) => bounds.min[1] <= FLOATING_GAP_THRESHOLD_MM);
  const totalPairs = boxes.length * (boxes.length - 1) / 2;
  let checkedPairs = 0;
  let interferenceCount = 0;
  let floatingCount = 0;
  let displayed = 0;
  const warn = (issue: ValidationIssue) => {
    if (displayed < MAX_GEOMETRY_WARNINGS) {
      issues.push(issue);
      displayed++;
    }
  };

  // 每个无序构件对最多检查一次，包括未通过 AABB 粗筛的对；上限对稀疏场景也生效。
  pairs: for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length; j++) {
      if (checkedPairs === MAX_GEOMETRY_PAIRS) break pairs;
      checkedPairs++;
      const b = boxes[j];
      if ((!near[i] || !near[j]) && boxGapMm(a.bounds, b.bounds) <= FLOATING_GAP_THRESHOLD_MM) {
        near[i] = true;
        near[j] = true;
      }
      const ox = Math.min(a.bounds.max[0], b.bounds.max[0]) - Math.max(a.bounds.min[0], b.bounds.min[0]);
      const oy = Math.min(a.bounds.max[1], b.bounds.max[1]) - Math.max(a.bounds.min[1], b.bounds.min[1]);
      const oz = Math.min(a.bounds.max[2], b.bounds.max[2]) - Math.max(a.bounds.min[2], b.bounds.min[2]);
      if (ox <= INTERFERENCE_EPSILON_MM || oy <= INTERFERENCE_EPSILON_MM || oz <= INTERFERENCE_EPSILON_MM) continue;
      // SAT 仅排除确定分离的定向包围盒，不计算实体碰撞或穿透深度。
      if (!orientedBox(a).intersectsOBB(orientedBox(b)) || isCoaxialNestedColumnPair(a, b)) continue;
      interferenceCount++;
      warn({
        level: "warning", path: `parts.${b.index}.position`, partId: b.part.id,
        message: `与零件 "${a.part.id}" 的包围盒可能存在空间干涉，请人工核对；包围盒交叠不代表实体碰撞`,
      });
    }
  }

  const complete = checkedPairs === totalPairs;
  // 未扫描所有对时无法判断剩余近邻，不能据此输出可能悬空的提示。
  if (complete) {
    for (const [index, box] of boxes.entries()) {
      if (near[index]) continue;
      floatingCount++;
      warn({
        level: "warning", path: `parts.${box.index}.position`, partId: box.part.id,
        message: `零件可能悬空：包围盒距其他构件和地面均超过 ${FLOATING_GAP_THRESHOLD_MM}mm；配件或墙体等连接可能未建模，请人工核对支撑`,
      });
    }
  }

  if (!complete) {
    issues.push({
      level: "warning", path: "parts",
      message: `几何检查未完成：已检查 ${checkedPairs} / ${totalPairs} 对构件（上限 ${MAX_GEOMETRY_PAIRS} 对），其余未检查；已发现 ${interferenceCount} 项包围盒可能干涉，显示 ${displayed} 项${interferenceCount > displayed ? `，警告输出已截断（上限 ${MAX_GEOMETRY_WARNINGS} 项）` : ""}；悬空检查未完成，未输出悬空提示`,
    });
  } else if (interferenceCount + floatingCount > displayed) {
    issues.push({
      level: "warning", path: "parts",
      message: `几何警告输出已截断：已检查全部 ${totalPairs} 对构件，发现 ${interferenceCount} 项包围盒可能干涉及 ${floatingCount} 项可能悬空，共显示 ${displayed} 项（上限 ${MAX_GEOMETRY_WARNINGS} 项）`,
    });
  }
}

export function inspectDesign(
  input: unknown,
  catalog: Catalog,
  accessories: AccessoryCatalog,
): { design: Design | null; issues: ValidationIssue[] } {
  const parsed = DesignSchema.safeParse(input);
  if (!parsed.success) {
    const rawParts = input && typeof input === "object" && "parts" in input && Array.isArray(input.parts)
      ? input.parts : [];
    return {
      design: null,
      issues: parsed.error.issues.map((issue) => {
        const part = issue.path[0] === "parts" && typeof issue.path[1] === "number"
          ? rawParts[issue.path[1]] : undefined;
        return {
          level: "error",
          path: issue.path.map(String).join(".") || "(根)",
          ...(part && typeof part.id === "string" ? { partId: part.id } : {}),
          message: issue.message,
        };
      }),
    };
  }

  const design = parsed.data;
  const issues: ValidationIssue[] = [];
  const profileIds = new Set(catalog.profiles.map((profile) => profile.id));
  const accessoryIds = new Set(accessories.accessories.map((accessory) => accessory.id));
  const partIds = new Set<string>();

  if (design.parts.length === 0) {
    issues.push({ level: "warning", path: "parts", message: "项目尚无零件，可以保存后继续编辑" });
  }

  const partBoxes: PartBox[] = [];

  for (const [index, part] of design.parts.entries()) {
    const error = (field: string, message: string) => issues.push({
      level: "error", path: `parts.${index}.${field}`, partId: part.id, message,
    });
    if (partIds.has(part.id)) error("id", `零件 id 重复: ${part.id}`);
    partIds.add(part.id);
    if (part.kind === "beam") {
      if (!part.profile) error("profile", "kind=beam 必须指定 profile");
      else if (!profileIds.has(part.profile)) error("profile", `型材 "${part.profile}" 不在 catalog 中`);
    } else if (part.profile) {
      error("profile", `kind=${part.kind} 不应指定 profile`);
    }

    // 复用渲染的 Euler 与型材轴向变换，不用未旋转的 size 猜测高度。
    const bounds = designBounds([part]);
    if (![...bounds.min, ...bounds.max, ...bounds.center, bounds.radius].every(Number.isFinite)) {
      error("size", "旋转后的包围盒超出可计算范围");
    } else {
      partBoxes.push({ index, part, bounds });
      if (bounds.min[1] < -0.5) {
        error("position", `零件低于地面 ${(-bounds.min[1]).toFixed(1)}mm`);
      }
    }
  }

  if (partBoxes.length === design.parts.length && partBoxes.length > 0) {
    inspectGeometry(partBoxes, issues);
  } else if (partBoxes.length !== design.parts.length) {
    issues.push({
      level: "warning", path: "parts",
      message: `几何检查未完成：${design.parts.length} 个构件中有 ${design.parts.length - partBoxes.length} 个包围盒无法计算；未检查构件对及悬空情况`,
    });
  }

  for (const [index, accessory] of design.accessories.entries()) {
    if (!accessoryIds.has(accessory.ref)) {
      issues.push({
        level: "error", path: `accessories.${index}.ref`,
        message: `配件引用 "${accessory.ref}" 不在配件库中`,
      });
    }
  }

  issues.push(...inspectAccessoryConnections(design, catalog, accessories));

  if (design.meta.heightRange != null) {
    const [minHeight, maxHeight] = design.meta.heightRange;
    if (minHeight > maxHeight) {
      issues.push({
        level: "error", path: "meta.heightRange",
        message: `高度范围最低值 ${minHeight}mm 不能大于最高值 ${maxHeight}mm`,
      });
    }
  }

  if (design.parts.length > 0) {
    const bounds = designBounds(design.parts);
    if (![...bounds.min, ...bounds.max, ...bounds.center, bounds.radius].every(Number.isFinite)) {
      issues.push({ level: "error", path: "parts", message: "整体包围盒超出可计算范围" });
    } else if (design.meta.frameHeight != null) {
      const top = bounds.max[1];
      const diff = Math.abs(top - design.meta.frameHeight);
      if (diff > 5) {
        issues.push({
          level: "error", path: "meta.frameHeight",
          message: `模型顶面 ${top.toFixed(1)}mm 与 meta.frameHeight ${design.meta.frameHeight}mm 相差 ${diff.toFixed(1)}mm`,
        });
      }
    }
  }

  return { design: issues.some((issue) => issue.level === "error") ? null : design, issues };
}
