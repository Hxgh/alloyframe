import type { Design } from "./schema";
import type { ProjectRecord } from "./projects";

export type DraftBackup = { id: string; fingerprint: string; text: string };
export type PendingProjectForm = "part" | "metadata" | "accessories";
export const unappliedFieldsWarning = "表单输入尚未应用，不在 JSON 备份中，请先应用或撤销。";
export const draftKey = (id: string) => `alloyframe:draft:${id}`;
export const legacyDraftKey = (id: string) => `sunmao:draft:${id}`;
export const designText = (design: Design) => JSON.stringify(design, null, 2);

export function parseDraftBackup(raw: string | null, id: string): DraftBackup | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value.id === id && typeof value.fingerprint === "string" && typeof value.text === "string"
      ? { id, fingerprint: value.fingerprint, text: value.text }
      : null;
  } catch {
    return null;
  }
}

export function isDraftDirty(text: string, saved: Pick<ProjectRecord, "design">): boolean {
  try {
    // revision 由服务端递增；保存期间的新原文可以仍携带旧 revision。
    const value = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)
      && (value.revision === undefined || (Number.isSafeInteger(value.revision) && value.revision >= 0))) {
      return JSON.stringify({ ...value, revision: undefined }) !== JSON.stringify({ ...saved.design, revision: undefined });
    }
    return JSON.stringify(value) !== JSON.stringify(saved.design);
  } catch {
    return true;
  }
}

export function serializeDraftBackup(text: string, saved: ProjectRecord, fingerprint = saved.fingerprint): string | null {
  return fingerprint !== saved.fingerprint || isDraftDirty(text, saved)
    ? JSON.stringify({ id: saved.design.id, fingerprint, text })
    : null;
}

export function nextPartId(existing: string[], source = "part") {
  const used = new Set(existing);
  let count = 1;
  while (used.has(`${source}-${count}`)) count++;
  return `${source}-${count}`;
}
