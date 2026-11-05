import fs from "node:fs";
import path from "node:path";
import { CatalogSchema, AccessoryCatalogSchema, DesignSchema, validateReferences } from "@/lib/schema";
import type { AccessoryCatalog, Catalog, Design } from "@/lib/schema";

/**
 * 数据加载。V1 不走数据库 —— design.json 就是唯一真相源，
 * 由人（编辑器）或 Agent（直接写文件）维护，git 提交即版本管理。
 *
 * 全部在服务端读取，客户端拿到的已是校验过的对象。
 */

const DATA_ROOT = path.join(process.cwd(), "data");

function readJson(file: string): unknown {
  const full = path.join(DATA_ROOT, file);
  if (!fs.existsSync(full)) {
    throw new Error(`数据文件不存在: ${full}`);
  }
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

export function loadCatalog(): Catalog {
  return CatalogSchema.parse(readJson("catalog/profiles.json"));
}

export function loadAccessories(): AccessoryCatalog {
  return AccessoryCatalogSchema.parse(readJson("catalog/accessories.json"));
}

export function loadDesign(id: string): Design {
  const design = DesignSchema.parse(readJson(`designs/${id}.json`));
  const errors = validateReferences(design, loadCatalog(), loadAccessories());
  if (errors.length > 0) {
    throw new Error(`design "${id}" 校验失败:\n  - ${errors.join("\n  - ")}`);
  }
  return design;
}

export function listDesigns(): string[] {
  const dir = path.join(DATA_ROOT, "designs");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

/**
 * 供页面一次性取全部数据。设计文件直接内联，避免客户端再发请求。
 */
export function loadWorkspace(designId: string) {
  return {
    design: loadDesign(designId),
    catalog: loadCatalog(),
    accessories: loadAccessories(),
    available: listDesigns(),
  };
}
