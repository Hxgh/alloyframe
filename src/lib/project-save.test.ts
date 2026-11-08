import assert from "node:assert/strict";
import { test } from "node:test";
import { DesignSchema } from "./schema";
import { designText, isDraftDirty, parseDraftBackup, serializeDraftBackup } from "./project-draft";
import {
  acknowledgeProjectSave, autoSaveDelay, autoSaveKey, beginProjectSave, canSaveProject,
  captureProjectSave, createProjectSaveTimer, isRemoteCheckCurrent, parseAutoSavePreference,
  pauseProjectSave, type SaveConditions, type SaveSnapshot,
} from "./project-save";
import type { ProjectRecord } from "./projects";

const design = DesignSchema.parse({ id: "workbench", name: "工作台", units: "mm", parts: [] });
const project = { design, fingerprint: "P0", updatedAt: "2026-01-01T00:00:00Z" };
const ready: SaveConditions = {
  valid: true, dirty: true, pending: false, writable: true, busy: false, saving: false,
  backupReady: true, backup: false, remote: false, conflict: false, confirmation: false,
  active: true, leaving: false, preferenceReady: true, autoSave: true, failed: false,
};

function clock() {
  let time = 0;
  let sequence = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    setTimeout(run: () => void, delay: number) {
      const id = ++sequence;
      timers.set(id, { at: time + delay, run });
      return id;
    },
    clearTimeout(id: number) { timers.delete(id); },
    tick(delay: number) {
      const end = time + delay;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at;
        timers.delete(next[0]);
        next[1].run();
      }
      time = end;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test("全局自动保存偏好默认开启，仅明确 false 关闭", () => {
  assert.equal(autoSaveKey, "alloyframe:autosave");
  assert.equal(autoSaveDelay, 1500);
  assert.equal(parseAutoSavePreference(null), true);
  assert.equal(parseAutoSavePreference("true"), true);
  assert.equal(parseAutoSavePreference("false"), false);
  assert.equal(parseAutoSavePreference("invalid"), true);
});

test("1499ms 不保存，1500ms 保存；连续编辑重新计时", () => {
  const time = clock();
  const timer = createProjectSaveTimer(time);
  let calls = 0;
  timer.schedule(() => calls++);
  time.tick(1499);
  assert.equal(calls, 0);
  time.tick(1);
  assert.equal(calls, 1);
  timer.schedule(() => calls++);
  time.tick(1000);
  timer.schedule(() => calls++);
  time.tick(1499);
  assert.equal(calls, 1);
  time.tick(1);
  assert.equal(calls, 2);
});

test("手动保存取消 debounce 并同步去重，包括请求仍在途时的再次点击", async () => {
  const time = clock();
  const timer = createProjectSaveTimer(time);
  const response = deferred<ProjectRecord>();
  const snapshot = captureProjectSave(design, designText(design), project, 1);
  const inFlight = { current: null as SaveSnapshot | null };
  let calls = 0;
  async function save() {
    if (!beginProjectSave(inFlight, snapshot)) return;
    calls++;
    try { await response.promise; } finally { inFlight.current = null; }
  }
  timer.schedule(() => { void save(); });
  time.tick(1499);
  const manual = timer.save(save);
  const duplicate = timer.save(save);
  time.tick(1500);
  assert.equal(calls, 1);
  assert.equal(inFlight.current, snapshot);
  response.resolve(project);
  await Promise.all([manual, duplicate]);
  assert.equal(inFlight.current, null);
  time.tick(1500);
  assert.equal(calls, 1);
});

test("保存 A 时编辑有效 B，回执只推进 P1 且 B 备份使用 P1", async () => {
  const a = { ...design, name: "A" };
  const b = { ...design, name: "B" };
  const aText = designText(a);
  const bText = JSON.stringify(b);
  const snapshot = captureProjectSave(a, aText, project, 1);
  const response = deferred<ProjectRecord>();
  const p1 = { ...project, design: { ...a, revision: 1 }, fingerprint: "P1" };
  const latest = { text: bText, preview: b, editVersion: 2, pendingForms: { metadata: true }, formEpoch: 7 };
  const completion = response.promise.then((saved) => ({ ...latest, ...acknowledgeProjectSave(snapshot, saved, latest) }));
  response.resolve(p1);
  const next = await completion;
  assert.equal(next.saved, p1);
  assert.equal(next.text, bText);
  assert.equal(next.preview.name, "B");
  assert.equal(next.preview.revision, 1);
  assert.deepEqual(next.pendingForms, { metadata: true });
  assert.equal(next.formEpoch, 7);
  assert.equal(isDraftDirty(next.text, next.saved), true);
  assert.deepEqual(parseDraftBackup(serializeDraftBackup(next.text, next.saved, next.fingerprint), design.id), {
    id: design.id, fingerprint: "P1", text: bText,
  });
  const nextSnapshot = captureProjectSave(b, bText, next.saved, 2);
  assert.equal(nextSnapshot.design.revision, 1);
  assert.equal(nextSnapshot.saved.fingerprint, "P1");
});

test("保存 A 时无效 B 原文和新表单不被回执覆盖，备份同样改用 P1", async () => {
  const a = { ...design, name: "A" };
  const snapshot = captureProjectSave(a, designText(a), project, 1);
  const response = deferred<ProjectRecord>();
  const latest = { text: "{invalid-B", preview: a, editVersion: 2, pendingForms: { part: true }, formEpoch: 4 };
  const completion = response.promise.then((saved) => ({ ...latest, ...acknowledgeProjectSave(snapshot, saved, latest) }));
  response.resolve({ ...project, design: { ...a, revision: 1 }, fingerprint: "P1" });
  const next = await completion;
  assert.equal(next.text, "{invalid-B");
  assert.deepEqual(next.pendingForms, { part: true });
  assert.equal(next.formEpoch, 4);
  assert.equal(next.preview.name, "A");
  assert.deepEqual(parseDraftBackup(serializeDraftBackup(next.text, next.saved, next.fingerprint), design.id), {
    id: design.id, fingerprint: "P1", text: "{invalid-B",
  });
  assert.equal(canSaveProject({ ...ready, valid: false }, true), false);
});

test("没有新 edit 才规范化；服务端 revision 不制造 dirty/重复保存循环", () => {
  const a = { ...design, name: "A" };
  const text = JSON.stringify(a);
  const snapshot = captureProjectSave(a, text, project, 1);
  const p1 = { ...project, design: { ...a, revision: 1 }, fingerprint: "P1" };
  const normalized = acknowledgeProjectSave(snapshot, p1, { text, preview: a, editVersion: 1 });
  assert.equal(normalized.text, designText(p1.design));
  const preserved = acknowledgeProjectSave(snapshot, p1, { text, preview: a, editVersion: 2 });
  assert.equal(preserved.text, text);
  assert.equal(isDraftDirty(preserved.text, p1), false);
  assert.equal(serializeDraftBackup(preserved.text, p1), null);
  assert.equal(canSaveProject({ ...ready, dirty: isDraftDirty(preserved.text, p1) }, true), false);
});

test("保存失败取消后续自动保存，不循环重试，但允许手动重试", async () => {
  const time = clock();
  const timer = createProjectSaveTimer(time);
  const response = deferred<ProjectRecord>();
  let conditions = { ...ready };
  let calls = 0;
  let completion: Promise<void> | undefined;
  function save() {
    calls++;
    return response.promise.then(() => {}, () => {
      const paused = pauseProjectSave(conditions);
      conditions = { ...conditions, ...paused };
    });
  }
  timer.schedule(() => { completion = save(); });
  time.tick(1500);
  assert.equal(calls, 1);
  response.reject(new Error("network failed"));
  await completion;
  if (canSaveProject(conditions, true)) timer.schedule(() => { void save(); });
  time.tick(10000);
  assert.equal(calls, 1);
  assert.equal(canSaveProject(conditions, true), false);
  assert.equal(canSaveProject(conditions), true);
});

test("409 即时锁定，随后 GET 失败或旧的成功结果都不能解锁；403 收紧权限", async () => {
  let conditions = { ...ready, ...pauseProjectSave(ready, 409) };
  assert.equal(conditions.conflict, true);
  assert.equal(canSaveProject(conditions), false);
  const remote = deferred<ProjectRecord>();
  const completion = remote.promise.catch(() => {});
  remote.reject(new Error("GET failed"));
  await completion;
  conditions = { ...conditions, failed: false }; // 甚至清掉失败提示也必须保留冲突锁。
  assert.equal(canSaveProject(conditions, true), false);
  assert.equal(canSaveProject(conditions), false);
  assert.equal(pauseProjectSave(conditions).conflict, true);
  assert.equal(pauseProjectSave(ready, 403).writable, false);
  assert.equal(canSaveProject({ ...ready, ...pauseProjectSave(ready, 403) }), false);
});

test("GET 只采用最新请求、同基准同代次且非在途的结果，避免误报自身保存", async () => {
  const old = deferred<ProjectRecord>();
  const check = { sequence: 1, epoch: 0, fingerprint: "P0" };
  let current = { ...check, active: true, saving: false, leaving: false };
  let reported = false;
  const completion = old.promise.then(() => { if (isRemoteCheckCurrent(check, current)) reported = true; });
  current = { ...current, epoch: 1, saving: true };
  assert.equal(isRemoteCheckCurrent(check, current), false);
  current = { ...current, epoch: 2, saving: false, fingerprint: "P1" };
  old.resolve({ ...project, fingerprint: "P1" });
  await completion;
  assert.equal(reported, false);
  const latest = { sequence: 2, epoch: 2, fingerprint: "P1" };
  current = { ...latest, active: true, saving: false, leaving: false };
  assert.equal(isRemoteCheckCurrent(latest, current), true);
  assert.equal(isRemoteCheckCurrent(latest, { ...current, sequence: 3 }), false);
  assert.equal(isRemoteCheckCurrent(latest, { ...current, epoch: 3 }), false);
  assert.equal(isRemoteCheckCurrent(latest, { ...current, fingerprint: "P2" }), false);
  assert.equal(isRemoteCheckCurrent(latest, { ...current, active: false }), false);
  assert.equal(isRemoteCheckCurrent(latest, { ...current, leaving: true }), false);
});

test("未准备偏好、未应用/无效/只读等状态不调度，手动保存也不能处理受阻草稿", () => {
  assert.equal(canSaveProject(ready, true), true);
  for (const values of [
    { valid: false }, { dirty: false }, { pending: true }, { writable: false }, { busy: true },
    { saving: true }, { backupReady: false }, { backup: true }, { remote: true }, { conflict: true },
    { confirmation: true }, { active: false }, { leaving: true },
  ]) {
    assert.equal(canSaveProject({ ...ready, ...values }, true), false, JSON.stringify(values));
    assert.equal(canSaveProject({ ...ready, ...values }), false, JSON.stringify(values));
  }
  for (const values of [{ preferenceReady: false }, { autoSave: false }, { failed: true }]) {
    assert.equal(canSaveProject({ ...ready, ...values }, true), false);
    assert.equal(canSaveProject({ ...ready, ...values }), true);
  }
});

test("Activity/离开取消未发 timer，但已发请求仍可确认 P1 而不再自动发下一轮", async () => {
  const time = clock();
  const timer = createProjectSaveTimer(time);
  let calls = 0;
  timer.schedule(() => calls++);
  timer.cancel();
  time.tick(1500);
  assert.equal(calls, 0);
  const response = deferred<ProjectRecord>();
  const snapshot = captureProjectSave(design, designText(design), project, 1);
  const latest = { text: "{hidden-B", preview: design, editVersion: 2 };
  const completion = response.promise.then((saved) => acknowledgeProjectSave(snapshot, saved, latest));
  response.resolve({ ...project, design: { ...design, revision: 1 }, fingerprint: "P1" });
  const next = await completion;
  assert.equal(next.saved.fingerprint, "P1");
  assert.equal(next.text, latest.text);
  assert.equal(canSaveProject({ ...ready, active: false }, true), false);
});
