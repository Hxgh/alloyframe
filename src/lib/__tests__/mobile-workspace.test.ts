import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import {
  act, Children, createElement, Fragment, isValidElement, useCallback, useEffect, useLayoutEffect,
  useMemo, useRef, useState, useSyncExternalStore, type ReactNode,
} from "react";
import { getConsoleFunction, PerspectiveCamera, setConsoleFunction, type WebGLRenderer } from "three";
import ts from "typescript";
import designJson from "../../../data/designs/standing-desk.json";
import profilesJson from "../../../data/catalog/profiles.json";
import accessoriesJson from "../../../data/catalog/accessories.json";
import { createFullscreenController } from "../fullscreen";
import { AccessoryCatalogSchema, CatalogSchema, DesignSchema } from "../schema";

const design = DesignSchema.parse(designJson);
const catalog = CatalogSchema.parse(profilesJson);
const accessoryCatalog = AccessoryCatalogSchema.parse(accessoriesJson);
const sourceText = await readFile(new URL("../../components/Workspace.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../../app/globals.css", import.meta.url), "utf8");
const source = ts.createSourceFile("Workspace.tsx", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = source.statements.filter((node) =>
  ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(source) === "MOBILE_WORKSPACE_QUERY")
  || ts.isFunctionDeclaration(node) && ["subscribeMobileWorkspace", "getMobileWorkspaceSnapshot", "getServerMobileWorkspaceSnapshot", "Workspace"].includes(node.name?.text ?? ""),
);
assert.equal(declarations.length, 5);
const componentCode = ts.transpileModule(`${declarations.map((node) => node.getText(source).replace(/^export\s+/, "")).join("\n")}\nWorkspace`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "h", jsxFragmentFactory: "Fragment" },
}).outputText;
const require = createRequire(import.meta.url);
const fiberEntry = pathToFileURL(require.resolve("@react-three/fiber"));
const { createRoot } = await import(new URL("./react-three-fiber.esm.js", fiberEntry).href) as typeof import("@react-three/fiber");

type Props = Record<string, unknown> & { children?: ReactNode };
type MockElement = {
  focus: (options?: FocusOptions) => void;
  contains: (element: unknown) => boolean;
  querySelector: (query: string) => object | null;
  style: { setProperty: (name: string, value: string) => void; removeProperty: (name: string) => void };
  setPointerCapture: (pointerId: number) => void;
  hasPointerCapture: (pointerId: number) => boolean;
  releasePointerCapture: (pointerId: number) => void;
};

function childText(children: ReactNode): string {
  return Children.toArray(children).map((child) => typeof child === "string" || typeof child === "number" ? String(child)
    : isValidElement<{ children?: ReactNode }>(child) ? childText(child.props.children) : "").join("");
}

// 使用真实 Workspace hook 和事件，借助现有 R3F 测试渲染器替代 DOM；控件外壳为轻量替身。
async function harness(initialMobile: boolean) {
  const globalKeys = ["requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const previous = globalKeys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.assign(globalThis, { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, IS_REACT_ACT_ENVIRONMENT: true });
  const media = Object.assign(new EventTarget(), { matches: initialMobile });
  class TestHTMLElement {
    tagName = "INPUT";
    isContentEditable = false;
  }
  class TestHTMLInputElement extends TestHTMLElement { type = "text"; }
  class TestPointerEvent { constructor(public pointerType: string) {} }
  const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
  const document = Object.assign(new EventTarget(), {
    activeElement: null as unknown,
    fullscreenEnabled: true,
    fullscreenElement: null as unknown,
    overlay: false,
    querySelector: () => document.overlay ? {} : null,
    async exitFullscreen() { document.fullscreenElement = null; document.dispatchEvent(new Event("fullscreenchange")); },
  });
  const window = Object.assign(new EventTarget(), { matchMedia: () => media, visualViewport: viewport, innerHeight: 800 });
  const elements = new Map<string, Props>();
  const hosts = new Map<string, MockElement>();
  const styles = new Map<string, string>();
  let selectScene: ((id: string) => void) | undefined;
  let sceneMounts = 0;
  let editorMounts = 0;
  let projectMounts = 0;
  let pending = false;
  let activeTab = "parts";
  let onValueChange: ((value: string) => void) | undefined;
  const focusedTab = { focus: () => { document.activeElement = focusedTab; }, contains: () => false, querySelector: () => null, style: { setProperty() {}, removeProperty() {} } };
  const formField = {};
  const scene = Object.assign(new EventTarget(), {
    ownerDocument: document,
    async requestFullscreen() { document.fullscreenElement = scene; document.dispatchEvent(new Event("fullscreenchange")); },
  });
  const makeElement = (kind: string): MockElement => ({
    focus: () => { document.activeElement = kind; },
    contains: (element) => kind === "workspace-panel-content" && element === formField,
    querySelector: () => kind === "panel-toolbar" ? focusedTab : null,
    style: { setProperty: (name, value) => styles.set(name, value), removeProperty: (name) => { styles.delete(name); } },
    setPointerCapture: () => {},
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
  });
  const useRegistration = (key: string, props: Props) => {
    useLayoutEffect(() => { elements.set(key, props); return () => { if (elements.get(key) === props) elements.delete(key); }; }, [key, props]);
  };
  const Host = ({ host, ...props }: Props & { host: string }) => {
    const name = String(props.id ?? props["data-testid"] ?? props.className ?? host);
    const reference = useMemo(() => makeElement(name.includes("panel-toolbar") ? "panel-toolbar" : name), [name]);
    const ref = props.ref;
    useLayoutEffect(() => {
      if (typeof ref === "function") ref(host === "section" && name === "workspace-scene" ? scene : reference);
      else if (ref && typeof ref === "object") (ref as { current: unknown }).current = reference;
      return () => {
        if (typeof ref === "function") ref(null);
        else if (ref && typeof ref === "object") (ref as { current: unknown }).current = null;
      };
    }, [host, name, ref, reference]);
    useLayoutEffect(() => {
      elements.set(name, props);
      hosts.set(name, reference);
      return () => {
        if (elements.get(name) === props) elements.delete(name);
        if (hosts.get(name) === reference) hosts.delete(name);
      };
    }, [name, props, reference]);
    return createElement(Fragment, null, props.children);
  };
  const Tabs = (props: Props) => { activeTab = String(props.value); onValueChange = props.onValueChange as typeof onValueChange; return props.children; };
  const TabsTrigger = (props: Props) => { useRegistration(`tab:${props.value}`, props); return null; };
  const Button = (props: Props) => { useRegistration(`button:${props["aria-label"] ?? childText(props.children)}`, props); return props.children; };
  const Scene = (props: Props) => {
    useLayoutEffect(() => { sceneMounts += 1; }, []);
    useLayoutEffect(() => { selectScene = props.onSelect as typeof selectScene; }, [props.onSelect]);
    return null;
  };
  const PartEditor = () => {
    const [value, setValue] = useState("");
    useLayoutEffect(() => { editorMounts += 1; }, []);
    useRegistration("editor", { value, change: (next: string) => { setValue(next); pending = true; }, error: value === "无效" ? "尺寸错误" : "" });
    return null;
  };
  const ProjectPanel = () => {
    const [value, setValue] = useState("");
    useLayoutEffect(() => { projectMounts += 1; }, []);
    useRegistration("project-form", { value, change: (next: string) => { setValue(next); pending = true; } });
    return null;
  };
  const pass = ({ children }: Props) => children;
  const noop = () => null;
  function h(type: Parameters<typeof createElement>[0] | string, props: Props | null, ...children: ReactNode[]) {
    if (typeof type === "string") return createElement(Host, { ...props, host: type }, ...children);
    return createElement(type as React.ComponentType<Props>, props, ...children);
  }
  const bindings: Record<string, unknown> = {
    h, Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, window, document,
    HTMLElement: TestHTMLElement, HTMLInputElement: TestHTMLInputElement, PointerEvent: TestPointerEvent,
    useTheme: () => ({ resolvedTheme: "light" }), createFullscreenController, explodeOffsets: () => ({}),
    Scene, PartEditor, ProjectPanel, Tabs, TabsContent: pass, TabsList: pass, TabsTrigger, Button, PartsList: pass,
    BomPanel: noop, Header: noop, ProjectToolbar: noop, SceneToolbar: noop, ConfirmDialog: noop, PartDetails: noop,
    unappliedFieldsWarning: "未应用", nextPartId: () => "new", mirrorPart: () => ({}),
  };
  for (const icon of ["ChevronDown", "ChevronUp", "Copy", "FlipHorizontal2", "Pencil", "Plus", "Trash2", "X"]) bindings[icon] = noop;
  const Workspace = runInNewContext(componentCode, bindings) as (props: Props) => ReactNode;
  const project = {
    text: "", issues: [], invalid: false, dirty: false, pending: false, formEpoch: 0, readOnly: false,
    status: "", savedAt: "", saving: false, saveBlocked: false, autoSave: false, canSave: true,
    onPendingChange() {}, onAutoSaveChange() {}, onSave() {}, onBack() {}, onChange() {}, onJsonChange() {},
    onExport() {}, onCopy() {}, onArchive() {}, onDiscard() {}, onRefresh() {}, messages: null,
  };
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
    await act(async () => { root!.render(createElement(Workspace, { design, catalog, accessoryCatalog, project })); });
    const get = (key: string) => { const props = elements.get(key); assert.ok(props, `缺少 ${key}`); return props; };
    function renderServer() {
      const noOpStore = (_subscribe: unknown, _getSnapshot: unknown, getServerSnapshot: () => unknown) => getServerSnapshot();
      const ServerWorkspace = runInNewContext(componentCode, { ...bindings, window: undefined, document: undefined, useSyncExternalStore: noOpStore }) as (props: Props) => ReactNode;
      return renderToStaticMarkup(createElement(ServerWorkspace, { design, catalog, accessoryCatalog, project }));
    }
    return {
      get, styles, media, viewport, window, document, focusedTab, formField, renderServer,
      mounts: () => ({ scene: sceneMounts, editor: editorMounts, project: projectMounts }),
      pending: () => pending,
      open: () => !get("workspace-panel-content").hidden,
      active: () => activeTab,
      async clickTab(tab: string) {
        await act(async () => {
          (get(`tab:${tab}`).onClick as () => void)();
          if (tab !== activeTab) onValueChange?.(tab); // Base UI 对当前值不触发 onValueChange。
        });
      },
      async clickButton(label: string) { await act(async () => { (get(`button:${label}`).onClick as () => void)(); }); },
      async touch(type: "Start" | "Move" | "End" | "Cancel", touches: Array<{ identifier: number; clientX: number; clientY: number }>, changedTouches = touches) {
        const toolbar = [...elements.entries()].find(([key]) => key.startsWith("panel-toolbar "))?.[1];
        assert.ok(toolbar);
        let prevented = false;
        const event = { touches, changedTouches, cancelable: true, nativeEvent: { defaultPrevented: false }, preventDefault() { prevented = true; this.nativeEvent.defaultPrevented = true; } };
        await act(async () => { (toolbar[`onTouch${type}`] as (value: typeof event) => void)(event); });
        return prevented;
      },
      async panelClickCapture(detail: number, pointerType = "touch") {
        const toolbar = [...elements.entries()].find(([key]) => key.startsWith("panel-toolbar "))?.[1];
        assert.ok(toolbar);
        let prevented = false;
        const event = { detail, nativeEvent: new TestPointerEvent(pointerType), preventDefault() { prevented = true; }, stopPropagation() {} };
        await act(async () => { (toolbar.onClickCapture as (value: typeof event) => void)(event); });
        return prevented;
      },
      async edit(key: string, value: string) { await act(async () => { (get(key).change as (next: string) => void)(value); }); },
      async select(id: string) { await act(async () => { assert.ok(selectScene); selectScene(id); }); },
      async resize(mobile: boolean) { await act(async () => { media.matches = mobile; media.dispatchEvent(new Event("change")); }); },
      async escape() { const event = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape", isComposing: false }); await act(async () => { document.dispatchEvent(event); }); return event.defaultPrevented; },
      async fullscreen(active: boolean) { await act(async () => { if (active) await scene.requestFullscreen(); else await document.exitFullscreen(); }); },
      async keyboard(height: number, offsetTop = 0, scale = 1, textFocused = true) {
        await act(async () => {
          document.activeElement = textFocused ? new TestHTMLInputElement() : focusedTab;
          viewport.height = height; viewport.offsetTop = offsetTop; viewport.scale = scale;
          viewport.dispatchEvent(new Event("resize"));
        });
      },
      async dispose() {
        try { await act(async () => { root?.unmount(); }); }
        finally { globalKeys.forEach((key, index) => { const descriptor = previous[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }); }
      },
    };
  } catch (error) {
    if (root) await act(async () => { root?.unmount(); });
    globalKeys.forEach((key, index) => { const descriptor = previous[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
    throw error;
  }
}

test("底栏 Tab 和箭头按钮开合抽屉，未应用零件输入和错误不丢失", async () => {
  const ui = await harness(true);
  try {
    assert.equal(ui.open(), false);
    assert.equal(ui.get("tab:parts")["aria-expanded"], false);
    await ui.clickTab("parts");
    assert.equal(ui.open(), true);
    assert.equal(ui.active(), "parts");
    await ui.clickButton("添加零件");
    await ui.edit("editor", "无效");
    assert.equal(ui.get("editor").error, "尺寸错误");
    await ui.clickTab("parts");
    assert.equal(ui.open(), false);
    await ui.clickTab("parts");
    assert.equal(ui.open(), true);
    assert.equal(ui.get("editor").value, "无效");
    assert.equal(ui.get("editor").error, "尺寸错误");
    assert.equal(ui.pending(), true);
    await ui.clickTab("project");
    await ui.edit("project-form", "未应用项目名称");
    await ui.clickButton("收起面板");
    assert.equal(ui.open(), false);
    await ui.clickButton("展开面板");
    assert.equal(ui.open(), true);
    assert.equal(ui.active(), "project");
    assert.equal(ui.get("project-form").value, "未应用项目名称");
    assert.deepEqual(ui.mounts(), { scene: 1, editor: 1, project: 1 });
  } finally { await ui.dispose(); }
});

test("底栏无拖拽手柄节点，SSR 正常渲染且内容和画布独立", async () => {
  const ui = await harness(true);
  try {
    assert.doesNotThrow(() => ui.renderServer());
    assert.match(css, /\.workspace-main,\s*\.workspace-main\[data-panel-open="false"\]\s*\{\s*--control-height: 2\.75rem;\s*--control-icon-size: 2\.75rem;/);
    assert.match(css, /\[data-slot="scroll-area-viewport"\]\s*\{\s*overscroll-behavior: contain;\s*touch-action: pan-y;/);
    assert.doesNotMatch(css, /\.panel-drag-handle/);
  } finally { await ui.dispose(); }
});

test("手机底栏单指上下滑开合，轻点、横滑、多指与取消不会误触", async () => {
  const ui = await harness(true);
  const point = (x: number, y: number, identifier = 1) => ({ identifier, clientX: x, clientY: y });
  try {
    assert.equal(ui.open(), false);
    await ui.touch("Start", [point(100, 500)]);
    await ui.touch("Move", [point(102, 440)]);
    assert.equal(await ui.touch("End", [], [point(102, 440)]), true);
    assert.equal(ui.open(), true);
    assert.equal(await ui.panelClickCapture(1), true);
    assert.equal(ui.active(), "parts");

    await ui.clickButton("添加零件");
    await ui.edit("editor", "无效");
    await ui.touch("Start", [point(100, 100)]);
    await ui.touch("Move", [point(102, 160)]);
    await ui.touch("End", [], [point(102, 160)]);
    assert.equal(ui.open(), false);
    assert.equal(await ui.panelClickCapture(0), false, "键盘点击不被误拦截");
    assert.equal(await ui.panelClickCapture(1, "mouse"), false, "鼠标点击不被误拦截");
    assert.equal(await ui.panelClickCapture(1), true);
    await ui.clickButton("展开面板");
    assert.equal(ui.get("editor").value, "无效");
    assert.equal(ui.pending(), true);

    await ui.touch("Start", [point(0, 100)]);
    await ui.touch("End", [], [point(2, 102)]);
    assert.equal(await ui.panelClickCapture(1), false, "轻点不应被拦截");
    await ui.touch("Start", [point(0, 100)]);
    await ui.touch("Move", [point(80, 105)]);
    await ui.touch("End", [], [point(80, 105)]);
    assert.equal(ui.open(), true);
    assert.equal(await ui.panelClickCapture(1), true, "横滑不能误触标签");

    await ui.touch("Start", [point(0, 100)]);
    await ui.touch("Start", [point(0, 100), point(10, 100, 2)], [point(10, 100, 2)]);
    await ui.touch("Move", [point(0, 200), point(10, 200, 2)]);
    await ui.touch("End", [point(10, 200, 2)], [point(0, 200)]);
    await ui.touch("End", [], [point(10, 200, 2)]);
    assert.equal(ui.open(), true, "多指不能开合");
    assert.equal(await ui.panelClickCapture(1), true);
    await ui.touch("Start", [point(0, 100)]);
    await ui.touch("Cancel", [], [point(0, 200)]);
    assert.equal(ui.open(), true, "取消不能开合");

    await ui.touch("Start", [point(0, 100)]);
    const outsideTouch = Object.assign(new Event("touchstart"), { touches: [point(0, 100), point(10, 100, 2)] });
    ui.window.dispatchEvent(outsideTouch);
    await ui.touch("End", [point(10, 200, 2)], [point(0, 200)]);
    assert.equal(ui.open(), true, "第二指落在工具栏外也不能开合");
    assert.equal(await ui.panelClickCapture(1), true);
    await ui.touch("Start", [point(0, 100)]);
    await ui.touch("Move", [point(0, 40)]);
    await ui.touch("End", [], [point(0, 40)]);
    assert.equal(ui.open(), true, "新手势不受外部第二指残留影响");
    await ui.panelClickCapture(1);
    await ui.touch("Start", [point(0, 100)]);
    await ui.touch("Move", [point(0, 160)]);
    await ui.resize(false);
    await ui.touch("End", [], [point(0, 160)]);
    assert.equal(ui.open(), true, "中途切换桌面不能改变桌面面板状态");
    assert.equal(await ui.panelClickCapture(1), true);
  } finally { await ui.dispose(); }
});

test("手机默认收起、同一标签反复开合，未应用零件输入和错误不丢失", async () => {
  const ui = await harness(true);
  try {
    assert.equal(ui.open(), false);
    assert.equal(ui.get("tab:parts")["aria-expanded"], false);
    await ui.clickTab("parts");
    assert.equal(ui.open(), true);
    await ui.clickButton("添加零件");
    await ui.edit("editor", "无效");
    assert.equal(ui.get("editor").error, "尺寸错误");
    await ui.clickTab("parts");
    assert.equal(ui.open(), false);
    await ui.clickTab("parts");
    assert.equal(ui.open(), true);
    assert.equal(ui.get("editor").value, "无效");
    assert.equal(ui.get("editor").error, "尺寸错误");
    assert.equal(ui.pending(), true);
    assert.deepEqual(ui.mounts(), { scene: 1, editor: 1, project: 1 });
  } finally { await ui.dispose(); }
});

test("跨标签、收起和屏幕切换保留项目表单，桌面和手机展开状态独立", async () => {
  const ui = await harness(true);
  try {
    await ui.clickTab("project");
    await ui.edit("project-form", "未应用项目名称");
    await ui.clickTab("bom");
    await ui.clickTab("project");
    assert.equal(ui.get("project-form").value, "未应用项目名称");
    await ui.clickButton("收起面板");
    ui.document.activeElement = ui.formField;
    await ui.resize(false);
    assert.equal(ui.open(), true);
    await ui.clickButton("收起面板");
    assert.equal(ui.document.activeElement, ui.focusedTab);
    await ui.resize(true);
    assert.equal(ui.open(), false);
    await ui.clickTab("project");
    assert.equal(ui.get("project-form").value, "未应用项目名称");
    await ui.resize(false);
    assert.equal(ui.open(), false);
    await ui.resize(true);
    assert.equal(ui.open(), true);
    assert.equal(ui.get("project-form").value, "未应用项目名称");
    assert.deepEqual(ui.mounts(), { scene: 1, editor: 0, project: 1 });
  } finally { await ui.dispose(); }
});

test("Esc 优先交给弹窗和全屏；普通收起恢复焦点，画布选中打开零件", async () => {
  const ui = await harness(true);
  try {
    await ui.clickTab("project");
    ui.document.overlay = true;
    assert.equal(await ui.escape(), false);
    assert.equal(ui.open(), true);
    ui.document.overlay = false;
    ui.document.activeElement = ui.formField;
    assert.equal(await ui.escape(), true);
    assert.equal(ui.open(), false);
    assert.equal(ui.document.activeElement, ui.focusedTab);
    await ui.select(design.parts[0].id);
    assert.equal(ui.open(), true);
    assert.equal(ui.active(), "parts");
    await ui.clickTab("parts");
    await ui.fullscreen(true);
    await ui.select(design.parts[1].id);
    assert.equal(await ui.escape(), false);
    await ui.resize(false);
    await ui.resize(true);
    await ui.clickTab("parts");
    assert.equal(ui.open(), false);
    await ui.fullscreen(false);
    assert.equal(ui.open(), true);
    assert.equal(ui.active(), "parts");
    assert.equal(ui.mounts().scene, 1);
  } finally { await ui.dispose(); }
});

test("软键盘可见高度和移动覆盖布局有界，画布尺寸不随抽屉开合变化", async () => {
  const ui = await harness(true);
  try {
    await ui.clickTab("parts");
    await ui.keyboard(490, 10);
    assert.equal(ui.styles.get("--workspace-keyboard-offset"), "300px");
    await ui.keyboard(490, 10, 2);
    assert.equal(ui.styles.get("--workspace-keyboard-offset"), "0px", "浏览器缩放不视为软键盘");
    await ui.keyboard(490, 10, 1, false);
    assert.equal(ui.styles.get("--workspace-keyboard-offset"), "0px", "没有文本焦点时不缩小工作台");
    await ui.keyboard(490, 10);
    await ui.clickButton("收起面板");
    assert.equal(ui.styles.has("--workspace-keyboard-offset"), false, "收起抽屉后恢复画布高度");
    await ui.resize(false);
    assert.equal(ui.styles.has("--workspace-keyboard-offset"), false);
    assert.match(css, /@media \(max-width: 639px\), \(max-width: 1023px\) and \(max-height: 540px\) and \(orientation: landscape\)/);
    assert.match(css, /\.workspace-panel\s*\{\s*position: absolute;[\s\S]*?height: min\(80%, 100%\)/);
    assert.match(css, /\.workspace-scene\s*\{\s*width: 100%;\s*height: calc\(100% - var\(--workspace-panel-bar-height\)\)/);
    assert.doesNotMatch(css, /flex-direction: column-reverse/);
    assert.match(css, /\.panel-toolbar\s*\{\s*border-bottom: 1px solid var\(--border\)/);
    assert.match(css, /height: max\(0px, calc\(100dvh - var\(--workspace-keyboard-offset, 0px\)\)\)/);
  } finally { await ui.dispose(); }
});
