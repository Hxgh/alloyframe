import assert from "node:assert/strict";
import { test } from "node:test";
import catalogJson from "../../../data/catalog/profiles.json";
import accessoriesJson from "../../../data/catalog/accessories.json";
import standingDesk from "../../../data/designs/standing-desk.json";
import { AccessoryCatalogSchema, CatalogSchema } from "../schema";
import { inspectDesign } from "../validation";

const catalog = CatalogSchema.parse(catalogJson);
const accessories = AccessoryCatalogSchema.parse(accessoriesJson);
const inspect = (input: unknown) => inspectDesign(input, catalog, accessories);
const design = (parts: unknown[], extra = {}) => ({
  id: "geometry-test", name: "几何校验", units: "mm", parts, ...extra,
});
const box = (id: string, position = [0, 10, 0], extra = {}) => ({
  id, kind: "box", role: "方块", material: "钢", size: [20, 20, 20], position, massKg: 0.2, ...extra,
});
const column = (id: string, size: number[], position: number[], rotation = [0, 0, 0]) => ({
  id, kind: "column", role: "柱", material: "钢", size, position, rotation, massKg: 3,
});
const interferences = (issues: ReturnType<typeof inspect>["issues"]) =>
  issues.filter((issue) => issue.level === "warning" && issue.message.includes("空间干涉"));
const floating = (issues: ReturnType<typeof inspect>["issues"]) =>
  issues.filter((issue) => issue.level === "warning" && issue.partId && issue.message.includes("可能悬空"));

test("现有 standing-desk 零警告，空项目仍返回唯一 warning", () => {
  const existing = inspect(standingDesk);
  assert.ok(existing.design);
  assert.deepEqual(existing.issues, []);
  const empty = inspect(design([]));
  assert.ok(empty.design);
  assert.equal(empty.issues.length, 1);
  assert.equal(empty.issues[0].level, "warning");
  assert.equal(empty.issues[0].path, "parts");
});

test("1500 个完全重叠件的构件对和输出均有上限，未检查与截断计数真实", { timeout: 10_000 }, () => {
  const count = 1500;
  const result = inspect(design(Array.from({ length: count }, (_, i) => box(`part-${i}`))));
  assert.ok(result.design);
  assert.equal(interferences(result.issues).length, 100);
  assert.equal(result.issues.length, 101);
  const summary = result.issues.find((issue) => issue.path === "parts");
  assert.ok(summary);
  assert.match(summary.message, /几何检查未完成/);
  assert.match(summary.message, /已检查 50000 \/ 1124250 对构件/);
  assert.match(summary.message, /已发现 50000 项包围盒可能干涉，显示 100 项/);
  assert.match(summary.message, /警告输出已截断/);
  assert.match(summary.message, /悬空检查未完成/);
});

test("稀疏场景也限制全部构件对，不据未完成的近邻检查误报悬空", { timeout: 10_000 }, () => {
  const parts = Array.from({ length: 1000 }, (_, i) => box(`sparse-${i}`, [i * 100, 100, 0]));
  const result = inspect(design(parts));
  assert.ok(result.design);
  assert.equal(floating(result.issues).length, 0);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].message, /已检查 50000 \/ 499500 对构件/);
  assert.match(result.issues[0].message, /已发现 0 项包围盒可能干涉/);
  assert.match(result.issues[0].message, /悬空检查未完成/);
});

test("完整检查的干涉与悬空提示各自计数，输出截断但不掩盖已发现的总数", () => {
  const overlapping = inspect(design(Array.from({ length: 16 }, (_, i) => box(`part-${i}`))));
  assert.equal(interferences(overlapping.issues).length, 100);
  assert.equal(overlapping.issues.length, 101);
  assert.match(overlapping.issues[100].message, /全部 120 对构件/);
  assert.match(overlapping.issues[100].message, /发现 120 项包围盒可能干涉及 0 项可能悬空，共显示 100 项/);

  const isolated = inspect(design(Array.from({ length: 101 }, (_, i) => box(`isolated-${i}`, [i * 100, 100, 0]))));
  assert.equal(floating(isolated.issues).length, 100);
  assert.match(isolated.issues[100].message, /发现 0 项包围盒可能干涉及 101 项可能悬空，共显示 100 项/);
});

test("构件对数量跨过上限时才报告未完成", () => {
  // 316 个构件有 49770 对，317 个则为 50086 对。
  const atMost = inspect(design(Array.from({ length: 316 }, (_, i) => box(`near-cap-${i}`, [i * 100, 10, 0]))));
  assert.ok(atMost.design);
  assert.equal(atMost.issues.length, 0);
  const over = inspect(design(Array.from({ length: 317 }, (_, i) => box(`over-cap-${i}`, [i * 100, 10, 0]))));
  assert.ok(over.design);
  assert.equal(over.issues.length, 1);
  assert.match(over.issues[0].message, /已检查 50000 \/ 50086 对构件/);
});

test("多个构件的干涉均能定位且只声称包围盒可能干涉，不声称实体或深度", () => {
  const result = inspect(design([box("a"), box("b"), box("c"), box("d")]));
  const warnings = interferences(result.issues);
  assert.equal(warnings.length, 6);
  assert.deepEqual([...new Set(warnings.map((issue) => issue.partId))], ["b", "c", "d"]);
  assert.ok(warnings.every((issue) => /包围盒可能存在空间干涉/.test(issue.message)));
  assert.ok(warnings.every((issue) => /人工核对/.test(issue.message) && !/重叠\s*\d/.test(issue.message)));
  assert.equal(warnings[0].path, "parts.1.position");
});

test("旋转后 AABB 交叠但定向包围盒分离，SAT 排除误报", () => {
  const d = 30 / Math.sqrt(2);
  const rotated = { size: [200, 20, 20], rotation: [0, 45, 0] };
  const result = inspect(design([box("a", [0, 10, 0], rotated), box("b", [d, 10, d], rotated)]));
  assert.ok(result.design);
  assert.equal(interferences(result.issues).length, 0);

  // 非方截面型材的局部尺寸和基础轴向须与实际渲染一致。
  const beam = { kind: "beam", profile: "4040", size: [200, 40, 20], rotation: [0, 45, 0] };
  const beams = inspect(design([box("beam-a", [0, 20, 0], beam), box("beam-b", [-d, 20, -d], beam)]));
  assert.ok(beams.design);
  assert.equal(interferences(beams.issues).length, 0);
});

test("不同旋转的型材包围盒足够接近时不能因轴向计算失真而漏报", () => {
  const result = inspect(design([
    box("beam", [0, 150, 0], { kind: "beam", profile: "4040", size: [220, 70, 20], rotation: [24, 37, -19] }),
    box("probe", [0, 150, 0], { size: [8, 8, 8] }),
  ]));
  assert.ok(result.design);
  assert.equal(interferences(result.issues).length, 1);
});

test("旋转柱交叉不可按 AABB 同心截面误豁免", () => {
  const result = inspect(design([
    column("horizontal", [100, 200, 100], [0, 150, 0], [0, 0, 90]),
    column("vertical", [60, 300, 60], [0, 150, 0]),
  ]));
  assert.ok(result.design);
  assert.equal(interferences(result.issues).length, 1);
  assert.equal(interferences(result.issues)[0].partId, "vertical");
});

test("合法同轴套管严格按真实旋转轴与截面包含判定", () => {
  const normal = inspect(design([
    column("outer", [80, 300, 50], [0, 150, 0]),
    column("inner", [68, 355, 38], [0, 240, 0]),
  ]));
  assert.ok(normal.design);
  assert.equal(interferences(normal.issues).length, 0);

  const offset = 30 / Math.sqrt(2);
  const tilted = inspect(design([
    column("tilted-outer", [80, 300, 50], [0, 300, 0], [0, 0, 45]),
    column("tilted-inner", [68, 355, 38], [-offset, 300 + offset, 0], [0, 0, 45]),
  ]));
  assert.ok(tilted.design);
  assert.equal(interferences(tilted.issues).length, 0);
});

test("偏轴、微倾斜或截面旋转超出外管时不可豁免", () => {
  const outer = column("outer", [80, 300, 50], [0, 200, 0]);
  for (const inner of [
    column("offset", [68, 300, 38], [1, 200, 0]),
    column("tilted", [68, 300, 38], [0, 200, 0], [0, 0, 0.01]),
    column("twisted", [68, 300, 38], [0, 200, 0], [0, 45, 0]),
  ]) {
    const result = inspect(design([outer, inner]));
    assert.ok(result.design);
    assert.equal(interferences(result.issues).length, 1, inner.id);
  }
});

test("干涉粗筛保留严格大于 0.5mm，悬空间距保留严格大于 10mm", () => {
  const overlaps = (x: number) => interferences(inspect(design([box("a"), box("b", [x, 10, 0])])).issues).length;
  assert.equal(overlaps(20), 0);
  assert.equal(overlaps(19.5), 0);
  assert.equal(overlaps(19.499), 1);

  assert.equal(floating(inspect(design([box("at-threshold", [0, 20, 0])])).issues).length, 0);
  assert.equal(floating(inspect(design([box("above-threshold", [0, 20.001, 0])])).issues).length, 1);
  const pair = (y: number) => inspect(design([box("base"), box("above", [0, y, 0])]));
  assert.equal(floating(pair(40).issues).length, 0);
  assert.equal(floating(pair(40.001).issues).length, 1);
});

test("悬空仅为可能提示，明确配件和墙体可能未建模；相邻悬空簇不作确定断言", () => {
  const result = inspect(design([box("base"), box("top", [0, 100, 0])], {
    accessories: [{ ref: accessories.accessories[0].id, qty: 1 }],
  }));
  assert.ok(result.design);
  const warnings = floating(result.issues);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].partId, "top");
  assert.match(warnings[0].message, /配件或墙体等连接可能未建模/);
  assert.match(warnings[0].message, /人工核对/);

  const cluster = inspect(design([box("a", [0, 100, 0]), box("b", [20, 100, 0])]));
  assert.ok(cluster.design);
  assert.equal(floating(cluster.issues).length, 0);
});

test("损坏字段、无效引用和后部错误仍保留 error、路径、partId 与 null design", () => {
  const corrupt = inspect(design([{ ...box("broken"), size: [-1, 20, 20] }]));
  assert.equal(corrupt.design, null);
  assert.ok(corrupt.issues.some((issue) => issue.level === "error" && issue.path === "parts.0.size" && issue.partId === "broken"));
  const unknown = inspect(design([{ ...box("broken"), unexpected: true }]));
  assert.equal(unknown.design, null);
  assert.ok(unknown.issues.some((issue) => issue.level === "error" && issue.path === "parts.0" && issue.partId === "broken"));
  assert.equal(inspect({ ...design([]), parts: [null] }).design, null);
  assert.equal(inspect(design([{ ...box("broken"), position: [Infinity, 10, 0] }])).design, null);
  const overflow = inspect(design([box("overflow", [1e308, 10, 0])]));
  assert.equal(overflow.design, null);
  assert.ok(overflow.issues.some((issue) => issue.level === "error" && issue.path === "parts.0.size"));
  assert.ok(overflow.issues.some((issue) => /几何检查未完成/.test(issue.message) && /1 个包围盒无法计算/.test(issue.message)));

  const many = Array.from({ length: 400 }, (_, i) => box(`part-${i}`));
  many.push(box("invalid-profile", [0, 10, 0], { kind: "beam", profile: "missing" }));
  const result = inspect(design(many, { accessories: [{ ref: "missing", qty: 1 }], meta: { heightRange: [100, 10] } }));
  assert.equal(result.design, null);
  assert.ok(result.issues.some((issue) => issue.level === "error" && issue.path === "parts.400.profile" && issue.partId === "invalid-profile"));
  assert.ok(result.issues.some((issue) => issue.level === "error" && issue.path === "accessories.0.ref"));
  assert.ok(result.issues.some((issue) => issue.level === "error" && issue.path === "meta.heightRange"));
  assert.ok(result.issues.some((issue) => issue.message.includes("几何检查未完成")));
});
