import * as THREE from "three";
import type { Profile } from "./schema";

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

/** 相机自动取景需要知道整体包围盒，这里按零件列表算 */
export function designBounds(
  parts: Array<{ size: [number, number, number]; position: [number, number, number] }>,
): { center: [number, number, number]; radius: number } {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (const p of parts) {
    const [sx, sy, sz] = p.size;
    const [px, py, pz] = p.position;
    minX = Math.min(minX, px - sx / 2);
    maxX = Math.max(maxX, px + sx / 2);
    minY = Math.min(minY, py - sy / 2);
    maxY = Math.max(maxY, py + sy / 2);
    minZ = Math.min(minZ, pz - sz / 2);
    maxZ = Math.max(maxZ, pz + sz / 2);
  }

  const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const radius = Math.max(
    Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2,
    200,
  );
  return { center, radius };
}
