import * as THREE from "three";
import type { Part, Profile } from "./schema";
import { beamDims, longAxis } from "./materials";
import type { SceneBounds, Vec3 } from "./scene-fit";

/**
 * 把一个矩形截面参数化成带四面 T 槽的 THREE.Shape（局部坐标，中心在原点）。
 * 单位 mm，与全局约定一致。
 *
 * 截面宽高取自零件实际尺寸（`size`），槽口参数取自 profile —— 这样
 * 同一套槽口标准可以套用到 40×40、40×80 等不同截面。
 */
export function tSlotShape(profile: Profile, sectionW: number, sectionH: number): THREE.Shape {
  const { open, cavity, lip, neck, depth, bore } = profile.slot;

  const hw = sectionW / 2;
  const hh = sectionH / 2;
  const shape = new THREE.Shape();

  // 槽全深不能挖穿：留出至少 30% 的实心腹板
  const minDim = Math.min(sectionW, sectionH);
  const d = Math.min(depth, minDim * 0.28);
  const scale = d / depth;
  const lipD = lip * scale;
  const neckD = neck * scale;

  const halfOpen = Math.min(open / 2, minDim * 0.16);
  const halfCavity = Math.min(cavity / 2, minDim * 0.2);

  const corners: Array<[number, number]> = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];

  shape.moveTo(-hw, -hh);

  for (let e = 0; e < 4; e++) {
    const a = corners[e];
    const b = corners[(e + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const tx = (b[0] - a[0]) / len;
    const ty = (b[1] - a[1]) / len;

    // 槽口 + 两侧角料必须放得下，否则整条边不挖槽
    const needPerSlot = halfCavity * 2;
    const cornerKeep = minDim * 0.18;
    const canSlot = len > needPerSlot + cornerKeep * 2;

    if (canSlot) {
      // 长边放两个槽，短边放一个
      const twoSlots = len >= minDim * 1.6;
      const centers = twoSlots ? [len / 2 - len / 4, len / 2 + len / 4] : [len / 2];

      for (const c of centers) {
        const pts: Array<[number, number]> = [
          [-halfOpen, 0],
          [-halfOpen, lipD],
          [-halfCavity, neckD],
          [-halfCavity, d],
          [halfCavity, d],
          [halfCavity, neckD],
          [halfOpen, lipD],
          [halfOpen, 0],
        ];
        for (const [u, v] of pts) {
          // 内向法线为 (-ty, tx)
          shape.lineTo(a[0] + tx * (c + u) - ty * v, a[1] + ty * (c + u) + tx * v);
        }
      }
    }

    shape.lineTo(b[0], b[1]);
  }
  shape.closePath();

  // 中心孔。长条形打两个，方形打一个。
  const r = bore / 2;
  const tall = sectionH >= sectionW * 1.6;
  const wide = sectionW >= sectionH * 1.6;
  const bores: Array<[number, number]> = tall
    ? [
        [0, -sectionH / 4],
        [0, sectionH / 4],
      ]
    : wide
      ? [
          [-sectionW / 4, 0],
          [sectionW / 4, 0],
        ]
      : [[0, 0]];

  if (r > 0 && r < minDim / 2 - 3) {
    for (const [cx, cy] of bores) {
      const hole = new THREE.Path();
      hole.absarc(cx, cy, r, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  }

  return shape;
}

/**
 * 沿 Z 轴挤出型材几何，长度居中。
 * 调用方通过旋转把 Z 轴对齐到零件的长轴。
 */
export function beamGeometry(
  profile: Profile,
  sectionW: number,
  sectionH: number,
  length: number,
): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(tSlotShape(profile, sectionW, sectionH), {
    depth: length,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 6,
  });
  geometry.translate(0, 0, -length / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * 把 z 向挤出的几何旋转到指定长轴。
 * 返回**弧度**（three.js / R3F 的 rotation 单位），不是度。
 */
export function axisRotation(axis: "x" | "y" | "z"): [number, number, number] {
  const HALF_PI = Math.PI / 2;
  if (axis === "x") return [0, HALF_PI, 0];
  if (axis === "y") return [-HALF_PI, 0, 0];
  return [0, 0, 0];
}

/** 与 PartMesh 共用同一套 Euler 变换，避免取景与实际几何轴向不一致。 */
export function partRotation(part: Pick<Part, "kind" | "size" | "rotation">): Vec3 {
  const extra = part.rotation.map(THREE.MathUtils.degToRad) as Vec3;
  const base = part.kind === "beam" ? axisRotation(longAxis(part)) : [0, 0, 0];
  return extra.map((value, i) => value + base[i]) as Vec3;
}

/** 用旋转后的包围盒求界；位移可复用拆解数据，不改变零件或几何。 */
export function designBounds(
  parts: Array<{ id?: string; kind?: Part["kind"]; size: Vec3; position: Vec3; rotation?: Vec3 }>,
  offsets?: ReadonlyMap<string, Vec3>,
): SceneBounds {
  if (parts.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 200 };
  }
  const bounds = new THREE.Box3();
  for (const part of parts) {
    const model = { ...part, kind: part.kind ?? "box", rotation: part.rotation ?? [0, 0, 0] as Vec3 };
    const rotation = new THREE.Euler(...partRotation(model));
    const matrix = new THREE.Matrix4().makeRotationFromEuler(rotation);
    const offset = part.id ? offsets?.get(part.id) : undefined;
    matrix.setPosition(...part.position.map((value, i) => value + (offset?.[i] ?? 0)) as Vec3);
    const { sectionW, sectionH, length } = beamDims(model);
    const localSize = model.kind === "beam" ? [sectionW, sectionH, length] as Vec3 : part.size;
    const half = new THREE.Vector3(...localSize).multiplyScalar(0.5);
    bounds.union(new THREE.Box3(half.clone().negate(), half).applyMatrix4(matrix));
  }
  const center = bounds.getCenter(new THREE.Vector3());
  return {
    min: bounds.min.toArray() as Vec3,
    max: bounds.max.toArray() as Vec3,
    center: center.toArray() as Vec3,
    radius: Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 200),
  };
}
