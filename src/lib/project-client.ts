import type { ValidationIssue } from "./projects";

export class ProjectRequestError extends Error {
  constructor(message: string, public status: number, public issues: ValidationIssue[] = []) {
    super(message);
  }
}

export async function projectRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const result = await response.json();
  if (!response.ok) {
    const issues: ValidationIssue[] = result.issues ?? [];
    const details = issues.slice(0, 3).map((issue) => `${issue.path}：${issue.message}`).join("；");
    throw new ProjectRequestError(`${result.error ?? "项目操作失败，请重试。"}${details ? ` — ${details}` : ""}`, response.status, issues);
  }
  return result as T;
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
