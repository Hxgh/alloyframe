import { draftKey, legacyDraftKey, parseDraftBackup, serializeDraftBackup, type DraftBackup } from "./project-draft";
import type { ProjectRecord } from "./projects";

export type StoredDraftBackup = DraftBackup & { key: string; raw: string; uncertain?: boolean };

/** 保存结果尚未确认时，即使原文等于旧文件，也要保留基准以便之后核对。 */
export function serializeProjectDraft(text: string, saved: ProjectRecord, fingerprint: string, sessionId: string, uncertain: boolean): string | null {
  return uncertain
    ? JSON.stringify({ id: saved.design.id, fingerprint, text, sessionId, uncertain: true })
    : serializeDraftBackup(text, saved, fingerprint, sessionId);
}

function storedDraft(raw: string, key: string, id: string): StoredDraftBackup | null {
  const backup = parseDraftBackup(raw, id);
  if (!backup) return null;
  const value = JSON.parse(raw) as { uncertain?: unknown };
  return { ...backup, key, raw, ...(value.uncertain === true ? { uncertain: true } : {}) };
}
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readProjectDrafts(storage: Pick<Storage, "getItem" | "key" | "length">, id: string, sessionId: string): StoredDraftBackup[] {
  const backups: StoredDraftBackup[] = [];
  const prefix = `${draftKey(id)}:`;
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const raw = storage.getItem(key);
    const backup = raw ? storedDraft(raw, key, id) : null;
    if (backup?.sessionId && key === draftKey(id, backup.sessionId)) backups.push(backup);
  }
  backups.sort((a, b) => Number(b.sessionId === sessionId) - Number(a.sessionId === sessionId) || a.key.localeCompare(b.key));
  const key = storage.getItem(draftKey(id)) !== null ? draftKey(id) : legacyDraftKey(id);
  const raw = storage.getItem(key);
  const backup = raw ? storedDraft(raw, key, id) : null;
  if (backup && !backup.sessionId) backups.push(backup);
  return backups;
}

export function writeProjectDraft(storage: DraftStorage, id: string, sessionId: string, value: string | null): void {
  const key = draftKey(id, sessionId);
  if (value === null) storage.removeItem(key);
  else {
    const backup = parseDraftBackup(value, id);
    if (backup?.sessionId !== sessionId) throw new Error("草稿编辑会话不匹配。");
    storage.setItem(key, value);
  }
}

export function migrateProjectDraft(storage: DraftStorage, id: string, sessionId: string, value: string, source: StoredDraftBackup): void {
  writeProjectDraft(storage, id, sessionId, value);
  // 其他会话始终保留；旧共享键仅在成功迁移且内容未变时清理。
  if (!source.sessionId && (source.key === draftKey(id) || source.key === legacyDraftKey(id))) {
    if (storage.getItem(source.key) !== source.raw) return;
    if (source.key === draftKey(id) && storage.getItem(legacyDraftKey(id)) === source.raw) storage.removeItem(legacyDraftKey(id));
    storage.removeItem(source.key);
  }
}

export function readProjectStorage(storage: Pick<Storage, "getItem">, key: string, legacyKey: string): string | null {
  return storage.getItem(key) ?? storage.getItem(legacyKey);
}

export function writeProjectStorage(storage: Pick<Storage, "setItem" | "removeItem">, key: string, legacyKey: string, value: string | null): void {
  if (value === null) {
    // 先清旧键，清理失败时保留新键，避免旧备份重新出现。
    storage.removeItem(legacyKey);
    storage.removeItem(key);
  } else {
    storage.setItem(key, value);
    storage.removeItem(legacyKey);
  }
}
