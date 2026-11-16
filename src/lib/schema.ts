import { z } from "zod";
import { inspectAccessoryConnections } from "./accessory-connections";

/**
 * 单位约定：全局使用毫米（mm），不做任何 mm <-> m 转换。
 * 3D 场景里 three.js 的数值也是毫米，相机裁剪面需要相应放大（见 Scene.tsx）。
 */

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

/** 设计与零件 id 同时用于文件名和链接，不允许路径片段。 */
export const IdSchema = z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
  message: "id 只能包含小写字母、数字及单个短横线分隔符",
});

/** 型材截面与槽口参数 */
export const ProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  series: z.number().int().positive(),
  /** 截面宽高 [w, h] */
  section: z.object({ w: z.number().positive(), h: z.number().positive() }),
  /** 槽口参数：open=槽口宽, cavity=T 腔宽, lip=唇口深度, neck=腔起始深度, depth=槽全深, bore=中心孔直径 */
  slot: z.object({
    open: z.number().positive(),
    cavity: z.number().positive(),
    lip: z.number().nonnegative(),
    neck: z.number().nonnegative(),
    depth: z.number().positive(),
    bore: z.number().positive(),
  }),
  massPerMetre: z.number().positive(),
  inertia: z.number().positive(),
  area: z.number().positive(),
  pricePerMetre: z.number().nonnegative(),
  currency: z.string().default("CNY"),
  /** supplier=供应商手册, estimate=公开资料估算 */
  source: z.enum(["supplier", "estimate"]),
  commonUses: z.array(z.string()).default([]),
  /** 连接接口族，不能仅凭截面尺寸或螺纹推断兼容。 */
  connectionFamily: z.string().min(1).optional(),
});

export const CatalogSchema = z.object({
  version: z.number().int().positive(),
  note: z.string().optional(),
  profiles: z.array(ProfileSchema).min(1),
});

export const AccessorySchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  fitsSlot: z.array(z.string()),
  unitPrice: z.number().nonnegative(),
  unit: z.string(),
  commonUses: z.array(z.string()).default([]),
  note: z.string().optional(),
  connectionFamily: z.string().min(1).optional(),
  mounting: z.enum(["profile-profile", "profile-panel"]).optional(),
  components: z.array(z.strictObject({
    name: z.string().min(1),
    qty: z.number().int().positive(),
    spec: z.string().optional(),
  })).optional(),
  sourceUrl: z.url().optional(),
  /** 外置角码示意；局部 x=0、y=0 是两个外安装面，沿 +x、+y 延伸。 */
  visual: z.strictObject({
    kind: z.literal("angle-bracket"),
    size: vec3.refine((size) => size.every((value) => value > 0), "角码尺寸须为正数"),
    thickness: z.number().positive(),
    holeDiameter: z.number().positive(),
  }).refine(({ size, thickness, holeDiameter }) => thickness < Math.min(...size) / 2
    && holeDiameter < Math.min(...size) - thickness * 2, "角码厚度或孔径超出尺寸范围").optional(),
});

export const AccessoryCatalogSchema = z.object({
  version: z.number().int().positive(),
  note: z.string().optional(),
  accessories: z.array(AccessorySchema),
});

/**
 * 零件的几何类型。
 * beam  = 沿 extrudeAxis 挤出的型材截面
 * plate = 平板（台面等）
 * column= 升降柱的管状件（简化成方管，不做内管细节）
 * box   = 通用方块（脚杯等）
 */
export const PartKindSchema = z.enum(["beam", "plate", "column", "box"]);

export const PartSchema = z.strictObject({
  id: IdSchema,
  kind: PartKindSchema,
  role: z.string().min(1),
  /** 引用 profiles.json 的 id。仅 kind=beam 时生效 */
  profile: z.string().nullable().default(null),
  /** 纯标注：影响渲染颜色与文档，不影响几何 */
  material: z.string().min(1),
  /** 包围盒尺寸 [x, y, z]，单位 mm */
  size: vec3.refine(([x, y, z]) => x > 0 && y > 0 && z > 0, {
    message: "size 三个分量都必须为正数",
  }),
  /** 中心点位置 [x, y, z]，单位 mm */
  position: vec3,
  /** 欧拉角 [x, y, z]，单位：度 */
  rotation: vec3.default([0, 0, 0]),
  /**
   * 可选：直接指定单件重量（kg）。
   * 空心件（升降柱钢管等）按实心包围盒估算会严重偏重，
   * 这里允许用实测值覆盖。不填则按体积 × 密度估算。
   */
  massKg: z.number().positive().optional(),
  note: z.string().optional(),
});

export const AccessoryInstanceSchema = z.strictObject({
  id: IdSchema,
  /** 装配态世界坐标（mm）；两安装面的交线中心。 */
  position: vec3,
  rotation: vec3.default([0, 0, 0]),
  /** 拆解时跟随此构件，不对两个构件的位移取平均。 */
  anchorPartId: IdSchema,
  /** 依次为局部 x=0 面与 y=0 面连接的构件。 */
  partIds: z.tuple([IdSchema, IdSchema]),
  note: z.string().optional(),
});

export const DesignAccessorySchema = z.strictObject({
  ref: z.string().min(1),
  qty: z.number().int().positive(),
  note: z.string().optional(),
  instances: z.array(AccessoryInstanceSchema).min(1).optional(),
}).refine((item) => !item.instances || item.qty === item.instances.length, {
  path: ["qty"], message: "有安装实例时，采购数量必须等于实例数量（套件内含件不重复计数）",
});

export const DesignMetaSchema = z.strictObject({
  description: z.string().default(""),
  /** 台面高度范围 [最低, 最高]，单位 mm */
  heightRange: z.tuple([z.number(), z.number()]).optional(),
  /** 建模时的落位高度，单位 mm */
  frameHeight: z.number().positive().optional(),
  loadRating: z.number().positive().optional(),
  profileSeries: z.string().optional(),
  note: z.string().optional(),
});

export const DesignSchema = z.strictObject({
  /** 编辑器 schema 标注是已知字段，不参与运行时校验或网络读取。 */
  $schema: z.string().optional(),
  id: IdSchema,
  name: z.string().trim().min(1),
  revision: z.number().int().nonnegative().default(0),
  units: z.literal("mm"),
  meta: DesignMetaSchema.default({ description: "" }),
  parts: z.array(PartSchema),
  accessories: z.array(DesignAccessorySchema).default([]),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;
export type Accessory = z.infer<typeof AccessorySchema>;
export type AccessoryCatalog = z.infer<typeof AccessoryCatalogSchema>;
export type PartKind = z.infer<typeof PartKindSchema>;
export type Part = z.infer<typeof PartSchema>;
export type DesignMeta = z.infer<typeof DesignMetaSchema>;
export type Design = z.infer<typeof DesignSchema>;
export type AccessoryInstance = z.infer<typeof AccessoryInstanceSchema>;

/**
 * 跨文件的引用校验：零件引用的型材必须在 catalog 中存在，
 * 配件引用也必须在配件库中存在。这是 schema 无法单独覆盖的部分。
 */
export function validateReferences(
  design: Design,
  catalog: Catalog,
  accessories: AccessoryCatalog,
): string[] {
  const errors: string[] = [];
  const profileIds = new Set(catalog.profiles.map((p) => p.id));
  const accessoryIds = new Set(accessories.accessories.map((a) => a.id));

  for (const part of design.parts) {
    if (part.kind === "beam") {
      if (!part.profile) {
        errors.push(`零件 ${part.id}: kind=beam 必须指定 profile`);
      } else if (!profileIds.has(part.profile)) {
        errors.push(`零件 ${part.id}: 型材 "${part.profile}" 不在 catalog 中`);
      }
    } else if (part.profile) {
      errors.push(`零件 ${part.id}: kind=${part.kind} 不应指定 profile`);
    }
  }

  for (const acc of design.accessories) {
    if (!accessoryIds.has(acc.ref)) {
      errors.push(`配件引用 "${acc.ref}" 不在配件库中`);
    }
  }

  const ids = design.parts.map((p) => p.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    errors.push(`零件 id 重复: ${[...new Set(dupes)].join(", ")}`);
  }

  errors.push(...inspectAccessoryConnections(design, catalog, accessories).map((issue) => `${issue.path}: ${issue.message}`));
  return errors;
}
