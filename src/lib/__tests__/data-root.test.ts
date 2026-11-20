import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, test, type TestContext } from "node:test";
import { getDataRoot, initialFiles } from "../data-root";
import { getProjectEnv } from "../project-env";

const repo = path.resolve(import.meta.dirname, "../../..");

beforeEach((t) => {
  const keys = ["ALLOYFRAME_DATA_DIR", "ALLOYFRAME_READ_ONLY", "ALLOYFRAME_TRUSTED_ORIGINS",
    "SUNMAO_DATA_DIR", "SUNMAO_READ_ONLY", "SUNMAO_TRUSTED_ORIGINS"] as const;
  const previous = keys.map((key) => process.env[key]);
  for (const key of keys) delete process.env[key];
  (t as TestContext).after(() => keys.forEach((key, index) => {
    if (previous[index] === undefined) delete process.env[key];
    else process.env[key] = previous[index];
  }));
});

test("显式空值优先于旧变量：ALLOYFRAME_* 一旦设置（含空串）就不再回退", () => {
  // 防呆语义：空值是「显式设为非法值」而非「未设置」，静默回退会让人误以为配置生效。
  process.env.ALLOYFRAME_DATA_DIR = "";
  process.env.SUNMAO_DATA_DIR = "/tmp/legacy-data";
  assert.equal(getProjectEnv("DATA_DIR"), "");
  assert.throws(() => getDataRoot(), /必须是绝对路径/);

  process.env.ALLOYFRAME_READ_ONLY = "";
  process.env.SUNMAO_READ_ONLY = "1";
  assert.equal(getProjectEnv("READ_ONLY"), "");
});

test("initialFiles 与公开 data/ 树完全同步，防止新增示例漏出校验与初始化", () => {
  const dataDir = path.join(repo, "data");
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    // 归档目录由 .gitignore 排除，不属于公开初始数据。
    if (entry === "archive" || entry.startsWith(".")) return [];
    return statSync(full).isDirectory() ? walk(full) : [path.relative(dataDir, full).split(path.sep).join("/")];
  });
  assert.deepEqual(walk(dataDir).sort(), [...initialFiles].sort());
  // 清单内的文件都真实存在，防止删了文件忘改清单。
  for (const file of initialFiles) {
    assert.doesNotThrow(() => readFileSync(path.join(dataDir, file)), file);
  }
});
