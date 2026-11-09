import assert from "node:assert/strict";
import { beforeEach, test, type TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import catalogJson from "../../../data/catalog/profiles.json";
import accessoriesJson from "../../../data/catalog/accessories.json";
import designJson from "../../../data/designs/standing-desk.json";
import { AccessoryCatalogSchema, CatalogSchema, IdSchema } from "../schema";
import { createProject, createProjectStore, getDataRoot, getStoreWritable, ProjectStoreError } from "../project-store";

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

const catalog = CatalogSchema.parse(catalogJson);
const accessories = AccessoryCatalogSchema.parse(accessoriesJson);
const repo = path.resolve(import.meta.dirname, "../../..");
const status = (expected: number) => (error: unknown) => error instanceof ProjectStoreError && error.status === expected;

async function fixture(t: { after: (fn: () => Promise<void>) => void }, writable = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "alloyframe-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store: createProjectStore({ root, catalog, accessories, writable }) };
}

async function writeCatalog(root: string) {
  await fs.mkdir(path.join(root, "catalog"), { recursive: true });
  await fs.writeFile(path.join(root, "catalog/profiles.json"), JSON.stringify(catalogJson));
  await fs.writeFile(path.join(root, "catalog/accessories.json"), JSON.stringify(accessoriesJson));
}

test("create/import/copy 均产生安全独立 id，空项目和磁盘中的设计文件保持唯一真相源", async (t) => {
  const { root, store } = await fixture(t);
  const empty = await store.createProject("  新家具  ");
  assert.equal(empty.design.name, "新家具");
  assert.equal(empty.design.parts.length, 0);
  assert.equal(empty.design.revision, 0);
  assert.ok(IdSchema.safeParse(empty.design.id).success);
  assert.match(empty.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(empty.updatedAt)));
  const imported = await store.importProject({ ...designJson, revision: 87 });
  const copied = await store.copyProject(imported.design.id, "复制品", imported.fingerprint);
  assert.equal(imported.design.revision, 0);
  assert.equal(copied.design.revision, 0);
  assert.equal(copied.design.name, "复制品");
  assert.equal(new Set([empty.design.id, imported.design.id, copied.design.id, designJson.id]).size, 4);
  assert.deepEqual(await store.getProject(copied.design.id), copied);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, "designs", `${copied.design.id}.json`), "utf8")).parts.length, designJson.parts.length);
  const library = await store.getProjectLibrary();
  assert.equal(library.projects.find((project) => project.id === empty.design.id)?.status, "empty");
  assert.equal(library.projects.find((project) => project.id === imported.design.id)?.status, "valid");
  assert.equal(library.writable, true);
  assert.deepEqual(library.archived, []);
});

test("存储侧增加 revision，忽略输入 revision；过期 hash 对保存、改名、复制和归档返回409", async (t) => {
  const { store } = await fixture(t);
  const initial = await store.createProject("原始名称");
  const saved = await store.saveProject(initial.design.id, { ...initial.design, name: "修改后", revision: 999 }, initial.fingerprint);
  assert.equal(saved.design.revision, 1);
  const renamed = await store.renameProject(initial.design.id, " 新名称 ", saved.fingerprint);
  assert.equal(renamed.design.revision, 2);
  assert.equal(renamed.design.name, "新名称");
  await assert.rejects(store.saveProject(initial.design.id, initial.design, initial.fingerprint), status(409));
  await assert.rejects(store.renameProject(initial.design.id, "冲突", initial.fingerprint), status(409));
  await assert.rejects(store.copyProject(initial.design.id, undefined, initial.fingerprint), status(409));
  await assert.rejects(store.archiveProject(initial.design.id, initial.fingerprint), status(409));
  assert.deepEqual(await store.getProject(initial.design.id), renamed);
});

test("Agent 不增加 revision 直接修改文件，仍由内容 hash 检出冲突，包括已变为坏 JSON", async (t) => {
  const { root, store } = await fixture(t);
  const initial = await store.createProject("原始");
  const file = path.join(root, "designs", `${initial.design.id}.json`);
  await fs.writeFile(file, JSON.stringify({ ...initial.design, name: "Agent 外部修改" }));
  await assert.rejects(store.saveProject(initial.design.id, initial.design, initial.fingerprint), status(409));
  const external = await store.getProject(initial.design.id);
  assert.equal(external.design.revision, 0);
  assert.equal(external.design.name, "Agent 外部修改");
  assert.notEqual(external.fingerprint, initial.fingerprint);
  await fs.writeFile(file, "{");
  await assert.rejects(store.saveProject(initial.design.id, initial.design, external.fingerprint), status(409));
});

test("同进程跨实例串行化：同一 fingerprint 的并发保存恰好一次成功", async (t) => {
  const { root, store } = await fixture(t);
  const other = createProjectStore({ root, catalog, accessories });
  const initial = await store.createProject("并发");
  const results = await Promise.allSettled([
    store.saveProject(initial.design.id, { ...initial.design, name: "甲" }, initial.fingerprint),
    other.saveProject(initial.design.id, { ...initial.design, name: "乙" }, initial.fingerprint),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const failed = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(status(409)(failed.reason));
  assert.equal((await store.getProject(initial.design.id)).design.revision, 1);
  assert.ok((await fs.readdir(path.join(root, "designs"))).every((file) => file.endsWith(".json")));
});

test("归档/恢复保留原文件，目录中同名文件绝不覆盖，冲突后两边均保留", async (t) => {
  const { root, store } = await fixture(t);
  const initial = await store.createProject("可归档");
  const id = initial.design.id;
  await store.archiveProject(id, initial.fingerprint);
  await assert.rejects(store.getProject(id), status(404));
  assert.deepEqual(await store.getProject(id, true), initial);
  let library = await store.getProjectLibrary();
  assert.equal(library.projects.length, 0);
  assert.equal(library.archived[0].id, id);
  assert.equal(library.archived[0].archived, true);
  await assert.rejects(store.restoreProject(id, "stale"), status(409));
  const activeFile = path.join(root, "designs", `${id}.json`);
  await fs.writeFile(activeFile, "do not overwrite");
  await assert.rejects(store.restoreProject(id, initial.fingerprint), status(409));
  assert.equal(await fs.readFile(activeFile, "utf8"), "do not overwrite");
  assert.deepEqual(await store.getProject(id, true), initial);
  await fs.unlink(activeFile);
  await store.restoreProject(id, initial.fingerprint);
  assert.deepEqual(await store.getProject(id), initial);
  library = await store.getProjectLibrary();
  assert.equal(library.archived.length, 0);
  await fs.writeFile(path.join(root, "archive", `${id}.json`), "archive collision");
  await assert.rejects(store.archiveProject(id, initial.fingerprint), status(409));
  assert.deepEqual(await store.getProject(id), initial);
});

test("坏 JSON、id/文件名不一致与引用损坏保留 invalid 摘要，坏文件可归档而不被解析重写", async (t) => {
  const { root, store } = await fixture(t);
  await fs.mkdir(path.join(root, "designs"));
  await fs.writeFile(path.join(root, "designs/broken.json"), "{broken");
  await fs.writeFile(path.join(root, "designs/mismatch.json"), JSON.stringify({ ...designJson, id: "different" }));
  await fs.writeFile(path.join(root, "designs/missing-ref.json"), JSON.stringify({ ...designJson, id: "missing-ref", accessories: [{ ref: "absent", qty: 1 }] }));
  const library = await store.getProjectLibrary();
  assert.equal(library.projects.length, 3);
  assert.ok(library.projects.every((project) => project.status === "invalid" && project.error && project.fingerprint));
  await assert.rejects(store.getProject("broken"), status(400));
  await assert.rejects(store.getProject("mismatch"), (error) => status(400)(error) && (error as ProjectStoreError).issues?.[0].path === "id");
  const broken = library.projects.find((project) => project.id === "broken")!;
  await store.archiveProject("broken", broken.fingerprint);
  assert.equal(await fs.readFile(path.join(root, "archive/broken.json"), "utf8"), "{broken");
});

test("校验失败不写文件、API id 与 design id 必须一致、缺失项目404、非法路径400", async (t) => {
  const { root, store } = await fixture(t);
  const initial = await store.createProject("校验");
  await assert.rejects(store.saveProject(initial.design.id, { ...initial.design, id: "other" }, initial.fingerprint), status(400));
  await assert.rejects(store.importProject({ ...designJson, extra: true }), (error) => status(400)(error) && !!(error as ProjectStoreError).issues?.length);
  await assert.rejects(store.createProject("  "), status(400));
  await assert.rejects(store.getProject("missing"), status(404));
  await assert.rejects(store.getProject("../outside"), status(400));
  await assert.rejects(store.archiveProject("../outside", initial.fingerprint), status(400));
  assert.deepEqual(await store.getProject(initial.design.id), initial);
  assert.deepEqual(await fs.readdir(path.join(root, "designs")), [`${initial.design.id}.json`]);
});

test("文件、designs/archive/catalog、root 符号链接不会被跟随", async (t) => {
  const { root, store } = await fixture(t);
  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "external.json"), JSON.stringify({ ...designJson, id: "external" }));
  await fs.mkdir(path.join(root, "designs"));
  await fs.symlink(path.join(outside, "external.json"), path.join(root, "designs/external.json"));
  await assert.rejects(store.getProject("external"), status(403));
  await assert.rejects(store.saveProject("external", { ...designJson, id: "external" }, "anything"), status(403));
  await assert.rejects(store.archiveProject("external", "anything"), status(403));
  assert.equal((await store.getProjectLibrary()).projects[0].status, "invalid");
  await fs.rm(path.join(root, "designs"), { recursive: true });
  await fs.symlink(outside, path.join(root, "designs"));
  await assert.rejects(store.createProject("禁止写出目录"), status(403));
  await fs.unlink(path.join(root, "designs"));
  const valid = await store.createProject("有效");
  await fs.symlink(outside, path.join(root, "archive"));
  await assert.rejects(store.archiveProject(valid.design.id, valid.fingerprint), status(403));
  await fs.symlink(outside, path.join(root, "catalog"));
  const diskCatalog = createProjectStore({ root });
  await assert.rejects(diskCatalog.importProject(designJson), status(403));
  const rootLink = path.join(root, "root-link");
  await fs.symlink(outside, rootLink);
  await assert.rejects(createProjectStore({ root: rootLink, catalog, accessories }).createProject("禁止"), status(403));
  assert.deepEqual(await fs.readdir(outside), ["external.json"]);
});

test("只读 store 禁止所有变更但可读取，配置开关也会覆盖显式 writable", async (t) => {
  const { root, store } = await fixture(t);
  const initial = await store.createProject("只读");
  const readOnly = createProjectStore({ root, catalog, accessories, writable: false });
  assert.equal(readOnly.getStoreWritable(), false);
  assert.equal((await readOnly.getProjectLibrary()).writable, false);
  assert.deepEqual(await readOnly.getProject(initial.design.id), initial);
  for (const operation of [
    () => readOnly.createProject("新建"), () => readOnly.importProject(designJson),
    () => readOnly.copyProject(initial.design.id),
    () => readOnly.saveProject(initial.design.id, initial.design, initial.fingerprint),
    () => readOnly.renameProject(initial.design.id, "新名称", initial.fingerprint),
    () => readOnly.archiveProject(initial.design.id, initial.fingerprint),
    () => readOnly.restoreProject(initial.design.id, initial.fingerprint),
  ]) await assert.rejects(operation(), status(403));
  const previous = process.env.ALLOYFRAME_READ_ONLY;
  process.env.ALLOYFRAME_READ_ONLY = "1";
  try {
    assert.equal(getStoreWritable(), false);
    assert.equal(store.getStoreWritable(), false);
    await assert.rejects(store.createProject("配置只读"), status(403));
  } finally {
    if (previous === undefined) delete process.env.ALLOYFRAME_READ_ONLY;
    else process.env.ALLOYFRAME_READ_ONLY = previous;
  }
});

test("只读操作不创建缺失 root/designs/archive 目录，读取不存在的库不产生写入", async (t) => {
  const { root } = await fixture(t);
  const missing = path.join(root, "missing-root");
  const store = createProjectStore({ root: missing, catalog, accessories, writable: false });
  assert.deepEqual(await store.getProjectLibrary(), { projects: [], archived: [], writable: false });
  await assert.rejects(store.getProject("absent"), status(404));
  await assert.rejects(store.createProject("只读禁止"), status(403));
  await assert.rejects(store.importProject(designJson), status(403));
  await assert.rejects(store.archiveProject("absent", "hash"), status(403));
  await assert.rejects(store.restoreProject("absent", "hash"), status(403));
  assert.deepEqual(await fs.readdir(root), []);
  const existing = createProjectStore({ root, catalog, accessories, writable: false });
  assert.deepEqual(await existing.getProjectLibrary(), { projects: [], archived: [], writable: false });
  assert.deepEqual(await fs.readdir(root), []);
});

test("默认 catalog 读取同 root/catalog，ALLOYFRAME_DATA_DIR 必须绝对路径，超限文件413", async (t) => {
  const { root } = await fixture(t);
  await writeCatalog(root);
  const store = createProjectStore({ root });
  const project = await store.importProject(designJson);
  assert.ok(project.design.parts.length > 0);
  const previous = process.env.ALLOYFRAME_DATA_DIR;
  try {
    process.env.ALLOYFRAME_DATA_DIR = root;
    assert.equal(getDataRoot(), root);
    process.env.ALLOYFRAME_DATA_DIR = "relative-data";
    assert.throws(() => getDataRoot(), status(400));
  } finally {
    if (previous === undefined) delete process.env.ALLOYFRAME_DATA_DIR;
    else process.env.ALLOYFRAME_DATA_DIR = previous;
  }
  await fs.writeFile(path.join(root, "designs/large.json"), " ".repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(store.getProject("large"), status(413));
});

test("数据目录默认值、旧名兼容和新名优先；显式新空值或相对路径返回400且不写入", async (t) => {
  const { root } = await fixture(t);
  assert.equal(getDataRoot(), path.join(process.cwd(), "data"));
  process.env.SUNMAO_DATA_DIR = path.join(root, "legacy");
  assert.equal(getDataRoot(), process.env.SUNMAO_DATA_DIR);
  process.env.ALLOYFRAME_DATA_DIR = path.join(root, "current");
  assert.equal(getDataRoot(), process.env.ALLOYFRAME_DATA_DIR);
  for (const invalid of ["", "relative-data"]) {
    process.env.ALLOYFRAME_DATA_DIR = invalid;
    assert.throws(() => getDataRoot(), status(400));
    assert.throws(() => createProject("不能回退写入"), (error) => status(400)(error)
      && error instanceof ProjectStoreError && /ALLOYFRAME_DATA_DIR/.test(error.message));
  }
  assert.deepEqual(await fs.readdir(root), []);
});

test("旧只读变量可回退，新0或空值覆盖旧1；显式 root 与只读 store 仍受尊重", async (t) => {
  const { root, store } = await fixture(t);
  process.env.SUNMAO_READ_ONLY = "1";
  assert.equal(getStoreWritable(), false);
  assert.equal(store.getStoreWritable(), false);
  await assert.rejects(store.createProject("旧配置只读"), status(403));
  process.env.ALLOYFRAME_DATA_DIR = "relative-data";
  process.env.SUNMAO_DATA_DIR = path.join(root, "legacy");
  const readOnly = createProjectStore({ root, catalog, accessories, writable: false });
  for (const value of ["0", "", "true"]) {
    process.env.ALLOYFRAME_READ_ONLY = value;
    assert.equal(getStoreWritable(), true);
    assert.equal(store.getStoreWritable(), true);
    assert.equal(readOnly.getStoreWritable(), false);
    await assert.rejects(readOnly.createProject("显式只读"), status(403));
  }
  const project = await store.createProject("显式目录");
  assert.deepEqual(await fs.readdir(root), ["designs"]);
  assert.deepEqual(await fs.readdir(path.join(root, "designs")), [`${project.design.id}.json`]);
  assert.deepEqual(await readOnly.getProject(project.design.id), project);
});

test("CLI 复用共享校验：空项目 warning 退出0；id 不匹配、旋转穿地、路径参数退出1", async (t) => {
  const { root, store } = await fixture(t);
  await writeCatalog(root);
  const project = await store.createProject("CLI 空项目");
  const run = (...args: string[]) => spawnSync(path.join(repo, "node_modules/.bin/tsx"), ["src/scripts/validate.ts", ...args], {
    cwd: repo, encoding: "utf8", env: {
      ...process.env, ALLOYFRAME_DATA_DIR: root, SUNMAO_DATA_DIR: root,
      ALLOYFRAME_READ_ONLY: "0", SUNMAO_READ_ONLY: "0",
      ALLOYFRAME_TRUSTED_ORIGINS: "", SUNMAO_TRUSTED_ORIGINS: "",
    },
  });
  const success = run(project.design.id);
  assert.equal(success.status, 0, success.stderr);
  assert.doesNotMatch(success.stderr, /THREE_CJS_DEPRECATED|DeprecationWarning/);
  assert.match(success.stderr, /警告.*尚无零件/);
  await fs.writeFile(path.join(root, "designs/mismatch.json"), JSON.stringify({ ...project.design, id: "another" }));
  assert.equal(run("mismatch").status, 1);
  await fs.writeFile(path.join(root, "designs/rotated.json"), JSON.stringify({
    ...project.design, id: "rotated", parts: [{
      id: "plate", kind: "plate", role: "台面", material: "wood", size: [100, 20, 40],
      position: [0, 20, 0], rotation: [0, 0, 90],
    }],
  }));
  const rotated = run("rotated");
  assert.equal(rotated.status, 1);
  assert.match(rotated.stderr, /低于地面/);
  assert.equal(run("../outside").status, 1);
});

test("坏 UTF-8 标记 invalid，保存/改名拒绝且归档/恢复保留原始字节", async (t) => {
  const { root, store } = await fixture(t);
  const initial = await store.createProject("坏编码");
  const id = initial.design.id;
  const file = path.join(root, "designs", `${id}.json`);
  const original = Buffer.from(JSON.stringify({ ...initial.design, meta: { note: "marker" } }));
  original[original.indexOf("marker")] = 0xff;
  await fs.writeFile(file, original);

  const invalid = (await store.getProjectLibrary()).projects[0];
  assert.equal(invalid.status, "invalid");
  assert.match(invalid.error ?? "", /UTF-8/);
  assert.match(invalid.fingerprint, /^[a-f0-9]{64}$/);
  const badEncoding = (error: unknown) => status(400)(error)
    && error instanceof ProjectStoreError && error.issues?.[0].path === "(根)";
  await assert.rejects(store.getProject(id), badEncoding);
  await assert.rejects(store.saveProject(id, initial.design, invalid.fingerprint), badEncoding);
  await assert.rejects(store.renameProject(id, "不能重写", invalid.fingerprint), badEncoding);
  assert.deepEqual(await fs.readFile(file), original);
  assert.deepEqual(await fs.readdir(path.join(root, "designs")), [`${id}.json`]);

  await store.archiveProject(id, invalid.fingerprint);
  assert.deepEqual(await fs.readFile(path.join(root, "archive", `${id}.json`)), original);
  const archived = (await store.getProjectLibrary()).archived[0];
  assert.equal(archived.status, "invalid");
  assert.equal(archived.fingerprint, invalid.fingerprint);
  await store.restoreProject(id, archived.fingerprint);
  assert.deepEqual(await fs.readFile(file), original);
  await assert.rejects(store.getProject(id), badEncoding);
});

test("revision 递增允许最大安全整数，溢出保存/改名拒绝且原文件不变", async (t) => {
  for (const action of ["save", "rename"] as const) {
    const { root, store } = await fixture(t);
    const initial = await store.createProject(action);
    const id = initial.design.id;
    const file = path.join(root, "designs", `${id}.json`);
    await fs.writeFile(file, JSON.stringify({ ...initial.design, revision: Number.MAX_SAFE_INTEGER - 1 }));
    const source = await store.getProject(id);
    const maximum = action === "save"
      ? await store.saveProject(id, { ...source.design, name: "最大修订号" }, source.fingerprint)
      : await store.renameProject(id, "最大修订号", source.fingerprint);
    assert.equal(maximum.design.revision, Number.MAX_SAFE_INTEGER);
    assert.deepEqual(await store.getProject(id), maximum);
    const original = await fs.readFile(file);

    await assert.rejects(action === "save"
      ? store.saveProject(id, { ...maximum.design, name: "不能写入" }, maximum.fingerprint)
      : store.renameProject(id, "不能写入", maximum.fingerprint),
    (error: unknown) => status(400)(error) && error instanceof ProjectStoreError && /revision/.test(error.message));
    assert.deepEqual(await fs.readFile(file), original);
    assert.deepEqual(await store.getProject(id), maximum);
    assert.deepEqual(await fs.readdir(path.join(root, "designs")), [`${id}.json`]);
  }
});

test("单件中心或整体半径非有限时导入/保存拒绝且不写文件", async (t) => {
  const { root, store } = await fixture(t);
  const initial = await store.createProject("有限几何");
  const file = path.join(root, "designs", `${initial.design.id}.json`);
  const original = await fs.readFile(file);
  const box = { id: "box", kind: "box", role: "方块", material: "wood", size: [100, 100, 100], position: [0, 100, 0] };
  const candidates = [
    [{ ...box, position: [1e308, 100, 0] }],
    [-1, 1].map((sign) => ({ ...box, id: sign < 0 ? "left" : "right", position: [sign * 1e154, 100, 0] })),
  ];
  for (const parts of candidates) {
    const input = { ...initial.design, parts };
    await assert.rejects(store.importProject(input), status(400));
    await assert.rejects(store.saveProject(initial.design.id, input, initial.fingerprint), status(400));
    assert.deepEqual(await fs.readFile(file), original);
    assert.deepEqual(await fs.readdir(path.join(root, "designs")), [`${initial.design.id}.json`]);
  }
  assert.deepEqual(await store.getProject(initial.design.id), initial);
});
