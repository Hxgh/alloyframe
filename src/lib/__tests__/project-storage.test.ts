import assert from "node:assert/strict";
import { test } from "node:test";
import { draftKey, legacyDraftKey, parseDraftBackup, serializeDraftBackup } from "../project-draft";
import { DesignSchema } from "../schema";
import { autoSaveKey, legacyAutoSaveKey, parseAutoSavePreference } from "../project-save";
import { migrateProjectDraft, readProjectDrafts, readProjectStorage, writeProjectDraft, writeProjectStorage } from "../project-storage";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const operations: string[] = [];
  return {
    values, operations,
    get length() { return values.size; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { operations.push(`get:${key}`); return values.get(key) ?? null; },
    setItem(key: string, value: string) { operations.push(`set:${key}`); values.set(key, value); },
    removeItem(key: string) { operations.push(`remove:${key}`); values.delete(key); },
  };
}

const id = "workbench";
const key = draftKey(id);
const legacyKey = legacyDraftKey(id);
const legacyDraft = JSON.stringify({ id, fingerprint: "P0", text: "{unfinished" });

test("新存储键使用 alloyframe，旧键仅用于兼容；缺少偏好时默认开启", () => {
  assert.equal(key, "alloyframe:draft:workbench");
  assert.equal(legacyKey, "sunmao:draft:workbench");
  assert.equal(autoSaveKey, "alloyframe:autosave");
  assert.equal(legacyAutoSaveKey, "sunmao:autosave");
  const empty = storage();
  assert.equal(readProjectStorage(empty, key, legacyKey), null);
  assert.equal(parseAutoSavePreference(readProjectStorage(empty, autoSaveKey, legacyAutoSaveKey)), true);
});

test("保留旧自动保存关闭偏好，新值存在时优先，包括空值", () => {
  const local = storage({ [legacyAutoSaveKey]: "false" });
  assert.equal(parseAutoSavePreference(readProjectStorage(local, autoSaveKey, legacyAutoSaveKey)), false);
  assert.equal(local.values.get(legacyAutoSaveKey), "false");
  local.values.set(autoSaveKey, "true");
  assert.equal(parseAutoSavePreference(readProjectStorage(local, autoSaveKey, legacyAutoSaveKey)), true);
  local.values.set(autoSaveKey, "");
  assert.equal(parseAutoSavePreference(readProjectStorage(local, autoSaveKey, legacyAutoSaveKey)), true);
});

test("旧草稿保留项目 ID、文件指纹和无效原文，读取不自动覆盖或清理", () => {
  const local = storage({ [legacyKey]: legacyDraft });
  assert.deepEqual(parseDraftBackup(readProjectStorage(local, key, legacyKey), id), {
    id, fingerprint: "P0", text: "{unfinished",
  });
  assert.equal(readProjectStorage(local, draftKey("other"), legacyDraftKey("other")), null);
  assert.equal(local.values.get(legacyKey), legacyDraft);
  assert.equal(local.values.has(key), false);
});

test("新草稿存在时不读取旧键，即使新内容无效也不回退", () => {
  for (const value of ["", "invalid", JSON.stringify({ id: "other", fingerprint: "P1", text: "{}" })]) {
    const local = storage({ [key]: value, [legacyKey]: legacyDraft });
    assert.equal(parseDraftBackup(readProjectStorage(local, key, legacyKey), id), null);
    assert.deepEqual(local.operations, [`get:${key}`]);
  }
});

test("成功写入新键后才清理旧键，草稿和偏好均可迁移", () => {
  for (const [nextKey, oldKey, value] of [[key, legacyKey, legacyDraft], [autoSaveKey, legacyAutoSaveKey, "false"]]) {
    const local = storage({ [oldKey]: value });
    writeProjectStorage(local, nextKey, oldKey, value);
    assert.equal(local.values.get(nextKey), value);
    assert.equal(local.values.has(oldKey), false);
    assert.deepEqual(local.operations, [`set:${nextKey}`, `remove:${oldKey}`]);
  }
});

test("写入新键失败时保留旧草稿或关闭偏好，不尝试清理旧键", () => {
  for (const [nextKey, oldKey, value] of [[key, legacyKey, legacyDraft], [autoSaveKey, legacyAutoSaveKey, "false"]]) {
    const local = storage({ [oldKey]: value });
    local.setItem = () => { throw new Error("quota"); };
    assert.throws(() => writeProjectStorage(local, nextKey, oldKey, value), /quota/);
    assert.equal(local.values.has(nextKey), false);
    assert.equal(local.values.get(oldKey), value);
    assert.deepEqual(local.operations, []);
  }
});

test("新写入成功但旧键清理失败时保留新值优先并报告失败", () => {
  const local = storage({ [key]: "old-new", [legacyKey]: legacyDraft });
  local.removeItem = () => { throw new Error("storage unavailable"); };
  assert.throws(() => writeProjectStorage(local, key, legacyKey, "latest"), /storage unavailable/);
  assert.equal(local.values.get(legacyKey), legacyDraft);
  assert.equal(readProjectStorage(local, key, legacyKey), "latest");
});

test("采用文件或丢弃备份时清理双键，刷新不能重新读出旧草稿", () => {
  const local = storage({ [key]: "latest", [legacyKey]: legacyDraft });
  writeProjectStorage(local, key, legacyKey, null);
  assert.deepEqual(local.operations, [`remove:${legacyKey}`, `remove:${key}`]);
  assert.equal(readProjectStorage(local, key, legacyKey), null);
});

test("清旧键失败时保留新键，避免部分清理后回退到旧草稿", () => {
  const local = storage({ [key]: "latest", [legacyKey]: legacyDraft });
  const remove = local.removeItem;
  local.removeItem = (target) => {
    if (target === legacyKey) throw new Error("legacy blocked");
    remove(target);
  };
  assert.throws(() => writeProjectStorage(local, key, legacyKey, null), /legacy blocked/);
  assert.equal(local.values.get(legacyKey), legacyDraft);
  assert.equal(readProjectStorage(local, key, legacyKey), "latest");
});

test("清新键失败时旧键已清除，保留新备份并报告失败", () => {
  const local = storage({ [key]: "latest", [legacyKey]: legacyDraft });
  const remove = local.removeItem;
  local.removeItem = (target) => {
    if (target === key) throw new Error("new blocked");
    remove(target);
  };
  assert.throws(() => writeProjectStorage(local, key, legacyKey, null), /new blocked/);
  assert.equal(local.values.has(legacyKey), false);
  assert.equal(readProjectStorage(local, key, legacyKey), "latest");
});

const project = { design: DesignSchema.parse({ id, name: "工作台", units: "mm", parts: [] }), fingerprint: "P0", updatedAt: "2026-01-01T00:00:00Z" };
const sessionDraft = (sessionId: string, text: string, fingerprint = "P0") => serializeDraftBackup(text, project, fingerprint, sessionId)!;

test("同一项目多个编辑会话独立写入，读取保留各自原文、ID和指纹", () => {
  const local = storage();
  writeProjectDraft(local, id, "tab-a", sessionDraft("tab-a", "{invalid-A"));
  writeProjectDraft(local, id, "tab-b", sessionDraft("tab-b", "{invalid-B", "older-P0"));
  writeProjectDraft(local, id, "tab-a", sessionDraft("tab-a", "{latest-A"));
  assert.equal(parseDraftBackup(local.getItem(draftKey(id, "tab-b")), id)?.text, "{invalid-B");
  const backups = readProjectDrafts(local, id, "tab-b");
  assert.deepEqual(backups.map(({ id, sessionId, text, fingerprint }) => ({ id, sessionId, text, fingerprint })), [
    { id, sessionId: "tab-b", text: "{invalid-B", fingerprint: "older-P0" },
    { id, sessionId: "tab-a", text: "{latest-A", fingerprint: "P0" },
  ]);
  assert.deepEqual(readProjectDrafts(local, "other", "tab-a"), []);
});

test("保存成功、采用文件或放弃修改只清理本会话，不清另一会话或旧共享键", () => {
  const a = sessionDraft("tab-a", "{A");
  const b = sessionDraft("tab-b", "{B");
  const local = storage({ [draftKey(id, "tab-a")]: a, [draftKey(id, "tab-b")]: b, [key]: legacyDraft, [legacyKey]: legacyDraft });
  writeProjectDraft(local, id, "tab-a", null);
  assert.equal(local.values.has(draftKey(id, "tab-a")), false);
  assert.equal(local.values.get(draftKey(id, "tab-b")), b);
  assert.equal(local.values.get(key), legacyDraft);
  assert.equal(local.values.get(legacyKey), legacyDraft);
  assert.deepEqual(local.operations, [`remove:${draftKey(id, "tab-a")}`]);
});

test("恢复其他会话只复制到本页，来源继续编辑或清理不影响副本", () => {
  const local = storage({ [draftKey(id, "tab-a")]: sessionDraft("tab-a", "{source", "old") });
  const source = readProjectDrafts(local, id, "tab-b")[0];
  migrateProjectDraft(local, id, "tab-b", sessionDraft("tab-b", source.text, source.fingerprint), source);
  assert.equal(local.values.get(source.key), source.raw);
  writeProjectDraft(local, id, "tab-a", sessionDraft("tab-a", "{changed-source"));
  writeProjectDraft(local, id, "tab-a", null);
  assert.deepEqual(parseDraftBackup(local.getItem(draftKey(id, "tab-b")), id), {
    id, sessionId: "tab-b", text: "{source", fingerprint: "old",
  });
});

test("旧 sunmao 草稿恢复成功后迁移，保留原始文本和旧指纹", () => {
  const local = storage({ [legacyKey]: legacyDraft });
  const source = readProjectDrafts(local, id, "tab-a")[0];
  const next = sessionDraft("tab-a", source.text, source.fingerprint);
  migrateProjectDraft(local, id, "tab-a", next, source);
  assert.equal(local.values.get(draftKey(id, "tab-a")), next);
  assert.equal(local.values.has(legacyKey), false);
  assert.ok(local.operations.indexOf(`set:${draftKey(id, "tab-a")}`) < local.operations.indexOf(`remove:${legacyKey}`));
});

test("迁移写入失败保留旧备份，较晚恢复不能删除已被更新的共享内容", () => {
  const local = storage({ [key]: legacyDraft });
  const source = readProjectDrafts(local, id, "tab-a")[0];
  const set = local.setItem;
  local.setItem = () => { throw new Error("quota"); };
  assert.throws(() => migrateProjectDraft(local, id, "tab-a", sessionDraft("tab-a", source.text), source), /quota/);
  assert.equal(local.values.get(key), legacyDraft);
  local.setItem = set;
  const newer = JSON.stringify({ id, text: "{newer-shared", fingerprint: "P1" });
  local.values.set(key, newer);
  migrateProjectDraft(local, id, "tab-a", sessionDraft("tab-a", source.text), source);
  assert.equal(local.values.get(key), newer);
});

test("新共享草稿无效时仍不回退旧 sunmao，读取和本页清理不删除任何共享草稿", () => {
  const local = storage({ [key]: "invalid", [legacyKey]: legacyDraft });
  assert.deepEqual(readProjectDrafts(local, id, "tab-a"), []);
  writeProjectDraft(local, id, "tab-a", null);
  assert.equal(local.values.get(key), "invalid");
  assert.equal(local.values.get(legacyKey), legacyDraft);
});

test("共享键迁移不删除内容不同的 sunmao 草稿，另一页先迁移后仍可按快照恢复", () => {
  const different = JSON.stringify({ id, text: "{legacy-other", fingerprint: "P0" });
  const local = storage({ [key]: legacyDraft, [legacyKey]: different });
  const source = readProjectDrafts(local, id, "tab-a")[0];
  migrateProjectDraft(local, id, "tab-a", sessionDraft("tab-a", source.text), source);
  assert.equal(local.values.get(legacyKey), different);
  migrateProjectDraft(local, id, "tab-b", sessionDraft("tab-b", source.text), source);
  assert.equal(local.values.get(legacyKey), different);
  assert.equal(parseDraftBackup(local.getItem(draftKey(id, "tab-b")), id)?.text, source.text);
});

test("会话写入拒绝错误项目或会话归属，读取忽略伪造归属而保留原键", () => {
  const local = storage({ [draftKey(id, "tab-a")]: sessionDraft("tab-b", "{wrong-session") });
  assert.deepEqual(readProjectDrafts(local, id, "tab-a"), []);
  assert.throws(() => writeProjectDraft(local, id, "tab-a", sessionDraft("tab-b", "{wrong-session")), /会话不匹配/);
  assert.throws(() => writeProjectDraft(local, "other", "tab-a", sessionDraft("tab-a", "{wrong-project")), /会话不匹配/);
  assert.equal(local.values.has(draftKey(id, "tab-a")), true);
});
