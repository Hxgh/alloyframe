"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import type { AccessoryCatalog, Catalog, Design } from "@/lib/schema";
import type { ProjectRecord, ValidationIssue } from "@/lib/projects";
import { inspectDesign } from "@/lib/validation";
import { ProjectRequestError, downloadJson, projectRequest } from "@/lib/project-client";
import {
  captureProjectExport, createDraftSessionId, designText, emptyDraftHistory, isDraftDirty,
  pushDraftHistory, stepDraftRedo, stepDraftUndo, unappliedFieldsWarning,
  type DraftHistoryState, type PendingProjectForm,
} from "@/lib/project-draft";
import {
  acknowledgeProjectSave, autoSaveKey, beginProjectSave, canSaveProject, captureProjectSave,
  createProjectSaveTimer, isRemoteCheckCurrent, legacyAutoSaveKey, parseAutoSavePreference, pauseProjectSave, projectChangeKey,
  type SaveConditions, type SaveSnapshot,
} from "@/lib/project-save";
import { migrateProjectDraft, readProjectDrafts, readProjectStorage, serializeProjectDraft, writeProjectDraft, writeProjectStorage, type StoredDraftBackup } from "@/lib/project-storage";
import { Button } from "@/components/ui/button";
import { Workspace } from "@/components/Workspace";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = { initial: ProjectRecord; catalog: Catalog; accessories: AccessoryCatalog; writable: boolean };
type Confirmation = "leave" | "discard" | "archive" | "reload" | null;
type EditorState = {
  saved: ProjectRecord;
  text: string;
  preview: Design;
  writable: boolean;
  permissionReady: boolean;
  writeRejected: boolean;
  busy: boolean;
  saving: boolean;
  uncertain: boolean;
  error: string;
  saveError: string;
  saveFailed: boolean;
  checkError: string;
  storageError: string;
  preferenceError: string;
  notice: string;
  remote: ProjectRecord | null;
  conflict: boolean;
  backups: StoredDraftBackup[];
  backupReady: boolean;
  autoSave: boolean;
  preferenceReady: boolean;
  activeReady: boolean;
  confirmation: Confirmation;
  pendingForms: Record<PendingProjectForm, boolean>;
  history: DraftHistoryState;
  formEpoch: number;
  workspaceEpoch: number;
};

function saveConditions(state: EditorState, valid: boolean, active: boolean, leaving: boolean): SaveConditions {
  return {
    valid, dirty: isDraftDirty(state.text, state.saved), pending: Object.values(state.pendingForms).some(Boolean),
    writable: state.writable, busy: state.busy, saving: state.saving, uncertain: state.uncertain, backupReady: state.backupReady,
    backup: state.backups.length > 0, remote: state.remote !== null, conflict: state.conflict,
    confirmation: state.confirmation !== null, active: active && state.activeReady, leaving,
    preferenceReady: state.preferenceReady, autoSave: state.autoSave, failed: state.saveFailed || Boolean(state.checkError),
  };
}

export function ProjectEditor({ initial, catalog, accessories, writable: initialWritable }: Props) {
  const router = useRouter();
  const [sessionId] = useState(createDraftSessionId);
  const [state, setState] = useState<EditorState>(() => ({
    saved: initial, text: designText(initial.design), preview: initial.design,
    writable: false, permissionReady: false, writeRejected: false, busy: false, saving: false, uncertain: false,
    error: "", saveError: "", saveFailed: false, checkError: "", storageError: "", preferenceError: "", notice: "",
    remote: null, conflict: false, backups: [], backupReady: false, autoSave: true, preferenceReady: false, activeReady: false,
    confirmation: null, pendingForms: { part: false, metadata: false, accessories: false },
    history: emptyDraftHistory(), formEpoch: 0, workspaceEpoch: 0,
  }));
  // 事件和异步回执始终读最新文本、表单及保存基准，不使用发请求时的闭包。
  const current = useRef(state);
  const draftFingerprint = useRef(initial.fingerprint);
  const editVersion = useRef(0);
  const inFlightRef = useRef<SaveSnapshot | null>(null);
  const baselineEpoch = useRef(0);
  const checkSequence = useRef(0);
  const permissionDenied = useRef(false);
  const active = useRef(false);
  const activityEpoch = useRef(0);
  const visible = useRef(false);
  const activeReady = useRef(false);
  const recheckPending = useRef(false);
  const leaving = useRef(false);
  const backupLoaded = useRef(false);
  const backupTimer = useRef<number | null>(null);
  const remoteCheckTimer = useRef<number | null>(null);
  const [saveTimer] = useState(() => createProjectSaveTimer({
    setTimeout: (run: () => void, delay: number) => window.setTimeout(run, delay),
    clearTimeout: (handle: number) => window.clearTimeout(handle),
  }));
  const update = useCallback((values: Partial<EditorState>) => {
    current.current = { ...current.current, ...values };
    setState(current.current);
  }, []);
  const invalidateRemoteChecks = useCallback(() => {
    baselineEpoch.current++;
    checkSequence.current++;
  }, []);
  const {
    saved, text, preview, writable, permissionReady, writeRejected, busy, saving, error, saveError, saveFailed,
    checkError, storageError, preferenceError, notice, remote, conflict, backups, backupReady, uncertain,
    autoSave, preferenceReady, confirmation, pendingForms, history, formEpoch, workspaceEpoch,
  } = state;
  const backup = backups[0] ?? null;
  const dirty = isDraftDirty(text, saved) || uncertain || conflict || remote !== null;
  const pending = Object.values(pendingForms).some(Boolean);

  const analyzeText = useCallback((value: string) => {
    try {
      const result = inspectDesign(JSON.parse(value), catalog, accessories);
      if (result.design && result.design.id !== initial.design.id) {
        return { design: null, issues: [{ level: "error", path: "id", message: "项目 ID 由系统维护，不能在 JSON 中修改。请复制或导入为新项目。" } as ValidationIssue] };
      }
      return result;
    } catch {
      return { design: null, issues: [{ level: "error", path: "JSON", message: "JSON 无法解析，请检查引号、逗号和括号。" } as ValidationIssue] };
    }
  }, [catalog, accessories, initial.design.id]);
  const analysis = useMemo(() => analyzeText(text), [text, analyzeText]);
  const visibleDesign = useMemo(() => {
    const value = analysis.design ?? preview;
    return value.revision === saved.design.revision ? value : { ...value, revision: saved.design.revision };
  }, [analysis.design, preview, saved.design.revision]);

  const cancelBackupTimer = useCallback(() => {
    if (backupTimer.current !== null) window.clearTimeout(backupTimer.current);
    backupTimer.current = null;
  }, []);

  const flushBackup = useCallback((leavingPage = false) => {
    cancelBackupTimer();
    const live = current.current;
    if (live.backups.length || leaving.current) return true; // 未决恢复备份和离开前的备份不能被当前文件覆盖。
    const value = serializeProjectDraft(live.text, live.saved, draftFingerprint.current, sessionId,
      live.uncertain || Boolean(inFlightRef.current) || live.conflict || live.remote !== null);
    try {
      writeProjectDraft(localStorage, live.saved.design.id, sessionId, value);
      update({ storageError: "" });
      return true;
    } catch {
      const reason = value !== null
        ? "当前 JSON 草稿未能备份，可能是浏览器存储不可用或空间不足。请及时保存、导出有效 JSON 或复制高级 JSON 原文。"
        : "浏览器旧 JSON 备份未能清除，可能是存储不可用；正式文件未受影响。请检查浏览器存储后重试。";
      update({ storageError: `${reason}${leavingPage ? "已阻止当前操作和自动跳转，页面内容仍保留。" : ""}未应用表单输入不在 JSON 备份中。` });
      return false;
    }
  }, [cancelBackupTimer, sessionId, update]);

  const checkRemote = useCallback(async () => {
    if (!active.current || !visible.current || leaving.current || !current.current.backupReady) return;
    if (inFlightRef.current || current.current.busy) { recheckPending.current = true; return; }
    recheckPending.current = false;
    const check = { sequence: ++checkSequence.current, epoch: baselineEpoch.current, fingerprint: current.current.saved.fingerprint };
    const stillCurrent = () => isRemoteCheckCurrent(check, {
      sequence: checkSequence.current, epoch: baselineEpoch.current, fingerprint: current.current.saved.fingerprint,
      active: active.current && visible.current, saving: Boolean(inFlightRef.current), leaving: leaving.current,
    });
    try {
      const result = await projectRequest<{ project: ProjectRecord; writable: boolean }>(`/api/projects/${initial.design.id}`);
      if (!stillCurrent()) return;
      const changed = result.project.fingerprint !== current.current.saved.fingerprint;
      const locked = changed || current.current.conflict;
      if (locked || !result.writable) saveTimer.cancel();
      activeReady.current = true;
      const wasUncertain = current.current.uncertain;
      update({
        writable: initialWritable && result.writable && !permissionDenied.current, permissionReady: true, checkError: "", activeReady: true,
        ...(locked ? { remote: result.project, conflict: true } : {}),
      });
      // 相同指纹不能排除旧 PUT 迟到落盘，必须继续保留原文和不确定状态。
      if (wasUncertain || locked) flushBackup();
    } catch (cause) {
      if (!stillCurrent()) return;
      saveTimer.cancel();
      activeReady.current = false;
      if (cause instanceof ProjectRequestError && cause.status === 403) permissionDenied.current = true;
      update({ checkError: (cause as Error).message, activeReady: false, ...(permissionDenied.current ? { writable: false } : {}) });
    }
  }, [flushBackup, initial.design.id, initialWritable, saveTimer, update]);

  const cancelScheduledRemoteCheck = useCallback(() => {
    if (remoteCheckTimer.current !== null) window.clearTimeout(remoteCheckTimer.current);
    remoteCheckTimer.current = null;
  }, []);

  // 事件立即作废旧检查并暂停保存；短时间合并焦点、可见性和跨标签通知。
  const scheduleRemoteCheck = useCallback(() => {
    cancelScheduledRemoteCheck();
    remoteCheckTimer.current = window.setTimeout(() => {
      remoteCheckTimer.current = null;
      void checkRemote();
    }, 50);
  }, [cancelScheduledRemoteCheck, checkRemote]);

  useLayoutEffect(() => {
    active.current = true;
    const epoch = ++activityEpoch.current;
    visible.current = document.visibilityState !== "hidden";
    activeReady.current = false;
    return () => {
      // Activity 隐藏和真实卸载均取消调度；已发出的请求仍可确认保存基准。
      active.current = false;
      activityEpoch.current = epoch + 1;
      visible.current = false;
      activeReady.current = false;
      invalidateRemoteChecks();
      saveTimer.cancel();
      cancelBackupTimer();
      cancelScheduledRemoteCheck();
      update({ activeReady: false, permissionReady: false, writable: false });
      if (current.current.backupReady) flushBackup();
    };
  }, [saveTimer, cancelBackupTimer, cancelScheduledRemoteCheck, flushBackup, invalidateRemoteChecks, update]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!active.current) return;
      const returning = leaving.current;
      if (returning) {
        leaving.current = false;
        update({ busy: false });
      }
      try {
        update({ autoSave: parseAutoSavePreference(readProjectStorage(localStorage, autoSaveKey, legacyAutoSaveKey)), preferenceError: "" });
      } catch {
        update({ preferenceError: "自动保存偏好未能读取；当前开关仍有效，但浏览器可能无法记住设置。此问题不影响正式保存或 JSON 备份。" });
      }
      // 初始化与 saved.design 分离；保存回执不能把刚写入的新备份弹成恢复提示。
      if (!backupLoaded.current || returning) {
        try {
          const live = current.current;
          const values = readProjectDrafts(localStorage, initial.design.id, sessionId);
          update({ backups: values.filter((value) => value.uncertain || value.fingerprint !== live.saved.fingerprint || isDraftDirty(value.text, live.saved)) });
        } catch {
          update({ storageError: "浏览器草稿备份不可用。请及时保存或导出 JSON，避免关闭页面后丢失修改。" });
        }
        backupLoaded.current = true;
      }
      update({ backupReady: true, preferenceReady: true });
      cancelScheduledRemoteCheck();
      void checkRemote();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initial.design.id, sessionId, cancelScheduledRemoteCheck, checkRemote, update]);

  useEffect(() => {
    const pause = () => {
      activeReady.current = false;
      invalidateRemoteChecks();
      saveTimer.cancel();
      update({ activeReady: false });
    };
    const onFocus = () => { pause(); scheduleRemoteCheck(); };
    const onVisibility = () => {
      visible.current = document.visibilityState !== "hidden";
      pause();
      if (visible.current) scheduleRemoteCheck();
      else {
        cancelScheduledRemoteCheck();
        if (current.current.backupReady) flushBackup();
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== projectChangeKey(initial.design.id) && event.key !== null) return;
      pause();
      scheduleRemoteCheck();
    };
    const onPageHide = () => {
      visible.current = false;
      pause();
      cancelScheduledRemoteCheck();
      if (current.current.backupReady) flushBackup();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onVisibility);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onVisibility);
      document.removeEventListener("visibilitychange", onVisibility);
      cancelScheduledRemoteCheck();
    };
  }, [scheduleRemoteCheck, cancelScheduledRemoteCheck, flushBackup, initial.design.id, invalidateRemoteChecks, saveTimer, update]);

  useEffect(() => {
    if (!busy && recheckPending.current) void checkRemote();
  }, [busy, checkRemote]);

  useEffect(() => {
    cancelBackupTimer();
    if (!backupReady || backup || leaving.current || !active.current) return;
    backupTimer.current = window.setTimeout(() => {
      backupTimer.current = null;
      flushBackup();
    }, 300);
    return cancelBackupTimer;
  }, [backupReady, backup, text, saved.fingerprint, cancelBackupTimer, flushBackup]);

  const save = useCallback((automatic = false) => saveTimer.save(async () => {
    const live = current.current;
    const result = analyzeText(live.text);
    if (!canSaveProject(saveConditions(live, Boolean(result.design) && !live.checkError, active.current && activeReady.current, leaving.current), automatic) || !result.design) return;
    const snapshot = captureProjectSave(result.design, live.text, live.saved, editVersion.current);
    if (!beginProjectSave(inFlightRef, snapshot)) return;
    // 请求开始和结束都使旧 GET 失效，防止误报自己的写入或旧基准的外部版本。
    baselineEpoch.current++;
    checkSequence.current++;
    update({ saving: true, uncertain: true, saveFailed: false, saveError: "", error: "", notice: "" });
    // 在途期间也可能隐藏或关闭，必须先保留原文和基准。
    flushBackup();
    let refreshAfterFailure = false;
    try {
      const project = await projectRequest<ProjectRecord>(`/api/projects/${snapshot.saved.design.id}`, {
        method: "PUT", body: JSON.stringify({ design: snapshot.design, fingerprint: snapshot.saved.fingerprint }),
      });
      const latest = current.current;
      const acknowledged = acknowledgeProjectSave(snapshot, project, { text: latest.text, preview: latest.preview, editVersion: editVersion.current });
      draftFingerprint.current = acknowledged.fingerprint;
      baselineEpoch.current++;
      checkSequence.current++;
      update({
        saved: acknowledged.saved, text: acknowledged.text, preview: acknowledged.preview,
        uncertain: false, saveFailed: false, saveError: "", checkError: "", remote: null, conflict: false,
        notice: isDraftDirty(acknowledged.text, project) ? "本次提交已保存；保存期间更新的 JSON 草稿仍保留。"
          : Object.values(latest.pendingForms).some(Boolean) ? "本次提交已保存；未应用的表单输入仍保留。" : "",
      });
      // B（包括无效原文）只换到 P1 基准，不 adopt、不重置表单、不删除新草稿。
      // 确认后先释放本请求的锁，再按新基准清理或写入备份。
      if (inFlightRef.current === snapshot) inFlightRef.current = null;
      flushBackup();
      try {
        localStorage.setItem(projectChangeKey(project.design.id), JSON.stringify({ sessionId, fingerprint: project.fingerprint }));
      } catch {
        update({ storageError: "项目已保存，但未能通知其他标签页检查文件。其他页面恢复显示时会重新核对指纹；请及时检查浏览器存储。" });
      }
    } catch (cause) {
      const status = cause instanceof ProjectRequestError ? cause.status : undefined;
      if (status === 403) permissionDenied.current = true;
      const paused = pauseProjectSave(current.current, status);
      activeReady.current = false;
      update({ saveFailed: paused.failed, conflict: paused.conflict, writable: paused.writable, activeReady: false, saveError: (cause as Error).message, ...(status === 403 ? { writeRejected: true } : {}) });
      refreshAfterFailure = true;
      flushBackup();
    } finally {
      baselineEpoch.current++;
      checkSequence.current++;
      if (inFlightRef.current === snapshot) inFlightRef.current = null;
      update({ saving: false });
    }
    // 所有失败都可能发生在落盘之后；409 的冲突锁在 GET 之前已建立。
    if (refreshAfterFailure || recheckPending.current) await checkRemote();
  }), [analyzeText, saveTimer, sessionId, update, flushBackup, checkRemote]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      saveTimer.cancel();
      const live = current.current;
      const backedUp = live.backupReady && flushBackup(true);
      if (isDraftDirty(live.text, live.saved) || live.uncertain || live.conflict || live.remote || live.backups.length || Object.values(live.pendingForms).some(Boolean) || inFlightRef.current || !backedUp) {
        event.preventDefault();
        event.returnValue = "";
        // 取消原生离页时恢复计时；真实离页由 pagehide / Activity 清理取消。
        saveTimer.schedule(() => { void save(true); });
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [flushBackup, saveTimer, save]);

  const canSave = canSaveProject(saveConditions(state, Boolean(analysis.design) && !state.checkError, true, false));
  const automaticAllowed = canSaveProject(saveConditions(state, Boolean(analysis.design), true, false), true);
  useEffect(() => {
    saveTimer.cancel();
    if (!automaticAllowed || !active.current || !activeReady.current || leaving.current) return;
    saveTimer.schedule(() => { void save(true); });
    return saveTimer.cancel;
  }, [automaticAllowed, text, saved.fingerprint, saveTimer, save]);

  function reportPending(form: PendingProjectForm, value: boolean) {
    const forms = current.current.pendingForms;
    if (value || forms[form] !== value) editVersion.current++;
    if (value) saveTimer.cancel();
    if (forms[form] !== value) update({ pendingForms: { ...forms, [form]: value } });
  }

  const resetForms = useCallback(() => {
    update({ pendingForms: { part: false, metadata: false, accessories: false }, formEpoch: current.current.formEpoch + 1 });
  }, [update]);

  function navigationBlocked() {
    const live = current.current;
    return live.busy || live.saving || Boolean(inFlightRef.current) || !live.backupReady
      || !active.current || !visible.current || leaving.current;
  }

  function filesBlocked() {
    return navigationBlocked() || current.current.backups.length > 0;
  }

  function resetToFile() {
    saveTimer.cancel();
    resetForms();
    const live = current.current;
    editVersion.current++;
    draftFingerprint.current = live.saved.fingerprint;
    update({ text: designText(live.saved.design), preview: live.saved.design, history: emptyDraftHistory(), confirmation: null, error: "", notice: "" });
  }

  function prepareToLeave() {
    saveTimer.cancel();
    const live = current.current;
    leaving.current = true;
    invalidateRemoteChecks();
    resetToFile();
    update({ workspaceEpoch: live.workspaceEpoch + 1, busy: true });
  }

  function leave() {
    if (navigationBlocked()) return;
    if (!flushBackup(true)) return;
    prepareToLeave();
    router.push("/");
  }

  function changeAutoSave(enabled: boolean) {
    saveTimer.cancel();
    update({ autoSave: enabled, preferenceReady: true });
    try {
      writeProjectStorage(localStorage, autoSaveKey, legacyAutoSaveKey, String(enabled));
      update({ preferenceError: "" });
    } catch {
      update({ preferenceError: "自动保存开关已在本页生效，但浏览器未能记住偏好；下次打开可能恢复默认开启。正式保存与 JSON 草稿备份的结果不受此错误影响。" });
    }
  }

  function changeText(value: string, recordHistory = true) {
    saveTimer.cancel();
    cancelBackupTimer();
    const live = current.current;
    editVersion.current++;
    const result = analyzeText(value);
    const nextHistory = recordHistory ? pushDraftHistory(live.history, live.text, value) : live.history;
    update({ text: value, history: nextHistory, notice: "", ...(result.design ? { preview: result.design } : {}) });
  }

  const undo = useCallback(() => {
    const live = current.current;
    if (!live.writable || live.busy || !live.backupReady || live.backups.length) return;
    if (Object.values(live.pendingForms).some(Boolean)) { update({ error: unappliedFieldsWarning }); return; }
    const stepped = stepDraftUndo(live.history, live.text);
    if (!stepped) return;
    saveTimer.cancel();
    cancelBackupTimer();
    editVersion.current++;
    const result = analyzeText(stepped.text);
    resetForms();
    update({ text: stepped.text, history: stepped.history, error: "", notice: "", ...(result.design ? { preview: result.design } : {}) });
  }, [analyzeText, cancelBackupTimer, resetForms, saveTimer, update]);

  const redo = useCallback(() => {
    const live = current.current;
    if (!live.writable || live.busy || !live.backupReady || live.backups.length) return;
    if (Object.values(live.pendingForms).some(Boolean)) { update({ error: unappliedFieldsWarning }); return; }
    const stepped = stepDraftRedo(live.history, live.text);
    if (!stepped) return;
    saveTimer.cancel();
    cancelBackupTimer();
    editVersion.current++;
    const result = analyzeText(stepped.text);
    resetForms();
    update({ text: stepped.text, history: stepped.history, error: "", notice: "", ...(result.design ? { preview: result.design } : {}) });
  }, [analyzeText, cancelBackupTimer, resetForms, saveTimer, update]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        if (current.current.history.past.length === 0) return;
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey)) {
        if (current.current.history.future.length === 0) return;
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  function changeJson(value: string) {
    const live = current.current;
    if (!live.writable || live.busy || !live.backupReady || live.backups.length) return;
    if (Object.values(live.pendingForms).some(Boolean)) { update({ error: unappliedFieldsWarning }); return; }
    changeText(value);
    resetForms();
  }

  function changeDesign(design: Design) {
    const live = current.current;
    if (!live.writable || live.busy || !live.backupReady || live.backups.length) return;
    changeText(designText({ ...design, id: live.saved.design.id, revision: live.saved.design.revision }));
  }

  function adopt(project: ProjectRecord, keepConflict = false) {
    if (inFlightRef.current) return;
    // 显式放弃草稿可以恢复文件原文，但不能证明失败的 PUT 不会迟到。
    const remainsUncertain = current.current.uncertain;
    if (remainsUncertain) activeReady.current = false;
    saveTimer.cancel();
    cancelBackupTimer();
    resetForms();
    editVersion.current++;
    baselineEpoch.current++;
    checkSequence.current++;
    draftFingerprint.current = project.fingerprint;
    update({
      saved: project, text: designText(project.design), preview: project.design, history: emptyDraftHistory(),
      remote: keepConflict ? current.current.remote : null, conflict: keepConflict && current.current.conflict,
      uncertain: remainsUncertain, ...(remainsUncertain ? { activeReady: false } : {}),
      error: "", saveError: "", saveFailed: remainsUncertain, checkError: "", backups: [], notice: "",
    });
    if (remainsUncertain || (keepConflict && current.current.conflict)) flushBackup();
    else try {
      writeProjectDraft(localStorage, project.design.id, sessionId, null);
      update({ storageError: "" });
    } catch {
      update({ storageError: "文件版本已采用，但浏览器旧 JSON 备份未能清除；下次打开可能仍提示旧备份。正式文件未受影响。" });
    }
    void checkRemote();
  }

  async function copy() {
    const live = current.current;
    if (Object.values(live.pendingForms).some(Boolean)) { update({ error: unappliedFieldsWarning }); return; }
    if (!live.writable) { update({ error: "当前写入不可用，另存副本需要写入权限。" }); return; }
    if (filesBlocked()) return;
    const result = analyzeText(live.text);
    if (!result.design) { update({ error: "请先修复项目数据，再另存为副本。" }); return; }
    saveTimer.cancel();
    update({ busy: true, error: "" });
    try {
      const project = await projectRequest<ProjectRecord>("/api/projects", { method: "POST", body: JSON.stringify({ action: "import", design: { ...result.design, name: `${result.design.name} · 副本` } }) });
      update({ notice: `副本已保存：${project.design.name}。可返回项目库打开；原项目及其草稿保持不变。` });
    } catch (cause) {
      if (cause instanceof ProjectRequestError && cause.status === 403) { permissionDenied.current = true; update({ writable: false, writeRejected: true }); }
      update({ error: (cause as Error).message });
    } finally {
      update({ busy: false });
    }
  }

  async function archive() {
    const live = current.current;
    if (Object.values(live.pendingForms).some(Boolean)) { update({ error: unappliedFieldsWarning }); return; }
    if (filesBlocked() || !live.writable) return;
    if (isDraftDirty(live.text, live.saved) || live.uncertain || live.remote || live.conflict) { update({ error: "请先保存或解决草稿冲突，再归档项目。" }); return; }
    if (!flushBackup(true)) return;
    saveTimer.cancel();
    const epoch = activityEpoch.current;
    update({ busy: true, error: "" });
    try {
      await projectRequest(`/api/projects/${live.saved.design.id}`, { method: "PATCH", body: JSON.stringify({ action: "archive", fingerprint: live.saved.fingerprint }) });
      cancelBackupTimer();
      if (active.current && epoch === activityEpoch.current) {
        prepareToLeave();
        router.push("/");
      } else update({ busy: false, notice: "项目已归档，可从项目库恢复。" });
    } catch (cause) {
      if (cause instanceof ProjectRequestError && cause.status === 403) { permissionDenied.current = true; update({ writable: false, writeRejected: true }); }
      if (cause instanceof ProjectRequestError && cause.status === 409) update({ conflict: true });
      update({ error: (cause as Error).message, busy: false });
    }
  }

  function exportProject() {
    const live = current.current;
    if (Object.values(live.pendingForms).some(Boolean)) { update({ error: unappliedFieldsWarning }); return; }
    if (filesBlocked()) return;
    const result = analyzeText(live.text);
    if (!result.design) { update({ error: "当前 JSON 无效，请先修复后导出项目。原文仍保留，可在「项目 → 高级 JSON」区域复制。" }); return; }
    const exported = captureProjectExport(result.design, live.saved);
    downloadJson(exported.filename, exported.design);
    update({ notice: exported.draft ? "已导出当前有效 JSON 草稿；仅下载副本，未写入正式文件。" : "已导出上次成功保存的设计；仅下载副本，未写入正式文件。" });
  }

  function askConfirmation(value: Exclude<Confirmation, null>) {
    if (filesBlocked()) return;
    saveTimer.cancel();
    update({ confirmation: value });
  }

  function back(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (navigationBlocked()) return;
    const live = current.current;
    if (isDraftDirty(live.text, live.saved) || live.uncertain || live.conflict || live.remote || live.backups.length || Object.values(live.pendingForms).some(Boolean)) {
      saveTimer.cancel();
      update({ confirmation: "leave" });
    }
    else leave();
  }

  function restoreBackup(source: StoredDraftBackup) {
    const live = current.current;
    if (!live.backups.includes(source) || Object.values(live.pendingForms).some(Boolean) || live.busy || inFlightRef.current) return;
    saveTimer.cancel();
    cancelBackupTimer();
    const value = serializeProjectDraft(source.text, live.saved, source.fingerprint, sessionId,
      Boolean(source.uncertain) || live.uncertain || live.conflict || live.remote !== null);
    try {
      if (value !== null) migrateProjectDraft(localStorage, live.saved.design.id, sessionId, value, source);
    } catch {
      update({ storageError: "草稿未能复制到当前编辑会话，原备份与输入仍保留。请检查浏览器存储后重试。" });
      return;
    }
    resetForms();
    const changed = source.fingerprint !== live.saved.fingerprint;
    draftFingerprint.current = source.fingerprint;
    changeText(source.text, false);
    if (source.uncertain) activeReady.current = false;
    update({
      history: emptyDraftHistory(),
      backups: [], storageError: "", uncertain: live.uncertain || Boolean(source.uncertain),
      ...(source.uncertain ? { activeReady: false } : {}), saveFailed: live.saveFailed || Boolean(source.uncertain),
      conflict: live.conflict || changed, ...(changed ? { remote: live.remote ?? live.saved } : {}),
      notice: changed || live.conflict ? "JSON 草稿已恢复，但与正式文件冲突；自动保存仍暂停。"
        : source.uncertain ? "JSON 草稿已恢复；保存结果未确认，请先检查文件。"
          : live.saveFailed || live.checkError ? "JSON 草稿已恢复；此前失败的暂停仍保留，请检查文件并确认保存条件。"
            : live.autoSave ? "JSON 草稿已恢复；写入权限允许时，有效且已应用的内容将在停止编辑 1.5 秒后自动保存。自动保存不是历史回滚。"
              : "JSON 草稿已恢复；自动保存已关闭，需要手动保存才写入正式文件。",
    });
    if (source.uncertain) void checkRemote();
  }

  function discardBackup() {
    const live = current.current;
    if (Object.values(live.pendingForms).some(Boolean) || live.busy || inFlightRef.current) return;
    saveTimer.cancel();
    cancelBackupTimer();
    try {
      writeProjectDraft(localStorage, live.saved.design.id, sessionId, null);
      resetToFile();
      update({ storageError: "", backups: [], notice: "本页未采用备份；其他编辑会话及旧版共享备份仍保留。" });
    } catch {
      update({ storageError: "当前编辑会话的草稿备份未能删除，备份仍保留。请检查浏览器存储后重试。" });
    }
  }

  const savedAt = preferenceReady && !Number.isNaN(Date.parse(saved.updatedAt))
    ? new Date(saved.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }) : "";
  const saveBlocked = busy || saving || !backupReady || backup !== null;
  const status = saving ? "保存中…" : busy ? "处理中…" : conflict || remote ? "文件冲突 · 自动保存已暂停"
    : saveFailed ? "保存失败 · 自动保存已暂停" : checkError ? "检查失败 · 自动保存已暂停" : uncertain ? "保存结果待核对 · 自动保存已暂停"
      : writeRejected ? "写入被拒绝" : backup ? "发现备份 · 自动保存已暂停" : !backupReady || !preferenceReady ? "准备浏览器草稿…"
        : !permissionReady ? "正在确认写入权限…" : !writable ? "写入不可用" : pending ? "表单未应用 · 自动保存已暂停"
          : !analysis.design ? "JSON 无效 · 自动保存已暂停" : confirmation ? "等待确认 · 自动保存已暂停"
            : dirty ? autoSave ? "等待自动保存（1.5 秒）" : "未保存 · 自动保存关闭"
              : `已保存${savedAt ? ` · ${savedAt}` : ""}${saved.design.parts.length === 0 ? " · 待添加零件" : ""}${!autoSave ? " · 自动保存关闭" : ""}`;
  const messages = (
    <>
      {backup && <div className="project-message border-b bg-muted px-3 py-3 text-sm" role="status"><p>发现浏览器中的未保存 JSON 备份，不含未应用的表单输入。恢复不会删除其他会话的备份；基准变化须先解决冲突，保存结果待核对的草稿须先检查文件。{autoSave ? "满足保存条件时，恢复后的有效草稿停止编辑 1.5 秒即可能自动写入正式文件；可先关闭自动保存。" : "自动保存已关闭，恢复后需手动保存。"}自动保存不是历史回滚。</p><ul className="mt-2 space-y-2">{backups.map((value) => <li key={value.key} className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 break-all text-xs">{value.sessionId === sessionId ? "当前编辑会话" : value.sessionId ? `其他编辑会话 · ${value.sessionId}` : "旧版共享草稿"}{value.fingerprint !== saved.fingerprint ? " · 文件基准已变化" : " · 同一文件基准"}{value.uncertain ? " · 保存结果待核对" : ""}</span><Button size="touch" variant="outline" disabled={pending || busy || saving} onClick={() => restoreBackup(value)}>恢复草稿</Button></li>)}</ul><Button className="mt-2" size="touch" variant="ghost" disabled={pending || busy || saving} onClick={discardBackup}>{backups.some((value) => value.sessionId === sessionId) ? "丢弃本会话备份并继续" : "不恢复，使用文件版本"}</Button></div>}
      {writeRejected && <div className="project-message border-b bg-muted/50 px-3 py-2 text-xs leading-relaxed" role="status">写入请求被服务端拒绝（HTTP 403），当前编辑和写入已暂停。{!saveBlocked && !pending && analysis.design ? "可导出有效 JSON；导出只是下载副本，不会保存正式文件。" : "导出仅在备份、表单及数据等条件允许时可用，且不会保存正式文件。"}</div>}
      {!writeRejected && permissionReady && !writable && !checkError && <div className="project-message border-b bg-muted/50 px-3 py-2 text-xs leading-relaxed" role="status">当前写入不可用，编辑已暂停。{!saveBlocked && !pending && analysis.design ? "可导出有效 JSON；导出不会保存正式文件。" : "导出须满足备份、表单及数据等条件，不会保存正式文件。"}</div>}
      {busy && <div className="project-message border-b bg-muted/50 px-3 py-2 text-xs leading-relaxed" role="status">正在处理项目操作，编辑暂时暂停。</div>}
      {!backupReady && <div className="project-message border-b bg-muted/50 px-3 py-2 text-xs leading-relaxed" role="status">正在准备浏览器草稿，编辑暂时暂停。</div>}
      {!permissionReady && !checkError && !writeRejected && <div className="project-message border-b bg-muted/50 px-3 py-2 text-xs leading-relaxed" role="status">正在确认写入权限。</div>}
      {uncertain && !saving && <div className="project-message border-b bg-muted/50 px-3 py-2 text-xs leading-relaxed" role="status">保存结果未确认，自动保存已暂停；原文和旧指纹保留。请先检查文件，满足权限及其他保存条件后再手动保存。</div>}
      {pending && <div className="project-message border-b bg-muted/50 px-3 py-2 text-xs leading-relaxed" role="status">{unappliedFieldsWarning}保存、导出、另存副本、归档及高级 JSON 编辑已暂停；切换面板不会丢弃输入。</div>}
      {(error || saveError || checkError || storageError || preferenceError || notice) && <div className="project-message border-b px-3 py-2 text-xs leading-relaxed" role={error || saveError || checkError || storageError || preferenceError ? "alert" : "status"}>{error && <p className="text-destructive wrap-anywhere">{error}</p>}{saveError && <p className="text-destructive wrap-anywhere">{saveError}保存失败，自动保存已暂停，草稿保留；检查文件并满足权限及其他保存条件后可手动重试。</p>}{checkError && <p className="text-destructive wrap-anywhere">{checkError}文件检查失败，保存已暂停；处理其他阻塞后可在顶部项目操作中重新检查。</p>}{storageError && <p className="text-destructive">{storageError}</p>}{preferenceError && <p className="text-destructive">{preferenceError}</p>}{notice && <p>{notice}</p>}</div>}
      {(remote || conflict) && <div className="project-message flex flex-wrap items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs"><p className="min-w-0 flex-1 leading-relaxed">文件发生冲突，自动保存已暂停，当前草稿不会被覆盖。{remote ? "可在条件允许时载入文件版本。" : "新文件版本尚未读取成功，请在条件允许时检查文件更新。"}</p><Button size="touch" variant="outline" disabled={saveBlocked || !remote} onClick={() => askConfirmation("reload")}>载入文件版本</Button><Button size="touch" variant="ghost" disabled={!analysis.design || !writable || saveBlocked || pending} title={pending ? unappliedFieldsWarning : !writable ? "当前写入不可用，另存副本需要写入权限。" : undefined} onClick={() => { void copy(); }}>另存副本</Button></div>}
      {!analysis.design && <div className="project-message border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive" role="alert">当前数据未通过校验，画布保留最近有效预览；手动与自动保存、算料与导出已暂停。到「项目 → 高级 JSON」修复。</div>}
    </>
  );

  return (
    <>
      <Workspace
        key={`${saved.design.id}-${workspaceEpoch}`}
        design={visibleDesign}
        catalog={catalog}
        accessoryCatalog={accessories}
        project={{
          text, issues: analysis.issues, invalid: !analysis.design, dirty, pending, formEpoch,
          onPendingChange: reportPending, readOnly: !writable || busy || !backupReady || backup !== null,
          status, canSave, autoSave, onAutoSaveChange: changeAutoSave, saving, saveBlocked, savedAt,
          canUndo: writable && !busy && backupReady && !backup && !pending && history.past.length > 0,
          canRedo: writable && !busy && backupReady && !backup && !pending && history.future.length > 0,
          onUndo: undo, onRedo: redo,
          onSave: () => { void save(); }, onBack: back, onChange: changeDesign, onJsonChange: changeJson,
          onExport: exportProject, onCopy: () => { void copy(); }, onArchive: () => askConfirmation("archive"),
          onDiscard: () => askConfirmation("discard"), onRefresh: () => { if (!filesBlocked()) void checkRemote(); }, messages,
        }}
      />
      <ConfirmDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) update({ confirmation: null }); }}
        title={confirmation === "leave" ? "离开未保存项目" : confirmation === "archive" ? "归档项目" : confirmation === "reload" ? "载入文件版本" : "放弃上次保存后的草稿"}
        description={confirmation === "leave"
          ? `${pending ? `${unappliedFieldsWarning}继续返回将丢弃未应用输入。` : ""}未保存的 JSON 不会因离开写入文件；返回前会尝试浏览器备份，失败将留在本页。备份不含未应用表单；自动保存不是历史回滚，也不保证关闭页面期间的网络写入。`
          : confirmation === "archive"
            ? "项目将移入已归档，可从项目库恢复。未保存修改和未应用输入须先保存、应用或放弃。"
            : `${pending ? `${unappliedFieldsWarning}继续将丢弃未应用输入。` : ""}${confirmation === "reload" ? "这会用文件版本替换当前草稿并重置表单。" : "这只放弃上次成功保存后的草稿并重置表单，不会回滚已自动保存的内容。"}需要保留时，请先应用输入，再在条件允许时导出或另存副本；导出不会保存正式文件。`}
        confirmLabel={confirmation === "leave" ? "返回项目库" : confirmation === "archive" ? "归档" : confirmation === "reload" ? "载入" : "放弃草稿"}
        onConfirm={() => {
          const action = current.current.confirmation;
          if (action === "leave" ? navigationBlocked() : filesBlocked()) return;
          update({ confirmation: null });
          if (action === "leave") leave();
          else if (action === "archive") { void archive(); }
          else if (action === "reload" && current.current.remote) adopt(current.current.remote);
          else if (action === "discard") { adopt(current.current.saved, true); update({ notice: "已放弃上次成功保存后的草稿；已保存内容没有回滚。" }); }
        }}
      />
    </>
  );
}
