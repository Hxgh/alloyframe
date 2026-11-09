import type { ValidationIssue } from "./projects";

export class ProjectRequestError extends Error {
  constructor(message: string, public status: number, public issues: ValidationIssue[] = []) {
    super(message);
  }
}

export async function projectRequest<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
  } catch {
    throw new ProjectRequestError("网络请求失败，请检查连接后重试。当前输入仍保留。", 0);
  }
  let result: unknown;
  try { result = await response.json(); }
  catch {
    throw new ProjectRequestError(response.status === 413 ? "项目请求不能超过 2 MiB（HTTP 413）。"
      : `服务返回的内容不是有效 JSON（HTTP ${response.status}），请稍后重试。`, response.status);
  }
  const payload = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
  if (!response.ok) {
    const issues = Array.isArray(payload.issues) ? payload.issues.filter((issue): issue is ValidationIssue => issue != null
      && (issue.level === "error" || issue.level === "warning") && typeof issue.path === "string" && typeof issue.message === "string") : [];
    const details = issues.slice(0, 3).map((issue) => `${issue.path}：${issue.message}`).join("；");
    const message = typeof payload.error === "string" ? payload.error : `项目操作失败（HTTP ${response.status}），请重试。`;
    throw new ProjectRequestError(`${message}${details ? ` — ${details}` : ""}`, response.status, issues);
  }
  return result as T;
}

export function createProjectImportReader(handlers: { onText: (text: string) => void; onError: (error: string) => void; onPending: (pending: boolean) => void }) {
  let sequence = 0;
  let pending = false;
  const tooLarge = "项目文件不能超过 2 MiB。当前输入仍保留。";
  return {
    get pending() { return pending; },
    cancel() { sequence++; pending = false; handlers.onPending(false); },
    async read(file: Pick<File, "size" | "arrayBuffer">) {
      const read = ++sequence;
      pending = true;
      handlers.onPending(true);
      handlers.onError("");
      try {
        if (file.size > 2 * 1024 * 1024) { handlers.onError(tooLarge); return; }
        const bytes = await file.arrayBuffer();
        if (read !== sequence) return;
        if (bytes.byteLength > 2 * 1024 * 1024) { handlers.onError(tooLarge); return; }
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
        catch { handlers.onError("文件不是有效的 UTF-8，请转换编码后重试。当前输入仍保留。"); return; }
        handlers.onText(text);
      } catch {
        if (read === sequence) handlers.onError("文件读取失败，请重新选择或粘贴 JSON。当前输入仍保留。");
      } finally {
        if (read === sequence) { pending = false; handlers.onPending(false); }
      }
    },
  };
}

export function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
