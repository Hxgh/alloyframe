import assert from "node:assert/strict";
import { test } from "node:test";
import catalogJson from "../../../data/catalog/profiles.json";
import accessoriesJson from "../../../data/catalog/accessories.json";
import designJson from "../../../data/designs/standing-desk.json";
import { AccessoryCatalogSchema, CatalogSchema, DesignSchema } from "../schema";
import { inspectDesign } from "../validation";
import { designBounds } from "../tslot";
import { explodeOffsets } from "../explode";
import { bomCsv, buildBom, cutListCsv } from "../bom";

const catalog = CatalogSchema.parse(catalogJson);
const accessories = AccessoryCatalogSchema.parse(accessoriesJson);
const inspect = (input: unknown) => inspectDesign(input, catalog, accessories);
const empty = { id: "empty-project", name: " 空项目 ", units: "mm", parts: [] };

const plate = {
  id: "desktop", kind: "plate", role: "台面", material: "wood",
  size: [100, 20, 40], position: [0, 50, 0], rotation: [0, 0, 90],
};

test("现有设计通过共享 schema、引用与旋转几何校验", () => {
  const result = inspect(designJson);
  assert.ok(result.design);
  assert.deepEqual(result.issues, []);
});

test("空项目可保存、名称 trim，只有 warning；空几何不产生 Infinity/NaN", () => {
  const result = inspect(empty);
  assert.equal(result.design?.name, "空项目");
  assert.deepEqual(result.issues.map((issue) => issue.level), ["warning"]);
  assert.deepEqual(designBounds([]), { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 200 });
  assert.equal(explodeOffsets([], 1).size, 0);
  assert.equal(buildBom(result.design!, catalog, accessories).totalMassKg, 0);
});

test("design/meta/part/accessory 未知字段均拒绝，但 catalog 仍保留原有剥离行为", () => {
  for (const input of [
    { ...empty, surprise: true },
    { ...empty, meta: { surprise: true } },
    { ...empty, parts: [{ ...plate, surprise: true }] },
    { ...empty, accessories: [{ ref: accessories.accessories[0].id, qty: 1, surprise: true }] },
  ]) {
    assert.equal(inspect(input).design, null);
  }
  assert.ok(CatalogSchema.safeParse({ ...catalogJson, surprise: true }).success);
  assert.equal(DesignSchema.safeParse({ ...empty, name: "   " }).success, false);
});

test("设计和零件 id 不能含路径片段、不安全字符或多重短横线", () => {
  for (const id of ["../escape", "nested/id", "a\\b", "a.json", "Upper", "a--b", "-id", "id-", "x".repeat(121)]) {
    assert.equal(inspect({ ...empty, id }).design, null, id);
    assert.equal(inspect({ ...empty, parts: [{ ...plate, id }] }).design, null, id);
  }
});

test("引用错误、重复 id 和不应引用型材均返回带路径的 error 与 null design", () => {
  const result = inspect({
    ...empty,
    parts: [
      { ...plate, kind: "beam", profile: "missing-profile" },
      { ...plate, profile: catalog.profiles[0].id },
    ],
    accessories: [{ ref: "missing-accessory", qty: 1 }],
  });
  assert.equal(result.design, null);
  assert.ok(result.issues.some((issue) => issue.path === "parts.0.profile" && issue.partId === "desktop"));
  assert.ok(result.issues.some((issue) => issue.path === "parts.1.id"));
  assert.ok(result.issues.some((issue) => issue.path === "parts.1.profile"));
  assert.ok(result.issues.some((issue) => issue.path === "accessories.0.ref"));
});

test("穿地与顶面声明使用旋转后的包围盒而不是 size[1]", () => {
  assert.ok(inspect({ ...empty, parts: [plate], meta: { frameHeight: 100 } }).design);
  const mismatch = inspect({ ...empty, parts: [plate], meta: { frameHeight: 60 } });
  assert.equal(mismatch.design, null);
  assert.ok(mismatch.issues.some((issue) => issue.path === "meta.frameHeight"));
  const below = inspect({ ...empty, parts: [{ ...plate, position: [0, 20, 0] }] });
  assert.equal(below.design, null);
  assert.ok(below.issues.some((issue) => issue.path === "parts.0.position"));
});

test("高度范围最低不能大于最高，表单与直接编辑共用同一规则", () => {
  assert.ok(inspect({ ...empty, meta: { heightRange: [600, 1200] } }).design);
  assert.ok(inspect({ ...empty, meta: { heightRange: [900, 900] } }).design);
  const reversed = inspect({ ...empty, meta: { heightRange: [1180, 720] } });
  assert.equal(reversed.design, null);
  assert.deepEqual(reversed.issues.map((issue) => issue.path), ["parts", "meta.heightRange"]);
  assert.match(reversed.issues[1].message, /最低值 1180mm 不能大于最高值 720mm/);
});

test("声明顶面针对整体非空模型：多板结构取最高板，无板结构也检查", () => {
  const shelves = [plate, { ...plate, id: "upper-shelf", position: [0, 150, 0] }];
  assert.ok(inspect({ ...empty, parts: shelves, meta: { frameHeight: 200 } }).design);
  assert.equal(inspect({ ...empty, parts: shelves, meta: { frameHeight: 100 } }).design, null);
  const box = { ...plate, kind: "box", rotation: [0, 0, 0], position: [0, 100, 0] };
  assert.ok(inspect({ ...empty, parts: [box], meta: { frameHeight: 110 } }).design);
  assert.equal(inspect({ ...empty, parts: [box], meta: { frameHeight: 200 } }).design, null);
});

test("schema issue 关联 partId，非有限数值不能进入引擎", () => {
  const result = inspect({ ...empty, parts: [{ ...plate, size: [-1, 20, 40] }] });
  assert.equal(result.issues[0].partId, "desktop");
  assert.equal(inspect({ ...empty, parts: [{ ...plate, position: [Infinity, 50, 0] }] }).design, null);
});

test("单件包围盒 min/max/radius 有限但 center 溢出也拒绝", () => {
  const design = DesignSchema.parse({
    ...empty,
    parts: [{ id: "box", kind: "box", role: "方块", material: "wood", size: [100, 100, 100], position: [1e308, 100, 0] }],
  });
  const bounds = designBounds(design.parts);
  assert.ok([...bounds.min, ...bounds.max, bounds.radius].every(Number.isFinite));
  assert.equal(bounds.center[0], Infinity);
  const result = inspect(design);
  assert.equal(result.design, null);
  assert.ok(result.issues.some((issue) => issue.level === "error" && issue.path === "parts.0.size"));
});

test("单件包围盒均有限但整体 radius 溢出时拒绝，有无 frameHeight 均检查", () => {
  const design = DesignSchema.parse({
    ...empty,
    parts: [-1, 1].map((sign) => ({
      id: sign < 0 ? "left" : "right", kind: "box", role: "方块", material: "wood",
      size: [100, 100, 100], position: [sign * 1e154, 100, 0],
    })),
  });
  for (const part of design.parts) {
    const bounds = designBounds([part]);
    assert.ok([...bounds.min, ...bounds.max, ...bounds.center, bounds.radius].every(Number.isFinite));
  }
  const bounds = designBounds(design.parts);
  assert.ok([...bounds.min, ...bounds.max, ...bounds.center].every(Number.isFinite));
  assert.equal(bounds.radius, Infinity);
  for (const meta of [{}, { frameHeight: 150 }]) {
    const result = inspect({ ...design, meta });
    assert.equal(result.design, null);
    assert.ok(result.issues.some((issue) => issue.level === "error" && issue.path === "parts"));
  }
});

test("BOM massKg 始终是行总重，两个 CSV 单重除数量且总重不再乘数量", () => {
  const input = DesignSchema.parse({
    ...empty,
    parts: ["a", "b"].map((id) => ({
      id, kind: "beam", role: "梁", profile: catalog.profiles[0].id,
      material: "aluminum", size: [1000, 40, 40], position: [0, 100, 0], massKg: 2,
    })),
  });
  const bom = buildBom(input, catalog, accessories);
  assert.equal(bom.lines[0].qty, 2);
  assert.equal(bom.lines[0].massKg, 4);
  assert.equal(bom.totalMassKg, 4);
  assert.deepEqual(cutListCsv(bom).split("\n")[1].split(",").slice(2, 5), ["2", "2.000", "4.000"]);
  assert.deepEqual(bomCsv(bom).split("\n")[1].split(",").slice(5, 7), ["2.000", "4.000"]);
});
