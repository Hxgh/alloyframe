import assert from "node:assert/strict";
import { test } from "node:test";
import designJson from "../../../data/designs/standing-desk.json";
import profilesJson from "../../../data/catalog/profiles.json";
import accessoriesJson from "../../../data/catalog/accessories.json";
import { AccessoryCatalogSchema, CatalogSchema, DesignSchema } from "../schema";
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
