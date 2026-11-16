import type { AccessoryCatalog, Catalog, Design } from "./schema";
import { beamDims, partMassKg } from "./materials";

export type BomLine = {
  /** 归并键：型材按 规格+长度 归并，其它按 角色+尺寸 归并 */
  key: string;
  category: "型材" | "板材" | "外购件" | "配件";
  label: string;
  spec: string;
  /** 单件长度，仅型材/线性件有 */
  lengthMm?: number;
  qty: number;
  unit: string;
  massKg: number;
  unitPrice?: number;
  lineTotal?: number;
  note?: string;
};

export type BomResult = {
  lines: BomLine[];
  profileLengthM: number;
  totalMassKg: number;
  /** 仅统计有价格的项 */
  knownTotal: number;
  /** 有价格缺失时为 true，UI 需要提示「估算」 */
  hasUnknownPrice: boolean;
  currency: string;
};

/**
 * 把 design.json 聚合成算料单。
 *
 * 归并规则：
 *  - beam：同 profile + 同长度 合并，数量累加
 *  - plate/column/box：同 role + 同 size 合并
 *  - 配件：同 ref 合并
 *
 * 注意：长度不做任何端头扣减。design.json 里的 size 就是下料长度，
 * 扣减应在写 design.json 时完成 —— 这样算料单是纯聚合，没有隐藏逻辑。
 */
export function buildBom(
  design: Design,
  catalog: Catalog,
  accessories: AccessoryCatalog,
): BomResult {
  const profileMap = new Map(catalog.profiles.map((p) => [p.id, p]));
  const accessoryMap = new Map(accessories.accessories.map((a) => [a.id, a]));
  const lines = new Map<string, BomLine>();

  const push = (line: BomLine) => {
    const existing = lines.get(line.key);
    if (existing) {
      existing.qty += line.qty;
      existing.massKg += line.massKg;
      if (existing.unitPrice != null && line.unitPrice != null) {
        existing.lineTotal = (existing.lineTotal ?? 0) + (line.lineTotal ?? 0);
      }
    } else {
      lines.set(line.key, line);
    }
  };

  for (const part of design.parts) {
    const mass = partMassKg(part, part.profile ? profileMap.get(part.profile) : undefined);

    if (part.kind === "beam") {
      const profile = part.profile ? profileMap.get(part.profile) : undefined;
      const { length } = beamDims(part);
      const pricePerM = profile?.pricePerMetre;
      push({
        key: `beam|${part.profile}|${length}`,
        category: "型材",
        label: profile?.name ?? part.profile ?? "型材",
        spec: `${part.profile} · ${length}mm`,
        lengthMm: length,
        qty: 1,
        unit: "支",
        massKg: mass,
        unitPrice: pricePerM != null ? (pricePerM * length) / 1000 : undefined,
        lineTotal: pricePerM != null ? (pricePerM * length) / 1000 : undefined,
        note: part.note,
      });
    } else if (part.kind === "plate") {
      push({
        key: `plate|${part.role}|${part.size.join("x")}`,
        category: "板材",
        label: part.role,
        spec: `${part.size[0]}×${part.size[2]}×${part.size[1]}mm · ${part.material}`,
        qty: 1,
        unit: "块",
        massKg: mass,
        note: part.note,
      });
    } else {
      push({
        key: `${part.kind}|${part.role}|${part.size.join("x")}`,
        category: "外购件",
        label: part.role,
        spec: `${part.size[0]}×${part.size[1]}×${part.size[2]}mm · ${part.material}`,
        qty: 1,
        unit: "件",
        massKg: mass,
        note: part.note,
      });
    }
  }

  for (const acc of design.accessories) {
    const item = accessoryMap.get(acc.ref);
    if (!item) continue;
    push({
      key: `acc|${acc.ref}`,
      category: "配件",
      label: item.name,
      spec: item.category,
      qty: acc.qty,
      unit: item.unit,
      massKg: 0,
      unitPrice: item.unitPrice,
      lineTotal: item.unitPrice * acc.qty,
      note: acc.note ?? item.note,
    });
  }

  const all = [...lines.values()];
  const profileLengthM =
    all.filter((l) => l.category === "型材").reduce((s, l) => s + ((l.lengthMm ?? 0) / 1000) * l.qty, 0);
  const totalMassKg = all.reduce((s, l) => s + l.massKg, 0);
  const priced = all.filter((l) => l.lineTotal != null);
  const knownTotal = priced.reduce((s, l) => s + (l.lineTotal ?? 0), 0);

  return {
    lines: all,
    profileLengthM,
    totalMassKg,
    knownTotal,
    hasUnknownPrice: priced.length < all.length,
    currency: catalog.profiles[0]?.currency ?? "CNY",
  };
}

/**
 * 切割清单 CSV：面向下料，只含型材，按长度降序便于排料。
 */
export function cutListCsv(bom: BomResult): string {
  const rows = bom.lines
    .filter((l) => l.category === "型材" && l.lengthMm != null)
    .sort((a, b) => (b.lengthMm ?? 0) - (a.lengthMm ?? 0));

  const header = ["型材规格", "下料长度(mm)", "数量", "单重(kg)", "总重(kg)", "备注"];
  const body = rows.map((r) => [
    neutralizeCsvText(r.label),
    String(r.lengthMm ?? ""),
    String(r.qty),
    (r.massKg / r.qty).toFixed(3),
    r.massKg.toFixed(3),
    neutralizeCsvText(r.note ?? ""),
  ]);

  return [header, ...body].map((r) => r.map(escapeCsv).join(",")).join("\n");
}

/** 完整算料单 CSV */
export function bomCsv(bom: BomResult): string {
  const header = ["分类", "名称", "规格", "数量", "单位", "单重(kg)", "总重(kg)", "单价", "小计", "备注"];
  const body = bom.lines.map((l) => [
    neutralizeCsvText(l.category),
    neutralizeCsvText(l.label),
    neutralizeCsvText(l.spec),
    String(l.qty),
    neutralizeCsvText(l.unit),
    (l.massKg / l.qty).toFixed(3),
    l.massKg.toFixed(3),
    l.unitPrice != null ? l.unitPrice.toFixed(2) : "",
    l.lineTotal != null ? l.lineTotal.toFixed(2) : "",
    neutralizeCsvText(l.note ?? ""),
  ]);
  return [header, ...body].map((r) => r.map(escapeCsv).join(",")).join("\n");
}

/**
 * 仅对文本列添加单引号前缀，数值列保留数值语义。
 * 这是降低 CSV 公式注入风险的措施，不保证所有电子表格及重新保存后的行为一致。
 */
function neutralizeCsvText(value: string): string {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || "=+-@".includes(char)) {
      return `'${value}`;
    }
    if (!/\s/u.test(char)) break;
  }
  return value;
}

function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
