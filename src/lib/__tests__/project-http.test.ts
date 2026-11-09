import assert from "node:assert/strict";
import { beforeEach, test, type TestContext } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import catalogJson from "../../../data/catalog/profiles.json";
import accessoriesJson from "../../../data/catalog/accessories.json";
import designJson from "../../../data/designs/standing-desk.json";
import { assertWriteRequest, canWriteRequest, MAX_PROJECT_BODY_BYTES, readProjectJson } from "../project-http";
import { ProjectStoreError } from "../project-store";
import type { ProjectLibrary, ProjectRecord } from "../projects";
import { GET as libraryGet, POST } from "../../app/api/projects/route";
import { GET as projectGet, PATCH, PUT } from "../../app/api/projects/[id]/route";

const restoreEnv = (key: string, previous: string | undefined) => {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
};
beforeEach((t) => {
  const keys = ["ALLOYFRAME_DATA_DIR", "ALLOYFRAME_READ_ONLY", "ALLOYFRAME_TRUSTED_ORIGINS",
    "SUNMAO_DATA_DIR", "SUNMAO_READ_ONLY", "SUNMAO_TRUSTED_ORIGINS"] as const;
  const previous = keys.map((key) => process.env[key]);
  for (const key of keys) delete process.env[key];
  (t as TestContext).after(() => keys.forEach((key, index) => restoreEnv(key, previous[index])));
});
const status = (expected: number) => (error: unknown) => error instanceof ProjectStoreError && error.status === expected;
const local = "http://localhost:3000";
const request = (url: string, origin?: string, method = "POST", headers: Record<string, string> = {}) => new Request(url, {
  method, headers: { ...headers, ...(origin === undefined ? {} : { origin }) },
});

test("来源保护默认仅 loopback 同源，写请求必须带有效 Origin，GET/HEAD 可推断同源能力", () => {
  const previous = process.env.ALLOYFRAME_TRUSTED_ORIGINS;
  delete process.env.ALLOYFRAME_TRUSTED_ORIGINS;
  try {
    for (const origin of [local, "http://127.0.0.1:3000", "http://[::1]:3000", "http://127.1.2.3:3000"]) {
      assert.equal(canWriteRequest(request(`${origin}/api/projects`, origin)), true, origin);
    }
    for (const origin of ["https://public.example", "http://192.168.0.2:3000", "http://localhost.evil.test:3000"]) {
      assert.equal(canWriteRequest(request(`${origin}/api/projects`, origin)), false, origin);
    }
    for (const origin of [undefined, "null", "http://localhost:4000", "http://127.0.0.1:3000", "https://evil.example", `${local}/path`]) {
      assert.equal(canWriteRequest(request(`${local}/api/projects`, origin)), false, String(origin));
    }
    assert.equal(canWriteRequest(request(`${local}/api/projects`, undefined, "GET")), true);
    assert.equal(canWriteRequest(request(`${local}/api/projects`, undefined, "HEAD")), true);
    assert.equal(canWriteRequest(request(`${local}/api/projects`, undefined, "GET", { "sec-fetch-site": "cross-site" })), false);
    assert.equal(canWriteRequest(request(`${local}/api/projects`, local, "POST", { host: "public.example" })), false);
    assert.equal(canWriteRequest(request("http://public.example/api/projects", "http://public.example", "POST", { "x-forwarded-host": "localhost:3000" })), false);
    assert.throws(() => assertWriteRequest(request(`${local}/api/projects`, "https://evil.example")), status(403));
  } finally { restoreEnv("ALLOYFRAME_TRUSTED_ORIGINS", previous); }
});

test("显式可信 origins 可以额外开放来源/部署地址，但不因任意可信来源误开其他公网目标", () => {
  const previous = process.env.ALLOYFRAME_TRUSTED_ORIGINS;
  process.env.ALLOYFRAME_TRUSTED_ORIGINS = "https://alloyframe.example,https://editor.example not-an-origin *";
  try {
    assert.equal(canWriteRequest(request("https://alloyframe.example/api/projects", "https://alloyframe.example")), true);
    assert.equal(canWriteRequest(request("https://alloyframe.example/api/projects", "https://editor.example")), true);
    assert.equal(canWriteRequest(request(`${local}/api/projects`, "https://editor.example")), true);
    assert.equal(canWriteRequest(request("https://unlisted.example/api/projects", "https://editor.example")), false);
    assert.equal(canWriteRequest(request("https://alloyframe.example/api/projects", "https://evil.example")), false);
    assert.equal(canWriteRequest(request("https://alloyframe.example/api/projects")), false);
  } finally { restoreEnv("ALLOYFRAME_TRUSTED_ORIGINS", previous); }
});

test("ALLOYFRAME_READ_ONLY=1 让可信来源也只读", () => {
  const previous = process.env.ALLOYFRAME_READ_ONLY;
  process.env.ALLOYFRAME_READ_ONLY = "1";
  try {
    assert.equal(canWriteRequest(request(`${local}/api/projects`, local)), false);
    assert.throws(() => assertWriteRequest(request(`${local}/api/projects`, local)), status(403));
  } finally { restoreEnv("ALLOYFRAME_READ_ONLY", previous); }
});

test("旧可信来源变量可回退，新来源列表优先且不合并，显式新空值清空旧白名单", () => {
  const legacy = "https://legacy.example";
  const current = "https://alloyframe.example";
  process.env.SUNMAO_TRUSTED_ORIGINS = legacy;
  assert.equal(canWriteRequest(request(`${legacy}/api/projects`, legacy)), true);
  assert.equal(canWriteRequest(request(`${local}/api/projects`, legacy)), true);
  process.env.ALLOYFRAME_TRUSTED_ORIGINS = current;
  assert.equal(canWriteRequest(request(`${current}/api/projects`, current)), true);
  assert.equal(canWriteRequest(request(`${current}/api/projects`, legacy)), false);
  assert.equal(canWriteRequest(request(`${legacy}/api/projects`, current)), false);
  assert.equal(canWriteRequest(request(`${local}/api/projects`, legacy)), false);
  process.env.ALLOYFRAME_TRUSTED_ORIGINS = "";
  assert.equal(canWriteRequest(request(`${legacy}/api/projects`, legacy)), false);
  assert.equal(canWriteRequest(request(`${current}/api/projects`, current)), false);
  assert.equal(canWriteRequest(request(`${local}/api/projects`, legacy)), false);
  assert.equal(canWriteRequest(request(`${local}/api/projects`, local)), true);
});

test("旧只读变量阻止写入，新0覆盖旧1，新1仍阻止写入", () => {
  process.env.SUNMAO_READ_ONLY = "1";
  assert.equal(canWriteRequest(request(`${local}/api/projects`, local)), false);
  assert.throws(() => assertWriteRequest(request(`${local}/api/projects`, local)), status(403));
  process.env.ALLOYFRAME_READ_ONLY = "0";
  assert.equal(canWriteRequest(request(`${local}/api/projects`, local)), true);
  assert.doesNotThrow(() => assertWriteRequest(request(`${local}/api/projects`, local)));
  process.env.SUNMAO_READ_ONLY = "0";
  process.env.ALLOYFRAME_READ_ONLY = "1";
  assert.equal(canWriteRequest(request(`${local}/api/projects`, local)), false);
});

test("JSON body 实际字节限制2MiB，伪造Content-Length、分块和多字节字符都不能绕过", async () => {
  const jsonRequest = (body: string, length?: string) => new Request(`${local}/api/projects`, {
    method: "POST", body, headers: length ? { "content-length": length } : {},
  });
  assert.deepEqual(await readProjectJson(jsonRequest('{"name":"家具"}')), { name: "家具" });
  const exact = `"${"x".repeat(MAX_PROJECT_BODY_BYTES - 2)}"`;
  assert.equal((await readProjectJson(jsonRequest(exact)) as string).length, MAX_PROJECT_BODY_BYTES - 2);
  await assert.rejects(readProjectJson(jsonRequest(`${exact} `, "1")), status(413));
  await assert.rejects(readProjectJson(jsonRequest(`"${"桌".repeat(Math.ceil(MAX_PROJECT_BODY_BYTES / 3))}"`, "1")), status(413));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_PROJECT_BODY_BYTES));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  const chunked = new Request(`${local}/api/projects`, { method: "POST", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readProjectJson(chunked), status(413));
  await assert.rejects(readProjectJson(jsonRequest("{")), status(400));
  await assert.rejects(readProjectJson(request(`${local}/api/projects`, local)), status(400));
  const malformed = new Request(`${local}/api/projects`, { method: "POST", body: new Uint8Array([0x22, 0xff, 0x22]) });
  await assert.rejects(readProjectJson(malformed), status(400));
});

test("API 显式新空值或相对数据目录返回400，不回退旧目录也不写入", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "alloyframe-api-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  process.env.SUNMAO_DATA_DIR = root;
  for (const invalid of ["", "relative-data"]) {
    process.env.ALLOYFRAME_DATA_DIR = invalid;
    const response = await POST(new Request(`${local}/api/projects`, {
      method: "POST", headers: { origin: local, "content-type": "application/json" },
      body: JSON.stringify({ action: "create", name: "不能回退写入" }),
    }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /ALLOYFRAME_DATA_DIR/);
    assert.equal((await libraryGet(new Request(`${local}/api/projects`))).status, 400);
    assert.deepEqual(await fs.readdir(root), []);
  }
});

test("API 不启服务器即测试CRUD、错误状态、no-store、异步params、来源与只读能力", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "alloyframe-api-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "catalog"));
  await fs.writeFile(path.join(root, "catalog/profiles.json"), JSON.stringify(catalogJson));
  await fs.writeFile(path.join(root, "catalog/accessories.json"), JSON.stringify(accessoriesJson));
  const oldRoot = process.env.ALLOYFRAME_DATA_DIR;
  const oldReadOnly = process.env.ALLOYFRAME_READ_ONLY;
  const oldTrusted = process.env.ALLOYFRAME_TRUSTED_ORIGINS;
  process.env.ALLOYFRAME_DATA_DIR = root;
  delete process.env.ALLOYFRAME_READ_ONLY;
  delete process.env.ALLOYFRAME_TRUSTED_ORIGINS;
  const bodyRequest = (method: string, body: unknown, origin = local) => new Request(`${local}/api/projects`, {
    method, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  try {
    let response = await libraryGet(new Request(`${local}/api/projects`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { projects: [], archived: [], writable: true });
    response = await libraryGet(new Request("https://public.example/api/projects"));
    assert.equal((await response.json()).writable, false);
    response = await POST(bodyRequest("POST", { action: "create", name: "API 新项目" }));
    assert.equal(response.status, 201);
    let project = await response.json() as ProjectRecord;
    const id = project.design.id;
    response = await projectGet(new Request(`${local}/api/projects/${id}`), context(id));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { project, writable: true });
    response = await projectGet(new Request(`https://public.example/api/projects/${id}`), context(id));
    assert.equal((await response.json()).writable, false);
    response = await PUT(bodyRequest("PUT", { design: { ...project.design, name: "保存后", revision: 9 }, fingerprint: project.fingerprint }), context(id));
    assert.equal(response.status, 200);
    project = await response.json();
    assert.equal(project.design.revision, 1);
    response = await PATCH(bodyRequest("PATCH", { action: "rename", name: "改名后", fingerprint: project.fingerprint }), context(id));
    assert.equal(response.status, 200);
    project = await response.json();
    assert.equal(project.design.name, "改名后");
    assert.equal(project.design.revision, 2);
    response = await PUT(bodyRequest("PUT", { design: project.design, fingerprint: "stale" }), context(id));
    assert.equal(response.status, 409);
    assert.equal(typeof (await response.json()).error, "string");
    response = await POST(bodyRequest("POST", { action: "copy", id, fingerprint: project.fingerprint }));
    assert.equal(response.status, 201);
    assert.notEqual((await response.json()).design.id, id);
    response = await POST(bodyRequest("POST", { action: "import", design: designJson, name: "导入" }));
    assert.equal(response.status, 201);
    const imported = await response.json() as ProjectRecord;
    assert.equal(imported.design.name, "导入");
    response = await PATCH(bodyRequest("PATCH", { action: "archive", fingerprint: project.fingerprint }), context(id));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id });
    response = await projectGet(new Request(`${local}/api/projects/${id}`), context(id));
    assert.equal(response.status, 404);
    response = await libraryGet(new Request(`${local}/api/projects`));
    const library = await response.json() as ProjectLibrary;
    assert.equal(library.archived[0].id, id);
    response = await PATCH(bodyRequest("PATCH", { action: "restore", fingerprint: library.archived[0].fingerprint }), context(id));
    assert.equal(response.status, 200);
    response = await POST(bodyRequest("POST", { action: "import", design: { ...designJson, unrecognized: true } }));
    assert.equal(response.status, 400);
    assert.ok((await response.json()).issues.length > 0);
    response = await POST(bodyRequest("POST", { action: "delete", id }));
    assert.equal(response.status, 400);
    response = await PUT(bodyRequest("PUT", { design: project.design }), context(id));
    assert.equal(response.status, 400);
    response = await POST(bodyRequest("POST", { action: "create", name: "拒绝" }, "https://evil.example"));
    assert.equal(response.status, 403);
    response = await POST(new Request(`${local}/api/projects`, {
      method: "POST", headers: { origin: local, "content-length": "1" }, body: "x".repeat(MAX_PROJECT_BODY_BYTES + 1),
    }));
    assert.equal(response.status, 413);
    process.env.ALLOYFRAME_READ_ONLY = "1";
    response = await libraryGet(new Request(`${local}/api/projects`));
    assert.equal((await response.json()).writable, false);
    response = await POST(bodyRequest("POST", { action: "create", name: "拒绝" }));
    assert.equal(response.status, 403);
  } finally {
    restoreEnv("ALLOYFRAME_DATA_DIR", oldRoot);
    restoreEnv("ALLOYFRAME_READ_ONLY", oldReadOnly);
    restoreEnv("ALLOYFRAME_TRUSTED_ORIGINS", oldTrusted);
  }
});
