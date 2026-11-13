import assert from "node:assert/strict";
import { test } from "node:test";
import { DesignSchema } from "../schema";
import { designBounds } from "../tslot";
import {
  captureProjectExport, createDraftSessionId, designText, emptyDraftHistory, isDraftDirty,
  mirrorPart, nextPartId, parseDraftBackup, pushDraftHistory, serializeDraftBackup, stepDraftRedo, stepDraftUndo,
} from "../project-draft";

const design = DesignSchema.parse({ id: "workbench", name: "工作台", units: "mm", parts: [] });
const project = { design, fingerprint: "file-v1", updatedAt: "2026-01-01T00:00:00Z" };

test("草稿序列化往返及未修改状态不因缩进变化误报", () => {
  const text = designText(design);
  assert.deepEqual(JSON.parse(text), design);
  assert.equal(isDraftDirty(text, project), false);
  assert.equal(isDraftDirty(JSON.stringify(design), project), false);
  assert.equal(isDraftDirty(JSON.stringify({ ...design, name: "新工作台" }), project), true);
  assert.equal(isDraftDirty("{", project), true);
});

test("浏览器草稿按项目隔离，保留无效原文和基准文件指纹", () => {
  const raw = JSON.stringify({ id: design.id, fingerprint: "older-v0", text: "{broken" });
  assert.deepEqual(parseDraftBackup(raw, design.id), { id: design.id, fingerprint: "older-v0", text: "{broken" });
  assert.equal(parseDraftBackup(raw, "other-project"), null);
  assert.equal(parseDraftBackup("bad JSON", design.id), null);
  assert.equal(parseDraftBackup(JSON.stringify({ id: design.id, text: "{}" }), design.id), null);
});

test("备份序列化使用当前 JSON 原文，保留无效输入和文件指纹", () => {
  const olderText = designText({ ...design, name: "旧草稿" });
  const latestText = "{latest-incomplete";
  assert.notEqual(serializeDraftBackup(olderText, project), serializeDraftBackup(latestText, project));
  assert.deepEqual(parseDraftBackup(serializeDraftBackup(latestText, project), design.id), {
    id: design.id, fingerprint: project.fingerprint, text: latestText,
  });
});

test("采用文件版本后无需保留旧备份，未应用表单字段不属于 JSON 备份", () => {
  const unappliedFields = { name: "尚未应用的项目名称" };
  const text = designText(design);
  assert.notEqual(unappliedFields.name, design.name);
  assert.equal(serializeDraftBackup(text, project), null);
  const nextDesign = { ...design, name: "已应用的项目名称" };
  const nextText = designText(nextDesign);
  assert.deepEqual(JSON.parse(parseDraftBackup(serializeDraftBackup(nextText, project), design.id)!.text), nextDesign);
  assert.equal(serializeDraftBackup(nextText, { ...project, design: nextDesign, fingerprint: "file-v2" }), null);
});

test("离开时保留 JSON 备份，重新展示文件文本不等于自动恢复草稿", () => {
  const draftText = "{unfinished-before-leave";
  const raw = serializeDraftBackup(draftText, project);
  const fileText = designText(project.design);
  assert.equal(isDraftDirty(fileText, project), false);
  assert.deepEqual(parseDraftBackup(raw, project.design.id), {
    id: project.design.id, fingerprint: project.fingerprint, text: draftText,
  });
  assert.notEqual(parseDraftBackup(raw, project.design.id)!.text, fileText);
});

test("服务端 revision 单独变化不让已保存草稿再变脏，非法 revision 仍保留为 dirty", () => {
  const next = { ...project, design: { ...design, revision: 1 }, fingerprint: "file-v2" };
  assert.equal(isDraftDirty(designText(design), next), false);
  assert.equal(serializeDraftBackup(designText(design), next), null);
  const { revision, ...withoutRevision } = design;
  assert.equal(revision, 0);
  assert.equal(isDraftDirty(JSON.stringify(withoutRevision), next), false);
  assert.equal(isDraftDirty(designText({ ...design, name: "保存期间的新内容" }), next), true);
  assert.equal(isDraftDirty(JSON.stringify({ ...design, revision: "invalid" }), project), true);
  assert.equal(isDraftDirty(JSON.stringify({ ...design, revision: -1 }), project), true);
});

test("冲突备份保留原基准，正式 saved 不需伪造成旧版本", () => {
  const raw = serializeDraftBackup(designText(design), project, "older-v0");
  assert.deepEqual(parseDraftBackup(raw, design.id), {
    id: design.id, fingerprint: "older-v0", text: designText(design),
  });
  assert.equal(project.fingerprint, "file-v1");
});

test("编辑会话 ID 在私网 HTTP 缺少 randomUUID 时仍可生成且相互独立", () => {
  const random = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };
  assert.equal("randomUUID" in random, false);
  const first = createDraftSessionId(random);
  const second = createDraftSessionId(random);
  assert.match(first, /^[0-9a-f]{32}$/);
  assert.notEqual(first, second);
});

test("编辑会话随备份往返保留，旧备份兼容且不接受无效会话", () => {
  const raw = serializeDraftBackup("{original-text", project, "old-file", "tab-a");
  assert.deepEqual(parseDraftBackup(raw, design.id), {
    id: design.id, fingerprint: "old-file", text: "{original-text", sessionId: "tab-a",
  });
  for (const sessionId of ["", null, 1, {}]) {
    assert.equal(parseDraftBackup(JSON.stringify({ id: design.id, fingerprint: "P0", text: "{}", sessionId }), design.id), null);
  }
});

test("导出以规范化有效设计区分已保存与草稿，忽略输入属性顺序及服务端 revision", () => {
  const reordered = DesignSchema.parse({ parts: [], units: "mm", name: design.name, id: design.id });
  const savedExport = captureProjectExport({ ...reordered, revision: 3 }, project);
  assert.equal(savedExport.draft, false);
  assert.equal(savedExport.filename, "workbench.json");
  assert.equal(savedExport.design, project.design);
  const draft = { ...design, name: "尚未保存的名称" };
  const next = captureProjectExport(draft, project);
  assert.equal(next.draft, true);
  assert.equal(next.filename, "workbench-draft.json");
  assert.deepEqual(next.design, draft);
  assert.equal(project.design.name, "工作台");
  assert.equal(project.fingerprint, "file-v1");
});

test("复制零件生成不重复身份且不改变原列表", () => {
  const ids = ["rail", "rail-1", "rail-2", "other"];
  assert.equal(nextPartId(ids, "rail"), "rail-3");
  assert.deepEqual(ids, ["rail", "rail-1", "rail-2", "other"]);
});

test("草稿撤销与重做栈支持多步回退、重做、新编辑清空重做分支及容量上限", () => {
  let history = emptyDraftHistory();
  history = pushDraftHistory(history, "v0", "v1");
  history = pushDraftHistory(history, "v1", "v1"); // 相同内容不重复入栈
  history = pushDraftHistory(history, "v1", "v2");
  assert.deepEqual(history, { past: ["v0", "v1"], future: [] });

  const undo1 = stepDraftUndo(history, "v2")!;
  assert.equal(undo1.text, "v1");
  assert.deepEqual(undo1.history, { past: ["v0"], future: ["v2"] });

  const undo2 = stepDraftUndo(undo1.history, undo1.text)!;
  assert.equal(undo2.text, "v0");
  assert.deepEqual(undo2.history, { past: [], future: ["v1", "v2"] });
  assert.equal(stepDraftUndo(undo2.history, undo2.text), null);

  const redo1 = stepDraftRedo(undo2.history, undo2.text)!;
  assert.equal(redo1.text, "v1");
  assert.deepEqual(redo1.history, { past: ["v0"], future: ["v2"] });

  // 在中间状态产生新修改时清空 future
  const branched = pushDraftHistory(redo1.history, redo1.text, "v3");
  assert.deepEqual(branched, { past: ["v0", "v1"], future: [] });
  assert.equal(stepDraftRedo(branched, "v3"), null);

  let bounded = emptyDraftHistory();
  for (let i = 0; i < 10; i++) bounded = pushDraftHistory(bounded, `s${i}`, `s${i + 1}`, 4);
  assert.equal(bounded.past.length, 4);
  assert.deepEqual(bounded.past, ["s6", "s7", "s8", "s9"]);
});

test("构件沿 X 与 Z 轴镜像保持几何对称，并转换语义化 ID", () => {
  const leftLeg = DesignSchema.parse({
    id: "desk", name: "桌", units: "mm",
    parts: [{
      id: "leg-left", kind: "beam", profile: "4040", role: "立柱",
      material: "铝", size: [40, 700, 40], position: [-500, 350, 200], rotation: [0, 15, -10],
    }],
  }).parts[0];

  const rightLeg = mirrorPart(leftLeg, ["leg-left"], "x");
  assert.equal(rightLeg.id, "leg-right");
  assert.deepEqual(rightLeg.position, [500, 350, 200]);

  // ID 已存在时自动追加序号
  const rightLeg2 = mirrorPart(leftLeg, ["leg-left", "leg-right"], "x");
  assert.equal(rightLeg2.id, "leg-right-1");

  const frontRail = { ...leftLeg, id: "rail-front", position: [0, 680, 280] as [number, number, number], rotation: [12, 20, 0] as [number, number, number] };
  const backRail = mirrorPart(frontRail, ["rail-front"], "z");
  assert.equal(backRail.id, "rail-back");
  assert.deepEqual(backRail.position, [0, 680, -280]);

  // 同一姿态可能存在多组等价欧拉角，核对实际渲染包围盒而不是角度字面值。
  for (const [source, mirrored, axis] of [[leftLeg, rightLeg, 0], [frontRail, backRail, 2]] as const) {
    const original = designBounds([source]);
    const reflected = designBounds([mirrored]);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(reflected.min[i] - (i === axis ? -original.max[i] : original.min[i])) < 1e-8);
      assert.ok(Math.abs(reflected.max[i] - (i === axis ? -original.min[i] : original.max[i])) < 1e-8);
    }
  }
});
