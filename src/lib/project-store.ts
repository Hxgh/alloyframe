import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { AccessoryCatalogSchema, CatalogSchema, DesignSchema, IdSchema } from "./schema";
import type { AccessoryCatalog, Catalog, Design } from "./schema";
import type { ProjectLibrary, ProjectRecord, ProjectSummary, ValidationIssue } from "./projects";
import { inspectDesign } from "./validation";
import { getProjectEnv } from "./project-env";
import { buildTemplateDesign, type ProjectTemplateId } from "./project-templates";

export class ProjectStoreError extends Error {
  constructor(public status: number, message: string, public issues?: ValidationIssue[]) {
    super(message);
    this.name = "ProjectStoreError";
  }
}

export function getDataRoot(): string {
  const root = getProjectEnv("DATA_DIR") ?? path.join(process.cwd(), "data");
  if (!path.isAbsolute(root)) throw new ProjectStoreError(400, "ALLOYFRAME_DATA_DIR（兼容 SUNMAO_DATA_DIR）必须是绝对路径");
  return path.resolve(/* turbopackIgnore: true */ root);
}

export function getStoreWritable(): boolean {
  return getProjectEnv("READ_ONLY") !== "1";
}

export type ProjectStoreOptions = {
  root: string;
  catalog?: Catalog;
  accessories?: AccessoryCatalog;
  writable?: boolean;
};

const MAX_FILE_BYTES = 2 * 1024 * 1024;
// 同一进程的不同 store 实例也共用队列；失败不会阻塞后续操作。
const queues = new Map<string, Promise<unknown>>();

function serialize<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(root) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation).catch((error: unknown) => {
    if (error instanceof ProjectStoreError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new ProjectStoreError(404, "项目或数据目录不存在");
    if (code === "EEXIST") throw new ProjectStoreError(409, "目标项目已存在，不会覆盖");
    if (["EACCES", "EPERM", "EROFS", "ELOOP"].includes(code ?? "")) {
      throw new ProjectStoreError(403, "数据目录不可写或包含不允许的符号链接");
    }
    throw error;
  });
  queues.set(root, result);
  void result.finally(() => { if (queues.get(root) === result) queues.delete(root); }).catch(() => undefined);
  return result;
}

function validateId(id: string): void {
  if (!IdSchema.safeParse(id).success) throw new ProjectStoreError(400, "无效的项目 id");
}

function projectName(name: string): string {
  const parsed = DesignSchema.shape.name.safeParse(name);
  if (!parsed.success) throw new ProjectStoreError(400, "项目名称不能为空");
  return parsed.data;
}

function fingerprint(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function checkFingerprint(actual: string, expected: string): void {
  if (typeof expected !== "string" || expected.length === 0) {
    throw new ProjectStoreError(400, "必须提供 fingerprint");
  }
  if (actual !== expected) throw new ProjectStoreError(409, "项目文件已被其他客户端修改，请重新加载");
}

function nextRevision(revision: number): number {
  const next = revision + 1;
  if (!Number.isSafeInteger(next)) throw new ProjectStoreError(400, "revision 递增超出安全整数范围，不能保存");
  return next;
}

async function directory(dir: string, create = false): Promise<boolean> {
  if (create) await fs.mkdir(dir, { recursive: true });
  try {
    const stat = await fs.lstat(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new ProjectStoreError(403, "数据目录不能是符号链接或普通文件");
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !create) return false;
    throw error;
  }
}

async function readFile(file: string): Promise<{ content: Buffer; fingerprint: string; updatedAt: string }> {
  // O_NONBLOCK 避免被伪装成 JSON 的 FIFO 阻塞，O_NOFOLLOW 拒绝最终路径的符号链接。
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new ProjectStoreError(403, "项目必须是普通文件，不能是符号链接");
    if (stat.size > MAX_FILE_BYTES) throw new ProjectStoreError(413, "项目文件不能超过 2 MiB");
    const content = await handle.readFile();
    if (content.byteLength > MAX_FILE_BYTES) throw new ProjectStoreError(413, "项目文件不能超过 2 MiB");
    return { content, fingerprint: fingerprint(content), updatedAt: stat.mtime.toISOString() };
  } finally {
    await handle.close();
  }
}

function parseJson(content: Buffer): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)); }
  catch { throw new ProjectStoreError(400, "项目文件不是有效的 UTF-8 JSON", [
    { level: "error", path: "(根)", message: "UTF-8 解码或 JSON 解析失败" },
  ]); }
}

export function createProjectStore(options: ProjectStoreOptions) {
  if (!path.isAbsolute(options.root)) throw new ProjectStoreError(400, "数据目录必须是绝对路径");
  const root = path.resolve(/* turbopackIgnore: true */ options.root);
  const writable = () => getStoreWritable() && options.writable !== false;
  const assertWritable = () => {
    if (!writable()) throw new ProjectStoreError(403, "项目库处于只读模式");
  };
  const folder = (archived: boolean) => path.join(root, archived ? "archive" : "designs");
  const filePath = (id: string, archived: boolean) => {
    validateId(id);
    return path.join(folder(archived), `${id}.json`);
  };

  async function ensureFolder(archived: boolean, create = false) {
    if (!await directory(root, create)) return false;
    return directory(folder(archived), create);
  }

  async function catalogs() {
    if (options.catalog && options.accessories) return { catalog: options.catalog, accessories: options.accessories };
    if (!await directory(root) || !await directory(path.join(root, "catalog"))) {
      throw new ProjectStoreError(404, "catalog 目录不存在");
    }
    const catalog = options.catalog ?? CatalogSchema.parse(parseJson((await readFile(path.join(root, "catalog/profiles.json"))).content));
    const accessories = options.accessories ?? AccessoryCatalogSchema.parse(parseJson((await readFile(path.join(root, "catalog/accessories.json"))).content));
    return { catalog, accessories };
  }

  async function validated(input: unknown, id?: string): Promise<Design> {
    const { catalog, accessories } = await catalogs();
    const result = inspectDesign(input, catalog, accessories);
    if (!result.design) throw new ProjectStoreError(400, "设计校验失败", result.issues);
    if (id != null && result.design.id !== id) {
      throw new ProjectStoreError(400, "设计 id 必须与文件名一致", [
        { level: "error", path: "id", message: `设计 id 必须为 ${id}` },
      ]);
    }
    return result.design;
  }

  async function snapshot(id: string, archived = false) {
    const file = filePath(id, archived);
    if (!await ensureFolder(archived)) throw new ProjectStoreError(404, "项目不存在");
    return { ...await readFile(file), file };
  }

  async function record(id: string, archived = false, expected?: string): Promise<ProjectRecord> {
    const raw = await snapshot(id, archived);
    if (expected != null) checkFingerprint(raw.fingerprint, expected);
    return {
      design: await validated(parseJson(raw.content), id),
      fingerprint: raw.fingerprint, updatedAt: raw.updatedAt,
    };
  }

  async function exists(id: string, archived: boolean): Promise<boolean> {
    const file = filePath(id, archived);
    if (!await ensureFolder(archived)) return false;
    try { await fs.lstat(file); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }

  async function atomicWrite(id: string, design: Design, expected?: string): Promise<ProjectRecord> {
    await ensureFolder(false, true);
    const destination = filePath(id, false);
    const content = Buffer.from(`${JSON.stringify(design, null, 2)}\n`);
    if (content.byteLength > MAX_FILE_BYTES) throw new ProjectStoreError(413, "项目文件不能超过 2 MiB");
    const temporary = path.join(folder(false), `.${id}-${randomBytes(8).toString("hex")}.tmp`);
    let created = false;
    try {
      const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created = true;
      try { await handle.writeFile(content); await handle.sync(); }
      finally { await handle.close(); }
      // 写入期间再次检查原文件，Agent 即便没增加 revision 也会触发冲突。
      if (expected != null) {
        const current = await snapshot(id);
        checkFingerprint(current.fingerprint, expected);
        await fs.rename(temporary, destination);
      } else {
        if (await exists(id, true)) throw new ProjectStoreError(409, "归档中已有同 id 项目");
        // link 为原子且 no-clobber；rename 会静默覆盖已有文件，不能用于创建。
        await fs.link(temporary, destination);
      }
      const stat = await fs.lstat(destination);
      return { design, fingerprint: fingerprint(content), updatedAt: stat.mtime.toISOString() };
    } finally {
      if (created) await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }
  }

  async function insert(input: Design, name?: string): Promise<ProjectRecord> {
    const nextName = projectName(name ?? input.name);
    const slug = nextName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70).replace(/-$/, "") || "project";
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = `${slug}-${randomBytes(6).toString("hex")}`;
      if (await exists(id, false) || await exists(id, true)) continue;
      try { return await atomicWrite(id, { ...input, id, name: nextName, revision: 0 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST" || error instanceof ProjectStoreError && error.status === 409) continue;
        throw error;
      }
    }
    throw new ProjectStoreError(409, "无法分配新的项目 id，请重试");
  }

  async function summaries(archived: boolean): Promise<ProjectSummary[]> {
    if (!await ensureFolder(archived)) return [];
    const files = (await fs.readdir(folder(archived))).filter((file) => file.endsWith(".json")).sort();
    const { catalog, accessories } = await catalogs();
    return Promise.all(files.map(async (file): Promise<ProjectSummary> => {
      const id = file.slice(0, -5);
      const summary: ProjectSummary = {
        id, name: id, description: "", revision: 0, partCount: 0,
        updatedAt: "", status: "invalid", archived, fingerprint: "",
      };
      try {
        const raw = await snapshot(id, archived);
        summary.fingerprint = raw.fingerprint;
        summary.updatedAt = raw.updatedAt;
        const input = parseJson(raw.content);
        const parsed = DesignSchema.safeParse(input);
        if (parsed.success) {
          summary.name = parsed.data.name;
          summary.description = parsed.data.meta.description;
          summary.revision = parsed.data.revision;
          summary.partCount = parsed.data.parts.length;
        }
        const result = inspectDesign(input, catalog, accessories);
        if (!result.design) throw new ProjectStoreError(400, result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
        if (result.design.id !== id) throw new ProjectStoreError(400, "设计 id 必须与文件名一致");
        summary.status = result.design.parts.length === 0 ? "empty" : "valid";
      } catch (error) {
        summary.error = error instanceof Error ? error.message : "无法读取项目";
      }
      return summary;
    }));
  }

  async function move(id: string, expected: string, fromArchive: boolean): Promise<void> {
    assertWritable();
    const source = await snapshot(id, fromArchive);
    checkFingerprint(source.fingerprint, expected);
    await ensureFolder(!fromArchive, true);
    const destination = filePath(id, !fromArchive);
    // 归档/恢复仅移动原文件，损坏项目也可归档；既不丢字段也不覆盖同名文件。
    await fs.link(source.file, destination);
    try {
      checkFingerprint((await snapshot(id, fromArchive)).fingerprint, expected);
      await fs.unlink(source.file);
    } catch (error) {
      await fs.unlink(destination);
      throw error;
    }
  }

  return {
    getStoreWritable: writable,
    getProjectLibrary: () => serialize(root, async (): Promise<ProjectLibrary> => ({
      projects: await summaries(false), archived: await summaries(true), writable: writable(),
    })),
    getProject: (id: string, archived = false) => serialize(root, () => record(id, archived)),
    createProject: (name: string, templateId: ProjectTemplateId = "blank") => serialize(root, async () => {
      assertWritable();
      const candidate = buildTemplateDesign(projectName(name), templateId);
      const design = templateId === "blank" ? candidate : await validated(candidate);
      return insert(design);
    }),
    importProject: (input: unknown, name?: string) => serialize(root, async () => {
      assertWritable();
      return insert(await validated(input), name);
    }),
    copyProject: (id: string, name?: string, expected?: string) => serialize(root, async () => {
      assertWritable();
      const source = await record(id, false, expected);
      return insert(source.design, name ?? `${source.design.name} 副本`);
    }),
    saveProject: (id: string, input: unknown, expected: string) => serialize(root, async () => {
      assertWritable();
      const source = await record(id, false, expected);
      checkFingerprint(source.fingerprint, expected);
      const design = await validated(input, id);
      return atomicWrite(id, { ...design, revision: nextRevision(source.design.revision) }, expected);
    }),
    renameProject: (id: string, name: string, expected: string) => serialize(root, async () => {
      assertWritable();
      const source = await record(id, false, expected);
      checkFingerprint(source.fingerprint, expected);
      return atomicWrite(id, { ...source.design, name: projectName(name), revision: nextRevision(source.design.revision) }, expected);
    }),
    archiveProject: (id: string, expected: string) => serialize(root, () => move(id, expected, false)),
    restoreProject: (id: string, expected: string) => serialize(root, () => move(id, expected, true)),
  };
}

function defaultStore() { return createProjectStore({ root: getDataRoot() }); }

export const getProjectLibrary = (): Promise<ProjectLibrary> => defaultStore().getProjectLibrary();
export const getProject = (id: string, archived = false): Promise<ProjectRecord> => defaultStore().getProject(id, archived);
export const createProject = (name: string, templateId?: ProjectTemplateId): Promise<ProjectRecord> => defaultStore().createProject(name, templateId);
export const importProject = (input: unknown, name?: string): Promise<ProjectRecord> => defaultStore().importProject(input, name);
export const copyProject = (id: string, name?: string, expected?: string): Promise<ProjectRecord> => defaultStore().copyProject(id, name, expected);
export const saveProject = (id: string, input: unknown, expected: string): Promise<ProjectRecord> => defaultStore().saveProject(id, input, expected);
export const renameProject = (id: string, name: string, expected: string): Promise<ProjectRecord> => defaultStore().renameProject(id, name, expected);
export const archiveProject = (id: string, expected: string): Promise<void> => defaultStore().archiveProject(id, expected);
export const restoreProject = (id: string, expected: string): Promise<void> => defaultStore().restoreProject(id, expected);
