import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createElement, type ReactElement } from "react";
import * as THREE from "three";
import ts from "typescript";
import catalogJson from "../../../data/catalog/profiles.json";
import accessoriesJson from "../../../data/catalog/accessories.json";
import designJson from "../../../data/designs/standing-desk.json";
import { AccessoryCatalogSchema, CatalogSchema, DesignSchema, PartSchema, type Part } from "../schema";
import { inspectDesign } from "../validation";
import { buildDimensionGuides, type DimensionGuide } from "../scene-dimensions";
import { beamDims } from "../materials";
import { designBounds, partRotation } from "../tslot";
import { boundsWithGuides, cameraBounds, type Vec3 } from "../scene-fit";
import { PROJECT_TEMPLATES, buildTemplateDesign } from "../project-templates";
import { createProjectStore } from "../project-store";

const catalog = CatalogSchema.parse(catalogJson);
const accessories = AccessoryCatalogSchema.parse(accessoriesJson);
const standingDesk = DesignSchema.parse(designJson);

test("三维尺寸标尺：未选中构件时输出整体宽深高，选中构件时追加构件主尺寸与离地净空", () => {
  assert.deepEqual(buildDimensionGuides([]), []);

  const overall = buildDimensionGuides(standingDesk.parts, null);
  assert.deepEqual(overall.map((guide) => guide.id), ["overall-x", "overall-z", "overall-y"]);
  assert.equal(overall.find((guide) => guide.id === "overall-x")?.label, "装配尺寸宽 1400 mm");
  assert.equal(overall.find((guide) => guide.id === "overall-z")?.label, "装配尺寸深 700 mm");
  assert.equal(overall.find((guide) => guide.id === "overall-y")?.label, "装配尺寸高 720 mm");
  const bounds = designBounds(standingDesk.parts);
  const radius = Math.hypot(...bounds.max.map((value, i) => value - bounds.min[i])) / 2;
  const margin = Math.max(Math.min(radius * 0.12, 120), 40);
  nearNumber(overall.find((guide) => guide.id === "overall-x")!.start[2] - bounds.max[2], margin, 1e-10, "普通模型保持原有标尺外移");
  nearNumber(overall[0].badgeHeight, Math.max(Math.min(radius * 0.068, 56), 24), 1e-10, "普通模型保持原有单行标牌高度");

  const withSelected = buildDimensionGuides(standingDesk.parts, "frame-rail-front");
  const sizeGuide = withSelected.find((guide) => guide.id === "selected-frame-rail-front-size");
  const elevationGuide = withSelected.find((guide) => guide.id === "selected-frame-rail-front-elevation");
  assert.ok(sizeGuide);
  assert.equal(sizeGuide.highlighted, true);
  assert.equal(sizeGuide.label, "长边框 长边 1300 mm\n原始尺寸 X × Y × Z：1300 × 40 × 40 mm");
  assert.equal(sizeGuide.valueMm, 1300);
  nearNumber(sizeGuide.badgeHeight, overall[0].badgeHeight * 1.05 * 2, 1e-10, "高亮双行标牌保留原有视觉倍率");
  assert.ok(elevationGuide);
  assert.equal(elevationGuide.label, "离地 655 mm");

  // 贴地构件（minY === 0）不生成冗余离地高度线
  const withGroundPart = buildDimensionGuides(standingDesk.parts, "foot-left");
  assert.equal(withGroundPart.some((guide) => guide.id === "selected-foot-left-elevation"), false);
});

function fixture(overrides: Partial<Part> = {}): Part {
  return PartSchema.parse({
    id: "test-part", kind: "beam", role: "测试梁", profile: "4040", material: "铝",
    size: [1000, 40, 40], position: [110, 800, -70], rotation: [0, 0, 0],
    ...overrides,
  });
}

function selectedGuide(parts: Part[], id: string, offsets?: ReadonlyMap<string, Vec3>): DimensionGuide {
  const guide = buildDimensionGuides(parts, id, offsets).find((item) => item.id === `selected-${id}-size`);
  assert.ok(guide, `缺少构件 ${id} 的尺寸线`);
  return guide;
}

function near(actual: Vec3, expected: Vec3, message: string, tolerance = 1e-7) {
  const error = new THREE.Vector3(...actual).distanceTo(new THREE.Vector3(...expected));
  assert.ok(error <= tolerance, `${message}: ${actual} != ${expected}，误差 ${error} > ${tolerance}`);
}

function nearNumber(actual: number, expected: number, tolerance: number, message: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}，容差 ${tolerance}`);
}

function checkGuideGeometry(part: Part, guide: DimensionGuide, localAxis: 0 | 1 | 2, localSize: Vec3, offset: Vec3 = [0, 0, 0]) {
  const rotation = new THREE.Euler(...partRotation(part));
  const center = new THREE.Vector3(...part.position).add(new THREE.Vector3(...offset));
  const tolerance = Math.max(...localSize) * 1e-9;
  const midpoint = (a: Vec3, b: Vec3) => new THREE.Vector3(...a).add(new THREE.Vector3(...b)).multiplyScalar(0.5);
  const direction = new THREE.Vector3().setComponent(localAxis, 1).applyEuler(rotation);
  const endToEnd = new THREE.Vector3(...guide.end).sub(new THREE.Vector3(...guide.start));
  near(endToEnd.toArray() as Vec3, direction.multiplyScalar(localSize[localAxis]).toArray() as Vec3, "标尺必须沿实际渲染轴，长度等于零件尺寸", tolerance);
  const toLocal = (point: Vec3) => new THREE.Vector3(...point).sub(center).applyQuaternion(new THREE.Quaternion().setFromEuler(rotation).invert());
  const a = toLocal(guide.anchorA);
  const b = toLocal(guide.anchorB);
  nearNumber(a.getComponent(localAxis), -localSize[localAxis] / 2, tolerance, "起点必须位于零件端面");
  nearNumber(b.getComponent(localAxis), localSize[localAxis] / 2, tolerance, "终点必须位于零件端面");
  for (let i = 0; i < 3; i++) {
    if (i === localAxis) continue;
    nearNumber(a.getComponent(i), localSize[i] / 2, tolerance, `起点局部 ${i} 轴须在几何边缘`);
    nearNumber(b.getComponent(i), localSize[i] / 2, tolerance, `终点局部 ${i} 轴须在几何边缘`);
  }
  const displacementA = new THREE.Vector3(...guide.start).sub(new THREE.Vector3(...guide.anchorA));
  const displacementB = new THREE.Vector3(...guide.end).sub(new THREE.Vector3(...guide.anchorB));
  near(displacementA.toArray() as Vec3, displacementB.toArray() as Vec3, "两个锚点应平行外移", tolerance);
  assert.ok(displacementA.length() > 0 && Math.abs(displacementA.clone().normalize().dot(endToEnd.clone().normalize())) < 1e-9);
  const centerOfLine = midpoint(guide.start, guide.end);
  near(
    new THREE.Vector3(...guide.labelPosition).sub(centerOfLine).toArray() as Vec3,
    displacementA.multiplyScalar(0.35).toArray() as Vec3,
    "标牌位于尺寸线中点外侧",
    tolerance,
  );
}

test("1mm 与亚毫米模型保留三轴真实尺寸、非零文字与等比例外移", () => {
  for (const [size, expected] of [[1, "1"], [0.5, "0.5"], [0.049, "0.049"], [0.001, "0.001"]] as const) {
    const part = fixture({
      id: "micro", kind: "box", profile: null, role: "微型方块",
      size: [size, size, size], position: [0, size / 2, 0],
    });
    const before = structuredClone(part);
    const guides = buildDimensionGuides([part], part.id);
    assert.deepEqual(guides.map((guide) => guide.id), ["overall-x", "overall-z", "overall-y", "selected-micro-size"]);
    const radius = Math.sqrt(3) * size / 2;
    const margin = radius * 0.2;
    const tolerance = size * 1e-12;
    for (const [id, axisIndex, chinese] of [["overall-x", 0, "宽"], ["overall-y", 1, "高"], ["overall-z", 2, "深"]] as const) {
      const guide = guides.find((item) => item.id === id)!;
      assert.equal(guide.label, `装配尺寸${chinese} ${expected} mm`);
      nearNumber(guide.valueMm, size, tolerance, `${id} 的值不能归零`);
      nearNumber(new THREE.Vector3(...guide.end).distanceTo(new THREE.Vector3(...guide.start)), guide.valueMm, tolerance, `${id} 的几何长度必须与数值一致`);
      nearNumber(Math.abs(guide.end[axisIndex] - guide.start[axisIndex]), size, tolerance, `${id} 应沿对应轴`);
      const displacement = new THREE.Vector3(...guide.start).sub(new THREE.Vector3(...guide.anchorA)).length();
      nearNumber(displacement, margin * (id === "overall-y" ? Math.sqrt(1.25) : 1), tolerance, `${id} 应按真实模型尺度外移`);
      nearNumber(guide.badgeHeight, radius * 0.12, tolerance, `${id} 标牌高度应随真实模型等比缩小`);
    }
    const selected = selectedGuide([part], part.id);
    assert.equal(selected.label, `微型方块 长边 ${expected} mm\n原始尺寸 X × Y × Z：${size} × ${size} × ${size} mm`);
    assert.equal(selected.valueMm, size);
    nearNumber(selected.badgeHeight, radius * 0.12 * 1.05 * 2, tolerance, "双行高亮标牌应包含对应倍率");
    nearNumber(new THREE.Vector3(...selected.start).distanceTo(new THREE.Vector3(...selected.anchorA)), radius * 0.18, tolerance, "构件标尺外移应随真实模型等比缩小");
    checkGuideGeometry(part, selected, 0, part.size);
    assert.deepEqual(part, before);
  }
});

test("微型小数按有效位数显示，数值仍保存真实尺寸", () => {
  for (const [size, text] of [[0.049, "0.049"], [0.0000491, "0.0000491"], [0.423, "0.423"], [0.9999, "1"], [1.23456, "1.23"], [9.876, "9.88"], [10.26, "10.3"], [100, "100"]] as const) {
    const part = fixture({ kind: "box", profile: null, size: [size, size / 2, size / 4], position: [0, size, 0] });
    const guide = selectedGuide([part], part.id);
    assert.equal(guide.valueMm, size);
    assert.ok(guide.label.startsWith(`测试梁 长边 ${text} mm\n`), `${size}: ${guide.label}`);
    assert.ok(Number(text) > 0);
    assert.ok(guide.label.includes(`原始尺寸 X × Y × Z：${part.size.join(" × ")} mm`));
  }
  const extremelySmall = fixture({ kind: "box", profile: null, size: [1e-101, 1e-101, 1e-101], position: [0, 1e-101, 0] });
  const guide = selectedGuide([extremelySmall], extremelySmall.id);
  assert.equal(guide.valueMm, 1e-101);
  assert.match(guide.label, /长边 1e-101 mm/);
});

test("微型非方截面型材和零件旋转、拆解时标尺与实际变换对齐", () => {
  for (const part of [
    fixture({ id: "micro-beam", size: [0.049, 0.008, 0.004], position: [0.02, 0.06, -0.03], rotation: [23, -31, 47] }),
    fixture({ id: "micro-box", kind: "box", profile: null, size: [0.0004, 0.001, 0.0002], position: [0.002, 0.003, -0.004], rotation: [-27, 18, 61] }),
  ]) {
    const before = structuredClone(part);
    const offset: Vec3 = [0.003, 0.004, -0.002];
    const offsets = new Map<string, Vec3>([[part.id, offset]]);
    const assembled = buildDimensionGuides([part], part.id);
    const guides = buildDimensionGuides([part], part.id, offsets);
    const selected = selectedGuide([part], part.id, offsets);
    const { length, sectionW, sectionH } = beamDims(part);
    const localSize: Vec3 = part.kind === "beam" ? [sectionW, sectionH, length] : part.size;
    const localAxis = part.kind === "beam" ? 2 : 1;
    checkGuideGeometry(part, selected, localAxis, localSize, offset);
    assert.equal(selected.valueMm, Math.max(...part.size));
    // 整体标注基于装配状态，不受拆解影响
    const bounds = designBounds([part], undefined);
    const tolerance = Math.max(...part.size) * 1e-10;
    for (const [id, axis, text] of [["overall-x", 0, "宽"], ["overall-y", 1, "高"], ["overall-z", 2, "深"]] as const) {
      const guide = guides.find((item) => item.id === id)!;
      if (axis !== 1) {
        nearNumber(guide.anchorA[1], bounds.min[1], tolerance, `${id} 的引线应连接到装配状态下边界`);
        nearNumber(guide.anchorB[1], bounds.min[1], tolerance, `${id} 的引线应连接到装配状态下边界`);
      }
      nearNumber(guide.valueMm, bounds.max[axis] - bounds.min[axis], tolerance, `${id} 应反映装配状态包围尺寸`);
      nearNumber(new THREE.Vector3(...guide.start).distanceTo(new THREE.Vector3(...guide.end)), guide.valueMm, tolerance, `${id} 标尺长度应等于真实尺寸`);
      const match = guide.label.match(new RegExp(`^装配尺寸${text} (.+) mm$`));
      assert.ok(match && Number(match[1]) > 0);
      assert.ok(Math.abs(Number(match[1]) - guide.valueMm) / guide.valueMm <= 0.005, `${id} 标牌显示应在真实值 0.5% 内`);
      assert.match(assembled.find((item) => item.id === id)!.label, /^装配尺寸/);
    }
    const previous = selectedGuide([part], part.id);
    for (const key of ["start", "end", "anchorA", "anchorB", "labelPosition"] as const) {
      near(selected[key], new THREE.Vector3(...previous[key]).add(new THREE.Vector3(...offset)).toArray() as Vec3, `${key} 应随拆解平移`, tolerance);
    }
    assert.deepEqual(part, before);
  }
});

test("45° 型材尺寸线显示真实最长边，而非旋转后的世界包围盒", () => {
  const part = fixture({ rotation: [0, -45, 0] });
  const before = structuredClone(part);
  const bounds = designBounds([part]);
  assert.ok(Math.abs((bounds.max[0] - bounds.min[0]) - 735.3910524) < 1e-6);
  const guide = selectedGuide([part], part.id);
  assert.equal(guide.valueMm, 1000);
  assert.equal(guide.label, "测试梁 长边 1000 mm\n原始尺寸 X × Y × Z：1000 × 40 × 40 mm");
  checkGuideGeometry(part, guide, 2, [40, 40, 1000]);
  assert.deepEqual(part, before, "标注不能改变设计数据");
});

test("非方截面型材及其他零件按实际渲染几何确定长度、方向和锚点", () => {
  const fixtures: Array<{ part: Part; localAxis: 0 | 1 | 2 }> = [
    { part: fixture({ id: "beam-x", size: [1000, 80, 40], rotation: [23, -31, 47] }), localAxis: 2 },
    { part: fixture({ id: "beam-y", size: [80, 1000, 40], rotation: [19, 33, -24] }), localAxis: 2 },
    { part: fixture({ id: "beam-z", size: [80, 40, 1000], rotation: [-27, 18, 61] }), localAxis: 2 },
    { part: fixture({ id: "plate", kind: "plate", profile: null, role: "板材", size: [200, 25, 600], rotation: [15, 20, 35] }), localAxis: 2 },
    { part: fixture({ id: "column", kind: "column", profile: null, role: "立柱", size: [900, 80, 40], rotation: [12, -17, 28] }), localAxis: 0 },
    { part: fixture({ id: "box", kind: "box", profile: null, role: "方块", size: [100, 500, 60], rotation: [12, -17, 28] }), localAxis: 1 },
    { part: fixture({ id: "tiny", kind: "box", profile: null, role: "小方块", size: [0.423, 0.2, 0.3], rotation: [20, 30, 40] }), localAxis: 0 },
  ];
  for (const { part, localAxis } of fixtures) {
    const dims = beamDims(part);
    const localSize: Vec3 = part.kind === "beam" ? [dims.sectionW, dims.sectionH, dims.length] : part.size;
    const guide = selectedGuide([part], part.id);
    assert.equal(guide.valueMm, Math.max(...part.size), `${part.id} 的真实长度不能被文字精度截断`);
    assert.ok(guide.label.includes(`${part.size.join(" × ")} mm`), part.id);
    checkGuideGeometry(part, guide, localAxis, localSize);
  }
});

test("拆解位移只平移零件尺寸线，整体包围固定装配状态", () => {
  const part = fixture({ rotation: [45, 0, 0] });
  const other = fixture({ id: "other", size: [600, 40, 80], position: [-700, 180, 120] });
  const parts = [part, other];
  const offset: Vec3 = [120, 150, -75];
  const offsets = new Map<string, Vec3>([[part.id, offset], [other.id, [-80, -30, 50]]]);
  const original = structuredClone(parts);
  const assembled = buildDimensionGuides(parts, part.id);
  const exploded = buildDimensionGuides(parts, part.id, offsets);
  const before = selectedGuide(parts, part.id);
  const after = selectedGuide(parts, part.id, offsets);
  assert.equal(after.valueMm, before.valueMm);
  assert.equal(after.label, before.label);
  for (const key of ["start", "end", "anchorA", "anchorB", "labelPosition"] as const) {
    const expected = new THREE.Vector3(...before[key]).add(new THREE.Vector3(...offset));
    near(after[key], expected.toArray() as Vec3, `${key} 应随零件同向平移`);
  }
  checkGuideGeometry(part, after, 2, [40, 40, 1000], offset);
  
  // 关键修改：整体包围固定装配状态，不受拆解影响
  const assembledBounds = designBounds(parts, undefined);
  for (const [id, index, label] of [["overall-x", 0, "宽"], ["overall-y", 1, "高"], ["overall-z", 2, "深"]] as const) {
    const guideAssembled = assembled.find((item) => item.id === id);
    const guideExploded = exploded.find((item) => item.id === id);
    assert.ok(guideAssembled && guideExploded);
    // 两者数值相同，都基于装配状态
    assert.equal(guideAssembled.valueMm, guideExploded.valueMm);
    nearNumber(guideExploded.valueMm, assembledBounds.max[index] - assembledBounds.min[index], 1e-10, `${id} 必须等于装配包围跨度`);
    // 标签都是"装配尺寸"
    assert.match(guideExploded.label, new RegExp(`^装配尺寸${label} `));
    assert.match(guideAssembled.label, new RegExp(`^装配尺寸${label} `));
  }
  
  // 选中零件的离地高度跟随拆解
  const elevation = exploded.find((item) => item.id === `selected-${part.id}-elevation`);
  const assembledElevation = assembled.find((item) => item.id === `selected-${part.id}-elevation`);
  assert.ok(elevation && assembledElevation);
  nearNumber(elevation.valueMm, designBounds([part], offsets).min[1], 1e-10, "拆解离地距离必须采用真实几何");
  nearNumber(elevation.valueMm, assembledElevation.valueMm + offset[1], 1e-10, "离地距离随拆解位移变化");
  assert.match(elevation.label, /^离地 /);
  assert.match(assembledElevation.label, /^离地 /);
  assert.deepEqual(elevation.start.slice(0, 2), [designBounds([part], offsets).center[0], 0]);
  assert.equal(elevation.end[1], designBounds([part], offsets).min[1]);
  assert.equal(elevation.labelPosition[1], elevation.end[1] / 2);
  const almostGrounded = fixture({ kind: "box", profile: null, size: [100, 100, 100], position: [0, 51, 0] });
  const lifted = buildDimensionGuides([almostGrounded], almostGrounded.id, new Map([[almostGrounded.id, [0, 2, 0]]]));
  assert.equal(buildDimensionGuides([almostGrounded], almostGrounded.id).some((guide) => guide.axis === "elevation"), false);
  assert.equal(lifted.find((guide) => guide.axis === "elevation")?.label, "离地 3 mm");
  const lowered = buildDimensionGuides([almostGrounded], almostGrounded.id, new Map([[almostGrounded.id, [0, -3, 0]]]));
  assert.equal(lowered.some((guide) => guide.axis === "elevation"), false);
  // 整体标注基于装配状态，不受拆解影响
  const groundedBounds = designBounds([almostGrounded], undefined);
  assert.equal(lowered.find((guide) => guide.id === "overall-x")!.anchorA[1], groundedBounds.min[1]);
  assert.equal(lowered.find((guide) => guide.id === "overall-z")!.anchorB[1], groundedBounds.min[1]);
  assert.deepEqual(parts, original);
});

test("零偏移与无关偏移结果一致，整体标注始终为装配尺寸", () => {
  const part = fixture();
  const zeroOffsets = new Map<string, Vec3>([[part.id, [0, 0, 0]], ["missing", [10, 20, 30]]]);
  assert.deepEqual(buildDimensionGuides([part], part.id, zeroOffsets), buildDimensionGuides([part], part.id));
  const other = fixture({ id: "other", position: [800, 600, 0] });
  const movedOther = buildDimensionGuides([part, other], part.id, new Map([[other.id, [10, 0, 0]]]));
  // 整体标注始终为"装配尺寸"，不受拆解影响
  assert.match(movedOther.find((guide) => guide.id === "overall-x")!.label, /^装配尺寸/);
  // 选中零件的离地标注也是"离地"
  assert.match(movedOther.find((guide) => guide.id === `selected-${part.id}-elevation`)!.label, /^离地/);
});

test("渲染标牌直接使用共享高度与实测纹理宽高比", async () => {
  const file = "../../components/scene/SceneDimensions.tsx";
  const source = ts.createSourceFile(file, await fs.readFile(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ["guideColor", "DimensionItem"].map((name) => {
    const declaration = source.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
    assert.ok(declaration, `缺少组件函数 ${name}`);
    return declaration.getText(source);
  });
  const code = ts.transpileModule(`${declarations.join("\n")}\nDimensionItem`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "h" },
  }).outputText;
  const aspect = 3.25;
  let texture = new THREE.Texture();
  const DimensionItem = runInNewContext(code, {
    THREE, h: createElement, useMemo: (factory: () => unknown) => factory(), useEffect: () => {},
    createBadgeTexture: () => ({ texture, aspect }),
  }) as (props: { guide: DimensionGuide; dark: boolean }) => ReactElement<{ children: [ReactElement, ReactElement<{ scale: Vec3; position: Vec3 }>] }>;
  for (const size of [1, 0.049, 0.001, 1000]) {
    const part = fixture({ kind: "box", profile: null, size: [size, size, size], position: [0, size / 2, 0] });
    for (const guide of buildDimensionGuides([part], part.id)) {
      texture = new THREE.Texture();
      const rendered = DimensionItem({ guide, dark: false });
      const [lines, sprite] = rendered.props.children;
      const geometry = (lines.props as { geometry: THREE.BufferGeometry }).geometry;
      assert.equal(sprite.type, "sprite");
      assert.equal(sprite.props.position, guide.labelPosition);
      assert.equal(sprite.props.scale[0], guide.badgeHeight * aspect);
      assert.equal(sprite.props.scale[1], guide.badgeHeight);
      assert.equal(sprite.props.scale[2], 1);
      geometry.dispose();
      texture.dispose();
    }
  }
});

test("微型模型取景包围使用相同标牌高度，覆盖中英文文字与双行标牌", () => {
  for (const size of [1, 0.049, 0.001]) {
    const part = fixture({
      kind: "box", profile: null, role: "微型尺寸测试零件", size: [size, size, size], position: [0, size / 2, 0],
    });
    const raw = designBounds([part]);
    const guides = buildDimensionGuides([part], part.id);
    const fitted = boundsWithGuides(cameraBounds(raw), guides);
    // 至少覆盖真实标牌宽高所形成的半对角线；高度应来自 guide 而非 24mm 或 200mm 下限。
    for (const guide of guides) {
      const lines = guide.label.split("\n");
      // 近似单字字符宽 0.62em，中文宽 1em；绘制代码横向留白为 20/14em。
      const longest = Math.max(...lines.map((line) => Array.from(line).reduce((sum, char) => sum + (char.charCodeAt(0) > 0x7f ? 1 : 0.62), 0)));
      const aspect = (longest + 20 / 14) / (lines.length * 1.25 + 12 / 14);
      const padding = Math.hypot(guide.badgeHeight * aspect, guide.badgeHeight) / 2;
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(fitted.min[axis] <= guide.labelPosition[axis] - padding + size * 1e-12, `${guide.id} 第 ${axis} 轴最小边界须包住标牌`);
        assert.ok(fitted.max[axis] >= guide.labelPosition[axis] + padding - size * 1e-12, `${guide.id} 第 ${axis} 轴最大边界须包住标牌`);
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(fitted.max[axis] - fitted.min[axis] < size * 10, `取景范围不能引入固定毫米标牌：${size}`);
    }
  }
});

test("尺寸标牌按行测量并绘制，不将换行文本挤在单行", async () => {
  const file = "../../components/scene/SceneDimensions.tsx";
  const source = ts.createSourceFile(file, await fs.readFile(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === "createBadgeTexture");
  assert.ok(declaration);
  const code = ts.transpileModule(`${declaration.getText(source)}\ncreateBadgeTexture`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const drawn: Array<{ text: string; x: number; y: number }> = [];
  const measured: string[] = [];
  const context = {
    font: "", fillStyle: "", lineWidth: 0, strokeStyle: "", textAlign: "", textBaseline: "",
    measureText(text: string) { measured.push(text); return { width: text.length * 10 }; },
    clearRect() {}, beginPath() {}, roundRect() {}, fill() {}, stroke() {},
    fillText(text: string, x: number, y: number) { drawn.push({ text, x, y }); },
  };
  const canvas = { width: 0, height: 0, getContext: () => context };
  const createBadgeTexture = runInNewContext(code, { THREE, document: { createElement: () => canvas } }) as
    (text: string, color: string, dark: boolean) => { texture: THREE.CanvasTexture; aspect: number };
  const part = fixture({ size: [1000, 80, 40], rotation: [0, -45, 0] });
  const text = selectedGuide([part], part.id).label;
  const badge = createBadgeTexture(text, "#fff", false);
  assert.deepEqual(measured, text.split("\n"));
  assert.deepEqual(drawn.map((item) => item.text), text.split("\n"));
  assert.equal(drawn[0].x, canvas.width / 2);
  assert.equal(drawn[1].x, canvas.width / 2);
  assert.ok(drawn[0].y < drawn[1].y && drawn[1].y < canvas.height);
  assert.equal(badge.aspect, canvas.width / canvas.height);
  badge.texture.dispose();
});

test("所有内置构型模板均通过严格 schema、引用、旋转几何与空间干涉/悬空校验", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "alloyframe-templates-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createProjectStore({ root, catalog, accessories, writable: true });

  for (const template of PROJECT_TEMPLATES) {
    const design = buildTemplateDesign(`测试-${template.label}`, template.id);
    const inspected = inspectDesign(design, catalog, accessories);
    assert.ok(inspected.design, `模板 ${template.id} 应当有效`);
    if (template.id === "blank") {
      assert.equal(inspected.design.parts.length, 0);
    } else {
      assert.ok(inspected.design.parts.length > 0, `模板 ${template.id} 应当包含零件`);
      assert.deepEqual(inspected.issues, [], `模板 ${template.id} 不应产生任何错误或警告`);
    }

    const created = await store.createProject(template.label, template.id);
    assert.equal(created.design.name, template.label);
    assert.equal(created.design.revision, 0);
    assert.equal(created.design.parts.length, design.parts.length);
  }
});
