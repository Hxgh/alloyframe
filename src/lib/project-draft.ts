import * as THREE from "three";
import type { Design, Part } from "./schema";
import type { ProjectRecord } from "./projects";
import { partRotation } from "./tslot";

export type DraftBackup = { id: string; fingerprint: string; text: string; sessionId?: string };
export type DraftHistoryState = { past: string[]; future: string[] };
export type MirrorAxis = "x" | "z";
export type PendingProjectForm = "part" | "metadata" | "accessories";
export const unappliedFieldsWarning = "表单输入尚未应用，不在 JSON 备份中，请先应用或撤销。";
export const draftKey = (id: string, sessionId?: string) => `alloyframe:draft:${id}${sessionId ? `:${sessionId}` : ""}`;
export const legacyDraftKey = (id: string) => `sunmao:draft:${id}`;
export const designText = (design: Design) => JSON.stringify(design, null, 2);

export function createDraftSessionId(random: Pick<Crypto, "getRandomValues"> = globalThis.crypto): string {
  // 私网 HTTP 上 randomUUID 不可用，getRandomValues 仍可用于隔离编辑会话。
  return Array.from(random.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function parseDraftBackup(raw: string | null, id: string): DraftBackup | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value?.id === id && typeof value.fingerprint === "string" && typeof value.text === "string"
      && (value.sessionId === undefined || (typeof value.sessionId === "string" && value.sessionId.length > 0))
      ? { id, fingerprint: value.fingerprint, text: value.text, ...(value.sessionId ? { sessionId: value.sessionId } : {}) }
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

export function serializeDraftBackup(text: string, saved: ProjectRecord, fingerprint = saved.fingerprint, sessionId?: string): string | null {
  return fingerprint !== saved.fingerprint || isDraftDirty(text, saved)
    ? JSON.stringify({ id: saved.design.id, fingerprint, text, ...(sessionId ? { sessionId } : {}) })
    : null;
}

export function captureProjectExport(design: Design, saved: ProjectRecord) {
  const draft = isDraftDirty(designText(design), saved);
  return {
    draft,
    filename: `${saved.design.id}${draft ? "-draft" : ""}.json`,
    design: draft ? { ...design, revision: saved.design.revision } : saved.design,
  };
}

function fitPartId(base: string, suffix = ""): string {
  // 来源是合法 ID；截断处若恰逢分隔符，不能产生连续或末尾短横线。
  return `${base.slice(0, 120 - suffix.length).replace(/-+$/, "")}${suffix}`;
}

function availablePartId(base: string, used: ReadonlySet<string>, startAtOne = false): string {
  const candidate = fitPartId(base);
  if (!startAtOne && !used.has(candidate)) return candidate;
  for (let count = 1; ; count++) {
    const id = fitPartId(base, `-${count}`);
    if (!used.has(id)) return id;
  }
}

export function nextPartId(existing: string[], source = "part") {
  return availablePartId(source, new Set(existing), true);
}

export const emptyDraftHistory = (): DraftHistoryState => ({ past: [], future: [] });

export function pushDraftHistory(history: DraftHistoryState, previousText: string, nextText: string, limit = 30): DraftHistoryState {
  if (previousText === nextText) return history;
  const past = history.past.at(-1) === previousText
    ? history.past
    : [...history.past.slice(-(limit - 1)), previousText];
  return { past, future: [] };
}

export function stepDraftUndo(history: DraftHistoryState, currentText: string, limit = 30): { history: DraftHistoryState; text: string } | null {
  if (history.past.length === 0) return null;
  const target = history.past[history.past.length - 1];
  return {
    text: target,
    history: {
      past: history.past.slice(0, -1),
      future: [currentText, ...history.future].slice(0, limit),
    },
  };
}

export function stepDraftRedo(history: DraftHistoryState, currentText: string, limit = 30): { history: DraftHistoryState; text: string } | null {
  if (history.future.length === 0) return null;
  const target = history.future[0];
  return {
    text: target,
    history: {
      past: [...history.past.slice(-(limit - 1)), currentText],
      future: history.future.slice(1),
    },
  };
}

function mirrorSemanticId(sourceId: string, axis: MirrorAxis): string {
  const pairs: ReadonlyArray<[string, string]> = axis === "x"
    ? [["left", "right"], ["right", "left"]]
    : [["front", "back"], ["back", "front"], ["rear", "front"]];
  for (const [from, to] of pairs) {
    const pattern = new RegExp(`(^|-)${from}(-|$)`);
    if (pattern.test(sourceId)) {
      const candidate = sourceId.replace(pattern, `$1${to}$2`);
      if (candidate.length <= 120) return candidate;
      const index = sourceId.search(pattern);
      // 前缀只有一字符时，改截末尾，避免删空前缀后留下非法的首短横线。
      return index > 1 ? fitPartId(sourceId.slice(0, index), candidate.slice(index)) : fitPartId(candidate);
    }
  }
  return fitPartId(sourceId, `-mirror-${axis}`);
}

export function mirrorPart(part: Part, existingIds: string[], axis: MirrorAxis): Part {
  const used = new Set([...existingIds, part.id]);
  const id = availablePartId(mirrorSemanticId(part.id, axis), used);
  const cleanZero = (value: number) => value === 0 ? 0 : value;
  const position = part.position.map((value, i) =>
    cleanZero(i === (axis === "x" ? 0 : 2) ? -value : value),
  ) as Part["position"];

  // PartMesh 使用 XYZ 欧拉角，型材长轴基准角是先逐分量相加而非矩阵相乘。
  // 沿世界镜像轴和相同的局部轴各反射一次，F R F 是合法旋转；渲染的
  // T 槽截面关于局部 X/Y 对称，挤出也关于局部 Z 对称，盒体同样适用。
  const reflection = new THREE.Matrix4().makeScale(axis === "x" ? -1 : 1, 1, axis === "z" ? -1 : 1);
  const matrix = new THREE.Matrix4()
    .makeRotationFromEuler(new THREE.Euler(...partRotation(part)))
    .premultiply(reflection)
    .multiply(reflection);

  // three 的默认 XYZ 分解在接近极点时会提前丢失一个旋转分量，手动使用
  // atan2 保留非零余弦；只有余弦确为零时才使用唯一可确定的组合角。
  const e = matrix.elements;
  const cosineY = Math.hypot(e[0], e[4]);
  const euler = cosineY > 0
    ? [Math.atan2(-e[9], e[10]), Math.atan2(e[8], cosineY), Math.atan2(-e[4], e[0])]
    : [Math.atan2(e[6], e[5]), Math.atan2(e[8], cosineY), 0];
  const base = partRotation({ ...part, rotation: [0, 0, 0] });
  const rotation = euler.map((value, i) => cleanZero(THREE.MathUtils.radToDeg(value - base[i]))) as Part["rotation"];

  // 无旋转构件仍以零角度呈现。基准姿态与其镜像相差的局部反射不会改变
  // 对称截面或盒体；这里不作近似归零，以免抹掉真实的小角度旋转。
  if (part.rotation.every((value) => value === 0)) rotation.fill(0);
  return { ...part, id, size: [...part.size], position, rotation };
}
