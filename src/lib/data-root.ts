import { constants, copyFileSync, linkSync, lstatSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { getProjectEnv } from "./project-env";
import type { ValidationIssue } from "./projects";

export class ProjectStoreError extends Error {
  constructor(public status: number, message: string, public issues?: ValidationIssue[]) {
    super(message);
    this.name = "ProjectStoreError";
  }
}

const initialFiles = [
  "design.schema.json",
  "catalog/profiles.json",
  "catalog/profiles.schema.json",
  "catalog/accessories.json",
  "catalog/accessories.schema.json",
  "designs/workbench-i8.json",
  "designs/shelf-i8.json",
  "designs/enclosure-i8.json",
  "designs/standing-desk.json",
];

function isDirectory(dir: string): boolean {
  try {
    const stat = lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new ProjectStoreError(403, "数据目录不能是符号链接或普通文件");
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** 默认目录只初始化一次；完成后不会补写示例，以免归档后重新出现。 */
export function initializeDataRoot(root: string, source: string): void {
  const marker = path.join(root, ".initialized");
  if (!isDirectory(root)) {
    try { mkdirSync(root, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !isDirectory(root)) throw error;
    }
  }
  try {
    if (!lstatSync(marker).isFile()) throw new ProjectStoreError(403, "数据目录初始化标记不是普通文件");
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  for (const dir of ["catalog", "designs"]) {
    const target = path.join(/* turbopackIgnore: true */ root, dir);
    if (!isDirectory(target)) {
      try { mkdirSync(target, { mode: 0o700 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !isDirectory(target)) throw error;
      }
    }
  }
  for (const file of initialFiles) {
    const target = path.join(/* turbopackIgnore: true */ root, file);
    const temporary = path.join(path.dirname(target), `.init-${randomBytes(8).toString("hex")}.tmp`);
    let copied = false;
    try {
      copyFileSync(path.join(/* turbopackIgnore: true */ source, file), temporary, constants.COPYFILE_EXCL);
      copied = true;
      try { linkSync(temporary, target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    } finally {
      if (copied) unlinkSync(temporary);
    }
  }
  try { writeFileSync(marker, "", { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}

export function getDataRoot(): string {
  const configured = getProjectEnv("DATA_DIR");
  const root = configured ?? path.join(process.cwd(), ".alloyframe-data");
  if (!path.isAbsolute(root)) throw new ProjectStoreError(400, "ALLOYFRAME_DATA_DIR（兼容 SUNMAO_DATA_DIR）必须是绝对路径");
  const resolved = path.resolve(/* turbopackIgnore: true */ root);
  if (configured == null) initializeDataRoot(resolved, path.join(process.cwd(), "data"));
  return resolved;
}
