#!/usr/bin/env tsx
/**
 * 设计文件校验 CLI。与 UI/API 使用相同校验引擎。
 * pnpm validate [项目id]；ALLOYFRAME_DATA_DIR 可指定绝对数据目录。
 * 退出码 0 = 无错误（空项目仅警告），1 = 有错误。
 */
import fs from "node:fs";
import path from "node:path";
import { AccessoryCatalogSchema, CatalogSchema, IdSchema } from "../lib/schema";
import { inspectDesign } from "../lib/validation";
import { getDataRoot } from "../lib/project-store";
import { designBounds } from "../lib/tslot";
import { buildBom } from "../lib/bom";

let failed = false;
const fail = (message: string) => { console.error(`  错误 ${message}`); failed = true; };
const ok = (message: string) => console.log(`  通过 ${message}`);
const warn = (message: string) => console.warn(`  警告 ${message}`);

function assertDirectory(dir: string) {
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`目录不能是符号链接或文件: ${dir}`);
}

function readJson(file: string): unknown {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error(`不是普通文件: ${file}`);
    return JSON.parse(fs.readFileSync(fd, "utf8"));
  } finally { fs.closeSync(fd); }
}

function main() {
  const root = getDataRoot();
  assertDirectory(root);
  assertDirectory(path.join(root, "catalog"));
  console.log("读取 catalog…");
  const catalog = CatalogSchema.parse(readJson(path.join(root, "catalog/profiles.json")));
  const accessories = AccessoryCatalogSchema.parse(readJson(path.join(root, "catalog/accessories.json")));
  ok(`型材库 ${catalog.profiles.length} 条，配件库 ${accessories.accessories.length} 条`);

  const target = process.argv[2];
  if (target && !IdSchema.safeParse(target).success) throw new Error("无效的项目 id，不能包含路径片段");
  const dir = path.join(root, "designs");
  if (!fs.existsSync(dir)) {
    if (target) throw new Error("项目文件不存在");
    console.log("没有设计文件，无需校验。");
    return;
  }
  assertDirectory(dir);
  const files = target ? [`${target}.json`] : fs.readdirSync(dir).filter((file) => file.endsWith(".json")).sort();
  console.log(`\n校验 ${files.length} 个设计…`);

  for (const file of files) {
    const id = file.slice(0, -5);
    console.log(`\n[${id}]`);
    if (!IdSchema.safeParse(id).success) { fail("文件名不是安全的项目 id"); continue; }
    let input: unknown;
    try { input = readJson(path.join(dir, file)); }
    catch (error) { fail((error as Error).message); continue; }
    const { design, issues } = inspectDesign(input, catalog, accessories);
    for (const issue of issues) {
      (issue.level === "error" ? fail : warn)(`${issue.path}: ${issue.message}`);
    }
    if (!design) continue;
    if (design.id !== id) { fail(`设计 id "${design.id}" 与文件名 "${id}" 不一致`); continue; }
    ok(`schema、引用和旋转几何通过（${design.parts.length} 个零件）`);
    const bom = buildBom(design, catalog, accessories);
    ok(`${bom.lines.length} 条算料行，型材 ${bom.profileLengthM.toFixed(2)} m，总重 ${bom.totalMassKg.toFixed(2)} kg`);
    const bounds = designBounds(design.parts);
    ok(`整体尺寸 ${(bounds.max[0] - bounds.min[0]).toFixed(0)} × ${(bounds.max[2] - bounds.min[2]).toFixed(0)} × ${(bounds.max[1] - bounds.min[1]).toFixed(0)} mm (宽×深×高)`);
  }
}

try { main(); }
catch (error) { fail((error as Error).message); }
console.log(failed ? "\n校验失败。" : "\n全部通过。");
process.exitCode = failed ? 1 : 0;
