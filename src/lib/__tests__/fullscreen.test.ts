import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { SceneToolbar } from "../../components/scene/SceneToolbar";
import { createFullscreenController } from "../fullscreen";

class FullscreenDocument extends EventTarget {
  fullscreenEnabled = true;
  fullscreenElement: HTMLElement | null = null;
  exitCalls = 0;
  async exitFullscreen() {
    this.exitCalls++;
    this.fullscreenElement = null;
    this.dispatchEvent(new Event("fullscreenchange"));
  }
}

function fixture() {
  const document = new FullscreenDocument();
  const element = {
    ownerDocument: document,
    requestCalls: 0,
    async requestFullscreen() {
      this.requestCalls++;
      document.fullscreenElement = this as unknown as HTMLElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    },
  };
  const controller = createFullscreenController();
  controller.setElement(element as unknown as HTMLElement);
  let notifications = 0;
  const unsubscribe = controller.subscribe(() => { notifications++; });
  return { document, element, controller, unsubscribe, notifications: () => notifications };
}

test("全屏快照只认当前场景，进入、退出、Esc 和外部变更均跟随真实状态", async () => {
  const { document, element, controller, unsubscribe } = fixture();
  try {
    assert.deepEqual(controller.getSnapshot(), { fullscreen: false, supported: true, busy: false, error: "" });
    await controller.toggle();
    assert.equal(element.requestCalls, 1);
    assert.equal(document.fullscreenElement, element);
    assert.equal(controller.getSnapshot().fullscreen, true);
    await controller.toggle();
    assert.equal(document.exitCalls, 1);
    assert.equal(controller.getSnapshot().fullscreen, false);

    await controller.toggle();
    // 浏览器 Esc 等同于外部更新，应用不自行维护乐观全屏布尔值。
    document.fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    assert.equal(controller.getSnapshot().fullscreen, false);
    document.fullscreenElement = {} as HTMLElement;
    document.dispatchEvent(new Event("fullscreenchange"));
    assert.equal(controller.getSnapshot().fullscreen, false);
    document.fullscreenElement = element as unknown as HTMLElement;
    document.dispatchEvent(new Event("fullscreenchange"));
    assert.equal(controller.getSnapshot().fullscreen, true);
  } finally {
    unsubscribe();
  }
});

test("全屏请求同步加锁，不乐观改状态；Promise 结束即使缺少事件也重新读取浏览器", async () => {
  const { document, element, controller, unsubscribe } = fixture();
  let finish!: () => void;
  element.requestFullscreen = () => {
    element.requestCalls++;
    return new Promise<void>((resolve) => { finish = resolve; });
  };
  try {
    const pending = controller.toggle();
    assert.equal(element.requestCalls, 1);
    assert.equal(controller.getSnapshot().busy, true);
    assert.equal(controller.getSnapshot().fullscreen, false);
    await controller.toggle();
    assert.equal(element.requestCalls, 1);
    document.fullscreenElement = element as unknown as HTMLElement;
    finish();
    await pending;
    assert.deepEqual(controller.getSnapshot(), { fullscreen: true, supported: true, busy: false, error: "" });
  } finally {
    unsubscribe();
  }
});

test("请求被拒绝、同步抛错和无效成功都会回正 busy、保留真实状态并明确报错，可重试", async () => {
  for (const request of [
    () => Promise.reject(new Error("denied")),
    () => { throw new Error("denied"); },
    () => Promise.resolve(),
  ]) {
    const { controller, element, unsubscribe } = fixture();
    const original = element.requestFullscreen;
    element.requestFullscreen = request;
    try {
      await controller.toggle();
      assert.equal(controller.getSnapshot().busy, false);
      assert.equal(controller.getSnapshot().fullscreen, false);
      assert.match(controller.getSnapshot().error, /浏览器未能切换全屏/);
      element.requestFullscreen = original;
      await controller.toggle();
      assert.equal(controller.getSnapshot().fullscreen, true);
      assert.equal(controller.getSnapshot().error, "");
    } finally {
      unsubscribe();
    }
  }
});

test("退出失败仍显示退出全屏，不阻止重试；权限变化不会阻止退出已有全屏", async () => {
  const { controller, document, unsubscribe } = fixture();
  const originalExit = document.exitFullscreen;
  try {
    await controller.toggle();
    document.exitFullscreen = () => Promise.reject(new Error("denied"));
    await controller.toggle();
    assert.equal(controller.getSnapshot().fullscreen, true);
    assert.equal(controller.getSnapshot().busy, false);
    assert.match(controller.getSnapshot().error, /浏览器未能切换全屏/);
    document.fullscreenEnabled = false;
    document.exitFullscreen = originalExit;
    await controller.toggle();
    assert.deepEqual(controller.getSnapshot(), { fullscreen: false, supported: false, busy: false, error: "" });
  } finally {
    unsubscribe();
  }
});

test("切换后又立刻 Esc，Promise 完成不能留下假的全屏或忙碌状态", async () => {
  const { document, element, controller, unsubscribe } = fixture();
  let finish!: () => void;
  element.requestFullscreen = () => new Promise<void>((resolve) => { finish = resolve; });
  try {
    const request = controller.toggle();
    document.fullscreenElement = element as unknown as HTMLElement;
    document.dispatchEvent(new Event("fullscreenchange"));
    assert.equal(controller.getSnapshot().fullscreen, true);
    document.fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    assert.equal(controller.getSnapshot().fullscreen, false);
    finish();
    await request;
    assert.equal(controller.getSnapshot().fullscreen, false);
    assert.equal(controller.getSnapshot().busy, false);
  } finally {
    unsubscribe();
  }
});

test("挂载、换文档与移除场景会迁移订阅，旧目标或已卸载请求不会污染实际全屏状态", async () => {
  const controller = createFullscreenController();
  const stop = controller.subscribe(() => {});
  const firstDocument = new FullscreenDocument();
  const secondDocument = new FullscreenDocument();
  let finish!: () => void;
  const element = { ownerDocument: firstDocument, requestFullscreen: () => new Promise<void>((resolve) => { finish = resolve; }) };
  try {
    await controller.toggle();
    assert.equal(controller.getSnapshot().busy, false);
    controller.setElement(element as unknown as HTMLElement);
    assert.equal(controller.getSnapshot().supported, true);
    const request = controller.toggle();
    controller.setElement({ ...element, ownerDocument: secondDocument } as unknown as HTMLElement);
    const snapshot = controller.getSnapshot();
    firstDocument.dispatchEvent(new Event("fullscreenerror"));
    assert.equal(controller.getSnapshot(), snapshot);
    secondDocument.dispatchEvent(new Event("fullscreenerror"));
    assert.match(controller.getSnapshot().error, /未能切换全屏/);
    controller.setElement(null);
    firstDocument.fullscreenElement = element as unknown as HTMLElement;
    finish();
    await request;
    assert.equal(controller.getSnapshot().fullscreen, false);
    assert.equal(controller.getSnapshot().supported, false);
    assert.equal(controller.getSnapshot().busy, false);
  } finally {
    stop();
  }
});

test("fullscreenerror 有明确提示；后续外部变更同步实际状态并清理过期错误", () => {
  const { document, element, controller, unsubscribe } = fixture();
  try {
    document.dispatchEvent(new Event("fullscreenerror"));
    assert.match(controller.getSnapshot().error, /浏览器未能切换全屏/);
    assert.equal(controller.getSnapshot().fullscreen, false);
    document.fullscreenElement = element as unknown as HTMLElement;
    document.dispatchEvent(new Event("fullscreenchange"));
    assert.equal(controller.getSnapshot().fullscreen, true);
    assert.equal(controller.getSnapshot().error, "");
  } finally {
    unsubscribe();
  }
});

test("服务端快照不访问 DOM，订阅清理后不再接收文档事件且支持重新订阅", () => {
  const server = createFullscreenController();
  assert.deepEqual(server.getServerSnapshot(), { fullscreen: false, supported: false, busy: false, error: "" });
  assert.equal(server.getSnapshot(), server.getServerSnapshot());

  const { document, element, controller, unsubscribe, notifications } = fixture();
  const stableSnapshot = controller.getSnapshot();
  document.dispatchEvent(new Event("fullscreenchange"));
  assert.equal(controller.getSnapshot(), stableSnapshot);
  const before = notifications();
  unsubscribe();
  document.fullscreenElement = element as unknown as HTMLElement;
  document.dispatchEvent(new Event("fullscreenchange"));
  document.dispatchEvent(new Event("fullscreenerror"));
  assert.equal(notifications(), before);
  assert.equal(controller.getSnapshot().fullscreen, false);
  const stop = controller.subscribe(() => {});
  assert.equal(controller.getSnapshot().fullscreen, true);
  stop();
});

test("不支持时不请求全屏且明确提示；能力检查使用场景所属文档和目标方法", async () => {
  const { document, element, controller, unsubscribe } = fixture();
  try {
    document.fullscreenEnabled = false;
    await controller.toggle();
    assert.equal(element.requestCalls, 0);
    assert.equal(controller.getSnapshot().supported, false);
    assert.equal(controller.getSnapshot().busy, false);
    assert.match(controller.getSnapshot().error, /不支持全屏/);
    document.fullscreenEnabled = true;
    Object.defineProperty(element, "requestFullscreen", { value: undefined });
    await controller.toggle();
    assert.equal(controller.getSnapshot().supported, false);
    assert.equal(controller.getSnapshot().busy, false);
  } finally {
    unsubscribe();
  }
});

function renderToolbar(overrides: Partial<ComponentProps<typeof SceneToolbar>> = {}) {
  return renderToStaticMarkup(createElement(SceneToolbar, {
    amount: 42,
    empty: false,
    fullscreen: false,
    fullscreenSupported: true,
    fullscreenBusy: false,
    fullscreenContainer: { current: null },
    error: "",
    onAmountChange() {},
    onView() {},
    onFullscreen() {},
    ...overrides,
  }));
}

function fullscreenButton(markup: string) {
  const button = markup.match(/<button\b[^>]*aria-label="(?:全屏视图|退出全屏)"[^>]*>/)?.[0];
  assert.ok(button);
  return button;
}

async function componentSource(path: string) {
  const text = await readFile(new URL(path, import.meta.url), "utf8");
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function elements(node: ts.Node, name: string): ts.JsxElement[] {
  const found: ts.JsxElement[] = [];
  function visit(current: ts.Node) {
    if (ts.isJsxElement(current) && current.openingElement.tagName.getText() === name) found.push(current);
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function attribute(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) {
  return node.attributes.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText() === name);
}

test("全屏按钮区分浏览器真实状态、切换中和不支持，不把切换中报成不支持", () => {
  const entering = fullscreenButton(renderToolbar({ fullscreenBusy: true }));
  assert.match(entering, /disabled=""/);
  assert.match(entering, /aria-busy="true"/);
  assert.match(entering, /aria-pressed="false"/);
  assert.match(entering, /title="正在切换全屏…"/);
  assert.doesNotMatch(entering, /不支持/);

  const exiting = fullscreenButton(renderToolbar({ fullscreen: true, fullscreenBusy: true }));
  assert.match(exiting, /title="正在切换全屏…"/);
  assert.match(exiting, /aria-pressed="true"/);

  const unsupported = fullscreenButton(renderToolbar({ fullscreenSupported: false }));
  assert.match(unsupported, /disabled=""/);
  assert.match(unsupported, /title="当前浏览器不支持全屏"/);

  // 禁止再进入全屏不应阻止退出当前已存在的全屏。
  const exit = fullscreenButton(renderToolbar({ fullscreen: true, fullscreenSupported: false }));
  assert.doesNotMatch(exit, /disabled=""/);
  assert.match(exit, /title="退出全屏 · Esc"/);
});

test("全屏错误通过 alert 显示，拆解按钮和视角入口不随全屏丢失", () => {
  for (const fullscreen of [false, true]) {
    const markup = renderToolbar({ fullscreen, error: "浏览器未能切换全屏。可继续使用当前画布，或检查浏览器的全屏权限。" });
    assert.match(markup, /role="alert"[^>]*>浏览器未能切换全屏/);
    assert.match(markup, /aria-label="拆解"|aria-label="恢复装配"|aria-label="当前分离 \d+%"/);
    assert.match(markup, /aria-label="适应视图"/);
    assert.match(markup, /aria-label="坐标与拆解说明"/);
  }
});

test("视角和说明共用固定场景 Portal 容器，Esc 退出全屏不切换挂载目标", async () => {
  const source = await componentSource("../../components/scene/SceneToolbar.tsx");
  const contents = elements(source, "DialogContent");
  assert.equal(contents.length, 1);
  assert.equal(attribute(contents[0].openingElement, "container")?.initializer?.getText(), "{fullscreenContainer}");

  const dialog = await componentSource("../../components/ui/dialog.tsx");
  const portals = elements(dialog, "DialogPrimitive.Portal");
  assert.equal(portals.length, 1);
  assert.equal(attribute(portals[0].openingElement, "container")?.initializer?.getText(), "{container}");
  assert.equal(elements(portals[0], "DialogPrimitive.Popup").length, 1);
  const backdrop: ts.JsxSelfClosingElement[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText() === "DialogPrimitive.Backdrop") backdrop.push(node);
    ts.forEachChild(node, visit);
  }
  visit(portals[0]);
  assert.equal(backdrop.length, 1);
});

test("全屏目标包含同一 Scene 和工具栏，切换不条件挂载或更换 Scene key", async () => {
  const source = await componentSource("../../components/Workspace.tsx");
  const section = elements(source, "section").find((node) => attribute(node.openingElement, "ref")?.initializer?.getText() === "{setSceneContainer}");
  assert.ok(section);
  const scenes: ts.JsxSelfClosingElement[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && ["Scene", "SceneToolbar"].includes(node.tagName.getText())) scenes.push(node);
    ts.forEachChild(node, visit);
  }
  visit(section);
  assert.deepEqual(scenes.map((node) => node.tagName.getText()), ["Scene", "SceneToolbar"]);
  const scene = scenes[0];
  assert.equal(attribute(scene, "key"), undefined);
  // 失效选中 ID 不应传入场景，否则撤销新增零件后会把所有剩余零件淡化。
  assert.match(source.getFullText(), /const sceneSelectedId = selectedPart\?\.id \?\? null/);
  assert.equal(attribute(scene, "selectedId")?.initializer?.getText(), "{sceneSelectedId}");
  for (const name of ["explodeAmount", "viewRequest"]) {
    assert.equal(attribute(scene, name)?.initializer?.getText(), `{${name}}`);
  }
  const toolbar = scenes[1];
  assert.equal(attribute(toolbar, "fullscreenContainer")?.initializer?.getText(), "{sceneContainer}");
  assert.equal(attribute(toolbar, "fullscreenSupported")?.initializer?.getText(), "{fullscreenSupported}");
  assert.equal(attribute(toolbar, "fullscreenBusy")?.initializer?.getText(), "{fullscreenBusy}");
  for (let node: ts.Node = scene; node !== section; node = node.parent) {
    assert.ok(!ts.isConditionalExpression(node) && !ts.isBinaryExpression(node), "Scene 不应随全屏状态条件重建");
  }
});
