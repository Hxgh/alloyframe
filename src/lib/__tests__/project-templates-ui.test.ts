import assert from "node:assert/strict";
import type { PathLike } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { act, Children, createElement, Fragment, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Euler, getConsoleFunction, MathUtils, Matrix4, PerspectiveCamera, setConsoleFunction, Vector3, type WebGLRenderer } from "three";
import ts from "typescript";
import catalogJson from "../../../data/catalog/profiles.json";
import accessoriesJson from "../../../data/catalog/accessories.json";
import standingDeskJson from "../../../data/designs/standing-desk.json";
import workbenchI8Json from "../../../data/designs/workbench-i8.json";
import shelfI8Json from "../../../data/designs/shelf-i8.json";
import enclosureI8Json from "../../../data/designs/enclosure-i8.json";
import { POST } from "../../app/api/projects/route";
import { buildBom } from "../bom";
import { createProjectImportReader, ProjectRequestError } from "../project-client";
import { createProjectStore } from "../project-store";
import { buildTemplateDesign, PROJECT_TEMPLATE_REGISTRY, PROJECT_TEMPLATES, type ProjectTemplateId } from "../project-templates";
import { AccessoryCatalogSchema, CatalogSchema, DesignSchema, type Part } from "../schema";
import { designBounds } from "../tslot";
import { inspectDesign } from "../validation";

const catalog = CatalogSchema.parse(catalogJson);
const accessories = AccessoryCatalogSchema.parse(accessoriesJson);
const template = (id: ProjectTemplateId) => {
  const item = PROJECT_TEMPLATE_REGISTRY.find((entry) => entry.id === id);
  assert.ok(item);
  return item;
};
const part = (parts: Part[], id: string) => {
  const found = parts.find((item) => item.id === id);
  assert.ok(found, `缺少构件 ${id}`);
  return found;
};
const extents = (parts: Part[]) => {
  const { min, max } = designBounds(parts);
  return max.map((value, axis) => Math.round((value - min[axis]) * 1e6) / 1e6);
};

function restoreEnv(t: TestContext) {
  for (const key of ["ALLOYFRAME_DATA_DIR", "ALLOYFRAME_READ_ONLY", "ALLOYFRAME_TRUSTED_ORIGINS", "SUNMAO_DATA_DIR", "SUNMAO_READ_ONLY", "SUNMAO_TRUSTED_ORIGINS"]) {
    const previous = process.env[key];
    delete process.env[key];
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

async function fixture(t: TestContext) {
  restoreEnv(t);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "alloyframe-template-ui-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "designs"));
  await fs.mkdir(path.join(root, "archive"));
  await fs.mkdir(path.join(root, "catalog"));
  await fs.writeFile(path.join(root, "catalog/profiles.json"), JSON.stringify(catalogJson));
  await fs.writeFile(path.join(root, "catalog/accessories.json"), JSON.stringify(accessoriesJson));
  const active = path.join(root, "designs/existing.json");
  const archived = path.join(root, "archive/existing-archived.json");
  const original = JSON.stringify({ ...standingDeskJson, id: "existing" });
  const originalArchive = JSON.stringify({ ...standingDeskJson, id: "existing-archived" });
  await fs.writeFile(active, original);
  await fs.writeFile(archived, originalArchive);
  return { root, active, archived, original, originalArchive, store: createProjectStore({ root, catalog, accessories, writable: true }) };
}

test("可见与隐藏兼容模板均通过 schema、引用和几何检查，独立创建不改现有或归档项目", async (t) => {
  const { root, active, archived, original, originalArchive, store } = await fixture(t);
  assert.deepEqual(PROJECT_TEMPLATES.map(({ id }) => id), ["blank", "workbench-i8", "shelf-i8", "enclosure-i8"]);
  assert.deepEqual(PROJECT_TEMPLATE_REGISTRY.map(({ id }) => id), ["blank", "workbench-i8", "shelf-i8", "enclosure-i8", "frame-4040", "rack-2020", "standing-desk"]);
  const ids = new Set<string>();
  for (const item of PROJECT_TEMPLATE_REGISTRY) {
    const design = buildTemplateDesign(`名称-${item.id}`, item.id);
    assert.equal(DesignSchema.parse(design).name, `名称-${item.id}`);
    const result = inspectDesign(design, catalog, accessories);
    assert.ok(result.design, `${item.id}: ${JSON.stringify(result.issues)}`);
    if (item.id === "blank") {
      assert.equal(design.parts.length, 0);
      assert.deepEqual(result.issues.map(({ level, path }) => ({ level, path })), [{ level: "warning", path: "parts" }]);
    } else {
      assert.ok(design.parts.length > 0);
      assert.deepEqual(result.issues, [], item.id);
    }
    const created = await store.createProject(`名称-${item.id}`, item.id);
    assert.equal(created.design.name, design.name);
    assert.equal(created.design.revision, 0);
    assert.deepEqual(created.design.parts, design.parts);
    assert.ok(!ids.has(created.design.id));
    ids.add(created.design.id);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "designs", `${created.design.id}.json`), "utf8")), created.design);
  }
  assert.equal(await fs.readFile(active, "utf8"), original);
  assert.equal(await fs.readFile(archived, "utf8"), originalArchive);
});

test("创建遇到同名文件竞争时重试，不覆盖竞争文件或现有设计", async (t) => {
  const { active, original, store } = await fixture(t);
  const link = fs.link.bind(fs);
  let collision = "";
  t.mock.method(fs, "link", async (source: PathLike, destination: PathLike) => {
    if (!collision) {
      collision = String(destination);
      await fs.writeFile(collision, "其他写入者的内容", { flag: "wx" });
    }
    return link(source, destination);
  });
  const created = await store.createProject("竞争", "rack-2020");
  assert.ok(collision);
  assert.notEqual(path.basename(collision), `${created.design.id}.json`);
  assert.equal(await fs.readFile(collision, "utf8"), "其他写入者的内容");
  assert.equal(await fs.readFile(active, "utf8"), original);
  assert.deepEqual(await store.getProject(created.design.id), created);
});

test("未知模板在内部明确报错，API 返回 400，均不创建文件；省略 ID 仍为空白", async (t) => {
  const { root, store } = await fixture(t);
  assert.equal(buildTemplateDesign("空白").parts.length, 0);
  for (const invalid of ["unknown", "", null, "__proto__"]) {
    assert.throws(() => buildTemplateDesign("无效", invalid as ProjectTemplateId), /未知项目模板/);
    await assert.rejects(store.createProject("无效", invalid as ProjectTemplateId), /未知项目模板/);
  }
  assert.deepEqual(await fs.readdir(path.join(root, "designs")), ["existing.json"]);
  const before = await fs.readdir(path.join(root, "designs"));
  process.env.ALLOYFRAME_DATA_DIR = root;
  for (const invalid of ["unknown", "", null]) {
    const response = await POST(new Request("http://localhost:3000/api/projects", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ action: "create", name: "无效", templateId: invalid }),
    }));
    assert.equal(response.status, 400);
    assert.match(JSON.stringify(await response.json()), /templateId/);
  }
  assert.deepEqual(await fs.readdir(path.join(root, "designs")), before);
});

test("新旧模板 ID 均可通过创建 API，省略 ID 仍创建空白项目", async (t) => {
  const { root, active, original } = await fixture(t);
  process.env.ALLOYFRAME_DATA_DIR = root;
  for (const id of [...PROJECT_TEMPLATE_REGISTRY.map((item) => item.id), undefined]) {
    const response = await POST(new Request("http://localhost:3000/api/projects", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ action: "create", name: `API-${id ?? "default"}`, ...(id ? { templateId: id } : {}) }),
    }));
    assert.equal(response.status, 201, id);
    const body = await response.json();
    assert.deepEqual(body.design.parts, buildTemplateDesign(`API-${id ?? "default"}`, id).parts);
    assert.deepEqual(body.design.accessories, buildTemplateDesign(`API-${id ?? "default"}`, id).accessories);
  }
  assert.equal(await fs.readFile(active, "utf8"), original);
});

test("三份 I8 JSON 是模板几何与配件的唯一来源，每次构建互不共享可变数据", () => {
  for (const [id, source] of [["workbench-i8", workbenchI8Json], ["shelf-i8", shelfI8Json], ["enclosure-i8", enclosureI8Json]] as const) {
    const design = buildTemplateDesign(`副本-${id}`, id);
    assert.deepEqual(design, DesignSchema.parse({ ...source, id: "project", name: `副本-${id}` }));
    design.parts[0].size[0] += 10;
    design.accessories[0].instances![0].position[0] += 10;
    assert.deepEqual(buildTemplateDesign(`副本-${id}`, id), DesignSchema.parse({ ...source, id: "project", name: `副本-${id}` }));
    assert.equal(design.meta.loadRating, undefined);
    assert.match(design.meta.note ?? "", /motedis\.com/);
    assert.match(design.meta.note ?? "", /未经|未做/);
  }
});

test("I8 目录按套计价，连接族与板材螺钉/垫片规格明确且不替换旧 4040", () => {
  const profile = catalog.profiles.find(({ id }) => id === "4040-i8");
  assert.ok(profile);
  assert.equal(profile.connectionFamily, "i-slot-8");
  assert.equal(profile.slot.open, 8);
  assert.equal(profile.slot.depth, 12);
  assert.equal(profile.source, "estimate");
  assert.equal(catalog.profiles.find(({ id }) => id === "4040")!.slot.open, 6.2);
  for (const [id, mounting, quantities] of [["bracket-i8-kit", "profile-profile", [1, 2, 2]], ["panel-i8-kit", "profile-panel", [1, 1, 1, 1, 1]]] as const) {
    const item = accessories.accessories.find((entry) => entry.id === id);
    assert.ok(item);
    assert.equal(item.connectionFamily, "i-slot-8");
    assert.equal(item.mounting, mounting);
    assert.deepEqual(item.fitsSlot, ["4040-i8"]);
    assert.equal(item.unit, "套");
    assert.deepEqual(item.components?.map(({ qty }) => qty), quantities);
    assert.deepEqual(item.visual, { kind: "angle-bracket", size: [36, 36, 30], thickness: 4, holeDiameter: 9 });
    assert.equal(item.sourceUrl, "https://www.motedis.com/en/Bracket-40-I-Type-slot-8");
    assert.match(item.note ?? "", /示意/);
  }
  const panel = accessories.accessories.find(({ id }) => id === "panel-i8-kit")!;
  assert.match(panel.components?.find(({ name }) => name === "盘头木螺钉")?.spec ?? "", /3\.5×10mm/);
  assert.match(panel.note ?? "", /入木深度不得超过板厚/);
  assert.match(panel.note ?? "", /大孔必须配大垫片/);
});

test("I8 三例外廓、下料、板位与全部角码安装面姿态符合合同，BOM 不重复计套内零件", () => {
  const cases = [
    { id: "workbench-i8", dimensions: [800, 750, 600], cuts: [725, 720, 520], levels: [705, 200], plates: [[800, 25, 600]], bottoms: [725], panelQty: 4, fixX: 160 },
    { id: "shelf-i8", dimensions: [600, 900, 400], cuts: [900, 520, 320], levels: [760, 120], plates: [[520, 15, 400], [520, 15, 400]], bottoms: [780, 140], panelQty: 8, fixX: 130 },
    { id: "enclosure-i8", dimensions: [600, 600, 500], cuts: [600, 520, 420], levels: [580, 80], plates: [], bottoms: [], panelQty: 0, fixX: 0 },
  ] as const;
  const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
  for (const item of cases) {
    const design = buildTemplateDesign(item.id, item.id);
    const [width, height, depth] = item.dimensions;
    assert.deepEqual(extents(design.parts), item.dimensions);
    assert.equal(design.meta.frameHeight, height);
    const beams = design.parts.filter(({ kind }) => kind === "beam");
    assert.equal(beams.length, 12);
    assert.ok(beams.every(({ profile, note }) => profile === "4040-i8" && / = /.test(note ?? "")));
    const posts = beams.filter(({ role }) => role === "立柱");
    assert.equal(posts.length, 4);
    for (const post of posts) {
      assert.deepEqual(post.size, [40, item.cuts[0], 40]);
      assert.equal(Math.abs(post.position[0]), width / 2 - 20);
      assert.equal(Math.abs(post.position[2]), depth / 2 - 20);
      assert.equal(post.position[1], item.cuts[0] / 2);
    }
    assert.equal(beams.filter(({ size }) => size[0] === item.cuts[1] && size[1] === 40 && size[2] === 40).length, 4);
    assert.equal(beams.filter(({ size }) => size[0] === 40 && size[1] === 40 && size[2] === item.cuts[2]).length, 4);
    assert.deepEqual([...new Set(beams.filter(({ role }) => role !== "立柱").map(({ position }) => position[1]))], item.levels);
    const plates = design.parts.filter(({ kind }) => kind === "plate");
    assert.deepEqual(plates.map(({ size }) => size), item.plates);
    assert.deepEqual(plates.map((plate) => designBounds([plate]).min[1]), item.bottoms);
    const structure = design.accessories.find(({ ref }) => ref === "bracket-i8-kit")!;
    assert.equal(structure.qty, 16);
    assert.equal(structure.instances?.length, 16);
    const endpointCounts = new Map<string, number>();
    const instanceIds = new Set<string>();
    for (const entry of design.accessories) {
      assert.equal(entry.qty, entry.instances?.length);
      for (const instance of entry.instances!) {
        assert.ok(!instanceIds.has(instance.id));
        instanceIds.add(instance.id);
        assert.deepEqual(Object.keys(instance).sort(), ["id", "position", "rotation", "anchorPartId", "partIds", "note"].sort());
        const [xFace, yFace] = instance.partIds.map((id) => part(design.parts, id));
        assert.equal(instance.anchorPartId, xFace.id);
        let u: Vector3;
        if (entry.ref === "bracket-i8-kit") {
          assert.equal(xFace.role, "立柱");
          assert.equal(yFace.kind, "beam");
          endpointCounts.set(yFace.id, (endpointCounts.get(yFace.id) ?? 0) + 1);
          u = new Vector3(yFace.position[0] - xFace.position[0], 0, yFace.position[2] - xFace.position[2]).normalize();
          const expected = [xFace.position[0] + u.x * 20, designBounds([yFace]).min[1], xFace.position[2] + u.z * 20];
          instance.position.forEach((value, axis) => close(value, expected[axis]));
        } else {
          assert.equal(xFace.kind, "beam");
          assert.equal(yFace.kind, "plate");
          assert.equal(Math.abs(instance.position[0]), item.fixX);
          close(instance.position[1], designBounds([yFace]).min[1]);
          close(instance.position[2], Math.sign(xFace.position[2]) * (depth / 2 - 40));
          u = new Vector3(0, 0, -Math.sign(xFace.position[2]));
        }
        const v = new Vector3(0, -1, 0);
        const expectedRotation = new Matrix4().makeBasis(u, v, new Vector3().crossVectors(u, v));
        const actualRotation = new Matrix4().makeRotationFromEuler(new Euler(...instance.rotation.map(MathUtils.degToRad) as [number, number, number], "XYZ"));
        actualRotation.elements.forEach((value, index) => close(value, expectedRotation.elements[index]));
      }
    }
    assert.equal(endpointCounts.size, 8);
    assert.ok([...endpointCounts.values()].every((count) => count === 2));
    assert.equal(design.accessories.find(({ ref }) => ref === "panel-i8-kit")?.qty ?? 0, item.panelQty);
    const lines = buildBom(design, catalog, accessories).lines.filter(({ category }) => category === "配件");
    assert.deepEqual(lines.map(({ key, qty }) => ({ key, qty })), [{ key: "acc|bracket-i8-kit", qty: 16 }, ...(item.panelQty ? [{ key: "acc|panel-i8-kit", qty: item.panelQty }] : [])]);
    if (item.id === "enclosure-i8") {
      assert.match(design.meta.note ?? "", /仅开放骨架/);
      assert.match(design.meta.note ?? "", /不是防护罩/);
    }
  }
});

test("4040 明确区分台面尺寸与包含脚杯的实际装配包围", () => {
  const design = buildTemplateDesign("4040", "frame-4040");
  assert.deepEqual(part(design.parts, "desktop").size, [800, 25, 600]);
  assert.deepEqual(extents(design.parts), [820, 750, 620]);
  assert.equal(design.parts.filter(({ role }) => role === "脚杯").length, 4);
  assert.match(template("frame-4040").summary, /台面 800×600mm/);
  assert.match(template("frame-4040").summary, /820×620×750mm/);
  assert.match(design.meta.description, /820 × 620 × 750mm/);
  assert.match(design.meta.note ?? "", /外延 10mm/);
});

test("2020 两层板为实际板材，每块由两根接触框架的梁支撑且计入材料清单", () => {
  const design = buildTemplateDesign("2020", "rack-2020");
  assert.deepEqual(extents(design.parts), [500, 600, 500]);
  assert.match(template("rack-2020").summary, /两块层板/);
  assert.match(design.meta.note ?? "", /另选连接件/);
  assert.equal(design.accessories.length, 0, "目录没有 2020 配件，不应冒充已配置");
  const plates = design.parts.filter(({ kind }) => kind === "plate");
  assert.deepEqual(plates.map(({ id }) => id).sort(), ["bottom-shelf", "top-shelf"]);
  const bom = buildBom(design, catalog, accessories);
  assert.equal(bom.lines.filter(({ category }) => category === "板材").reduce((sum, line) => sum + line.qty, 0), 2);
  for (const level of ["top", "bottom"] as const) {
    const plate = part(design.parts, `${level}-shelf`);
    const plateBounds = designBounds([plate]);
    assert.deepEqual(plate.size, [460, 15, 460]);
    for (const side of ["front", "back"]) {
      const support = part(design.parts, `${level}-shelf-support-${side}`);
      const supportBounds = designBounds([support]);
      assert.equal(support.profile, "2020");
      assert.equal(supportBounds.max[1], plateBounds.min[1], `${support.id} 顶面须接触层板底面`);
      assert.ok(supportBounds.max[2] > plateBounds.min[2] && supportBounds.min[2] < plateBounds.max[2]);
      for (const end of ["left", "right"]) {
        const rail = designBounds([part(design.parts, `${level}-${end}`)]);
        const overlap = [0, 1, 2].map((axis) => Math.min(supportBounds.max[axis], rail.max[axis]) - Math.max(supportBounds.min[axis], rail.min[axis]));
        assert.equal(overlap.filter((value) => Math.abs(value) < 1e-7).length, 1, `${support.id} 应接触 ${level}-${end}`);
        assert.equal(overlap.filter((value) => value > 0).length, 2);
      }
    }
  }
});

test("升降桌保留原设计几何，实际 6mm 间隙及未验证状态清晰可见", () => {
  const design = buildTemplateDesign("升降桌副本", "standing-desk");
  const original = DesignSchema.parse(standingDeskJson);
  const geometry = (parts: Part[]) => parts.map((item) => ({ ...item, note: undefined }));
  assert.deepEqual(geometry(design.parts), geometry(original.parts));
  assert.deepEqual(extents(design.parts), [1400, 720, 700]);
  const crossbar = designBounds([part(design.parts, "crossbar")]);
  const left = designBounds([part(design.parts, "column-left-inner")]);
  const right = designBounds([part(design.parts, "column-right-inner")]);
  assert.equal(crossbar.min[0] - left.max[0], 6);
  assert.equal(right.min[0] - crossbar.max[0], 6);
  for (const text of [template("standing-desk").summary, design.meta.note ?? "", part(design.parts, "crossbar").note ?? ""]) {
    assert.match(text, /6mm/);
    assert.match(text, /待设计/);
  }
  assert.match(design.meta.note ?? "", /未经验证/);
  assert.match(design.meta.description, /已有升降桌设计副本/);
});

// 不启动浏览器：沿用项目中 AST + 真实 React/R3F root 的测试方式，
// 只用替身代替 DOM 外壳、Select 和网络，事件处理器与状态来自 ProjectLibrary 原组件。
const require = createRequire(import.meta.url);
const fiberEntry = pathToFileURL(require.resolve("@react-three/fiber"));
const { createRoot } = await import(new URL("./react-three-fiber.esm.js", fiberEntry).href) as typeof import("@react-three/fiber");
const text = await fs.readFile(new URL("../../components/project/ProjectLibrary.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("ProjectLibrary.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "ProjectLibrary");
assert.ok(declaration);
const componentCode = ts.transpileModule(`${declaration.getText(source).replace(/^export\s+/, "")}\nProjectLibrary`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "h", jsxFragmentFactory: "Fragment" },
}).outputText;

function childText(children: ReactNode): string {
  return Children.toArray(children).map((child) => typeof child === "string" || typeof child === "number" ? String(child)
    : isValidElement<{ children?: ReactNode }>(child) ? childText(child.props.children) : "").join("");
}

async function uiHarness(options: { skipInitialRefresh?: boolean } = {}) {
  const globals = ["requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const previous = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.assign(globalThis, { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, IS_REACT_ACT_ENVIRONMENT: true });
  const buttons = new Map<string, Set<() => void>>();
  const buttonEnabled = new Map<string, boolean>();
  const paragraphs = new Set<string>();
  const requests: Array<{ url: string; body: string }> = [];
  let input: { value: string; onChange: (event: { target: { value: string } }) => void } | undefined;
  let select: { value: string; onValueChange: (value: string | null) => void } | undefined;
  let submit: ((event: { preventDefault: () => void }) => Promise<void>) | undefined;
  let timer: (() => void) | undefined;
  let focus: (() => void) | undefined;
  let getError: Error | undefined;
  let writeError: Error | undefined;
  let getWritable = true;
  const win = {
    setTimeout: (callback: () => void) => { timer = callback; return 1; }, clearTimeout: () => { timer = undefined; },
    addEventListener: (name: string, callback: () => void) => { if (name === "focus") focus = callback; },
    removeEventListener: () => { focus = undefined; },
  };
  const Button = (props: { children?: ReactNode; onClick?: () => void; disabled?: boolean }) => {
    const label = childText(props.children);
    useLayoutEffect(() => {
      buttonEnabled.set(label, !props.disabled);
      const action = props.onClick;
      if (action && !props.disabled) {
        const actions = buttons.get(label) ?? new Set<() => void>();
        actions.add(action);
        buttons.set(label, actions);
      }
      return () => {
        if (action) buttons.get(label)?.delete(action);
        if (buttons.get(label)?.size === 0) buttons.delete(label);
        buttonEnabled.delete(label);
      };
    }, [label, props.onClick, props.disabled]);
    return props.children;
  };
  const Input = (props: { value: string; onChange: (event: { target: { value: string } }) => void; "aria-label"?: string }) => {
    useLayoutEffect(() => {
      if (props["aria-label"]) return;
      input = props;
      return () => { input = undefined; };
    }, [props]);
    return null;
  };
  const Select = (props: { value: string; onValueChange: (value: string | null) => void; children?: ReactNode }) => {
    useLayoutEffect(() => { select = props; return () => { select = undefined; }; }, [props]);
    return props.children;
  };
  const Form = (props: { onSubmit: (event: { preventDefault: () => void }) => Promise<void>; children?: ReactNode }) => {
    useLayoutEffect(() => { submit = props.onSubmit; return () => { submit = undefined; }; }, [props]);
    return props.children;
  };
  const Paragraph = ({ children }: { children?: ReactNode }) => {
    const value = childText(children);
    useLayoutEffect(() => { paragraphs.add(value); return () => { paragraphs.delete(value); }; }, [value]);
    return null;
  };
  const pass = ({ children }: { children?: ReactNode }) => children;
  const noop = () => null;
  function h(type: Parameters<typeof createElement>[0] | string, props: Record<string, unknown> | null, ...children: ReactNode[]) {
    if (type === "form") return createElement(Form, props as Parameters<typeof Form>[0], ...children);
    if (type === "p") return createElement(Paragraph, props, ...children);
    if (typeof type === "string") return createElement(Fragment, props?.key == null ? null : { key: String(props.key) }, ...children.map((child) => typeof child === "string" || typeof child === "number" ? null : child));
    return createElement(type, props, ...children);
  }
  const bindings: Record<string, unknown> = {
    h, Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, window: win, PROJECT_TEMPLATES,
    dateFormat: new Intl.DateTimeFormat("zh-CN"), createProjectImportReader, ProjectRequestError,
    projectRequest: async (url: string, options?: RequestInit) => {
      if (!options) {
        if (getError) throw getError;
        return { projects: [], archived: [], writable: getWritable };
      }
      requests.push({ url, body: String(options.body) });
      if (writeError) throw writeError;
      return { design: { id: "new-project" } };
    },
    useRouter: () => ({ push() {} }), Button, Input, Select,
    SelectContent: pass, SelectItem: pass, SelectTrigger: pass, SelectValue: noop,
    Link: pass, Textarea: noop, ThemeSelect: noop, ConfirmDialog: noop,
    Dialog: (props: { open?: boolean; children?: ReactNode }) => (props.open ? props.children : null),
    DialogContent: pass, DialogDescription: pass, DialogTitle: pass, IconButton: pass,
  };
  for (const icon of ["Archive", "ArrowUpRight", "Copy", "FileJson", "FolderOpen", "Plus", "RotateCcw", "X"]) bindings[icon] = noop;
  const ProjectLibrary = runInNewContext(componentCode, bindings) as (props: { initial: { projects: []; archived: []; writable: boolean } }) => ReactNode;
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
    await act(async () => { root!.render(createElement(ProjectLibrary, { initial: { projects: [], archived: [], writable: true } })); });
    if (!options.skipInitialRefresh) await act(async () => { timer?.(); await Promise.resolve(); });
    return {
      requests,
      name: () => { assert.ok(input); return input.value; },
      selected: () => { assert.ok(select); return select.value; },
      hasText: (value: string) => paragraphs.has(value),
      hasTextMatching: (value: RegExp) => [...paragraphs].some((paragraph) => value.test(paragraph)),
      canClick: (label: string) => buttonEnabled.get(label) === true,
      setGetError: (value?: Error) => { getError = value; },
      setWriteError: (value?: Error) => { writeError = value; },
      setGetWritable: (value: boolean) => { getWritable = value; },
      async startRefresh() { await act(async () => { timer?.(); await Promise.resolve(); }); },
      async focus() { await act(async () => { focus?.(); await Promise.resolve(); }); },
      buttonCount: (label: string) => buttons.get(label)?.size ?? 0,
      async click(label: string, index = 0) { const action = [...(buttons.get(label) ?? [])][index]; assert.ok(action, `找不到可用按钮 ${label}[${index}]`); await act(async () => { action(); }); },
      async changeName(value: string) { const field = input; assert.ok(field); await act(async () => { field.onChange({ target: { value } }); }); },
      async choose(value: string | null) { const field = select; assert.ok(field); await act(async () => { field.onValueChange(value); }); },
      async submit() { const action = submit; assert.ok(action); await act(async () => { await action({ preventDefault() {} }); }); },
      async dispose() {
        try { await act(async () => { root?.unmount(); }); }
        finally { globals.forEach((key, index) => { const descriptor = previous[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }); }
      },
    };
  } catch (error) {
    if (root) await act(async () => { root?.unmount(); });
    globals.forEach((key, index) => { const descriptor = previous[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
    throw error;
  }
}

test("项目库区分确认中、首次检查失败和真实不可写，失败后可重新检查", async () => {
  const ui = await uiHarness({ skipInitialRefresh: true });
  try {
    assert.ok(ui.hasTextMatching(/正在检查写入权限/));
    assert.equal(ui.canClick("新建项目"), false);
    ui.setGetError(new ProjectRequestError("网络故障", 0));
    await ui.startRefresh();
    assert.ok(ui.hasTextMatching(/项目库检查失败：网络故障/));
    assert.equal(ui.hasTextMatching(/只读/), false);
    assert.equal(ui.canClick("新建项目"), false);
    ui.setGetError();
    ui.setGetWritable(false);
    await ui.focus();
    assert.ok(ui.hasTextMatching(/当前无法写入，可查看项目/));
    assert.equal(ui.hasTextMatching(/检查失败/), false);
    assert.equal(ui.canClick("新建项目"), false);
    ui.setGetWritable(true);
    await ui.focus();
    assert.equal(ui.hasTextMatching(/当前无法写入/), false);
    assert.equal(ui.canClick("新建项目"), true);
  } finally { await ui.dispose(); }
});

test("项目库 403、检查失败和表单同时保留，实际可用的写入操作仍以服务端决定", async () => {
  const ui = await uiHarness();
  try {
    await ui.click("新建项目");
    await ui.changeName("保留的输入");
    ui.setWriteError(new ProjectRequestError("来源不允许写入", 403));
    await ui.submit();
    assert.equal(ui.name(), "保留的输入");
    assert.ok(ui.hasTextMatching(/上次写入被拒绝，请检查服务权限/));
    assert.equal(ui.canClick("创建"), true);
    ui.setGetError(new ProjectRequestError("检查断线", 0));
    await ui.focus();
    assert.ok(ui.hasTextMatching(/上次写入被拒绝/));
    assert.ok(ui.hasTextMatching(/项目库检查失败：检查断线/));
    assert.ok(ui.hasTextMatching(/来源不允许写入/));
    assert.equal(ui.name(), "保留的输入");
    assert.equal(ui.canClick("创建"), true);
    ui.setGetError();
    ui.setGetWritable(false);
    await ui.focus();
    assert.ok(ui.hasTextMatching(/当前无法写入/));
    assert.ok(ui.hasTextMatching(/上次写入被拒绝/));
    assert.equal(ui.canClick("创建"), false);
    assert.equal(ui.name(), "保留的输入");
  } finally { await ui.dispose(); }
});

test("三张典型示例卡片分别打开对应模板的新建表单，不立即写入项目", async () => {
  const examples = PROJECT_TEMPLATES.filter(({ id }) => id !== "blank");
  for (const [index, example] of examples.entries()) {
    const ui = await uiHarness();
    try {
      assert.equal(ui.buttonCount("以此示例新建"), 3);
      assert.ok(ui.hasText(example.summary));
      await ui.click("以此示例新建", index);
      assert.equal(ui.selected(), example.id);
      assert.equal(ui.name(), example.label);
      assert.equal(ui.requests.length, 0);
      await ui.submit();
      assert.deepEqual(JSON.parse(ui.requests[0].body), { action: "create", name: example.label, templateId: example.id });
    } finally { await ui.dispose(); }
  }
});

test("真实表单随模板更新自动名称和说明，回到空白清空自动名并正确提交", async () => {
  const ui = await uiHarness();
  try {
    await ui.click("新建项目");
    assert.equal(ui.name(), "");
    for (const id of ["workbench-i8", "shelf-i8", "enclosure-i8"] as const) {
      await ui.choose(id);
      assert.equal(ui.selected(), id);
      assert.equal(ui.name(), template(id).label);
      assert.ok(ui.hasText(template(id).summary));
    }
    await ui.choose("blank");
    assert.equal(ui.name(), "");
    assert.ok(ui.hasText(template("blank").summary));
    await ui.choose("shelf-i8");
    await ui.submit();
    assert.equal(ui.requests[0].url, "/api/projects");
    assert.deepEqual(JSON.parse(ui.requests[0].body), { action: "create", name: template("shelf-i8").label, templateId: "shelf-i8" });
  } finally { await ui.dispose(); }
});

test("真实表单保留手动名称、空白与恰好等于模板名的手动输入；重新打开恢复自动命名", async () => {
  const ui = await uiHarness();
  try {
    await ui.click("新建项目");
    await ui.changeName("先输入的名称");
    await ui.choose("workbench-i8");
    assert.equal(ui.name(), "先输入的名称");
    await ui.changeName("用户自定义");
    await ui.choose("shelf-i8");
    assert.equal(ui.name(), "用户自定义");
    await ui.choose("blank");
    assert.equal(ui.name(), "用户自定义");
    await ui.changeName(template("workbench-i8").label);
    await ui.choose("enclosure-i8");
    assert.equal(ui.name(), template("workbench-i8").label);
    await ui.changeName("");
    await ui.choose("shelf-i8");
    assert.equal(ui.name(), "", "用户主动清空后不应重新自动填充");
    await ui.changeName("  ");
    await ui.choose("workbench-i8");
    assert.equal(ui.name(), "  ", "用户输入的空格也不应被自动名称替换");
    await ui.click("取消");
    await ui.click("新建项目");
    await ui.choose("enclosure-i8");
    assert.equal(ui.name(), template("enclosure-i8").label);
    await ui.changeName("保留这个名称");
    await ui.submit();
    assert.deepEqual(JSON.parse(ui.requests[0].body), { action: "create", name: "保留这个名称", templateId: "enclosure-i8" });
  } finally { await ui.dispose(); }
});

test("真实选择器收到未知 ID 显示错误，不悄悄切成空白或修改名称", async () => {
  const ui = await uiHarness();
  try {
    await ui.click("新建项目");
    await ui.choose("shelf-i8");
    for (const id of ["unknown", "frame-4040", "rack-2020", "standing-desk"]) {
      await ui.choose(id);
      assert.equal(ui.selected(), "shelf-i8");
      assert.equal(ui.name(), template("shelf-i8").label);
      assert.ok(ui.hasText(`未知项目模板: ${id}`));
    }
    await ui.choose(null);
    assert.equal(ui.selected(), "shelf-i8");
    await ui.submit();
    assert.deepEqual(JSON.parse(ui.requests[0].body), { action: "create", name: template("shelf-i8").label, templateId: "shelf-i8" });
  } finally { await ui.dispose(); }
});
