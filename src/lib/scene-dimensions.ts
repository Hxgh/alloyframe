import * as THREE from "three";
import type { Part } from "./schema";
import type { Vec3 } from "./scene-fit";
import { beamDims } from "./materials";
import { designBounds, partRotation } from "./tslot";

export type DimensionGuide = {
  id: string;
  axis: "x" | "y" | "z" | "elevation";
  start: Vec3;
  end: Vec3;
  anchorA: Vec3;
  anchorB: Vec3;
  labelPosition: Vec3;
  /** 尺寸线的实际长度，格式化只影响文字，不改变该值。 */
  valueMm: number;
  label: string;
  /** 世界单位 mm，包含行数与高亮倍率，供渲染及取景共用。 */
  badgeHeight: number;
  highlighted?: boolean;
};

function formatMm(value: number): string {
  if (value === 0) return "0 mm";
  // 小于 10mm 保留至少三位有效数字，常规尺寸保持 0.1mm 精度。
  // 极端小值超出 toFixed 的精度范围时，用科学计数法而不是误显示为零。
  if (value < 1e-98) return `${Number(value.toPrecision(3))} mm`;
  const decimals = value < 10 ? Math.max(1, 2 - Math.floor(Math.log10(value))) : 1;
  return `${Number(value.toFixed(decimals))} mm`;
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function boundsRadius(min: Vec3, max: Vec3): number {
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
}

function withBadgeHeight(guide: Omit<DimensionGuide, "badgeHeight">, radius: number): DimensionGuide {
  // designBounds.radius 有 200mm 的取景下限；标牌须使用实际几何半径。
  const lineHeight = radius < 200 ? radius * 0.12 : Math.max(Math.min(radius * 0.068, 56), 24);
  const badgeHeight = lineHeight * (guide.highlighted ? 1.05 : 1) * guide.label.split("\n").length;
  return { ...guide, badgeHeight };
}

export function buildDimensionGuides(
  parts: Part[],
  selectedId: string | null = null,
  offsets?: ReadonlyMap<string, Vec3>,
): DimensionGuide[] {
  if (parts.length === 0) return [];
  const overall = designBounds(parts, offsets);
  const [minX, minY, minZ] = overall.min;
  const [maxX, maxY, maxZ] = overall.max;
  const widthX = maxX - minX;
  const heightY = maxY - minY;
  const depthZ = maxZ - minZ;
  if (![widthX, heightY, depthZ].every((v) => Number.isFinite(v) && v >= 0)) return [];

  // 标注当前世界包围范围；只有参与渲染的零件实际位移时才标记为拆解展示。
  const exploded = parts.some((part) => offsets?.get(part.id)?.some((value) => value !== 0));
  const stateLabel = exploded ? "拆解展示" : "装配包围";
  const radius = boundsRadius(overall.min, overall.max);
  const margin = radius < 200 ? radius * 0.2 : Math.max(Math.min(radius * 0.12, 120), 40);
  const baseY = minY;
  const guides: DimensionGuide[] = [];
  const addGuide = (guide: Omit<DimensionGuide, "badgeHeight">) => guides.push(withBadgeHeight(guide, radius));

  if (widthX > 0) {
    const z = maxZ + margin;
    const start: Vec3 = [minX, baseY, z];
    const end: Vec3 = [maxX, baseY, z];
    const mid = midpoint(start, end);
    addGuide({
      id: "overall-x",
      axis: "x",
      start,
      end,
      anchorA: [minX, baseY, maxZ],
      anchorB: [maxX, baseY, maxZ],
      labelPosition: [mid[0], mid[1] + margin * 0.25, mid[2]],
      valueMm: widthX,
      label: `${stateLabel}宽 ${formatMm(widthX)}`,
    });
  }

  if (depthZ > 0) {
    const x = maxX + margin;
    const start: Vec3 = [x, baseY, minZ];
    const end: Vec3 = [x, baseY, maxZ];
    const mid = midpoint(start, end);
    addGuide({
      id: "overall-z",
      axis: "z",
      start,
      end,
      anchorA: [maxX, baseY, minZ],
      anchorB: [maxX, baseY, maxZ],
      labelPosition: [mid[0], mid[1] + margin * 0.25, mid[2]],
      valueMm: depthZ,
      label: `${stateLabel}深 ${formatMm(depthZ)}`,
    });
  }

  if (heightY > 0) {
    const x = minX - margin;
    const z = maxZ + margin * 0.5;
    const start: Vec3 = [x, minY, z];
    const end: Vec3 = [x, maxY, z];
    const mid = midpoint(start, end);
    addGuide({
      id: "overall-y",
      axis: "y",
      start,
      end,
      anchorA: [minX, minY, maxZ],
      anchorB: [minX, maxY, maxZ],
      labelPosition: [mid[0] - margin * 0.25, mid[1], mid[2]],
      valueMm: heightY,
      label: `${stateLabel}高 ${formatMm(heightY)}`,
    });
  }

  const selected = selectedId ? parts.find((part) => part.id === selectedId) : null;
  if (selected) {
    const partBox = designBounds([selected], offsets);
    const pMinY = partBox.min[1];
    const pMaxZ = partBox.max[2];
    const partRadius = boundsRadius(partBox.min, partBox.max);
    const localMargin = Math.min(partRadius * 0.18, 60);

    const [sx, sy, sz] = selected.size;
    const axis: "x" | "y" | "z" = sx >= sy && sx >= sz ? "x" : sy >= sz ? "y" : "z";
    const { length, sectionW, sectionH } = beamDims(selected);
    const localSize: Vec3 = selected.kind === "beam" ? [sectionW, sectionH, length] : selected.size;
    const localAxis = selected.kind === "beam" ? 2 : axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const size = localSize[localAxis];

    if (size > 0) {
      // 沿实际几何的最长边取一条局部边；端点和外移方向均使用 PartMesh 的 Euler 旋转。
      const rotation = new THREE.Euler(...partRotation(selected));
      const center = new THREE.Vector3(...selected.position).add(new THREE.Vector3(...(offsets?.get(selected.id) ?? [0, 0, 0])));
      const corner = new THREE.Vector3(...localSize).multiplyScalar(0.5);
      corner.setComponent(localAxis, 0);
      const direction = new THREE.Vector3().setComponent(localAxis, 1);
      const anchorA = corner.clone().addScaledVector(direction, -size / 2).applyEuler(rotation).add(center);
      const anchorB = corner.clone().addScaledVector(direction, size / 2).applyEuler(rotation).add(center);
      const displacement = corner.clone().normalize().applyEuler(rotation).multiplyScalar(localMargin);
      const start = anchorA.clone().add(displacement);
      const end = anchorB.clone().add(displacement);
      const labelPosition = start.clone().add(end).multiplyScalar(0.5).addScaledVector(displacement, 0.35);
      const dimensions = selected.size.join(" × ");

      addGuide({
        id: `selected-${selected.id}-size`,
        axis,
        start: start.toArray() as Vec3,
        end: end.toArray() as Vec3,
        anchorA: anchorA.toArray() as Vec3,
        anchorB: anchorB.toArray() as Vec3,
        labelPosition: labelPosition.toArray() as Vec3,
        valueMm: size,
        label: `${selected.role} 长边 ${formatMm(size)}\n原始尺寸 X × Y × Z：${dimensions} mm`,
        highlighted: true,
      });
    }

    if (pMinY > 1) {
      const x = partBox.center[0];
      const z = pMaxZ + localMargin * 0.6;
      const start: Vec3 = [x, 0, z];
      const end: Vec3 = [x, pMinY, z];
      addGuide({
        id: `selected-${selected.id}-elevation`,
        axis: "elevation",
        start,
        end,
        anchorA: [x, 0, pMaxZ],
        anchorB: [x, pMinY, pMaxZ],
        labelPosition: [x, pMinY / 2, z + localMargin * 0.3],
        valueMm: pMinY,
        label: `${exploded ? "拆解展示" : "装配"}离地 ${formatMm(pMinY)}`,
        highlighted: true,
      });
    }
  }

  return guides;
}
