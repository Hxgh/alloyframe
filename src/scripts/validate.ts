#!/usr/bin/env tsx
/**
 * 设计文件校验 CLI —— 这是 Agent 的入口。
 *
 * 用法:
 *   pnpm validate                 校验所有 designs
 *   pnpm validate standing-desk   校验指定设计
 *
 * 退出码 0 = 全部通过，1 = 有错误。Agent 可以据此判断是否需要修复。
 */
import fs from "node:fs";
import path from "node:path";
import { CatalogSchema, AccessoryCatalogSchema, DesignSchema, validateReferences } from "../lib/schema";
import { buildBom } from "../lib/bom";

const DATA_ROOT = path.join(process.cwd(), "data");

function readJson(rel: string): unknown {
  const full = path.join(DATA_ROOT, rel);
  if (!fs.existsSync(full)) throw new Error(`文件不存在: ${full}`);
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

let failed = false;

function fail(msg: string) {
  console.error(`  ✗ ${msg}`);
  failed = true;
}

function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}

console.log("读取 catalog…");
let catalog, accessories;
try {
  catalog = CatalogSchema.parse(readJson("catalog/profiles.json"));
  ok(`型材库 ${catalog.profiles.length} 条`);
} catch (e) {
  fail(`profiles.json 解析失败: ${(e as Error).message}`);
  process.exit(1);
}
try {
  accessories = AccessoryCatalogSchema.parse(readJson("catalog/accessories.json"));
  ok(`配件库 ${accessories.accessories.length} 条`);
} catch (e) {
  fail(`accessories.json 解析失败: ${(e as Error).message}`);
  process.exit(1);
}

const target = process.argv[2];
const dir = path.join(DATA_ROOT, "designs");
const files = target
  ? [`${target}.json`]
  : fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();

if (files.length === 0) {
  console.log("\n没有找到任何设计文件。");
  process.exit(1);
}

console.log(`\n校验 ${files.length} 个设计…`);

for (const file of files) {
  const label = file.replace(/\.json$/, "");
  console.log(`\n[${label}]`);

  let design;
  try {
    design = DesignSchema.parse(readJson(`designs/${file}`));
  } catch (e) {
    const err = e as { issues?: Array<{ path: (string | number)[]; message: string }>; message: string };
    if (err.issues) {
      for (const issue of err.issues) {
        fail(`${issue.path.join(".") || "(根)"}: ${issue.message}`);
      }
    } else {
      fail(err.message);
    }
    continue;
  }
  ok(`schema 通过（${design.parts.length} 个零件）`);

  const refErrors = validateReferences(design, catalog, accessories);
  if (refErrors.length > 0) {
    for (const e of refErrors) fail(e);
    continue;
  }
  ok("引用完整性通过");

  const bom = buildBom(design, catalog, accessories);
  ok(`${bom.lines.length} 条算料行，型材 ${bom.profileLengthM.toFixed(2)} m，总重 ${bom.totalMassKg.toFixed(2)} kg`);

  // 高度一致性检查：所有零件都不应低于地面
  const belowGround = design.parts.filter((p) => p.position[1] - p.size[1] / 2 < -0.5);
  if (belowGround.length > 0) {
    fail(`以下零件低于地面: ${belowGround.map((p) => p.id).join(", ")}`);
  } else {
    ok("无零件穿透地面");
  }

  // 台面高度与声明的一致性
  const desktop = design.parts.find((p) => p.kind === "plate");
  if (desktop && design.meta.frameHeight) {
    const top = desktop.position[1] + desktop.size[1] / 2;
    const diff = Math.abs(top - design.meta.frameHeight);
    if (diff > 5) {
      fail(`台面上表面 ${top}mm 与 meta.frameHeight ${design.meta.frameHeight}mm 相差 ${diff.toFixed(1)}mm`);
    } else {
      ok(`台面上表面 ${top}mm 与声明高度一致`);
    }
  }

  // 包围盒总尺寸
  let maxY = -Infinity;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of design.parts) {
    maxY = Math.max(maxY, p.position[1] + p.size[1] / 2);
    minX = Math.min(minX, p.position[0] - p.size[0] / 2);
    maxX = Math.max(maxX, p.position[0] + p.size[0] / 2);
    minZ = Math.min(minZ, p.position[2] - p.size[2] / 2);
    maxZ = Math.max(maxZ, p.position[2] + p.size[2] / 2);
  }
  ok(`整体尺寸 ${(maxX - minX).toFixed(0)} × ${(maxZ - minZ).toFixed(0)} × ${maxY.toFixed(0)} mm (宽×深×高)`);
}

console.log("");
if (failed) {
  console.error("校验失败。");
  process.exit(1);
}
console.log("全部通过。");
