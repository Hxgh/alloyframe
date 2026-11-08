import { DesignSchema } from "./schema";
import type { AccessoryCatalog, Catalog, Design } from "./schema";
import type { ValidationIssue } from "./projects";
import { designBounds } from "./tslot";

export function inspectDesign(
  input: unknown,
  catalog: Catalog,
  accessories: AccessoryCatalog,
): { design: Design | null; issues: ValidationIssue[] } {
  const parsed = DesignSchema.safeParse(input);
  if (!parsed.success) {
    const rawParts = input && typeof input === "object" && "parts" in input && Array.isArray(input.parts)
      ? input.parts : [];
    return {
      design: null,
      issues: parsed.error.issues.map((issue) => {
        const part = issue.path[0] === "parts" && typeof issue.path[1] === "number"
          ? rawParts[issue.path[1]] : undefined;
        return {
          level: "error",
          path: issue.path.map(String).join(".") || "(根)",
          ...(part && typeof part.id === "string" ? { partId: part.id } : {}),
          message: issue.message,
        };
      }),
    };
  }

  const design = parsed.data;
  const issues: ValidationIssue[] = [];
  const profileIds = new Set(catalog.profiles.map((profile) => profile.id));
  const accessoryIds = new Set(accessories.accessories.map((accessory) => accessory.id));
  const partIds = new Set<string>();

  if (design.parts.length === 0) {
    issues.push({ level: "warning", path: "parts", message: "项目尚无零件，可以保存后继续编辑" });
  }

  for (const [index, part] of design.parts.entries()) {
    const error = (field: string, message: string) => issues.push({
      level: "error", path: `parts.${index}.${field}`, partId: part.id, message,
    });
    if (partIds.has(part.id)) error("id", `零件 id 重复: ${part.id}`);
    partIds.add(part.id);
    if (part.kind === "beam") {
      if (!part.profile) error("profile", "kind=beam 必须指定 profile");
      else if (!profileIds.has(part.profile)) error("profile", `型材 "${part.profile}" 不在 catalog 中`);
    } else if (part.profile) {
      error("profile", `kind=${part.kind} 不应指定 profile`);
    }

    // 复用渲染的 Euler 与型材轴向变换，不用未旋转的 size 猜测高度。
    const bounds = designBounds([part]);
    if (![...bounds.min, ...bounds.max, ...bounds.center, bounds.radius].every(Number.isFinite)) {
      error("size", "旋转后的包围盒超出可计算范围");
    } else if (bounds.min[1] < -0.5) {
      error("position", `零件低于地面 ${(-bounds.min[1]).toFixed(1)}mm`);
    }
  }

  for (const [index, accessory] of design.accessories.entries()) {
    if (!accessoryIds.has(accessory.ref)) {
      issues.push({
        level: "error", path: `accessories.${index}.ref`,
        message: `配件引用 "${accessory.ref}" 不在配件库中`,
      });
    }
  }

  if (design.meta.heightRange != null) {
    const [minHeight, maxHeight] = design.meta.heightRange;
    if (minHeight > maxHeight) {
      issues.push({
        level: "error", path: "meta.heightRange",
        message: `高度范围最低值 ${minHeight}mm 不能大于最高值 ${maxHeight}mm`,
      });
    }
  }

  if (design.parts.length > 0) {
    const bounds = designBounds(design.parts);
    if (![...bounds.min, ...bounds.max, ...bounds.center, bounds.radius].every(Number.isFinite)) {
      issues.push({ level: "error", path: "parts", message: "整体包围盒超出可计算范围" });
    } else if (design.meta.frameHeight != null) {
      const top = bounds.max[1];
      const diff = Math.abs(top - design.meta.frameHeight);
      if (diff > 5) {
        issues.push({
          level: "error", path: "meta.frameHeight",
          message: `模型顶面 ${top.toFixed(1)}mm 与 meta.frameHeight ${design.meta.frameHeight}mm 相差 ${diff.toFixed(1)}mm`,
        });
      }
    }
  }

  return { design: issues.some((issue) => issue.level === "error") ? null : design, issues };
}
