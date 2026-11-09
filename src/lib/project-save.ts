import type { Design } from "./schema";
import type { ProjectRecord } from "./projects";
import { designText } from "./project-draft";

export const autoSaveKey = "alloyframe:autosave";
export const legacyAutoSaveKey = "sunmao:autosave";
export const projectChangeKey = (id: string) => `alloyframe:project-change:${id}`;
export const autoSaveDelay = 1500;
export const parseAutoSavePreference = (value: string | null) => value !== "false";

export type SaveConditions = {
  valid: boolean;
  dirty: boolean;
  pending: boolean;
  writable: boolean;
  busy: boolean;
  saving: boolean;
  backupReady: boolean;
  backup: boolean;
  remote: boolean;
  conflict: boolean;
  confirmation: boolean;
  active: boolean;
  leaving: boolean;
  preferenceReady: boolean;
  autoSave: boolean;
  failed: boolean;
};

export function canSaveProject(state: SaveConditions, automatic = false): boolean {
  return state.valid && state.dirty && state.writable && state.backupReady && state.active
    && !state.pending && !state.busy && !state.saving && !state.backup && !state.remote
    && !state.conflict && !state.confirmation && !state.leaving
    && (!automatic || (state.preferenceReady && state.autoSave && !state.failed));
}

export function pauseProjectSave(state: Pick<SaveConditions, "conflict" | "writable">, status?: number) {
  return { failed: true, conflict: state.conflict || status === 409, writable: state.writable && status !== 403 };
}

export type SaveSnapshot = { design: Design; text: string; saved: ProjectRecord; editVersion: number };

export function captureProjectSave(design: Design, text: string, saved: ProjectRecord, editVersion: number): SaveSnapshot {
  return { design: { ...design, id: saved.design.id, revision: saved.design.revision }, text, saved, editVersion };
}

export function beginProjectSave(inFlight: { current: SaveSnapshot | null }, snapshot: SaveSnapshot): boolean {
  if (inFlight.current) return false;
  inFlight.current = snapshot;
  return true;
}

export function acknowledgeProjectSave(snapshot: SaveSnapshot, project: ProjectRecord, current: { text: string; preview: Design; editVersion: number }) {
  const untouched = current.editVersion === snapshot.editVersion && current.text === snapshot.text;
  return {
    saved: project,
    text: untouched ? designText(project.design) : current.text,
    preview: untouched ? project.design : { ...current.preview, revision: project.design.revision },
    fingerprint: project.fingerprint,
  };
}

export type RemoteCheck = { sequence: number; epoch: number; fingerprint: string };

export function isRemoteCheckCurrent(check: RemoteCheck, current: RemoteCheck & { active: boolean; saving: boolean; leaving: boolean }): boolean {
  return current.active && !current.saving && !current.leaving
    && check.sequence === current.sequence && check.epoch === current.epoch && check.fingerprint === current.fingerprint;
}

export function createProjectSaveTimer<Handle>(clock: {
  setTimeout: (callback: () => void, delay: number) => Handle;
  clearTimeout: (handle: Handle) => void;
}) {
  let timer: Handle | null = null;
  function cancel() {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  }
  return {
    cancel,
    schedule(run: () => void) {
      cancel();
      timer = clock.setTimeout(() => { timer = null; run(); }, autoSaveDelay);
    },
    save<T>(run: () => T): T {
      cancel();
      return run();
    },
  };
}
