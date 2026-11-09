import assert from "node:assert/strict";
import { test } from "node:test";
import designJson from "../../../data/designs/standing-desk.json";
import { DesignSchema, type Part } from "../schema";
import { explodeOffsets } from "../explode";

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

test("空设计无拆解位移；预设位移是显示启发式而非真实拆装路径", () => {
  assert.equal(explodeOffsets([], 1).size, 0);
  const offsets = explodeOffsets(parts, 1);
  assert.ok(offsets.get("panel")![1] > 0);
  assert.equal(offsets.get("panel")![0], 0);
  assert.equal(offsets.get("panel")![2], 0);
});
