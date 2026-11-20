import assert from "node:assert/strict";
import { test } from "node:test";
import designJson from "../../../data/designs/standing-desk.json";
import profilesJson from "../../../data/catalog/profiles.json";
import accessoriesJson from "../../../data/catalog/accessories.json";
import { AccessoryCatalogSchema, CatalogSchema, DesignSchema, type Part } from "../schema";
import { enumerateMaterials, materialLook, partMassKg } from "../materials";
import { buildBom } from "../bom";

const design = DesignSchema.parse(designJson);
const catalog = CatalogSchema.parse(profilesJson);
const accessories = AccessoryCatalogSchema.parse(accessoriesJson);

test("材料默认浅色，深色适配仍保留语义与物理渲染属性", () => {
  for (const material of ["木", "钢", "黑色喷粉", "磨砂铝", "6063-T5 银白", "未知材料"]) {
    const light = materialLook(material);
    const dark = materialLook(material, true);
    assert.deepEqual(light, materialLook(material, false));
    assert.notEqual(light.color, dark.color);
    assert.equal(light.metalness, dark.metalness);
    assert.equal(light.roughness, dark.roughness);
  }
  assert.deepEqual(materialLook("木铝"), materialLook("木"));
  assert.notEqual(materialLook("木").color, materialLook("铝").color);
});

test("体积估重按材料分档：木 650、钢 7850、其它按铝 2700 kg/m³", () => {
  const base: Part = {
    id: "part", kind: "box", role: "件", profile: null, material: "铝",
    size: [100, 100, 100], position: [0, 50, 0], rotation: [0, 0, 0],
  };
  const volume = 0.001; // 100mm 立方 = 0.001 m³
  assert.equal(partMassKg({ ...base, material: "桦木多层板" }, undefined), volume * 650);
  assert.equal(partMassKg({ ...base, material: "钢制喷粉 深灰" }, undefined), volume * 7850);
  assert.equal(partMassKg({ ...base, material: "304 不锈钢" }, undefined), volume * 7850);
  assert.equal(partMassKg({ ...base, material: "6063-T5 铝合金" }, undefined), volume * 2700);
  // massKg 实测值始终优先，覆盖密度估算。
  assert.equal(partMassKg({ ...base, material: "钢制喷粉", massKg: 0.5 }, undefined), 0.5);
});

test("场景和材料色板使用同一主题映射，主题不修改设计或算料", () => {
  const before = JSON.stringify(design);
  const bom = buildBom(design, catalog, accessories);
  const masses = design.parts.map((part) => partMassKg(part, catalog.profiles.find((profile) => profile.id === part.profile)));
  for (const dark of [false, true]) {
    for (const row of enumerateMaterials(design, dark)) {
      assert.deepEqual(row.look, materialLook(row.material, dark));
    }
  }
  assert.deepEqual(buildBom(design, catalog, accessories), bom);
  assert.deepEqual(design.parts.map((part) => partMassKg(part, catalog.profiles.find((profile) => profile.id === part.profile))), masses);
  assert.equal(JSON.stringify(design), before);
});
