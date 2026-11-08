import assert from "node:assert/strict";
import { test } from "node:test";
import { draftKey, legacyDraftKey, parseDraftBackup } from "./project-draft";
import { autoSaveKey, legacyAutoSaveKey, parseAutoSavePreference } from "./project-save";
import { readProjectStorage, writeProjectStorage } from "./project-storage";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const operations: string[] = [];
  return {
    values, operations,
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
