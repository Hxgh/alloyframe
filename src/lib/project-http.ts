import { z } from "zod";
import { getStoreWritable, ProjectStoreError } from "./project-store";
import { getProjectEnv } from "./project-env";

export const MAX_PROJECT_BODY_BYTES = 2 * 1024 * 1024;

function httpOrigin(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.origin !== value) return null;
    return url;
  } catch { return null; }
}

function trustedOrigins(): Set<string> {
  return new Set((getProjectEnv("TRUSTED_ORIGINS") ?? "").split(/[\s,]+/)
    .filter((origin) => httpOrigin(origin) != null));
}

function loopback(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  return /^127(?:\.\d{1,3}){3}$/.test(hostname) && hostname.split(".").every((part) => Number(part) <= 255);
}

/** 来源保护不是鉴权。默认只为 loopback 同源请求开放写入，不信任转发头。 */
export function canWriteRequest(request: Request): boolean {
  if (!getStoreWritable()) return false;
  try {
    const url = new URL(request.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    // Next 的 URL 可能使用服务器内部地址；Host 才能避免公开代理被误认为 localhost。
    const host = request.headers.get("host");
    const target = host ? httpOrigin(`${url.protocol}//${host}`) : httpOrigin(url.origin);
    if (!target) return false;
    const trusted = trustedOrigins();
    if (!loopback(target.hostname) && !trusted.has(target.origin)) return false;
    const suppliedOrigin = request.headers.get("origin");
    const readOnlyMethod = request.method === "GET" || request.method === "HEAD";
    if (!suppliedOrigin && (!readOnlyMethod || request.headers.get("sec-fetch-site") === "cross-site")) return false;
    const origin = httpOrigin(suppliedOrigin ?? target.origin);
    if (!origin) return false;
    return origin.origin === target.origin || trusted.has(origin.origin);
  } catch { return false; }
}

export function assertWriteRequest(request: Request): void {
  if (!getStoreWritable()) throw new ProjectStoreError(403, "项目库处于只读模式");
  if (!canWriteRequest(request)) throw new ProjectStoreError(403, "此请求来源不允许写入项目库");
}

/** 逐块统计实际字节，Content-Length 缺失或伪造也不能绕过限制。 */
export async function readProjectJson(request: Request): Promise<unknown> {
  if (!request.body) throw new ProjectStoreError(400, "请求体不能为空");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROJECT_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new ProjectStoreError(413, "请求体不能超过 2 MiB");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new ProjectStoreError(400, "请求体必须是有效的 UTF-8 JSON"); }
  } finally { reader.releaseLock(); }
}

const name = z.string().trim().min(1);
const fingerprint = z.string().min(1);
const templateId = z.enum(["blank", "frame-4040", "rack-2020", "standing-desk"]);
export const CreateProjectRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), name, templateId: templateId.optional() }),
  z.strictObject({ action: z.literal("import"), design: z.unknown(), name: name.optional() }),
  z.strictObject({ action: z.literal("copy"), id: z.string(), name: name.optional(), fingerprint: fingerprint.optional() }),
]);
export const SaveProjectRequestSchema = z.strictObject({ design: z.unknown(), fingerprint });
export const UpdateProjectRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("rename"), name, fingerprint }),
  z.strictObject({ action: z.literal("archive"), fingerprint }),
  z.strictObject({ action: z.literal("restore"), fingerprint }),
]);

export function projectJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export function projectErrorResponse(error: unknown): Response {
  if (error instanceof ProjectStoreError) {
    return projectJson({ error: error.message, ...(error.issues ? { issues: error.issues } : {}) }, error.status);
  }
  if (error instanceof z.ZodError) {
    return projectJson({ error: "请求参数无效", issues: error.issues.map((issue) => ({
      level: "error", path: issue.path.map(String).join(".") || "(根)", message: issue.message,
    })) }, 400);
  }
  console.error("项目 API 失败", error);
  return projectJson({ error: "项目操作失败，请检查数据目录和服务器日志" }, 500);
}
