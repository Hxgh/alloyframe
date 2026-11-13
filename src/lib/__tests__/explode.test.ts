import assert from "node:assert/strict";
import { test } from "node:test";
import designJson from "../../../data/designs/standing-desk.json";
import { DesignSchema, type Part } from "../schema";
import { explodeOffsets } from "../explode";
import { designBounds } from "../tslot";

const example = DesignSchema.parse(designJson).parts;
const parts: Part[] = [
  { id: "panel", kind: "plate", role: "竖板", material: "木", profile: null, size: [600, 800, 20], position: [0, 500, 0], rotation: [0, 0, 0] },
  { id: "brace", kind: "beam", role: "旋转梁", material: "铝", profile: "4040", size: [600, 40, 40], position: [200, 400, 200], rotation: [0, 0, 25] },
  { id: "foot", kind: "box", role: "脚杯", material: "铝", profile: null, size: [60, 30, 60], position: [-200, 15, -200], rotation: [0, 0, 0] },
];

test("拆解端点可逆，分离程度线性且不修改不同项目数据", () => {
  for (const source of [example, parts]) {
    const before = JSON.stringify(source);
    const zero = explodeOffsets(source, 0);
    const full = explodeOffsets(source, 1);
    for (const part of source) assert.deepEqual(zero.get(part.id), [0, 0, 0]);
    for (const amount of [0.25, 0.5, 0.75]) {
      const offsets = explodeOffsets(source, amount);
      for (const part of source) {
        const expected = full.get(part.id)!;
        const actual = offsets.get(part.id)!;
        for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(actual[axis] - expected[axis] * amount) < 1e-8);
      }
    }
    assert.equal(JSON.stringify(source), before);
    assert.deepEqual(explodeOffsets(source, 0), zero);
  }
});

test("现有设计从装配到完全拆解逐件不穿地，贴地脚杯不再下沉", () => {
  for (const source of [example, parts]) {
    const before = JSON.stringify(source);
    for (const amount of [0, 0.000001, ...Array.from({ length: 100 }, (_, i) => (i + 1) / 100)]) {
      const offsets = explodeOffsets(source, amount);
      for (const part of source) {
        const minY = designBounds([part], offsets).min[1];
        assert.ok(minY >= -1e-8, `${part.id} 在 ${amount * 100}% 时最低点为 ${minY}mm`);
      }
      assert.ok(designBounds(source, offsets).min[1] >= -1e-8);
    }
    assert.equal(JSON.stringify(source), before);
  }
  const full = explodeOffsets(example, 1);
  for (const id of ["foot-left", "foot-right"]) assert.equal(full.get(id)![1], 0);
});

test("按旋转后的净空限制向下拆解，安全下降及水平分离保持原样", () => {
  const fixtures: Array<{ part: Part; clearance: number }> = [
    { part: { ...parts[2], id: "grounded", role: "通用块" }, clearance: 0 },
    { part: { ...parts[2], id: "limited", role: "通用块" }, clearance: 10 },
    { part: { ...parts[2], id: "safe", role: "通用块" }, clearance: 200 },
    { part: { ...parts[2], id: "rotated-box", size: [160, 30, 80], rotation: [25, 35, 40] }, clearance: 5 },
    { part: { ...parts[1], id: "rotated-x-beam", size: [600, 40, 80], rotation: [15, 25, 30] }, clearance: 10 },
    { part: { ...parts[1], id: "rotated-z-beam", size: [40, 80, 600], rotation: [20, 30, 15] }, clearance: 0 },
  ];
  const anchor: Part = { ...parts[0], size: [1000, 20, 1000], position: [0, 2000, 0] };
  const strength = 1000 * 0.14;
  for (const { part, clearance } of fixtures) {
    const halfHeight = -designBounds([{ ...part, position: [0, 0, 0] }]).min[1];
    const grounded: Part = { ...part, position: [200, halfHeight + clearance, 200] };
    const source = [grounded, anchor];
    const before = JSON.stringify(source);
    const minY = designBounds([grounded]).min[1];
    const expectedY = Math.max(-strength * 0.35, -Math.max(0, minY));
    const full = explodeOffsets(source, 1).get(part.id)!;
    assert.ok(Math.abs(full[1] - expectedY) < 1e-8, part.id);
    assert.ok(full[0] > 0 || full[2] > 0, "地面约束不取消水平分离");
    assert.equal(Math.max(full[0], full[2]), strength);
    for (const amount of [0, 0.000001, 0.25, 0.5, 0.75, 1, 0.5, 0]) {
      const offsets = explodeOffsets(source, amount);
      const actual = offsets.get(part.id)!;
      for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(actual[axis] - full[axis] * amount) < 1e-8);
      assert.ok(designBounds([grounded], offsets).min[1] >= -1e-8, part.id);
    }
    if (clearance === 200) assert.equal(full[1], -strength * 0.35, "净空足够时保留原有下降");
    assert.equal(JSON.stringify(source), before);
  }
});

test("装配容差内已有微小穿透时保持原位，不进一步向下拆解", () => {
  const low: Part = { ...parts[2], position: [200, 14.75, 200] };
  const source = [low, { ...parts[0], position: [0, 2000, 0] as Part["position"] }];
  for (const amount of [0, 0.001, 0.5, 1]) {
    const offsets = explodeOffsets(source, amount);
    assert.equal(offsets.get(low.id)![1], 0);
    assert.equal(designBounds([low], offsets).min[1], -0.25);
  }
});

test("空设计无拆解位移；预设位移是显示启发式而非真实拆装路径", () => {
  assert.equal(explodeOffsets([], 1).size, 0);
  const offsets = explodeOffsets(parts, 1);
  assert.ok(offsets.get("panel")![1] > 0);
  assert.equal(offsets.get("panel")![0], 0);
  assert.equal(offsets.get("panel")![2], 0);
});
