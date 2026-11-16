import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { z } from "zod";
import { Euler, Matrix4, Vector3 } from "three";
import profileJson from "../../../data/catalog/profiles.json";
import accessoryJson from "../../../data/catalog/accessories.json";
import workbenchJson from "../../../data/designs/workbench-i8.json";
import shelfJson from "../../../data/designs/shelf-i8.json";
import enclosureJson from "../../../data/designs/enclosure-i8.json";
import { AccessoryCatalogSchema, CatalogSchema, DesignSchema, validateReferences, type Design } from "../schema";
import { inspectDesign } from "../validation";
import { accessoryInstanceBounds, displayedDesignBounds, inspectAccessoryConnections, resolveAccessoryInstances } from "../accessory-connections";
import { angleBracketGeometries } from "../accessory-geometry";
import { explodeOffsets } from "../explode";
import { designBounds } from "../tslot";
import { buildBom } from "../bom";

const catalog = CatalogSchema.parse(profileJson);
const accessories = AccessoryCatalogSchema.parse(accessoryJson);
const examples = [workbenchJson, shelfJson, enclosureJson].map((item) => DesignSchema.parse(item));

function checkInvalid(change: (design: Design) => void, message: RegExp) {
  const design = structuredClone(examples[0]);
  change(design);
  assert.match(inspectAccessoryConnections(design, catalog, accessories).map((issue) => issue.message).join("\n"), message);
  assert.equal(inspectDesign(design, catalog, accessories).design, null);
  assert.match(validateReferences(design, catalog, accessories).join("\n"), message);
}

test("三种示例的角码安装面、槽口族和连接数量闭合，BOM只计一次套件", () => {
  for (const [index, design] of examples.entries()) {
    assert.deepEqual(inspectDesign(design, catalog, accessories).issues, [], design.id);
    assert.deepEqual(validateReferences(design, catalog, accessories), []);
    assert.equal(design.meta.loadRating, undefined);
    assert.ok(design.parts.filter((part) => part.kind === "beam").every((part) => part.profile === "4040-i8"));
    const structure = design.accessories.find((item) => item.ref === "bracket-i8-kit")!;
    assert.equal(structure.qty, 16);
    assert.equal(structure.instances?.length, 16);
    const panel = design.accessories.find((item) => item.ref === "panel-i8-kit");
    assert.equal(panel?.qty ?? 0, [4, 8, 0][index]);
    const bom = buildBom(design, catalog, accessories);
    const line = bom.lines.find((item) => item.key === "acc|bracket-i8-kit")!;
    assert.equal(line.qty, 16);
    assert.equal(line.lineTotal, 16 * accessories.accessories.find((item) => item.id === structure.ref)!.unitPrice);
    assert.ok(!bom.lines.some((item) => /acc\|(?:tnut|bolt|spring-tnut)/.test(item.key)), "套件内含件不能重复采购");
    for (const rail of design.parts.filter((part) => /rail/.test(part.id))) {
      const connected: NonNullable<typeof structure.instances> = structure.instances!.filter((instance) => instance.partIds.includes(rail.id));
      assert.equal(connected.length, 2, `${rail.id} 两端须各有连接`);
      assert.notEqual(connected[0].partIds[0], connected[1].partIds[0]);
    }
  }
});

test("连接实例两个校验入口均拒绝悬挂引用、槽族混用、虚假贴合及无效锚定", () => {
  checkInvalid((design) => { design.parts = design.parts.filter((part) => part.id !== design.accessories[0].instances![0].partIds[0]); }, /不存在/);
  checkInvalid((design) => { design.accessories[0].instances![0].anchorPartId = "desktop"; }, /锚定构件必须/);
  checkInvalid((design) => { design.accessories[0].instances![0].partIds[1] = design.accessories[0].instances![0].partIds[0]; }, /不同构件/);
  checkInvalid((design) => { design.accessories[0].instances![1].id = design.accessories[0].instances![0].id; }, /重复/);
  checkInvalid((design) => { design.accessories[0].instances![0].position[0] += 10; }, /未贴合/);
  checkInvalid((design) => { design.accessories[0].instances![0].position[1] = 0; }, /低于地面/);
  checkInvalid((design) => { design.parts.find((part) => part.id === design.accessories[0].instances![0].partIds[0])!.profile = "4040"; }, /槽口族不匹配/);
  checkInvalid((design) => { design.parts.find((part) => part.id === design.accessories[0].instances![0].partIds[0])!.kind = "column"; }, /只能连接/);
  checkInvalid((design) => { design.accessories[0].ref = "tnut-m8"; }, /没有可定位/);
  checkInvalid((design) => { design.accessories[0].instances![0].anchorPartId = design.accessories[0].instances![0].partIds[1]; }, /低于锚定构件底面/);
  const mismatch = structuredClone(examples[0]);
  mismatch.accessories[0].qty++;
  assert.equal(DesignSchema.safeParse(mismatch).success, false);
});

test("角码随单个锚定构件移动而非平均，连续拆解不穿地且计入取景范围", () => {
  for (const design of examples) {
    const before = JSON.stringify(design);
    const baseline = resolveAccessoryInstances(design, accessories);
    for (const amount of [0, 0.000001, ...Array.from({ length: 100 }, (_, i) => (i + 1) / 100), 0.5, 0]) {
      const offsets = explodeOffsets(design.parts, amount);
      const resolved = resolveAccessoryInstances(design, accessories, offsets);
      const bounds = displayedDesignBounds(design, accessories, offsets);
      assert.ok(bounds.min[1] >= -1e-8);
      for (const [index, item] of resolved.entries()) {
        const anchorOffset = offsets.get(item.instance.anchorPartId)!;
        assert.deepEqual(item.position, baseline[index].position.map((value, axis) => value + anchorOffset[axis]));
        assert.ok(item.bounds.min[1] >= -1e-8, item.instance.id);
        for (let axis = 0; axis < 3; axis++) {
          assert.ok(bounds.min[axis] <= item.bounds.min[axis] && bounds.max[axis] >= item.bounds.max[axis]);
        }
      }
    }
    assert.equal(JSON.stringify(design), before);
  }
});

test("L形角码实体包含安装孔且渲染几何与实例边界采用相同变换", () => {
  for (const item of resolveAccessoryInstances(examples[0], accessories)) {
    const geometries = angleBracketGeometries(item.visual);
    const matrix = new Matrix4().makeRotationFromEuler(new Euler(...item.rotation.map((value) => value * Math.PI / 180) as [number, number, number])).setPosition(...item.position);
    try {
      for (const geometry of geometries) {
        const shapes = geometry.parameters.shapes;
        assert.ok(!Array.isArray(shapes));
        assert.equal(shapes.holes.length, 1);
        const points = geometry.getAttribute("position");
        for (let index = 0; index < points.count; index++) {
          const point = new Vector3().fromBufferAttribute(points, index).applyMatrix4(matrix).toArray();
          point.forEach((value, axis) => assert.ok(value >= item.bounds.min[axis] - 1e-5 && value <= item.bounds.max[axis] + 1e-5));
        }
      }
      assert.deepEqual(accessoryInstanceBounds(item.visual, item.position, item.rotation), item.bounds);
    } finally {
      geometries.forEach((geometry) => geometry.dispose());
    }
  }
});

test("旧配件继续仅计BOM，新实例JSON往返不丢字段，镜像或改ID不隐式重绑", () => {
  const design = examples[0];
  assert.deepEqual(DesignSchema.parse(JSON.parse(JSON.stringify(design))), design);
  const legacy = { ...design, accessories: [{ ref: "bracket-outer-4040", qty: 4 }] };
  assert.deepEqual(resolveAccessoryInstances(legacy, accessories), []);
  assert.deepEqual(displayedDesignBounds(legacy, accessories), designBounds(legacy.parts));
  const changed = structuredClone(design);
  changed.parts[1].id = "changed-post";
  assert.deepEqual(changed.accessories, design.accessories);
  assert.ok(inspectAccessoryConnections(changed, catalog, accessories).some((issue) => /不存在/.test(issue.message)));
});

test("设计与目录编辑器Schema同运行时结构同步，接受各自的schema声明", async () => {
  for (const [path, schema] of [
    ["../../../data/design.schema.json", DesignSchema],
    ["../../../data/catalog/profiles.schema.json", CatalogSchema],
    ["../../../data/catalog/accessories.schema.json", AccessoryCatalogSchema],
  ] as const) {
    const expected = z.toJSONSchema(schema);
    if (schema !== DesignSchema) expected.properties!.$schema = { type: "string" };
    assert.deepEqual(JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")), expected);
  }
});
