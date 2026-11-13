import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import {
  act, createElement, Fragment, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo,
  useRef, useState, useSyncExternalStore, type ComponentRef, type ReactNode,
} from "react";
import type { RootStore } from "@react-three/fiber";
import type { OrbitControls as ControlsComponent } from "@react-three/drei";
import { Clock, getConsoleFunction, PCFShadowMap, PerspectiveCamera, Scene as ThreeScene, setConsoleFunction, Vector3, type WebGLRenderer } from "three";
import ts from "typescript";
import designJson from "../../../data/designs/standing-desk.json";
import { DesignSchema, type Design } from "../schema";
import { designBounds } from "../tslot";
import { explodeOffsets } from "../explode";
import { createFullscreenController } from "../fullscreen";
import { createTapGesture, isSelectionClick } from "../tap-gesture";
import { sceneControls } from "../scene-controls";
import { buildDimensionGuides } from "../scene-dimensions";
import {
  applyViewFrame, boundsWithGuides, cameraBounds, combineBounds, fitDistance, frameRequest, frameView, visibleBoundsDistance,
  type SceneBounds, type ViewAction,
} from "../scene-fit";

type Controls = ComponentRef<typeof ControlsComponent>;
type Click = () => void;

// Node 会选用 R3F 的 CJS 入口；显式加载其 ESM 构建，让 R3F 与相机共用同一个 three。
const require = createRequire(import.meta.url);
const fiberEntry = pathToFileURL(require.resolve("@react-three/fiber"));
const fiberModule = new URL("./react-three-fiber.esm.js", fiberEntry).href;
const { createRoot, useThree } = await import(fiberModule) as typeof import("@react-three/fiber");

// drei 的 ESM 源码会按包主入口重新加载 CJS 版 R3F。保留真实组件源码和依赖，
// 仅将四个裸导入改为同一 ESM R3F 与从 drei 位置解析的依赖 URL。
const dreiEntry = pathToFileURL(require.resolve("@react-three/drei"));
const dreiRequire = createRequire(dreiEntry);
const stdlibPackage = new URL("./package.json", pathToFileURL(dreiRequire.resolve("three-stdlib")));
const stdlib = JSON.parse(await readFile(stdlibPackage, "utf8")) as { exports: { import: string } };
const imports: Record<string, string> = {
  "@react-three/fiber": fiberModule,
  "three-stdlib": new URL(stdlib.exports.import, stdlibPackage).href,
  react: pathToFileURL(dreiRequire.resolve("react")).href,
  "@babel/runtime/helpers/esm/extends": pathToFileURL(dreiRequire.resolve("@babel/runtime/helpers/esm/extends")).href,
};
const orbitSource = await readFile(new URL("./core/OrbitControls.js", dreiEntry), "utf8");
const orbitModule = ts.createSourceFile("OrbitControls.js", orbitSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const replacements = orbitModule.statements.flatMap((statement) => {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
  const specifier = statement.moduleSpecifier.text;
  assert.ok(imports[specifier], `OrbitControls 出现未知依赖: ${specifier}`);
  return [{ start: statement.moduleSpecifier.getStart(orbitModule), end: statement.moduleSpecifier.end, url: imports[specifier] }];
});
assert.deepEqual(replacements.map(({ url }) => url).sort(), Object.values(imports).sort());
const orbitCode = replacements.sort((a, b) => b.start - a.start).reduce(
  (text, { start, end, url }) => text.slice(0, start) + JSON.stringify(url) + text.slice(end), orbitSource,
);
const { OrbitControls: OrbitControlsComponent } = await import(`data:text/javascript;base64,${Buffer.from(orbitCode).toString("base64")}`) as {
  OrbitControls: typeof ControlsComponent;
};

// R3F 9.8 的 createStore 构造 Clock；仅在 createRoot 同步执行期间截获这条已知弃用提示。
function createTestRoot(surface: ControlSurface) {
  const previous = getConsoleFunction();
  const stacks: string[] = [];
  setConsoleFunction((type, message, ...params) => {
    if (type === "warn" && message === "THREE.Clock: This module has been deprecated. Please use THREE.Timer instead." && params.length === 0) {
      const stack = new Error().stack ?? "";
      if (stack.includes("/three/build/three.core.js") && stack.includes("/fiber/dist/events-") && stack.includes("createRoot")) {
        stacks.push(stack);
        return;
      }
    }
    if (previous) previous(type, message, ...params);
    else console[type](message, ...params);
  });
  try {
    const root = createRoot(surface as unknown as HTMLCanvasElement);
    if (stacks.length !== 1) {
      root.unmount();
      assert.equal(stacks.length, 1, "每个 R3F root 应产生一次已确认来源的 Clock 弃用提示");
    }
    return root;
  } finally {
    // three 的类型声明未标记 null，但运行时以 null 表示恢复默认日志。
    setConsoleFunction(previous ?? (null as unknown as typeof previous));
  }
}

class ControlSurface extends EventTarget {
  clientWidth = 800;
  clientHeight = 600;
  style = { touchAction: "auto" };
  ownerDocument = new EventTarget();
  releasePointerCapture() {}
}

// 浏览器 RAF 队列由测试驱动，既能检查主动重绘，也能确保卸载时不残留任务。
function animationClock() {
  let id = 0;
  const pending = new Map<number, FrameRequestCallback>();
  return {
    request: (callback: FrameRequestCallback) => { pending.set(++id, callback); return id; },
    cancel: (handle: number) => { pending.delete(handle); },
    flush() {
      for (let turn = 0; pending.size; turn++) {
        assert.ok(turn < 100, "RAF 未能停止");
        for (const handle of [...pending.keys()]) {
          const callback = pending.get(handle);
          if (callback) { pending.delete(handle); callback((turn + 1) * 16); }
        }
      }
    },
    clear: () => pending.clear(),
    size: () => pending.size,
  };
}

async function source(path: string) {
  const text = await readFile(new URL(path, import.meta.url), "utf8");
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function declaration(file: ts.SourceFile, name: string) {
  const node = file.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `未找到生产函数 ${name}`);
  return node.getText(file).replace(/^export\s+/, "");
}

function variable(file: ts.SourceFile, name: string) {
  const node = file.statements.find((item) => ts.isVariableStatement(item)
    && item.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === name));
  assert.ok(node, `未找到生产变量 ${name}`);
  return node.getText(file);
}

const [sceneSource, toolbarSource, workspaceSource] = await Promise.all([
  source("../../components/scene/Scene.tsx"),
  source("../../components/scene/SceneToolbar.tsx"),
  source("../../components/Workspace.tsx"),
]);

// 沿用项目的 TypeScript AST 提取约定，执行当前工作区中未经改写的生产函数。
// JSX 宿主、WebGL 和无关控件作替身；React hooks、R3F root/store、drei OrbitControls 和 three 相机均为真实实现。
const componentCode = ts.transpileModule([
  variable(sceneSource, "mobileQuery"), declaration(sceneSource, "subscribeMobile"),
  declaration(sceneSource, "Rig"), declaration(sceneSource, "Scene").replace("function Scene(", "function InnerScene("),
  variable(workspaceSource, "MOBILE_WORKSPACE_QUERY"),
  declaration(workspaceSource, "subscribeMobileWorkspace"), declaration(workspaceSource, "getMobileWorkspaceSnapshot"),
  declaration(workspaceSource, "getServerMobileWorkspaceSnapshot"), declaration(workspaceSource, "PartDetails"),
  // 模拟动态导入尚未完成：工具栏可用，但 Scene 直到加载完成才挂载。
  "function Scene(props) { return sceneReady() ? h(InnerScene, props) : null; }",
  variable(toolbarSource, "VIEWS"),
  // 包装 SceneToolbar 以捕获 onAmountChange
  `const OriginalSceneToolbar = ${declaration(toolbarSource, "SceneToolbar")};`,
  `function SceneToolbar(props) {
    const onAmountChange = props.onAmountChange;
    useEffect(() => {
      if (onAmountChange && typeof __registerAmountChange === 'function') {
        __registerAmountChange(onAmountChange);
        return () => __registerAmountChange(undefined);
      }
    }, [onAmountChange]);
    return h(OriginalSceneToolbar, props);
  }`,
  declaration(workspaceSource, "Workspace"),
  "({ Workspace })",
].join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "h", jsxFragmentFactory: "Fragment" },
}).outputText;

function h(type: Parameters<typeof createElement>[0] | string, props: Record<string, unknown> | null, ...children: ReactNode[]) {
  // 保留 null/false 等占位子节点，避免移除 DOM 外壳时改变 React 的组件身份。
  if (typeof type === "string") return createElement(Fragment, null, ...children.map((child) => typeof child === "string" || typeof child === "number" ? null : child));
  return createElement(type, props, ...children);
}

function input(target: EventTarget, type: string, values: Record<string, number | string | boolean>) {
  target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), values));
}

function drag(surface: ControlSurface, button: number) {
  const pointer = (x: number, y: number) => ({ clientX: x, clientY: y, pageX: x, pageY: y, button, pointerId: 1, pointerType: "mouse" });
  input(surface, "pointerdown", pointer(350, 250));
  input(surface.ownerDocument, "pointermove", pointer(410, 270));
  input(surface.ownerDocument, "pointerup", pointer(410, 270));
}

function settle(controls: Controls) {
  for (let i = 0; i < 300; i++) controls.update();
}

function direction(camera: PerspectiveCamera, controls: Controls) {
  return camera.position.clone().sub(controls.target).normalize();
}

function near(actual: Vector3, expected: Vector3, message: string) {
  assert.ok(actual.distanceTo(expected) < 1e-7, `${message}: ${actual.toArray()} != ${expected.toArray()}`);
}

function close(actual: number, expected: number, message: string) {
  assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
}

async function harness(width = 800, height = 600, inputDesign?: Design, delayedScene = false) {
  const clock = animationClock();
  const globals = ["requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const descriptors = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.assign(globalThis, { requestAnimationFrame: clock.request, cancelAnimationFrame: clock.cancel, IS_REACT_ACT_ENVIRONMENT: true });
  const restore = () => {
    clock.clear();
    globals.forEach((key, index) => {
      const descriptor = descriptors[index];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  };

  const surface = new ControlSurface();
  const camera = new PerspectiveCamera(38, width / (height || 1));
  const originalConsole = getConsoleFunction();
  const buttons = new Map<string, Set<Click>>();
  let selectPart: ((id: string) => void) | undefined;
  let changeAmount: ((value: number) => void) | undefined;
  const calls: Array<{ bounds: SceneBounds; action: ViewAction; id: number }> = [];
  let canvasMode = "";
  let renders = 0;
  let lastRendered = new Vector3();
  const renderer = {
    domElement: surface,
    render(_scene: unknown, renderedCamera: PerspectiveCamera) { renders++; lastRendered = renderedCamera.position.clone(); },
    setPixelRatio() {},
    setSize(w: number, h: number) { surface.clientWidth = w; surface.clientHeight = h; },
  };
  const noop = () => null;
  const pass = ({ children }: { children?: ReactNode }) => children;
  const ButtonStub = ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => {
    const label = typeof props["aria-label"] === "string" ? props["aria-label"] : undefined;
    const onClick = typeof props.onClick === "function" && !props.disabled ? props.onClick as Click : undefined;
    useEffect(() => {
      if (!label || !onClick) return;
      const callbacks = buttons.get(label) ?? new Set<Click>();
      callbacks.add(onClick);
      buttons.set(label, callbacks);
      return () => {
        callbacks.delete(onClick);
        if (!callbacks.size) buttons.delete(label);
      };
    }, [label, onClick]);
    return children;
  };
  const PartsListStub = ({ onSelect, children }: { onSelect: (id: string) => void; children?: ReactNode }) => {
    useEffect(() => {
      selectPart = onSelect;
      return () => { selectPart = undefined; };
    }, [onSelect]);
    return children;
  };
  const SliderStub = ({ onValueChange }: { onValueChange: (value: number | number[]) => void }) => {
    useEffect(() => {
      const callback = (value: number | number[]) => onValueChange(value);
      changeAmount = (value: number) => callback(value);
      return () => { changeAmount = undefined; };
    }, [onValueChange]);
    return null;
  };
  const IconButtonStub = ({ label, ...props }: { label: string; [key: string]: unknown }) => {
    return ButtonStub({ ...props, "aria-label": label, size: "icon-touch" });
  };
  const canvas = ({ children, frameloop }: { children?: ReactNode; frameloop: string }) => {
    canvasMode = frameloop;
    return children;
  };
  const dialog = ({ children, open }: { children?: ReactNode; open: boolean }) => open ? children : null;
  const media = { matches: false, addEventListener() {}, removeEventListener() {} };
  const window = Object.assign(new EventTarget(), { matchMedia: () => media });
  const document = new EventTarget();
  const frame = (...args: Parameters<typeof frameRequest>) => {
    calls.push({ bounds: args[0], action: args[3].action, id: args[3].id });
    return frameRequest(...args);
  };
  let ready = !delayedScene;
  const bindings: Record<string, unknown> = {
    h, Fragment, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useThree,
    PCFShadowMap, PerspectiveCamera, frameRequest: frame, frameView, applyViewFrame, boundsWithGuides, cameraBounds, visibleBoundsDistance,
    combineBounds, designBounds, explodeOffsets, buildDimensionGuides,
    createTapGesture, isSelectionClick, sceneControls, createFullscreenController,
    window, document, requestAnimationFrame: clock.request, cancelAnimationFrame: clock.cancel,
    sceneReady: () => ready,
    __registerAmountChange: (callback: ((value: number) => void) | undefined) => { changeAmount = callback; },
    useTheme: () => ({ resolvedTheme: "light" }), Canvas: canvas, OrbitControls: OrbitControlsComponent,
    Button: ButtonStub, IconButton: IconButtonStub, Slider: SliderStub, PartsList: PartsListStub, Tabs: pass, TabsContent: pass,
    Dialog: dialog, DialogContent: pass, DialogTitle: pass, DialogDescription: pass,
  };
  for (const name of [
    "Environment", "GizmoHelper", "GizmoViewport", "Lightformer", "PartMesh", "SceneDimensions",
    "BomPanel", "TabsList", "TabsTrigger", "Header", "ProjectToolbar",
    "PartEditor", "ProjectPanel", "ConfirmDialog", "Box", "Boxes", "ChevronDown", "ChevronLeft", "ChevronRight", "ChevronUp", "CircleHelp", 
    "ClipboardList", "Copy", "FlipHorizontal2", "Focus", "Layers3", "Maximize", "Minimize", "Package", "PackageOpen", "Pencil", "Plus",
    "RotateCcw", "Ruler", "Settings", "SlidersHorizontal", "Split", "Trash2", "View", "X",
  ]) bindings[name] = noop;
  const { Workspace } = runInNewContext(componentCode, bindings) as { Workspace: (props: Record<string, unknown>) => ReactNode };
  let design = inputDesign ?? DesignSchema.parse(designJson);
  const project = { formEpoch: 0, issues: [], messages: null };
  const props = () => ({ design, catalog: { profiles: [] }, accessoryCatalog: {}, project });
  let root: ReturnType<typeof createRoot> | undefined;
  let store!: RootStore;
  let invalidations = 0;
  try {
    const activeRoot = root = createTestRoot(surface);
    assert.equal(getConsoleFunction(), originalConsole, "创建 root 后应恢复原 Three 日志处理器");
    await activeRoot.configure({ gl: renderer as unknown as WebGLRenderer, camera, size: { width, height, top: 0, left: 0 }, dpr: 1, frameloop: "demand" });
    await act(async () => { store = activeRoot.render(createElement(Workspace, props())); });
    assert.ok(store.getState().scene instanceof ThreeScene, "R3F 与测试必须使用相同的 three ESM 实例");
    assert.ok(store.getState().clock instanceof Clock, "R3F 应使用相同的 three ESM Clock");
    const attachControls = () => {
      const controls = store.getState().controls as Controls;
      assert.ok(controls, "Rig 必须挂载真正的默认 OrbitControls");
      assert.equal(controls.object, camera, "真实 drei 控件应使用 R3F 的相机");
      assert.equal(canvasMode, "demand");
      // 屏蔽控件的 change，以独立验证 Rig 主动请求重绘。
      controls.dispatchEvent = () => {};
      return controls;
    };
    if (ready) attachControls();
    const originalInvalidate = store.getState().invalidate;
    await act(async () => { store.setState({ invalidate: () => { invalidations++; originalInvalidate(); } }); });
    await act(async () => { clock.flush(); });
    const initialCalls = calls.slice();
    invalidations = 0;
    renders = 0;
    calls.length = 0;
    return {
      camera, get controls() { return store.getState().controls as Controls; }, surface, calls, initialCalls, clock,
      invalidations: () => invalidations,
      renders: () => renders,
      lastRendered: () => lastRendered,
      buttonsHave: (label: string) => buttons.has(label),
      async click(label: string) {
        const onClick = buttons.get(label)?.values().next().value;
        assert.ok(onClick, `工具栏未渲染可用按钮 ${label}`);
        await act(async () => { onClick(); });
      },
      async select(id: string) {
        assert.ok(selectPart, "零件列表应暴露选择回调");
        const select = selectPart;
        await act(async () => { select(id); });
      },
      async setAmount(value: number) {
        assert.ok(changeAmount, "须注册 changeAmount 回调");
        const onValueChange = changeAmount;
        await act(async () => { onValueChange(value); });
      },
      async flush() { await act(async () => { clock.flush(); }); },
      async resize(w: number, h: number) { await act(async () => { store.getState().setSize(w, h); }); },
      async setDesign(next: Design) {
        design = next;
        await act(async () => { store = activeRoot.render(createElement(Workspace, props())); });
      },
      async loadScene() {
        ready = true;
        await act(async () => { store = activeRoot.render(createElement(Workspace, props())); });
        attachControls();
      },
      async dispose() {
        try {
          await act(async () => { activeRoot.unmount(); });
          const afterUnmount = invalidations;
          await act(async () => { clock.flush(); });
          assert.equal(invalidations, afterUnmount, "卸载应取消 Rig 的补绘");
          assert.equal(clock.size(), 0, "卸载后不能残留 RAF");
          assert.equal(buttons.size, 0, "卸载后不能保留按钮回调");
          assert.equal(changeAmount, undefined, "卸载后不能保留滑块回调");
        } finally { restore(); }
      },
    };
  } catch (error) {
    try {
      if (root) await act(async () => { root?.unmount(); });
      await act(async () => { clock.flush(); });
    } finally { restore(); }
    throw error;
  }
}

const design = DesignSchema.parse(designJson);
const assembled = designBounds(design.parts);
const exploded = designBounds(design.parts, explodeOffsets(design.parts, 1));
const bounds = combineBounds(assembled, exploded);
const center = () => new Vector3(...bounds.center);
const displayedBounds = (amount: number) => cameraBounds(designBounds(design.parts, explodeOffsets(design.parts, amount / 100)));

function smallDesign(size = 40): Design {
  return DesignSchema.parse({ id: "small", name: "小方块", units: "mm", parts: [{
    id: "box", kind: "box", role: "方块", material: "铝", size: [size, size, size], position: [0, size / 2, 0],
  }] });
}

function projectedPoints(camera: PerspectiveCamera, guides: ReturnType<typeof buildDimensionGuides>) {
  camera.updateMatrixWorld();
  return guides.flatMap((guide) => [guide.start, guide.end, guide.anchorA, guide.anchorB, guide.labelPosition]
    .map((point) => new Vector3(...point).project(camera)));
}

function panAndZoom(scene: Awaited<ReturnType<typeof harness>>) {
  drag(scene.surface, 2);
  settle(scene.controls);
  input(scene.surface, "wheel", { deltaY: -100, deltaMode: 0 });
  settle(scene.controls);
  assert.ok(scene.controls.target.distanceTo(center()) > 1, "真实控件应已平移");
  assert.ok(Math.abs(scene.camera.position.distanceTo(scene.controls.target) - fitDistance(bounds.radius, 38, 4 / 3)) > 1, "真实控件应已缩放");
}

test("右上坐标轴控件未禁用点击", () => {
  let gizmo: ts.JsxOpeningLikeElement | undefined;
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && node.tagName.getText(sceneSource) === "GizmoViewport") gizmo = node;
    ts.forEachChild(node, visit);
  };
  visit(sceneSource);
  assert.ok(gizmo, "场景应挂载 GizmoViewport");
  assert.equal(gizmo.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
    && attribute.name.getText(sceneSource) === "disabled"), false);
});

test("工具栏 fit 经 Workspace 和 Scene 更新真实 R3F Rig，主动 invalidate 并在下一帧补绘", async () => {
  const scene = await harness();
  try {
    assert.equal(scene.initialCalls.length, 1);
    assert.deepEqual(scene.initialCalls[0].bounds, bounds, "初始取景应使用装配与最大拆解的联合边界");
    panAndZoom(scene);
    const before = direction(scene.camera, scene.controls);
    await scene.click("适应视图");
    assert.deepEqual(scene.calls.map(({ id, action }) => ({ id, action })), [{ id: 1, action: "fit" }]);
    const active = displayedBounds(0);
    assert.deepEqual(scene.calls.at(-1)?.bounds, active, "显式 fit 应使用当前装配边界");
    near(scene.controls.target, new Vector3(...active.center), "fit 应按当前展示状态居中");
    near(direction(scene.camera, scene.controls), before, "fit 应保留方向");
    close(scene.camera.position.distanceTo(scene.controls.target), fitDistance(active.radius, 38, 4 / 3), "fit 距离");
    assert.equal(scene.invalidations(), 1, "控件 change 被屏蔽时仍须立即 invalidate");
    assert.ok(scene.clock.size() > 0, "应安排重绘");
    await scene.flush();
    assert.equal(scene.invalidations(), 2, "下一帧应再次 invalidate");
    assert.ok(scene.renders() >= 1, "demand 循环应真正执行渲染");
    near(scene.lastRendered(), scene.camera.position, "渲染器应收到更新后的相机");
  } finally { await scene.dispose(); }
});

test("0%、50%、100% 展示边界各自显式 fit，切换分离程度不强制重置", async () => {
  const scene = await harness();
  try {
    assert.deepEqual(scene.initialCalls[0].bounds, bounds, "首次取景使用全程拆解范围");
    near(scene.controls.target, center(), "首次取景中心");
    close(scene.camera.position.distanceTo(scene.controls.target), fitDistance(bounds.radius, 38, 4 / 3), "首次取景距离");
    await scene.click("视角");
    await scene.click("正视（+Z）");
    await scene.flush();
    const expectedDirection = new Vector3(0, 0, 1);
    let previous = displayedBounds(0);
    for (const [index, amount] of [0, 50, 100].entries()) {
      const position = scene.camera.position.clone();
      const target = scene.controls.target.clone();
      const count = scene.calls.length;
      const invalidations = scene.invalidations();
      await scene.setAmount(amount);
      assert.equal(scene.calls.length, count, `${amount}% 改变不能强制取景`);
      near(scene.camera.position, position, `${amount}% 改变不能移动相机`);
      near(scene.controls.target, target, `${amount}% 改变不能移动目标`);
      const active = displayedBounds(amount);
      if (amount > 0) assert.notDeepEqual(active, previous, "不同拆解比例应有不同真实包围盒");
      await scene.click("适应视图");
      assert.equal(scene.calls.length, count + 1);
      assert.equal(scene.calls.at(-1)?.id, index + 2);
      assert.equal(scene.calls.at(-1)?.action, "fit");
      assert.deepEqual(scene.calls.at(-1)?.bounds, active, `${amount}% 显式 fit 使用当前展示边界`);
      near(scene.controls.target, new Vector3(...active.center), `${amount}% fit 目标中心`);
      near(direction(scene.camera, scene.controls), expectedDirection, `${amount}% fit 保留正视方向`);
      close(scene.camera.position.distanceTo(scene.controls.target), fitDistance(active.radius, 38, 4 / 3), `${amount}% fit 距离`);
      assert.equal(scene.invalidations(), invalidations + 1, "每次显式 fit 立即 invalidate");
      await scene.flush();
      assert.equal(scene.invalidations(), invalidations + 2, "每次显式 fit 下一帧补绘");
      previous = active;
    }
  } finally { await scene.dispose(); }
});

test("开启尺寸标注后显式 fit 包含真实标注边界且不改变方向", async () => {
  const scene = await harness();
  try {
    const position = scene.camera.position.clone();
    const target = scene.controls.target.clone();
    const before = direction(scene.camera, scene.controls);
    const offsets = explodeOffsets(design.parts, 0);
    const guides = buildDimensionGuides(design.parts, null, offsets);
    assert.ok(guides.length > 0);
    const active = boundsWithGuides(displayedBounds(0), guides);
    const nearPlane = Math.min(scene.camera.near, active.radius * 0.02);
    const clipped = visibleBoundsDistance(active, scene.camera, target.toArray() as [number, number, number], 4 / 3, nearPlane);
    const retreat = clipped > 0 ? visibleBoundsDistance(active, scene.camera, target.toArray() as [number, number, number], 4 / 3, nearPlane, 1.02) : 0;
    await scene.click("显示尺寸标注");
    assert.equal(scene.calls.length, 0, "开关标注不能强制重置相机");
    near(scene.camera.position, position.addScaledVector(before, retreat), "显示标注仅在裁切时沿原方向后退");
    near(scene.controls.target, target, "显示标注不能改变目标");
    near(direction(scene.camera, scene.controls), before, "显示标注不能改变方向");
    assert.ok(active.radius > displayedBounds(0).radius, "夹具的标注应扩大包围半径");
    await scene.click("适应视图");
    assert.deepEqual(scene.calls.at(-1)?.bounds, active, "fit 应涵盖尺寸线和标签");
    near(scene.controls.target, new Vector3(...active.center), "标注 fit 中心");
    near(direction(scene.camera, scene.controls), before, "标注 fit 保留方向");
    close(scene.camera.position.distanceTo(scene.controls.target), fitDistance(active.radius, 38, 4 / 3), "标注 fit 距离");
  } finally { await scene.dispose(); }
});

test("小模型显式 fit 后 resize 和等值引用保留目标、方向及相对缩放", async () => {
  for (const size of [40, 1, 0.001]) {
    const small = smallDesign(size);
    const active = cameraBounds(designBounds(small.parts));
    const scene = await harness(800, 600, small);
    try {
      await scene.click("适应视图");
      close(scene.camera.position.distanceTo(scene.controls.target), fitDistance(active.radius, 38, 4 / 3), `${size} 初次 fit`);
      const position = scene.camera.position.clone();
      const target = scene.controls.target.clone();
      const beforeDirection = direction(scene.camera, scene.controls);
      await scene.resize(800, 601);
      near(scene.camera.position, position, `${size} 横向宽屏比例未变时不应跳动`);
      await scene.setDesign(structuredClone(small));
      near(scene.camera.position, position, `${size} 等值 parts 引用不能夹回联合边界最小距离`);
      near(scene.controls.target, target, `${size} 等值 parts 保留目标`);
      await scene.resize(300, 600);
      close(scene.camera.position.distanceTo(scene.controls.target), fitDistance(active.radius, 38, 0.5), `${size} 窄屏比例`);
      near(scene.controls.target, target, `${size} resize 保留目标`);
      near(direction(scene.camera, scene.controls), beforeDirection, `${size} resize 保留方向`);
      await scene.resize(800, 600);
      near(scene.camera.position, position, `${size} resize 往返恢复位置`);
      drag(scene.surface, 2);
      settle(scene.controls);
      const panned = scene.controls.target.clone();
      const distance = scene.camera.position.distanceTo(panned);
      await scene.resize(800, 601);
      near(scene.controls.target, panned, `${size} 手动平移不应丢失`);
      close(scene.camera.position.distanceTo(scene.controls.target), distance, `${size} 手动平移后的距离`);
    } finally { await scene.dispose(); }
  }
});

test("小模型 fit 后启用裁切的标注仅沿当前方向后退，关闭不改变视角", async () => {
  const small = smallDesign();
  const scene = await harness(800, 600, small);
  try {
    await scene.click("适应视图");
    await scene.select("box");
    // 用户主动放大，使标尺超出视锥，而不是依赖固定标尺边距。
    for (let i = 0; i < 30; i++) input(scene.surface, "wheel", { deltaY: -100, deltaMode: 0 });
    settle(scene.controls);
    const guides = buildDimensionGuides(small.parts, "box", explodeOffsets(small.parts, 0));
    drag(scene.surface, 2);
    settle(scene.controls);
    assert.ok(projectedPoints(scene.camera, guides).some((p) => Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || Math.abs(p.z) > 1), "夹具须确有裁切");
    const target = scene.controls.target.clone();
    const beforeDirection = direction(scene.camera, scene.controls);
    const distance = scene.camera.position.distanceTo(target);
    await scene.click("显示尺寸标注");
    near(scene.controls.target, target, "显示标注不得重置手动平移");
    near(direction(scene.camera, scene.controls), beforeDirection, "显示标注不得改变方向");
    assert.ok(scene.buttonsHave("取消选择零件"), "开启标注不能清除选中零件");
    assert.ok(scene.camera.position.distanceTo(target) > distance, "有裁切时应后退");
    for (const p of projectedPoints(scene.camera, guides)) {
      assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && Math.abs(p.z) <= 1, `标尺仍在视锥之外 ${p.toArray()}`);
    }
    const active = cameraBounds(designBounds(small.parts));
    const expanded = boundsWithGuides(active, guides);
    for (const x of [expanded.min[0], expanded.max[0]]) for (const y of [expanded.min[1], expanded.max[1]]) for (const z of [expanded.min[2], expanded.max[2]]) {
      const p = new Vector3(x, y, z).project(scene.camera);
      assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && Math.abs(p.z) <= 1, `标牌保守包围盒仍在视锥之外 ${p.toArray()}`);
    }
    const position = scene.camera.position.clone();
    const beforeResizeDistance = scene.camera.position.distanceTo(target);
    await scene.resize(300, 600);
    close(scene.camera.position.distanceTo(target) / fitDistance(active.radius, 38, 0.5),
      beforeResizeDistance / fitDistance(active.radius, 38, 4 / 3), "自动后退后 resize 仍沿用模型基准");
    await scene.resize(800, 600);
    near(scene.camera.position, position, "自动后退后的尺寸往返不能漂移");
    await scene.click("隐藏尺寸标注");
    near(scene.camera.position, position, "关闭标注不能改变位置");
    near(scene.controls.target, target, "关闭标注不能改变目标");
    await scene.setDesign(structuredClone(small));
    near(scene.camera.position, position, "关闭标注后等值引用不能跳动");
  } finally { await scene.dispose(); }
});

test("完全可见时开启标注保留用户手动平移、距离与方向", async () => {
  const small = smallDesign();
  const scene = await harness(800, 600, small);
  try {
    await scene.click("适应视图");
    await scene.click("显示尺寸标注");
    await scene.click("适应视图");
    await scene.click("隐藏尺寸标注");
    drag(scene.surface, 2);
    settle(scene.controls);
    for (let i = 0; i < 12; i++) input(scene.surface, "wheel", { deltaY: 100, deltaMode: 0 });
    settle(scene.controls);
    const position = scene.camera.position.clone();
    const target = scene.controls.target.clone();
    const guides = buildDimensionGuides(small.parts, null, explodeOffsets(small.parts, 0));
    const active = boundsWithGuides(cameraBounds(designBounds(small.parts)), guides);
    assert.equal(visibleBoundsDistance(active, scene.camera, target.toArray() as [number, number, number], 4 / 3), 0);
    await scene.click("显示尺寸标注");
    near(scene.camera.position, position, "已可见时不得重置位置");
    near(scene.controls.target, target, "已可见时不得重置手动目标");
  } finally { await scene.dispose(); }
});

test("正视后重复 fit 保持方向和画面，reset 恢复默认斜视", async () => {
  const scene = await harness();
  try {
    await scene.click("视角");
    await scene.click("正视（+Z）");
    near(direction(scene.camera, scene.controls), new Vector3(0, 0, 1), "正视方向");
    near(scene.controls.target, center(), "正视首次按全程联合边界居中");
    await scene.flush();
    await scene.click("适应视图");
    assert.equal(scene.calls.at(-1)?.id, 2);
    assert.deepEqual(scene.calls.at(-1)?.bounds, displayedBounds(0));
    near(scene.controls.target, new Vector3(...displayedBounds(0).center), "fit 应按装配边界居中");
    near(direction(scene.camera, scene.controls), new Vector3(0, 0, 1), "首次 fit 后保持正视");
    close(scene.camera.position.distanceTo(scene.controls.target), fitDistance(displayedBounds(0).radius, 38, 4 / 3), "正视 fit 距离");
    const position = scene.camera.position.clone();
    await scene.flush();
    await scene.click("适应视图");
    assert.equal(scene.calls.at(-1)?.id, 3);
    near(scene.camera.position, position, "已适应的正视不能跳回斜视");
    near(direction(scene.camera, scene.controls), new Vector3(0, 0, 1), "重复 fit 后保持正视");
    await scene.flush();
    await scene.click("重置视角");
    assert.equal(scene.calls.at(-1)?.action, "reset");
    near(scene.controls.target, center(), "reset 应居中");
    near(direction(scene.camera, scene.controls), new Vector3(0.66, 0.25, 0.71).normalize(), "reset 应恢复默认斜视");
  } finally { await scene.dispose(); }
});

test("同一请求 resize 保留真实控件的平移、方向和相对缩放", async () => {
  const scene = await harness();
  try {
    await scene.click("视角");
    await scene.click("正视（+Z）");
    await scene.flush();
    panAndZoom(scene);
    const target = scene.controls.target.clone();
    const before = direction(scene.camera, scene.controls);
    const ratio = scene.camera.position.distanceTo(scene.controls.target) / fitDistance(bounds.radius, 38, 4 / 3);
    await scene.resize(300, 600);
    assert.equal(scene.calls.at(-1)?.id, 1);
    assert.equal(scene.calls.at(-1)?.action, "front");
    assert.deepEqual(scene.calls.at(-1)?.bounds, bounds, "resize 仍使用全程联合边界");
    near(scene.controls.target, target, "resize 不能重新居中");
    near(direction(scene.camera, scene.controls), before, "resize 不能重放视角");
    close(scene.camera.position.distanceTo(scene.controls.target) / fitDistance(bounds.radius, 38, 0.5), ratio, "resize 相对缩放");
    await scene.resize(800, 600);
    near(scene.controls.target, target, "尺寸往返仍保留平移");
    close(scene.camera.position.distanceTo(scene.controls.target) / fitDistance(bounds.radius, 38, 4 / 3), ratio, "尺寸往返相对缩放");
  } finally { await scene.dispose(); }
});

test("零宽或零高期间不消费新请求，尺寸恢复后执行并取消过期补绘", async () => {
  const scene = await harness();
  try {
    await scene.click("适应视图");
    const invalidations = scene.invalidations();
    const position = scene.camera.position.clone();
    const target = scene.controls.target.clone();
    await scene.resize(0, 600);
    await scene.click("视角");
    await scene.click("正视（+Z）");
    await scene.resize(800, 0);
    assert.equal(scene.calls.length, 1, "零尺寸不能调用取景或消费请求");
    near(scene.camera.position, position, "零尺寸不能改变相机位置");
    near(scene.controls.target, target, "零尺寸不能改变目标");
    await scene.flush();
    assert.equal(scene.invalidations(), invalidations, "零尺寸前的补绘应被清理");
    await scene.resize(800, 600);
    assert.equal(scene.calls.at(-1)?.id, 2);
    assert.equal(scene.calls.at(-1)?.action, "front");
    near(direction(scene.camera, scene.controls), new Vector3(0, 0, 1), "恢复后执行积压请求");
    assert.equal(scene.invalidations(), invalidations + 1);
  } finally { await scene.dispose(); }
});

test("初始零尺寸恢复时也能执行尚未消费的视角请求", async () => {
  const scene = await harness(0, 0);
  try {
    assert.equal(scene.initialCalls.length, 0, "初始零尺寸不能取景");
    await scene.click("视角");
    await scene.click("正视（+Z）");
    assert.equal(scene.calls.length, 0);
    await scene.resize(800, 600);
    assert.equal(scene.calls.length, 1);
    assert.equal(scene.calls[0].id, 1);
    near(scene.controls.target, center(), "恢复后居中");
    near(direction(scene.camera, scene.controls), new Vector3(0, 0, 1), "恢复后正视");
  } finally { await scene.dispose(); }
});

test("零尺寸或动态加载期间的显式 fit 使用最新当前边界；未请求时仍用联合边界", async () => {
  const small = smallDesign();
  const active = cameraBounds(designBounds(small.parts));
  const union = combineBounds(designBounds(small.parts), designBounds(small.parts, explodeOffsets(small.parts, 1)));
  for (const delayed of [false, true]) {
    const scene = await harness(delayed ? 800 : 0, delayed ? 600 : 0, small, delayed);
    try {
      await scene.click("适应视图");
      if (delayed) await scene.loadScene();
      else await scene.resize(800, 600);
      assert.equal(scene.calls.at(-1)?.id, 1);
      assert.deepEqual(scene.calls.at(-1)?.bounds, active);
      close(scene.camera.position.distanceTo(scene.controls.target), fitDistance(active.radius, 38, 4 / 3), "积压 fit 应使用当前真实模型");
    } finally { await scene.dispose(); }
  }
  const initial = await harness(0, 0, small);
  try {
    await initial.resize(800, 600);
    assert.equal(initial.calls.at(-1)?.id, 0);
    assert.deepEqual(initial.calls.at(-1)?.bounds, union, "初始 id=0 必须保持联合边界");
  } finally { await initial.dispose(); }
});

test("清空开启标注的场景后 fit 保留空模型默认半径", async () => {
  const small = smallDesign();
  const scene = await harness(800, 600, small);
  try {
    await scene.click("显示尺寸标注");
    await scene.setDesign({ ...small, parts: [] });
    await scene.click("适应视图");
    assert.equal(scene.calls.at(-1)?.bounds.radius, 200);
    close(scene.camera.position.distanceTo(scene.controls.target), fitDistance(200, 38, 4 / 3), "空模型默认 fit 距离");
  } finally { await scene.dispose(); }
});

test("切换拆解不重置视角；等值边界保留用户操作，几何变化仅重新居中而不重置方向", async () => {
  const scene = await harness();
  try {
    assert.ok(exploded.max.some((value, index) => value !== assembled.max[index])
      || exploded.min.some((value, index) => value !== assembled.min[index]), "夹具需包含真实拆解边界");
    await scene.click("视角");
    await scene.click("正视（+Z）");
    await scene.flush();
    panAndZoom(scene);
    const position = scene.camera.position.clone();
    const target = scene.controls.target.clone();
    const before = direction(scene.camera, scene.controls);
    const count = scene.calls.length;
    await scene.click("拆解");
    await scene.flush();
    await scene.click("装配");
    await scene.flush();
    assert.equal(scene.calls.length, count, "拆解比例变化不能重新取景");
    near(scene.camera.position, position, "拆解往返不能移动相机");
    near(scene.controls.target, target, "拆解往返不能移动目标");

    const equivalent = structuredClone(design);
    await scene.setDesign(equivalent);
    assert.equal(scene.calls.length, count + 1, "新对象应重新检查边界");
    near(scene.camera.position, position, "等值边界保留缩放");
    near(scene.controls.target, target, "等值边界保留平移");

    const shifted = structuredClone(design);
    for (const part of shifted.parts) part.position[0] += 600;
    await scene.setDesign(shifted);
    assert.equal(scene.calls.length, count + 2);
    near(scene.controls.target, center().add(new Vector3(600, 0, 0)), "新边界重新居中");
    near(direction(scene.camera, scene.controls), before, "新边界不能强制恢复默认斜视");
  } finally { await scene.dispose(); }
});
