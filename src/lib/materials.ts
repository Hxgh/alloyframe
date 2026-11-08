import type { Design, Part, Profile } from "./schema";

/** 材料的渲染属性。material 是纯标注字段，这里把它映射成视觉表现。 */
export type MaterialLook = {
  color: string;
  metalness: number;
  roughness: number;
};

/**
 * 按材料名做关键词匹配，而不是精确相等 —— 这样 design.json 里写
 * "6063-T5 银白阳极氧化"、"6063 阳极氧化银"、"银白阳极"都能命中同一条。
 * 顺序有意义：先匹配更具体的（深灰、木、黑），再匹配通用铝。
 */
const RULES: Array<{ test: RegExp; look: MaterialLook; darkColor: string }> = [
  { test: /木|枫桦|橡|胡桃|松|桦/, look: { color: "#c9a172", metalness: 0.05, roughness: 0.72 }, darkColor: "#d3af84" },
  { test: /钢|铁|不锈/, look: { color: "#8b9199", metalness: 0.8, roughness: 0.42 }, darkColor: "#a6aeb8" },
  // 喷粉深灰要留出明暗层次，否则立柱会糊成一块黑
  { test: /黑|深灰|喷粉|碳/, look: { color: "#565b62", metalness: 0.45, roughness: 0.5 }, darkColor: "#707984" },
  { test: /磨砂|雾面|哑光/, look: { color: "#b9bfc6", metalness: 0.7, roughness: 0.62 }, darkColor: "#c4ccd6" },
  { test: /6063|6061|铝|阳极|银白/, look: { color: "#cfd5dc", metalness: 0.62, roughness: 0.34 }, darkColor: "#d8e0ea" },
];

const FALLBACK: MaterialLook = { color: "#b4bac2", metalness: 0.6, roughness: 0.45 };

export function materialLook(material: string, dark = false): MaterialLook {
  for (const rule of RULES) {
    if (rule.test.test(material)) return dark ? { ...rule.look, color: rule.darkColor } : rule.look;
  }
  return dark ? { ...FALLBACK, color: "#c3cedc" } : FALLBACK;
}

/**
 * 供 UI 使用的材料色板。同一种 material 字符串在整个设计里只出现一次，
 * 避免零件树里十行都是 "6063-T5 银白阳极氧化"。
 */
export function enumerateMaterials(design: Design, dark = false): Array<{ material: string; count: number; look: MaterialLook }> {
  const map = new Map<string, number>();
  for (const p of design.parts) {
    map.set(p.material, (map.get(p.material) ?? 0) + 1);
  }
  return [...map.entries()].map(([material, count]) => ({
    material,
    count,
    look: materialLook(material, dark),
  }));
}

/**
 * 零件沿哪一根世界轴延伸。
 * beam 型材的挤出轴取决于它最长的那个尺寸分量；
 * plate / column / box 则以 y 为高度轴，退化为按最长边判断。
 */
export type Axis = "x" | "y" | "z";

export function longAxis(part: Pick<Part, "kind" | "size">): Axis {
  // column 是竖直构件，即使截面尺寸接近也一律按 Y 轴处理
  if (part.kind === "column") return "y";
  const [sx, sy, sz] = part.size;
  if (sx >= sy && sx >= sz) return "x";
  if (sy >= sx && sy >= sz) return "y";
  return "z";
}

/** beam 的长度取最长边，横截面取另外两条边 */
export function beamDims(part: Pick<Part, "kind" | "size">): { length: number; sectionW: number; sectionH: number } {
  const [sx, sy, sz] = part.size;
  const axis = longAxis(part);
  if (axis === "x") return { length: sx, sectionW: sz, sectionH: sy };
  if (axis === "y") return { length: sy, sectionW: sx, sectionH: sz };
  return { length: sz, sectionW: sx, sectionH: sy };
}

/** 重量：优先用零件自带的实测值，否则型材按米重、其它按体积 × 密度估算 */
export function partMassKg(part: Part, profile: Profile | undefined): number {
  if (part.massKg != null) return part.massKg;
  if (part.kind === "beam" && profile) {
    const { length } = beamDims(part);
    return (length / 1000) * profile.massPerMetre;
  }
  const [sx, sy, sz] = part.size;
  const volumeM3 = (sx * sy * sz) / 1e9;
  // 木材约 650，其它默认按铝 2700
  const density = /木/.test(part.material) ? 650 : 2700;
  return volumeM3 * density;
}
