import assert from "node:assert/strict";
import { beforeEach, test, type TestContext } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import catalogJson from "../../../data/catalog/profiles.json";
import accessoriesJson from "../../../data/catalog/accessories.json";
import designJson from "../../../data/designs/standing-desk.json";
import { DesignSchema } from "../schema";
import { createProjectImportReader, ProjectRequestError, projectRequest } from "../project-client";
import { MAX_PROJECT_BODY_BYTES } from "../project-http";
import type { ProjectRecord } from "../projects";
import { POST } from "../../app/api/projects/route";

const local = "http://localhost:3000";

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

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "alloyframe-import-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "catalog"));
  await fs.writeFile(path.join(root, "catalog/profiles.json"), JSON.stringify(catalogJson));
  await fs.writeFile(path.join(root, "catalog/accessories.json"), JSON.stringify(accessoriesJson));
  await fs.mkdir(path.join(root, "designs"));
  await fs.mkdir(path.join(root, "archive"));
  process.env.ALLOYFRAME_DATA_DIR = root;
  t.mock.method(globalThis, "fetch", async (url: string, options?: RequestInit) => POST(new Request(`${local}${url}`, {
    ...options, headers: { ...options?.headers, origin: local },
  })));
  return root;
}

const importText = (text: string, name?: string) => projectRequest<ProjectRecord>("/api/projects", {
  method: "POST", body: JSON.stringify({ action: "import", design: JSON.parse(text), ...(name ? { name } : {}) }),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const encoded = (text: string) => new TextEncoder().encode(text).buffer;

function importReader() {
  const input = { text: "原有粘贴内容", error: "", pending: false };
  const reader = createProjectImportReader({
    onText: (text) => { input.text = text; },
    onError: (error) => { input.error = error; },
    onPending: (pending) => { input.pending = pending; },
  });
  return { input, reader };
}

test("读文件期间 pending 阻止提交，成功后原样填入 JSON 文本而不自动导入", async () => {
  const { input, reader } = importReader();
  const pending = deferred<ArrayBuffer>();
  const text = JSON.stringify(designJson, null, 2) + "\n";
  const reading = reader.read({ size: encoded(text).byteLength, arrayBuffer: () => pending.promise });
  assert.equal(reader.pending, true);
  assert.equal(input.pending, true);
  assert.equal(input.text, "原有粘贴内容");
  pending.resolve(encoded(text));
  await reading;
  assert.equal(reader.pending, false);
  assert.equal(input.pending, false);
  assert.equal(input.text, text);
  assert.equal(input.error, "");
});

test("先选旧文件再选新文件，旧读取的成功或失败均不能覆盖新内容和提示", async () => {
  for (const fails of [false, true]) {
    const { input, reader } = importReader();
    const old = deferred<ArrayBuffer>();
    const fresh = deferred<ArrayBuffer>();
    const first = reader.read({ size: 1, arrayBuffer: () => old.promise });
    const second = reader.read({ size: 1, arrayBuffer: () => fresh.promise });
    fresh.resolve(encoded("新文件原文"));
    await second;
    assert.equal(reader.pending, false);
    if (fails) old.reject(new Error("old read failed"));
    else old.resolve(encoded("旧文件原文"));
    await first;
    assert.equal(input.text, "新文件原文");
    assert.equal(input.error, "");
    assert.equal(reader.pending, false);
  }
});

test("旧文件先完成也不能解除新文件的 pending 或覆盖原输入", async () => {
  const { input, reader } = importReader();
  const old = deferred<ArrayBuffer>();
  const fresh = deferred<ArrayBuffer>();
  const first = reader.read({ size: 1, arrayBuffer: () => old.promise });
  const second = reader.read({ size: 1, arrayBuffer: () => fresh.promise });
  old.resolve(encoded("旧文件"));
  await first;
  assert.equal(reader.pending, true);
  assert.equal(input.pending, true);
  assert.equal(input.text, "原有粘贴内容");
  fresh.resolve(encoded("新文件"));
  await second;
  assert.equal(reader.pending, false);
  assert.equal(input.pending, false);
  assert.equal(input.text, "新文件");
});

test("手动粘贴、取消表单或卸载使读取失效，旧回执不再改动输入", async () => {
  const { input, reader } = importReader();
  const old = deferred<ArrayBuffer>();
  const reading = reader.read({ size: 1, arrayBuffer: () => old.promise });
  reader.cancel();
  input.text = "用户新粘贴内容";
  assert.equal(reader.pending, false);
  old.resolve(encoded("迟到的文件原文"));
  await reading;
  assert.equal(input.text, "用户新粘贴内容");
  assert.equal(input.error, "");
});

test("读文件失败、超限或坏 UTF-8 明确反馈且保留旧输入，同文件可重试", async () => {
  const { input, reader } = importReader();
  let calls = 0;
  const failed = { size: 1, arrayBuffer: async () => { calls++; throw new Error("read failed"); } };
  await reader.read(failed);
  await reader.read(failed);
  assert.equal(calls, 2);
  assert.match(input.error, /文件读取失败/);
  assert.equal(input.text, "原有粘贴内容");
  assert.equal(reader.pending, false);

  calls = 0;
  await reader.read({ size: MAX_PROJECT_BODY_BYTES + 1, arrayBuffer: async () => { calls++; return new ArrayBuffer(0); } });
  assert.equal(calls, 0);
  assert.match(input.error, /2 MiB/);
  assert.equal(input.text, "原有粘贴内容");

  // 读取后的实际字节也检查，不能仅信任声明的 size。
  await reader.read({ size: 1, arrayBuffer: async () => new ArrayBuffer(MAX_PROJECT_BODY_BYTES + 1) });
  assert.match(input.error, /2 MiB/);
  assert.equal(input.text, "原有粘贴内容");

  const bytes = new TextEncoder().encode('{"material":"marker"}');
  bytes[13] = 0xff;
  await reader.read({ size: bytes.byteLength, arrayBuffer: async () => bytes.buffer });
  assert.match(input.error, /UTF-8/);
  assert.equal(input.text, "原有粘贴内容");
  await reader.read({ size: 1, arrayBuffer: async () => encoded("{尚未修复的 JSON") });
  assert.equal(input.text, "{尚未修复的 JSON");
  assert.equal(input.error, "");
});

test("创建或导入成功清理已提交表单，离开及返回后的迟到回执不会抢导航", async () => {
  const text = await fs.readFile(new URL("../../components/project/ProjectLibrary.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("ProjectLibrary.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let submit: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "submit") submit = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(submit);
  const code = ts.transpileModule(`(${submit.getText()})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const type of ["create", "import"] as const) for (const outcome of ["current", "hidden", "returned"] as const) {
    const response = deferred<ProjectRecord>();
    const active = { current: true };
    const activityEpoch = { current: 1 };
    const input = { form: { type } as { type: string } | null, name: "提交的名称", json: JSON.stringify(designJson), busy: false, error: "" };
    let navigation = 0;
    const callback = runInNewContext(code, {
      form: input.form, name: input.name, json: input.json, busy: false,
      importReader: { pending: false }, active, activityEpoch,
      setBusy: (value: boolean) => { input.busy = value; }, setError: (value: string) => { input.error = value; },
      setForm: (value: null) => { input.form = value; }, setName: (value: string) => { input.name = value; }, setJson: (value: string) => { input.json = value; },
      projectRequest: () => response.promise, router: { push: () => { navigation++; } },
    });
    const completion = callback({ preventDefault() {} });
    if (outcome !== "current") { active.current = false; activityEpoch.current++; }
    if (outcome === "returned") { active.current = true; activityEpoch.current++; }
    response.resolve({ design: DesignSchema.parse(designJson), fingerprint: "P1", updatedAt: "2026-01-01T00:00:00Z" });
    await completion;
    assert.equal(navigation, outcome === "current" ? 1 : 0, `${type}/${outcome}`);
    assert.equal(input.form, null);
    assert.equal(input.name, "");
    assert.equal(input.json, "");
    assert.equal(input.busy, false);
  }
});

test("导入网络失败返回明确的项目请求错误，不暴露原始 fetch 异常", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(projectRequest("/api/projects"), (error: unknown) => error instanceof ProjectRequestError
    && error.status === 0 && /网络/.test(error.message));
});

test("导入遇到 HTML、空或无效响应时保留 HTTP 状态，不误报输入 JSON 语法错误", async (t) => {
  let response = new Response("<html>Bad gateway</html>", { status: 502 });
  t.mock.method(globalThis, "fetch", async () => response);
  for (const [status, body, message] of [
    [502, "<html>Bad gateway</html>", /502/],
    [413, "Payload Too Large", /2 MiB/],
    [403, "", /403/],
    [200, "{unfinished", /服务.*JSON/],
  ] as const) {
    response = new Response(body, { status });
    await assert.rejects(importText(JSON.stringify(designJson)), (error: unknown) => error instanceof ProjectRequestError
      && error.status === status && message.test(error.message));
  }
});

test("导入服务返回 null 或异常 issues 时仍显示请求错误，正常引用错误保留路径详情", async (t) => {
  let result: unknown = null;
  t.mock.method(globalThis, "fetch", async () => Response.json(result, { status: 400 }));
  for (const value of [null, { error: "导入失败", issues: {} }, { error: "导入失败", issues: [null, 1] }]) {
    result = value;
    await assert.rejects(projectRequest("/api/projects"), (error: unknown) => error instanceof ProjectRequestError && error.status === 400);
  }
  result = { error: "设计校验失败", issues: [
    { level: "error", path: "parts.0.profile", message: '型材 "missing" 不在 catalog 中' },
    { level: "error", path: "accessories.0.ref", message: '配件引用 "missing" 不在配件库中' },
  ] };
  await assert.rejects(projectRequest("/api/projects"), (error: unknown) => error instanceof ProjectRequestError
    && error.status === 400 && error.issues.length === 2
    && /parts\.0\.profile/.test(error.message) && /accessories\.0\.ref/.test(error.message));
});

test("JSON 往返保留全部零件、尺寸、中心、旋转、材料、配件；导入生成新 ID 且不覆盖原件与归档", async (t) => {
  const root = await fixture(t);
  const original = DesignSchema.parse({
    ...designJson, revision: 37,
    parts: designJson.parts.map((part, index) => ({ ...part, rotation: [index === 6 ? 4.25 : 0, index * 7.25, index === 6 ? -6.75 : 0] })),
  });
  const text = JSON.stringify(original, null, 2) + "\n";
  const source = path.join(root, "designs", `${original.id}.json`);
  const archived = path.join(root, "archive", `${original.id}.json`);
  await fs.writeFile(source, text);
  await fs.writeFile(archived, text);

  const first = await importText(text);
  const second = await importText(JSON.stringify(first.design), "往返副本");
  assert.equal(new Set([original.id, first.design.id, second.design.id]).size, 3);
  assert.equal(first.design.revision, 0);
  assert.equal(first.design.name, original.name);
  assert.equal(second.design.revision, 0);
  assert.equal(second.design.name, "往返副本");
  for (const imported of [first, second]) {
    assert.deepEqual(imported.design.parts, original.parts);
    assert.deepEqual(imported.design.accessories, original.accessories);
    assert.deepEqual(imported.design.meta, original.meta);
    assert.equal(imported.design.units, "mm");
    assert.equal(imported.design.$schema, original.$schema);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "designs", `${imported.design.id}.json`), "utf8")), imported.design);
  }
  assert.equal(await fs.readFile(source, "utf8"), text);
  assert.equal(await fs.readFile(archived, "utf8"), text);
  assert.equal((await fs.readdir(path.join(root, "designs"))).length, 3);
});

test("导入引用、几何、未知字段与请求超限的错误明确，失败不写文件且原输入可修复后重试", async (t) => {
  const root = await fixture(t);
  const cases = [
    { design: { ...designJson, parts: [{ ...designJson.parts[1], profile: "missing-profile" }] }, path: "parts.0.profile" },
    { design: { ...designJson, accessories: [{ ref: "missing-accessory", qty: 1 }] }, path: "accessories.0.ref" },
    { design: { ...designJson, parts: [{ ...designJson.parts[0], position: [0, -100, 0] }] }, path: "parts.0.position" },
    { design: { ...designJson, extra: "不接受" }, path: "(根)" },
  ];
  for (const input of cases) {
    const text = JSON.stringify(input.design, null, 2);
    const original = JSON.parse(text);
    await assert.rejects(importText(text), (error: unknown) => error instanceof ProjectRequestError
      && error.status === 400 && error.message.includes(input.path));
    assert.deepEqual(JSON.parse(text), original);
    assert.deepEqual(await fs.readdir(path.join(root, "designs")), []);
  }
  const large = JSON.stringify({ ...designJson, meta: { ...designJson.meta, note: "桌".repeat(Math.ceil(MAX_PROJECT_BODY_BYTES / 3)) } });
  await assert.rejects(importText(large), (error: unknown) => error instanceof ProjectRequestError
    && error.status === 413 && /2 MiB/.test(error.message));
  assert.deepEqual(await fs.readdir(path.join(root, "designs")), []);
  assert.equal(JSON.parse(large).meta.note.length, Math.ceil(MAX_PROJECT_BODY_BYTES / 3));
  const fixed = await importText(JSON.stringify(designJson));
  assert.equal(fixed.design.parts.length, designJson.parts.length);
  assert.deepEqual(await fs.readdir(path.join(root, "designs")), [`${fixed.design.id}.json`]);
});
