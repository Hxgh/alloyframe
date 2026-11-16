import assert from "node:assert/strict";
import { test } from "node:test";
import catalogJson from "../../../data/catalog/profiles.json";
import accessoriesJson from "../../../data/catalog/accessories.json";
import designJson from "../../../data/designs/standing-desk.json";
import { AccessoryCatalogSchema, CatalogSchema, DesignSchema } from "../schema";
import { inspectDesign } from "../validation";
import { designBounds } from "../tslot";
import { explodeOffsets } from "../explode";
import { bomCsv, buildBom, cutListCsv, type BomResult } from "../bom";

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

test("BOM 和切割清单对不可信文本列中和公式前缀，数值列不受影响", () => {
  const inputs = [
    "=1+1", "+SUM(1,2)", "-10", "@SUM(1,2)",
    "  =1+1", "  +1", "  -1", "  @cmd", "\t+1", "\r-1", "\n@cmd",
    "\u0000=1", "\u001f+1", "\u007f-1", "\u0085@cmd", "\u00a0=1", "\ufeff+1", "\u2003@cmd",
    " \u0000=1", " \u001f+1", " \u007f-1", " \u0085@cmd", "\u00a0\u0000=1", "\ufeff\u007f@cmd",
    "\t普通文本", "\r普通文本", "\n普通文本", "\u0000普通文本", "\u007f普通文本", "\u0085普通文本",
    " \t普通文本", " \r普通文本", " \n普通文本", " \u0000普通文本", " \u001f普通文本", " \u007f普通文本", " \u0085普通文本",
    '  ="a,b"\r\n第二行', '前缀,=1\n"另一行"', "单独\r回车", "普通文本", "  普通文本", " \u00a0", "", "+",
  ];
  const neutralized = [
    "'=1+1", "'+SUM(1,2)", "'-10", "'@SUM(1,2)",
    "'  =1+1", "'  +1", "'  -1", "'  @cmd", "'\t+1", "'\r-1", "'\n@cmd",
    "'\u0000=1", "'\u001f+1", "'\u007f-1", "'\u0085@cmd", "'\u00a0=1", "'\ufeff+1", "'\u2003@cmd",
    "' \u0000=1", "' \u001f+1", "' \u007f-1", "' \u0085@cmd", "'\u00a0\u0000=1", "'\ufeff\u007f@cmd",
    "'\t普通文本", "'\r普通文本", "'\n普通文本", "'\u0000普通文本", "'\u007f普通文本", "'\u0085普通文本",
    "' \t普通文本", "' \r普通文本", "' \n普通文本", "' \u0000普通文本", "' \u001f普通文本", "' \u007f普通文本", "' \u0085普通文本",
    `'  ="a,b"\r\n第二行`, '前缀,=1\n"另一行"', "单独\r回车", "普通文本", "  普通文本", " \u00a0", "", "'+",
  ];
  const bom: BomResult = {
    lines: inputs.map((value, index) => ({
      key: String(index), category: "型材", label: value, spec: value, lengthMm: index + 1,
      qty: -2, unit: value, massKg: -4, unitPrice: -3.25, lineTotal: -6.5, note: value,
    })),
    profileLengthM: 0, totalMassKg: 0, knownTotal: 0, hasUnknownPrice: false, currency: "CNY",
  };

  // 使用转义序列覆盖不可见字符，而不在源码中嵌入控制字符。
  const bomSnapshot = structuredClone(bom);
  const fullRows = parseCsvForTest(bomCsv(bom));
  assert.deepEqual(fullRows[0], ["分类", "名称", "规格", "数量", "单位", "单重(kg)", "总重(kg)", "单价", "小计", "备注"]);
  assert.deepEqual(fullRows.slice(1), neutralized.map((value) => [
    "型材", value, value, "-2", value, "2.000", "-4.000", "-3.25", "-6.50", value,
  ]));

  const cutRows = parseCsvForTest(cutListCsv(bom));
  assert.deepEqual(cutRows[0], ["型材规格", "下料长度(mm)", "数量", "单重(kg)", "总重(kg)", "备注"]);
  assert.deepEqual(cutRows.slice(1), neutralized.map((value, index) => [
    value, String(index + 1), "-2", "2.000", "-4.000", value,
  ]).reverse());
  assert.deepEqual(bom, bomSnapshot);

  for (const code of [...Array(0x20).keys(), ...Array.from({ length: 0x21 }, (_, index) => index + 0x7f)]) {
    const value = ` \u00a0${String.fromCharCode(code)}普通文本`;
    const line = { ...bom.lines[0], label: value, spec: value, unit: value, note: value };
    const controlBom: BomResult = { ...bom, lines: [line] };
    const full = parseCsvForTest(bomCsv(controlBom))[1];
    assert.deepEqual([full[1], full[2], full[4], full[9]], Array(4).fill(`'${value}`));
    const cut = parseCsvForTest(cutListCsv(controlBom))[1];
    assert.deepEqual([cut[0], cut[5]], Array(2).fill(`'${value}`));
  }
});

test("CSV 数值列中的负号与可选空值不被文本中和", () => {
  const bom: BomResult = {
    lines: [
      { key: "beam", category: "型材", label: "型材", spec: "规格", lengthMm: -100, qty: 2, unit: "支", massKg: -4, unitPrice: -3.25, lineTotal: -6.5 },
      { key: "plate", category: "板材", label: "板材", spec: "规格", qty: 1, unit: "块", massKg: 0 },
    ],
    profileLengthM: 0, totalMassKg: -4, knownTotal: -6.5, hasUnknownPrice: true, currency: "CNY",
  };
  assert.deepEqual(parseCsvForTest(cutListCsv(bom)).slice(1), [["型材", "-100", "2", "-2.000", "-4.000", ""]]);
  assert.deepEqual(parseCsvForTest(bomCsv(bom)).slice(1), [
    ["型材", "型材", "规格", "2", "支", "-2.000", "-4.000", "-3.25", "-6.50", ""],
    ["板材", "板材", "规格", "1", "块", "0.000", "0.000", "", "", ""],
  ]);
});

test("CSV 保留备注、分隔符与换行并使用标准引号转义", () => {
  const note = '说明,"加固"\r\n第二行\r第三行';
  const bom: BomResult = {
    lines: [{ key: "beam", category: "型材", label: '型材,"规格"', spec: "规格\r参数", lengthMm: 1000, qty: 2, unit: "支", massKg: 4, note }],
    profileLengthM: 2, totalMassKg: 4, knownTotal: 0, hasUnknownPrice: true, currency: "CNY",
  };
  assert.equal(cutListCsv(bom), '型材规格,下料长度(mm),数量,单重(kg),总重(kg),备注\n"型材,""规格""",1000,2,2.000,4.000,"说明,""加固""\r\n第二行\r第三行"');
  assert.equal(bomCsv(bom), '分类,名称,规格,数量,单位,单重(kg),总重(kg),单价,小计,备注\n型材,"型材,""规格""","规格\r参数",2,支,2.000,4.000,,,"说明,""加固""\r\n第二行\r第三行"');

  // 中和必须发生在 CSV 编码之前，不能让公式中的引号或分隔符生成新单元格。
  const riskyText = '=HYPERLINK("url","label")\r\n第二行';
  const riskyBom: BomResult = {
    ...bom,
    lines: [{ ...bom.lines[0], label: riskyText, spec: riskyText, unit: riskyText, note: riskyText }],
  };
  const encoded = `"'=HYPERLINK(""url"",""label"")\r\n第二行"`;
  assert.equal(cutListCsv(riskyBom), `型材规格,下料长度(mm),数量,单重(kg),总重(kg),备注\n${encoded},1000,2,2.000,4.000,${encoded}`);
  assert.equal(bomCsv(riskyBom), `分类,名称,规格,数量,单位,单重(kg),总重(kg),单价,小计,备注\n型材,${encoded},${encoded},2,${encoded},2.000,4.000,,,${encoded}`);

  const breakout = '",=1\r\n+2,"';
  const breakoutBom: BomResult = {
    ...bom,
    lines: [{ ...bom.lines[0], label: breakout, spec: breakout, unit: breakout, note: breakout }],
  };
  const csvBreakout = '""",=1\r\n+2,"""';
  assert.equal(cutListCsv(breakoutBom), `型材规格,下料长度(mm),数量,单重(kg),总重(kg),备注\n${csvBreakout},1000,2,2.000,4.000,${csvBreakout}`);
  assert.equal(bomCsv(breakoutBom), `分类,名称,规格,数量,单位,单重(kg),总重(kg),单价,小计,备注\n型材,${csvBreakout},${csvBreakout},2,${csvBreakout},2.000,4.000,,,${csvBreakout}`);
  assert.deepEqual(parseCsvForTest(cutListCsv(breakoutBom))[1], [breakout, "1000", "2", "2.000", "4.000", breakout]);
  assert.deepEqual(parseCsvForTest(bomCsv(breakoutBom))[1], ["型材", breakout, breakout, "2", breakout, "2.000", "4.000", "", "", breakout]);
});

test("完整算料单的分类也是文本列", () => {
  // 运行时传入的外部数据不一定遵守 TypeScript 的联合类型。
  const category = ' =SUM(1,2)' as BomResult["lines"][number]["category"];
  const bom: BomResult = {
    lines: [{ key: "category", category, label: "名称", spec: "规格", qty: 1, unit: "件", massKg: 1 }],
    profileLengthM: 0, totalMassKg: 1, knownTotal: 0, hasUnknownPrice: true, currency: "CNY",
  };
  assert.equal(parseCsvForTest(bomCsv(bom))[1][0], "' =SUM(1,2)");
});

test("设计和目录输入的文本在两种 CSV 中分别中和", () => {
  const profile = { ...catalog.profiles[0], id: "=profile", name: "=型材" };
  const accessory = { ...accessories.accessories[0], id: "csv-test", name: "+配件", category: "-类别", unit: "@单位", note: "=目录备注" };
  const input = DesignSchema.parse({
    ...empty,
    parts: [
      { id: "beam", kind: "beam", role: "梁", profile: profile.id, material: "铝", size: [1000, 40, 40], position: [0, 100, 0], massKg: 2, note: "\t=设计备注" },
      { id: "plate", kind: "plate", role: "@台面", material: "木", size: [100, 20, 40], position: [0, 100, 0], note: "+板材备注" },
    ],
    accessories: [{ ref: accessory.id, qty: 2 }],
  });
  const bom = buildBom(input, { ...catalog, profiles: [profile] }, { ...accessories, accessories: [accessory] });
  const rows = parseCsvForTest(bomCsv(bom));
  assert.equal(rows[1][1], "'=型材");
  assert.equal(rows[1][2], "'=profile · 1000mm");
  assert.equal(rows[1][9], "'\t=设计备注");
  assert.equal(rows[2][1], "'@台面");
  assert.equal(rows[2][9], "'+板材备注");
  assert.deepEqual([rows[3][1], rows[3][2], rows[3][4], rows[3][9]], ["'+配件", "'-类别", "'@单位", "'=目录备注"]);
  const cutRows = parseCsvForTest(cutListCsv(bom));
  assert.deepEqual([cutRows[1][0], cutRows[1][5]], ["'=型材", "'\t=设计备注"]);
});

/** 解析测试中的 CSV；确保换行与引号不会打断字段或行。 */
function parseCsvForTest(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      assert.equal(field, "", "引号必须位于字段开头");
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      assert.notEqual(char, "\r", "未转义的回车会破坏 CSV 行");
      field += char;
    }
  }
  assert.equal(quoted, false, "引号必须闭合");
  row.push(field);
  rows.push(row);
  return rows;
}

test("空间防呆检查：型材未做端头扣减产生干涉警告，悬空构件产生悬空警告，同心套管柱豁免", () => {
  const overlappingBeams = inspect({
    ...empty,
    parts: [
      {
        id: "rail-front", kind: "beam", role: "前梁", profile: "4040",
        material: "铝", size: [1000, 40, 40], position: [0, 20, 200],
      },
      {
        id: "rail-left", kind: "beam", role: "左梁", profile: "4040",
        material: "铝", size: [40, 40, 440], position: [-480, 20, 0],
      },
    ],
  });
  assert.ok(overlappingBeams.design);
  assert.ok(overlappingBeams.issues.some((issue) => issue.level === "warning"
    && issue.partId === "rail-left"
    && /空间干涉/.test(issue.message)));

  const floatingPart = inspect({
    ...empty,
    parts: [
      {
        id: "base", kind: "box", role: "底座", material: "钢",
        size: [100, 20, 100], position: [0, 10, 0],
      },
      {
        id: "floating-top", kind: "plate", role: "顶板", material: "木",
        size: [200, 20, 200], position: [0, 100, 0],
      },
    ],
  });
  assert.ok(floatingPart.design);
  assert.ok(floatingPart.issues.some((issue) => issue.level === "warning"
    && issue.partId === "floating-top"
    && /悬空/.test(issue.message)));
});
