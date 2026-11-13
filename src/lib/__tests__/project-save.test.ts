import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { act, Activity, Children, createElement, Fragment, isValidElement, StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { getConsoleFunction, PerspectiveCamera, setConsoleFunction, type WebGLRenderer } from "three";
import ts from "typescript";
import { AccessoryCatalogSchema, CatalogSchema, DesignSchema } from "../schema";
import { createProjectStore, ProjectStoreError } from "../project-store";
import catalogJson from "../../../data/catalog/profiles.json";
import accessoriesJson from "../../../data/catalog/accessories.json";
import { captureProjectExport, designText, draftKey, emptyDraftHistory, isDraftDirty, parseDraftBackup, pushDraftHistory, serializeDraftBackup, stepDraftRedo, stepDraftUndo, unappliedFieldsWarning } from "../project-draft";
import { inspectDesign } from "../validation";
import { ProjectRequestError } from "../project-client";
import * as projectStorage from "../project-storage";
import {
  acknowledgeProjectSave, autoSaveDelay, autoSaveKey, beginProjectSave, canSaveProject,
  captureProjectSave, createProjectSaveTimer, isRemoteCheckCurrent, parseAutoSavePreference,
  pauseProjectSave, type SaveConditions, type SaveSnapshot,
} from "../project-save";
import * as projectSave from "../project-save";
import type { ProjectRecord } from "../projects";

const design = DesignSchema.parse({ id: "workbench", name: "工作台", units: "mm", parts: [] });
const project = { design, fingerprint: "P0", updatedAt: "2026-01-01T00:00:00Z" };
const ready: SaveConditions = {
  valid: true, dirty: true, pending: false, writable: true, busy: false, saving: false, uncertain: false,
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
  for (const values of [{ preferenceReady: false }, { autoSave: false }, { failed: true }, { uncertain: true }]) {
    assert.equal(canSaveProject({ ...ready, ...values }, true), false);
    assert.equal(canSaveProject({ ...ready, ...values }), true);
  }
  assert.equal(canSaveProject({ ...ready, dirty: false, uncertain: true }), true);
});

test("两个会话并发保存只推进胜者基准，409 保留败者草稿且旧检查不能解锁", async () => {
  const a = { ...design, name: "A" };
  const b = { ...design, name: "B" };
  const aSnapshot = captureProjectSave(a, designText(a), project, 1);
  const bSnapshot = captureProjectSave(b, designText(b), project, 1);
  const p1 = { ...project, design: { ...a, revision: 1 }, fingerprint: "P1" };
  const nextA = acknowledgeProjectSave(aSnapshot, p1, { text: aSnapshot.text, preview: a, editVersion: 1 });
  const nextB = { saved: project, text: bSnapshot.text, preview: b, ...pauseProjectSave(ready, 409) };
  assert.equal(nextA.saved.fingerprint, "P1");
  assert.equal(nextB.saved.fingerprint, "P0");
  assert.equal(nextB.text, designText(b));
  assert.equal(canSaveProject({ ...ready, ...nextB }), false);
  assert.equal(parseDraftBackup(serializeDraftBackup(nextB.text, nextB.saved, "P0", "tab-b"), design.id)?.sessionId, "tab-b");
  const oldCheck = { sequence: 1, epoch: 0, fingerprint: "P0" };
  assert.equal(isRemoteCheckCurrent(oldCheck, { ...oldCheck, sequence: 2, epoch: 2, active: true, saving: false, leaving: false }), false);
  assert.equal(pauseProjectSave(nextB).conflict, true);
});

test("隐藏后恢复仍须先检查文件，旧 GET 失效且取消的自动保存不补发", () => {
  const time = clock();
  const timer = createProjectSaveTimer(time);
  let calls = 0;
  timer.schedule(() => calls++);
  const check = { sequence: 1, epoch: 0, fingerprint: "P0" };
  timer.cancel();
  time.tick(1500);
  assert.equal(calls, 0);
  assert.equal(isRemoteCheckCurrent(check, { ...check, sequence: 2, epoch: 1, active: false, saving: false, leaving: false }), false);
  assert.equal(isRemoteCheckCurrent(check, { ...check, sequence: 3, epoch: 1, active: true, saving: false, leaving: false }), false);
  assert.equal(canSaveProject({ ...ready, active: false }, true), false);
  assert.equal(canSaveProject({ ...ready, active: true, conflict: true }, true), false);
  assert.equal(canSaveProject({ ...ready, active: true }, true), true);
});

async function editorFunctions() {
  const text = await readFile(new URL("../../components/project/ProjectEditor.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("ProjectEditor.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = new Map<string, ts.FunctionLikeDeclaration>();
  function visit(node: ts.Node) {
    const name = ts.isFunctionDeclaration(node) ? node.name?.text : ts.isVariableDeclaration(node) ? node.name.getText() : undefined;
    let value = ts.isVariableDeclaration(node) ? node.initializer : node;
    if (value && ts.isCallExpression(value) && value.expression.getText() === "useCallback") value = value.arguments[0];
    if (name && value && (ts.isFunctionDeclaration(value) || ts.isArrowFunction(value))) functions.set(name, value);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return {
    text,
    body: (name: string) => { const body = functions.get(name)?.body; assert.ok(body, name); return body.getText(); },
    run: (name: string, bindings: Record<string, unknown>) => {
      const value = functions.get(name);
      assert.ok(value, name);
      const code = ts.transpileModule(`(${value.getText()})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
      return runInNewContext(code, bindings);
    },
  };
}

async function editorSaveHarness(initialProject: ProjectRecord = project) {
  const { run } = await editorFunctions();
  const baseDesign = initialProject.design;
  const response = deferred<ProjectRecord>();
  const putResponses = [response];
  const requests: Array<{ design: typeof design; fingerprint: string }> = [];
  const otherBackup = JSON.stringify({ id: baseDesign.id, fingerprint: "other", text: "{other", sessionId: "tab-b" });
  const values = new Map<string, string>([[draftKey(baseDesign.id, "tab-b"), otherBackup]]);
  const localStorage = {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const a = { ...baseDesign, name: "A" };
  const aText = designText(a);
  const original = designText(baseDesign);
  const current = { current: {
    saved: initialProject, text: aText, preview: a, writable: true, permissionReady: true,
    busy: false, saving: false, error: "", saveError: "", saveFailed: false, checkError: "", storageError: "", notice: "",
    remote: null as ProjectRecord | null, conflict: false, backups: [], backupReady: true, autoSave: true,
    preferenceReady: true, activeReady: true, confirmation: null, pendingForms: { part: false, metadata: false, accessories: false },
    history: pushDraftHistory({ past: [], future: [] }, original, aText), formEpoch: 0,
    uncertain: false,
  } };
  const editVersion = { current: 1 };
  const inFlightRef = { current: null as SaveSnapshot | null };
  const active = { current: true };
  const visible = { current: true };
  const activeReady = { current: true };
  const leaving = { current: false };
  const baselineEpoch = { current: 0 };
  const checkSequence = { current: 0 };
  const draftFingerprint = { current: initialProject.fingerprint };
  const permissionDenied = { current: false };
  const recheckPending = { current: false };
  const saveTimer = createProjectSaveTimer(clock());
  let disk: ProjectRecord = initialProject;
  let getCount = 0;
  let getFailure = false;
  let getResponse: ReturnType<typeof deferred<{ project: ProjectRecord; writable: boolean }>> | null = null;
  const update = (value: Partial<typeof current.current>) => { Object.assign(current.current, value); };
  const bindings: Record<string, unknown> = {
    ...projectSave, ...projectStorage, designText, serializeDraftBackup, emptyDraftHistory, ProjectRequestError, isDraftDirty,
    current, editVersion, inFlightRef, active, visible, activeReady, leaving, baselineEpoch, checkSequence,
    draftFingerprint, permissionDenied, recheckPending, saveTimer, localStorage, update,
    initial: { design: baseDesign }, initialWritable: true, sessionId: "tab-a", cancelBackupTimer() {},
    analyzeText: (text: string) => { try { return { design: JSON.parse(text) }; } catch { return { design: null }; } },
    saveConditions: (live: typeof current.current, valid: boolean, isActive: boolean, isLeaving: boolean) => ({
      ...ready, valid, pending: Object.values(live.pendingForms).some(Boolean),
      dirty: isDraftDirty(live.text, live.saved), writable: live.writable, busy: live.busy,
      saving: live.saving, backupReady: live.backupReady, backup: live.backups.length > 0,
      remote: live.remote !== null, conflict: live.conflict, active: isActive && live.activeReady,
      leaving: isLeaving, failed: live.saveFailed || Boolean(live.checkError),
      uncertain: live.uncertain,
    }),
    projectRequest: (_url: string, options?: RequestInit) => {
      if (options?.method === "PUT") {
        requests.push(JSON.parse(String(options.body)));
        const next = putResponses.shift();
        assert.ok(next, "unexpected PUT");
        return next.promise;
      }
      getCount++;
      if (getResponse) return getResponse.promise;
      if (getFailure) return Promise.reject(new Error("GET failed"));
      return Promise.resolve({ project: disk, writable: true });
    },
  };
  bindings.flushBackup = run("flushBackup", bindings);
  bindings.checkRemote = run("checkRemote", bindings);
  const save = run("save", bindings);
  bindings.save = save;
  const beforeUnload = run("beforeUnload", bindings);
  const onPageHide = run("onPageHide", { ...bindings, pause: () => { activeReady.current = false; }, cancelScheduledRemoteCheck() {} });
  const checkRemote = bindings.checkRemote as () => Promise<void>;
  const restoreBackup = run("restoreBackup", {
    ...bindings,
    resetForms() {},
    changeText: (text: string) => { current.current.text = text; },
  });
  const back = run("back", {
    ...bindings, navigationBlocked: () => false, leave: () => { throw new Error("未确认即离开"); },
  });
  const adopt = run("adopt", { ...bindings, resetForms() {} });
  return {
    current, localStorage, values, otherBackup, response, requests, active, visible, inFlightRef, editVersion,
    enqueuePut: (next: typeof response) => { putResponses.push(next); },
    save, beforeUnload, onPageHide, checkRemote, restoreBackup, back, adopt,
    flushBackup: bindings.flushBackup as (leavingPage?: boolean) => boolean,
    original, a, setDisk: (value: ProjectRecord) => { disk = value; },
    setGetFailure: (value: boolean) => { getFailure = value; },
    setGetResponse: (value: typeof getResponse) => { getResponse = value; },
    getCount: () => getCount,
    canSave(automatic = false) {
      const conditions = bindings.saveConditions as (live: typeof current.current, valid: boolean, active: boolean, leaving: boolean) => SaveConditions;
      let valid = false;
      try { JSON.parse(current.current.text); valid = !current.current.checkError; } catch { /* 无效原文 */ }
      return canSaveProject(conditions(current.current, valid, active.current && activeReady.current, leaving.current), automatic);
    },
    undo() {
      const result = stepDraftUndo(current.current.history, current.current.text);
      assert.ok(result);
      current.current.text = result.text;
      current.current.history = result.history;
      editVersion.current++;
    },
    unloadWarning() {
      let warned = false;
      beforeUnload({ preventDefault: () => { warned = true; }, returnValue: "" });
      return warned;
    },
    ownBackup() { return parseDraftBackup(localStorage.getItem(draftKey(baseDesign.id, "tab-a")), baseDesign.id); },
  };
}

test("保存已落盘但响应丢失，撤销原文在核对期间和冲突后都保留", async () => {
  const h = await editorSaveHarness();
  const completion = h.save();
  h.undo();
  const check = deferred<{ project: ProjectRecord; writable: boolean }>();
  h.setGetResponse(check);
  const disk = { ...project, design: { ...h.a, revision: 1 }, fingerprint: "P1" };
  h.setDisk(disk);
  h.response.reject(new ProjectRequestError("response lost", 0));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.getCount(), 1);
  assert.equal(h.current.current.text, h.original);
  assert.equal(h.ownBackup()?.text, h.original);
  assert.equal(h.ownBackup()?.fingerprint, "P0");
  assert.equal(h.unloadWarning(), true);
  assert.equal(h.canSave(), false);
  assert.equal(h.canSave(true), false);
  h.back({ preventDefault() {} });
  assert.equal(h.current.current.confirmation, "leave");
  check.resolve({ project: disk, writable: true });
  await completion;
  assert.equal(h.current.current.conflict, true);
  assert.equal(h.current.current.remote?.fingerprint, "P1");
  assert.equal(h.current.current.text, h.original);
  assert.equal(h.ownBackup()?.text, h.original);
  assert.equal(h.unloadWarning(), true);
  assert.equal(h.localStorage.getItem(draftKey(design.id, "tab-b")), h.otherBackup);
});

test("GET 不变仍保留不确定备份，允许手动保存而不自动重试", async () => {
  const h = await editorSaveHarness();
  const completion = h.save();
  h.undo();
  h.response.reject(new ProjectRequestError("network", 0));
  await completion;
  assert.equal(h.getCount(), 1);
  assert.equal(h.current.current.conflict, false);
  assert.equal(h.current.current.saveFailed, true);
  assert.equal(h.current.current.uncertain, true);
  assert.equal(h.ownBackup()?.text, h.original);
  assert.equal(h.unloadWarning(), true);
  assert.equal(h.localStorage.getItem(draftKey(design.id, "tab-b")), h.otherBackup);
  assert.equal(h.canSave(true), false);
  assert.equal(h.canSave(), true);
});

test("GET 失败、隐藏关页与输入变化不会清掉未核对的原文，恢复后核对冲突", async () => {
  const h = await editorSaveHarness();
  const completion = h.save();
  h.undo();
  h.onPageHide();
  assert.equal(h.ownBackup()?.text, h.original);
  assert.equal(h.unloadWarning(), true);
  h.active.current = false;
  h.response.reject(new ProjectRequestError("network", 0));
  await completion;
  assert.equal(h.ownBackup()?.text, h.original);
  assert.equal(h.getCount(), 0);
  h.active.current = true;
  h.visible.current = true;
  h.setGetFailure(true);
  await h.checkRemote();
  assert.equal(h.current.current.checkError, "GET failed");
  assert.equal(h.ownBackup()?.text, h.original);
  assert.equal(h.unloadWarning(), true);
  h.current.current.text = "{unfinished";
  h.flushBackup();
  assert.equal(h.ownBackup()?.text, "{unfinished");
  assert.equal(h.ownBackup()?.fingerprint, "P0");
  h.setGetFailure(false);
  h.setDisk({ ...project, design: { ...h.a, revision: 1 }, fingerprint: "P1" });
  await h.checkRemote();
  assert.equal(h.current.current.conflict, true);
  assert.equal(h.current.current.text, "{unfinished");
  assert.equal(h.ownBackup()?.text, "{unfinished");
  assert.equal(h.localStorage.getItem(draftKey(design.id, "tab-b")), h.otherBackup);
});

test("关闭后恢复不确定备份，核对同基准仍保持保护且不删来源会话", async () => {
  const h = await editorSaveHarness();
  const sourceValue = projectStorage.serializeProjectDraft(h.original, project, "P0", "tab-b", true);
  assert.ok(sourceValue);
  h.localStorage.setItem(draftKey(design.id, "tab-b"), sourceValue);
  const [source] = projectStorage.readProjectDrafts(h.localStorage, design.id, "tab-a");
  Object.assign(h.current.current, { text: h.original, preview: design, backups: [source] });
  h.back({ preventDefault() {} });
  assert.equal(h.current.current.confirmation, "leave");
  h.current.current.confirmation = null;
  h.restoreBackup(source);
  assert.equal(h.ownBackup()?.text, h.original);
  assert.equal(h.unloadWarning(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.current.current.saveFailed, true);
  assert.equal(h.current.current.uncertain, true);
  assert.equal(h.current.current.conflict, false);
  assert.equal(h.ownBackup()?.text, h.original);
  assert.equal(h.canSave(), true);
  assert.equal(h.canSave(true), false);
  assert.equal(h.localStorage.getItem(source.key), sourceValue);
});

test("未落盘时用户继续编辑，核对相同指纹保留最新原文并暂停自动保存", async () => {
  const h = await editorSaveHarness();
  const completion = h.save();
  h.undo();
  const check = deferred<{ project: ProjectRecord; writable: boolean }>();
  h.setGetResponse(check);
  h.response.reject(new ProjectRequestError("network", 0));
  await new Promise((resolve) => setImmediate(resolve));
  h.current.current.text = "{new-input";
  check.resolve({ project, writable: true });
  await completion;
  assert.equal(h.current.current.text, "{new-input");
  assert.equal(h.ownBackup()?.text, "{new-input");
  assert.equal(h.ownBackup()?.fingerprint, "P0");
  assert.equal(h.current.current.saveFailed, true);
  assert.equal(h.current.current.uncertain, true);
  assert.equal(h.canSave(), false); // 无效 JSON 不能通过手动确认写入。
  assert.equal(h.canSave(true), false);
  h.current.current.text = designText({ ...design, name: "B" });
  h.current.current.pendingForms.part = true;
  assert.equal(h.canSave(), false); // 表单未应用时也不能覆盖。
  h.current.current.pendingForms.part = false;
  assert.equal(h.canSave(), true);
  assert.equal(h.unloadWarning(), true);
});

test("显式采用或放弃后仍不能认为旧 PUT 不会迟到，保护新选择并重新检查", async () => {
  for (const action of ["discard", "reload"] as const) {
    const h = await editorSaveHarness();
    const completion = h.save();
    h.undo();
    const response = deferred<{ project: ProjectRecord; writable: boolean }>();
    h.setGetResponse(response);
    h.response.reject(new ProjectRequestError("network", 0));
    response.resolve({ project, writable: true });
    await completion;
    const chosen = action === "reload" ? { ...project, design: { ...design, name: "remote" }, fingerprint: "P1" } : project;
    if (action === "reload") Object.assign(h.current.current, { remote: chosen, conflict: true });
    const check = deferred<{ project: ProjectRecord; writable: boolean }>();
    h.setGetResponse(check);
    h.adopt(chosen, action === "discard");
    assert.equal(h.current.current.uncertain, true);
    assert.equal(h.canSave(), false);
    assert.equal(h.ownBackup()?.text, designText(chosen.design));
    assert.equal(h.ownBackup()?.fingerprint, chosen.fingerprint);
    assert.equal(h.unloadWarning(), true);
    check.resolve({ project: chosen, writable: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.current.current.uncertain, true);
    assert.equal(h.canSave(), true);
    assert.equal(h.canSave(true), false);
  }
});

test("GET 同指纹后旧 PUT 才落盘，手动确认因真实文件指纹冲突而保留撤销原文", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "alloyframe-save-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createProjectStore({ root, catalog: CatalogSchema.parse(catalogJson), accessories: AccessoryCatalogSchema.parse(accessoriesJson) });
  const initial = await store.createProject("race");
  const h = await editorSaveHarness(initial);
  const completion = h.save();
  h.undo();
  h.response.reject(new ProjectRequestError("network", 0));
  await completion;
  assert.equal(h.getCount(), 1);
  assert.equal((await store.getProject(initial.design.id)).fingerprint, initial.fingerprint);
  assert.equal(h.ownBackup()?.text, h.original);
  assert.equal(h.current.current.uncertain, true);
  const late = await store.saveProject(initial.design.id, h.requests[0].design, h.requests[0].fingerprint);
  h.setDisk(late);
  const response = deferred<ProjectRecord>();
  h.enqueuePut(response);
  const retry = h.save();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].fingerprint, initial.fingerprint);
  assert.equal(h.requests[1].design.name, initial.design.name);
  try {
    response.resolve(await store.saveProject(initial.design.id, h.requests[1].design, h.requests[1].fingerprint));
    assert.fail("旧指纹不应覆盖迟到的 PUT");
  } catch (cause) {
    assert.ok(cause instanceof ProjectStoreError && cause.status === 409);
    response.reject(new ProjectRequestError(cause.message, cause.status));
  }
  await retry;
  assert.equal(h.current.current.conflict, true);
  assert.equal(h.current.current.text, h.original);
  assert.equal(h.ownBackup()?.text, h.original);
  assert.equal(h.ownBackup()?.fingerprint, initial.fingerprint);
  assert.equal(h.unloadWarning(), true);
});

test("手动确认先落盘可使迟到的旧 PUT 冲突，不覆盖撤销原文", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "alloyframe-save-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createProjectStore({ root, catalog: CatalogSchema.parse(catalogJson), accessories: AccessoryCatalogSchema.parse(accessoriesJson) });
  const initial = await store.createProject("race");
  const h = await editorSaveHarness(initial);
  const completion = h.save();
  h.undo();
  h.response.reject(new ProjectRequestError("network", 0));
  await completion;
  const response = deferred<ProjectRecord>();
  h.enqueuePut(response);
  const retry = h.save();
  const confirmed = await store.saveProject(initial.design.id, h.requests[1].design, h.requests[1].fingerprint);
  response.resolve(confirmed);
  await retry;
  await assert.rejects(store.saveProject(initial.design.id, h.requests[0].design, h.requests[0].fingerprint),
    (cause: unknown) => cause instanceof ProjectStoreError && cause.status === 409);
  assert.equal((await store.getProject(initial.design.id)).design.name, initial.design.name);
  assert.equal(h.current.current.uncertain, false);
  assert.equal(h.ownBackup(), null);
});

test("成功回执释放在途锁并以新基准备份撤销原文，隐藏后也可确认", async () => {
  const h = await editorSaveHarness();
  const completion = h.save();
  const duplicate = h.save();
  assert.ok(h.inFlightRef.current);
  h.undo();
  h.onPageHide();
  h.active.current = false;
  const disk = { ...project, design: { ...h.a, revision: 1 }, fingerprint: "P1" };
  h.response.resolve(disk);
  await Promise.all([completion, duplicate]);
  assert.equal(h.inFlightRef.current, null);
  assert.equal(h.current.current.saved.fingerprint, "P1");
  assert.equal(h.current.current.text, h.original);
  assert.equal(h.current.current.uncertain, false);
  assert.equal(h.ownBackup()?.text, h.original);
  assert.equal(h.ownBackup()?.fingerprint, "P1");
  assert.equal(h.localStorage.getItem(draftKey(design.id, "tab-b")), h.otherBackup);
});

test("409 与 403 保留各自冲突和权限约束，不能假定失败未写入", async () => {
  for (const status of [409, 403]) {
    const h = await editorSaveHarness();
    const completion = h.save();
    h.undo();
    h.setGetFailure(true);
    h.response.reject(new ProjectRequestError(`HTTP ${status}`, status));
    await completion;
    assert.equal(h.current.current.saveFailed, true);
    assert.equal(h.current.current.conflict, status === 409);
    assert.equal(h.current.current.writable, status !== 403);
    assert.equal(h.ownBackup()?.text, h.original);
    assert.equal(h.unloadWarning(), true);
  }
});

test("编辑器隐藏取消调度并作废旧检查，恢复显示和忙碌结束均重新核对文件", async () => {
  const { text, body } = await editorFunctions();
  assert.match(body("pause"), /saveTimer\.cancel\(\)/);
  assert.match(body("pause"), /invalidateRemoteChecks\(\)/);
  assert.match(body("pause"), /activeReady\.current = false/);
  assert.match(body("onVisibility"), /if \(visible\.current\) scheduleRemoteCheck\(\)/);
  assert.match(body("onPageHide"), /visible\.current = false/);
  assert.match(body("onPageHide"), /pause\(\)/);
  for (const event of ["visibilitychange", "pagehide", "pageshow", "storage"]) assert.match(text, new RegExp(`addEventListener\\("${event}"`));
  assert.match(text, /if \(!busy && recheckPending\.current\) void checkRemote\(\)/);
});

test("采用文件推进检查代次后重新读取，导出先检查未应用与无效输入且不触发保存", async () => {
  const { body } = await editorFunctions();
  const adopt = body("adopt");
  assert.ok(adopt.indexOf("baselineEpoch.current++") < adopt.indexOf("void checkRemote()"));
  assert.ok(adopt.indexOf("checkSequence.current++") < adopt.indexOf("void checkRemote()"));
  const exported = body("exportProject");
  const download = exported.indexOf("downloadJson(");
  for (const guard of ["pendingForms", "filesBlocked()", "!result.design"]) {
    const index = exported.indexOf(guard);
    assert.ok(index >= 0 && index < download, guard);
    assert.ok(exported.slice(index, download).includes("return"), guard);
  }
  assert.doesNotMatch(exported, /\b(?:save|projectRequest)\s*\(/);
});

test("取消原生离页恢复自动保存计时，真实离页仍取消；新输入使用完整资格守卫", async () => {
  const { run } = await editorFunctions();
  for (const outcome of ["cancel", "leave", "pending", "conflict", "invalid"] as const) {
    const time = clock();
    const saveTimer = createProjectSaveTimer(time);
    let calls = 0;
    let backups = 0;
    let prevented = false;
    const conditions = { ...ready };
    const live = { text: designText({ ...design, name: "未保存" }), saved: project, backupReady: true, backups: [], pendingForms: { part: false } };
    const beforeUnload = run("beforeUnload", {
      saveTimer, current: { current: live }, isDraftDirty, inFlightRef: { current: null },
      flushBackup: () => { backups++; return true; },
      save: (automatic: boolean) => { if (canSaveProject(conditions, automatic)) calls++; },
    });
    saveTimer.schedule(() => calls++);
    time.tick(1000);
    beforeUnload({ preventDefault: () => { prevented = true; }, returnValue: "" });
    assert.equal(prevented, true);
    assert.equal(backups, 1);
    if (outcome === "leave") {
      const visible = { current: true };
      const pause = run("pause", {
        saveTimer, activeReady: { current: true }, invalidateRemoteChecks() {},
        update: () => { conditions.active = false; },
      });
      run("onPageHide", { visible, pause, cancelScheduledRemoteCheck() {}, current: { current: live }, flushBackup: () => { backups++; } })();
      assert.equal(visible.current, false);
    } else if (outcome === "pending") conditions.pending = true;
    else if (outcome === "conflict") conditions.conflict = true;
    else if (outcome === "invalid") conditions.valid = false;
    time.tick(1499);
    assert.equal(calls, 0);
    time.tick(1);
    assert.equal(calls, outcome === "cancel" ? 1 : 0, outcome);
  }
});

test("归档成功确认结果，但离开或返回后的迟到回执不能抢导航", async () => {
  const { run } = await editorFunctions();
  for (const outcome of ["current", "hidden", "returned"] as const) {
    const response = deferred<void>();
    const active = { current: true };
    const activityEpoch = { current: 1 };
    const notices: string[] = [];
    let navigation = 0;
    let resets = 0;
    const archive = run("archive", {
      current: { current: { saved: project, text: designText(design), writable: true, pendingForms: {}, remote: null, conflict: false } },
      filesBlocked: () => false, isDraftDirty, flushBackup: () => true,
      saveTimer: { cancel() {} }, active, activityEpoch,
      update: (value: { notice?: string }) => { if (value.notice) notices.push(value.notice); },
      projectRequest: () => response.promise, cancelBackupTimer() {},
      prepareToLeave: () => { resets++; }, router: { push: () => { navigation++; } },
    });
    const completion = archive();
    if (outcome !== "current") { active.current = false; activityEpoch.current++; }
    if (outcome === "returned") { active.current = true; activityEpoch.current++; }
    response.resolve();
    await completion;
    assert.equal(navigation, outcome === "current" ? 1 : 0, outcome);
    assert.equal(resets, navigation);
    assert.equal(notices.length, outcome === "current" ? 0 : 1);
  }
});

type EditorWorkspace = {
  text: string; status: string; readOnly: boolean; canSave: boolean; pending: boolean; saveBlocked: boolean;
  messages: ReactNode; onJsonChange: (text: string) => void; onPendingChange: (form: "part", pending: boolean) => void;
  onSave: () => void; onExport: () => void; onCopy: () => void; onAutoSaveChange: (enabled: boolean) => void; onRefresh: () => void;
  onBack: (event: { preventDefault: () => void }) => void;
};

function editorMessageText(value: ReactNode): string {
  return Children.toArray(value).map((child) => typeof child === "string" || typeof child === "number" ? String(child)
    : isValidElement<{ children?: ReactNode }>(child) ? editorMessageText(child.props.children) : "").join("");
}

function editorMessageButton(value: ReactNode, label: string): { disabled?: boolean; onClick?: () => void } | undefined {
  for (const child of Children.toArray(value)) {
    if (!isValidElement<{ children?: ReactNode; disabled?: boolean; onClick?: () => void }>(child)) continue;
    if (typeof child.type === "function" && editorMessageText(child.props.children) === label) return child.props;
    const nested = editorMessageButton(child.props.children, label);
    if (nested) return nested;
  }
  return undefined;
}

async function editorUiHarness(backup = false, options: { strict?: boolean; activity?: boolean } = {}) {
  const globals = ["requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const previous = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.assign(globalThis, { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, IS_REACT_ACT_ENVIRONMENT: true });
  const text = await readFile(new URL("../../components/project/ProjectEditor.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("ProjectEditor.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const editor = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "ProjectEditor");
  const conditions = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "saveConditions");
  assert.ok(editor && conditions);
  const code = ts.transpileModule(`${conditions.getText(source)}\n${editor.getText(source).replace(/^export\s+/, "")}\nProjectEditor`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "h", jsxFragmentFactory: "Fragment" },
  }).outputText;
  const values = new Map<string, string>();
  if (backup) {
    const raw = serializeDraftBackup(designText({ ...design, name: "备份草稿" }), project, project.fingerprint, "tab-b");
    assert.ok(raw);
    values.set(draftKey(design.id, "tab-b"), raw);
  }
  const localStorage = {
    get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const timers = new Map<number, { run: () => void; delay: number; at: number }>();
  const events = new Map<string, (event?: unknown) => void>();
  const documentEvents = new Map<string, () => void>();
  let timerId = 0;
  let now = 0;
  const window = {
    setTimeout: (run: () => void, delay: number) => { timers.set(++timerId, { run, delay, at: now + delay }); return timerId; },
    clearTimeout: (id: number) => { timers.delete(id); },
    addEventListener: (name: string, callback: (event?: unknown) => void) => { events.set(name, callback); },
    removeEventListener: (name: string) => { events.delete(name); },
  };
  const document = {
    visibilityState: "visible",
    addEventListener: (name: string, callback: () => void) => { documentEvents.set(name, callback); },
    removeEventListener: (name: string) => { documentEvents.delete(name); },
  };
  let workspace: EditorWorkspace | undefined;
  let disk: ProjectRecord = project;
  let writable = true;
  let getError: Error | undefined;
  let getResponse: Promise<{ project: ProjectRecord; writable: boolean }> | undefined;
  let putError: Error | undefined;
  let putResponse: Promise<ProjectRecord> | undefined;
  let writeResponse: Promise<never> | undefined;
  let gets = 0;
  let puts = 0;
  let exports = 0;
  let workspaceMounts = 0;
  const Workspace = ({ project: value }: { project: EditorWorkspace }) => {
    useLayoutEffect(() => { workspaceMounts++; }, []);
    useLayoutEffect(() => { workspace = value; }, [value]);
    return null;
  };
  const noop = () => null;
  const bindings = {
    h: createElement, Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
    window, document, localStorage, ...projectSave, ...projectStorage, ProjectRequestError, inspectDesign,
    captureProjectExport, createDraftSessionId: () => "tab-a", designText, emptyDraftHistory, isDraftDirty,
    pushDraftHistory, stepDraftRedo, stepDraftUndo, unappliedFieldsWarning,
    projectRequest: async (_url: string, options?: RequestInit) => {
      if (options?.method === "PUT") {
        puts++;
        if (putResponse) return putResponse;
        if (putError) throw putError;
        return disk;
      }
      if (options?.method) {
        assert.ok(writeResponse, "unexpected project write");
        return writeResponse;
      }
      gets++;
      if (getResponse) return getResponse;
      if (getError) throw getError;
      return { project: disk, writable };
    },
    downloadJson: () => { exports++; }, useRouter: () => ({ push() {} }), Workspace, Button: noop, ConfirmDialog: noop,
  };
  const ProjectEditor = runInNewContext(code, bindings) as (props: { initial: ProjectRecord; writable: boolean; catalog: unknown; accessories: unknown }) => ReactNode;
  const require = createRequire(import.meta.url);
  const fiberEntry = pathToFileURL(require.resolve("@react-three/fiber"));
  const { createRoot } = await import(new URL("./react-three-fiber.esm.js", fiberEntry).href) as typeof import("@react-three/fiber");
  const surface = Object.assign(new EventTarget(), { clientWidth: 800, clientHeight: 600, style: {}, ownerDocument: new EventTarget() });
  const renderer = { domElement: surface, render() {}, setPixelRatio() {}, setSize() {} };
  const consoleFunction = getConsoleFunction();
  setConsoleFunction((type, message, ...args) => {
    if (type === "warn" && message === "THREE.Clock: This module has been deprecated. Please use THREE.Timer instead." && args.length === 0) return;
    if (consoleFunction) consoleFunction(type, message, ...args); else console[type](message, ...args);
  });
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    try { root = createRoot(surface as unknown as HTMLCanvasElement); }
    finally { setConsoleFunction(consoleFunction ?? (null as unknown as typeof consoleFunction)); }
    await root.configure({ gl: renderer as unknown as WebGLRenderer, camera: new PerspectiveCamera(), size: { width: 800, height: 600, top: 0, left: 0 }, frameloop: "never" });
    const props = { initial: project, writable: true, catalog: CatalogSchema.parse(catalogJson), accessories: AccessoryCatalogSchema.parse(accessoriesJson) };
    const render = (mode: "visible" | "hidden" = "visible") => {
      let element: ReactNode = createElement(ProjectEditor, props);
      if (options.activity) element = createElement(Activity as ComponentType<{ mode: "visible" | "hidden"; children?: ReactNode }>, { mode }, element);
      if (options.strict) element = createElement(StrictMode, null, element);
      root!.render(element);
    };
    await act(async () => { render(); });
    const current = () => { assert.ok(workspace); return workspace; };
    return {
      current, messages: () => editorMessageText(current().messages),
      button: (label: string) => editorMessageButton(current().messages, label),
      setGetError: (value?: Error) => { getError = value; },
      setGetResponse: (value?: Promise<{ project: ProjectRecord; writable: boolean }>) => { getResponse = value; },
      setPutError: (value?: Error) => { putError = value; },
      setPutResponse: (value?: Promise<ProjectRecord>) => { putResponse = value; },
      setWriteResponse: (value: Promise<never>) => { writeResponse = value; },
      setDisk: (value: ProjectRecord) => { disk = value; },
      setWritable: (value: boolean) => { writable = value; },
      gets: () => gets, puts: () => puts, exports: () => exports, workspaceMounts: () => workspaceMounts,
      async advance(delay: number) {
        const end = now + delay;
        let steps = 0;
        while (true) {
          const next = [...timers.entries()].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
          if (!next) break;
          if (++steps > 100) throw new Error("检测到计时器循环");
          now = next[1].at;
          timers.delete(next[0]);
          await act(async () => { next[1].run(); await Promise.resolve(); });
        }
        now = end;
      },
      async initialize() { await act(async () => { for (const [id, value] of [...timers]) if (value.delay === 0) { timers.delete(id); value.run(); } await Promise.resolve(); }); },
      async focus() { await act(async () => { events.get("focus")?.(); await Promise.resolve(); }); await this.advance(50); },
      async focusBurst(count: number) { await act(async () => { for (let index = 0; index < count; index++) events.get("focus")?.(); await Promise.resolve(); }); },
      async storage(key: string | null) { await act(async () => { events.get("storage")?.({ key }); await Promise.resolve(); }); },
      async visibility(value: "visible" | "hidden") { await act(async () => { document.visibilityState = value; documentEvents.get("visibilitychange")?.(); await Promise.resolve(); }); },
      async pageHide() { await act(async () => { events.get("pagehide")?.(); await Promise.resolve(); }); },
      async pageShow() { await act(async () => { events.get("pageshow")?.(); await Promise.resolve(); }); },
      async setActivity(mode: "visible" | "hidden") { await act(async () => { render(mode); await Promise.resolve(); }); },
      async update(callback: (value: EditorWorkspace) => void) { await act(async () => { callback(current()); await Promise.resolve(); }); },
      async dispose() {
        try { await act(async () => { root?.unmount(); root = undefined; }); }
        finally { globals.forEach((key, index) => { const descriptor = previous[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }); }
      },
    };
  } catch (cause) {
    if (root) await act(async () => { root?.unmount(); });
    globals.forEach((key, index) => { const descriptor = previous[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
    throw cause;
  }
}

test("编辑器在权限更新、备份计时和普通表单重渲染后保持单次初始 GET", async () => {
  for (const outcome of ["success", "failure", "readonly"] as const) {
    const ui = await editorUiHarness();
    try {
      if (outcome === "failure") ui.setGetError(new ProjectRequestError("检查失败", 0));
      if (outcome === "readonly") ui.setWritable(false);
      assert.equal(ui.gets(), 0);
      await ui.advance(0);
      assert.equal(ui.gets(), 1, outcome);
      await ui.advance(5000);
      assert.equal(ui.gets(), 1, `${outcome} 检查回执及备份不应重发请求`);
      assert.equal(ui.workspaceMounts(), 1, outcome);
      await ui.update((value) => value.onPendingChange("part", true));
      await ui.advance(5000);
      assert.equal(ui.gets(), 1, `${outcome} 表单更新不应重发请求`);
      assert.equal(ui.workspaceMounts(), 1, outcome);
      await ui.focus();
      assert.equal(ui.gets(), 2, `${outcome} 窗口重新聚焦应检查`);
      await ui.advance(5000);
      assert.equal(ui.gets(), 2, `${outcome} 聚焦后的状态更新不应循环`);
      assert.equal(ui.workspaceMounts(), 1, outcome);
    } finally { await ui.dispose(); }
  }
});

test("严格模式及 Activity 隐藏恢复只在需要时核对文件", async () => {
  const ui = await editorUiHarness(false, { strict: true, activity: true });
  try {
    await ui.advance(0);
    assert.equal(ui.gets(), 1);
    await ui.advance(5000);
    assert.equal(ui.gets(), 1);
    await ui.setActivity("hidden");
    await ui.advance(1000);
    assert.equal(ui.gets(), 1);
    await ui.setActivity("visible");
    await ui.advance(0);
    assert.equal(ui.gets(), 2);
    await ui.advance(5000);
    assert.equal(ui.gets(), 2);
  } finally { await ui.dispose(); }
});

test("连续焦点事件合并重检，旧 GET 失效前后都不能提前启用保存", async () => {
  const ui = await editorUiHarness();
  try {
    const response = deferred<{ project: ProjectRecord; writable: boolean }>();
    ui.setGetResponse(response.promise);
    await ui.advance(0);
    assert.equal(ui.gets(), 1);
    await ui.focusBurst(20);
    assert.equal(ui.gets(), 1);
    assert.equal(ui.current().canSave, false);
    response.resolve({ project, writable: true });
    await ui.update(() => {});
    assert.equal(ui.current().readOnly, true, "失效的旧 GET 不得恢复权限");
    ui.setGetResponse();
    await ui.advance(49);
    assert.equal(ui.gets(), 1);
    assert.equal(ui.current().canSave, false);
    await ui.advance(1);
    assert.equal(ui.gets(), 2, "事件后必须重新检查");
    await ui.advance(5000);
    assert.equal(ui.gets(), 2);
    assert.equal(ui.current().readOnly, false);
  } finally { await ui.dispose(); }
});

test("焦点、可见性、跨标签存储事件同一波次只检查一次并保留冲突锁", async () => {
  const ui = await editorUiHarness();
  try {
    await ui.advance(0);
    await ui.update((value) => value.onJsonChange(designText({ ...design, name: "草稿" })));
    assert.equal(ui.current().canSave, true);
    ui.setDisk({ ...project, fingerprint: "P1" });
    await ui.focusBurst(3);
    await ui.storage(projectSave.projectChangeKey(design.id));
    await ui.visibility("visible");
    await ui.pageShow();
    assert.equal(ui.current().canSave, false, "新事件必须立即暂停保存");
    assert.equal(ui.gets(), 1);
    await ui.advance(50);
    assert.equal(ui.gets(), 2);
    assert.match(ui.current().status, /文件冲突/);
    assert.equal(ui.current().canSave, false);
    await ui.advance(5000);
    assert.equal(ui.gets(), 2);
    assert.equal(ui.puts(), 0);
  } finally { await ui.dispose(); }
});

test("页面隐藏或卸载取消排队重检，恢复时重新检查；手动检查保持立即执行", async () => {
  const ui = await editorUiHarness();
  try {
    await ui.advance(0);
    await ui.focusBurst(1);
    await ui.visibility("hidden");
    await ui.advance(1000);
    assert.equal(ui.gets(), 1);
    await ui.visibility("visible");
    await ui.advance(50);
    assert.equal(ui.gets(), 2);
    await ui.focusBurst(1);
    await ui.pageHide();
    await ui.advance(1000);
    assert.equal(ui.gets(), 2);
    await ui.pageShow();
    await ui.advance(50);
    assert.equal(ui.gets(), 3);
    await ui.update((value) => value.onRefresh());
    assert.equal(ui.gets(), 4, "用户显式检查不应被延迟");
    await ui.focusBurst(1);
    await ui.dispose();
    await ui.advance(1000);
    assert.equal(ui.gets(), 4, "卸载后不应发出排队请求");
  } finally { await ui.dispose(); }
});

test("副本处理中发生的事件会在忙碌结束后补查一次", async () => {
  const ui = await editorUiHarness();
  try {
    await ui.advance(0);
    const response = deferred<never>();
    ui.setWriteResponse(response.promise);
    await ui.update((value) => value.onCopy());
    await ui.focusBurst(10);
    await ui.advance(50);
    assert.equal(ui.gets(), 1);
    response.reject(new ProjectRequestError("副本失败", 500));
    await ui.update(() => {});
    assert.equal(ui.gets(), 2);
    await ui.advance(5000);
    assert.equal(ui.gets(), 2);
  } finally { await ui.dispose(); }
});

test("保存失败与排队中的环境事件并存时立即核对，检查失败不会放行保存", async () => {
  const ui = await editorUiHarness();
  try {
    await ui.advance(0);
    await ui.update((value) => value.onJsonChange(designText({ ...design, name: "草稿" })));
    const response = deferred<ProjectRecord>();
    ui.setPutResponse(response.promise);
    await ui.update((value) => value.onSave());
    assert.equal(ui.puts(), 1);
    await ui.focusBurst(1);
    assert.equal(ui.gets(), 1);
    ui.setGetError(new ProjectRequestError("核对失败", 0));
    response.reject(new ProjectRequestError("保存失败", 500));
    await ui.update(() => {});
    assert.equal(ui.gets(), 2, "保存失败应立即核对而不等待事件定时器");
    assert.match(ui.messages(), /保存失败/);
    assert.match(ui.messages(), /核对失败/);
    assert.equal(ui.current().canSave, false);
    await ui.advance(50);
    assert.equal(ui.gets(), 3);
    assert.equal(ui.current().canSave, false);
    await ui.advance(5000);
    assert.equal(ui.gets(), 3);
    assert.equal(ui.puts(), 1);
  } finally { await ui.dispose(); }
});

test("离页后等待中的环境检查不会发出请求", async () => {
  const ui = await editorUiHarness();
  try {
    await ui.advance(0);
    await ui.focusBurst(1);
    await ui.update((value) => value.onBack({ preventDefault() {} }));
    await ui.advance(1000);
    assert.equal(ui.gets(), 1);
    assert.equal(ui.puts(), 0);
    assert.equal(ui.current().canSave, false);
  } finally { await ui.dispose(); }
});

test("编辑器首次 GET 失败不是只读，成功复查前不开放编辑和保存", async () => {
  const ui = await editorUiHarness();
  try {
    assert.match(ui.messages(), /正在确认写入权限/);
    assert.equal(ui.current().readOnly, true);
    ui.setGetError(new ProjectRequestError("检查断线", 0));
    await ui.initialize();
    assert.match(ui.current().status, /检查失败/);
    assert.match(ui.messages(), /检查断线/);
    assert.doesNotMatch(ui.messages(), /只读|写入被拒绝/);
    assert.equal(ui.current().readOnly, true);
    assert.equal(ui.current().canSave, false);
    ui.setGetError();
    ui.setWritable(false);
    await ui.focus();
    assert.equal(ui.current().readOnly, true);
    assert.match(ui.messages(), /当前写入不可用/);
    ui.setWritable(true);
    await ui.focus();
    assert.equal(ui.current().readOnly, false);
    assert.doesNotMatch(ui.messages(), /检查断线/);
  } finally { await ui.dispose(); }
});

test("编辑器 403 后只提示真实可用操作，冲突与未应用表单仍可见", async () => {
  const ui = await editorUiHarness();
  try {
    await ui.initialize();
    await ui.update((value) => value.onJsonChange(designText({ ...design, name: "草稿" })));
    assert.equal(ui.current().canSave, true);
    ui.setPutError(new ProjectRequestError("来源不允许写入", 403));
    await ui.update((value) => value.onSave());
    assert.equal(ui.puts(), 1);
    assert.equal(ui.current().readOnly, true);
    assert.equal(ui.current().canSave, false);
    assert.match(ui.current().status, /保存失败/);
    assert.match(ui.messages(), /写入请求被服务端拒绝（HTTP 403）/);
    assert.match(ui.messages(), /可导出有效 JSON/);
    await ui.update((value) => value.onExport());
    assert.equal(ui.exports(), 1);
    await ui.update((value) => value.onPendingChange("part", true));
    assert.match(ui.messages(), /表单输入尚未应用/);
    assert.match(ui.messages(), /导出仅在备份、表单及数据等条件允许时可用/);
    await ui.update((value) => value.onExport());
    assert.equal(ui.exports(), 1);
    ui.setDisk({ ...project, fingerprint: "P1" });
    await ui.focus();
    ui.setGetError(new ProjectRequestError("检查再次失败", 0));
    await ui.focus();
    assert.match(ui.current().status, /文件冲突/);
    for (const risk of [/写入请求被服务端拒绝/, /保存失败/, /检查再次失败/, /文件发生冲突/, /表单输入尚未应用/]) assert.match(ui.messages(), risk);
    assert.equal(ui.button("另存副本")?.disabled, true);
    assert.equal(ui.current().canSave, false);
  } finally { await ui.dispose(); }
});

test("副本请求处理中不误称只读，失败、冲突与表单风险仍保留", async () => {
  const ui = await editorUiHarness();
  try {
    await ui.initialize();
    await ui.update((value) => value.onJsonChange(designText({ ...design, name: "草稿" })));
    ui.setPutError(new ProjectRequestError("保存失败原因", 500));
    await ui.update((value) => value.onSave());
    ui.setDisk({ ...project, fingerprint: "P1" });
    await ui.focus();
    const pendingCopy = deferred<never>();
    ui.setWriteResponse(pendingCopy.promise);
    await ui.update((value) => value.onCopy());
    assert.equal(ui.current().status, "处理中…");
    assert.equal(ui.current().readOnly, true);
    assert.match(ui.messages(), /正在处理项目操作/);
    assert.match(ui.messages(), /保存失败原因/);
    assert.match(ui.messages(), /文件发生冲突/);
    assert.doesNotMatch(ui.messages(), /只读/);
    await ui.update((value) => value.onPendingChange("part", true));
    assert.match(ui.messages(), /表单输入尚未应用/);
    assert.match(ui.messages(), /保存失败原因/);
    assert.match(ui.messages(), /文件发生冲突/);
    pendingCopy.reject(new ProjectRequestError("副本被拒绝", 403));
    await ui.update(() => {});
    assert.match(ui.messages(), /写入请求被服务端拒绝/);
    assert.equal(ui.current().readOnly, true);
  } finally { await ui.dispose(); }
});

test("备份、文件冲突、检查失败与未应用表单并存时均显示且不放宽按钮资格", async () => {
  const ui = await editorUiHarness(true);
  try {
    ui.setDisk({ ...project, fingerprint: "P1" });
    await ui.initialize();
    ui.setGetError(new ProjectRequestError("检查断线", 0));
    await ui.focus();
    await ui.update((value) => value.onPendingChange("part", true));
    for (const risk of [/未保存 JSON 备份/, /1.5 秒即可能自动写入/, /检查断线/, /文件发生冲突/, /表单输入尚未应用/]) assert.match(ui.messages(), risk);
    assert.equal(ui.button("恢复草稿")?.disabled, true);
    assert.equal(ui.button("另存副本")?.disabled, true);
    assert.equal(ui.current().readOnly, true);
    assert.equal(ui.current().canSave, false);
    await ui.update((value) => value.onPendingChange("part", false));
    assert.equal(ui.button("恢复草稿")?.disabled, false);
    await ui.update((value) => value.onAutoSaveChange(false));
    assert.match(ui.messages(), /自动保存已关闭，恢复后需手动保存/);
    await ui.update(() => ui.button("恢复草稿")?.onClick?.());
    assert.match(ui.messages(), /检查断线/);
    assert.match(ui.messages(), /JSON 草稿已恢复，但与正式文件冲突/);
    assert.match(ui.messages(), /文件发生冲突/);
    assert.equal(ui.current().canSave, false);
  } finally { await ui.dispose(); }
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
