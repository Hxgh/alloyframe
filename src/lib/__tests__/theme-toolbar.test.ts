import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { act, Children, createElement, Fragment, isValidElement, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getConsoleFunction, PerspectiveCamera, setConsoleFunction, type WebGLRenderer } from "three";
import ts from "typescript";
import designJson from "../../../data/designs/standing-desk.json";
import { Header } from "../../components/Header";
import { ThemeSelect } from "../../components/ThemeSelect";
import { ProjectToolbar } from "../../components/project/ProjectToolbar";
import { DesignSchema } from "../schema";

const design = DesignSchema.parse(designJson);
const source = async (path: string) => {
  const text = await readFile(new URL(path, import.meta.url), "utf8");
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
};
const [themeSource, toolbarSource] = await Promise.all([
  source("../../components/ThemeSelect.tsx"), source("../../components/project/ProjectToolbar.tsx"),
]);

function variable(file: ts.SourceFile, name: string) {
  const node = file.statements.find((item) => ts.isVariableStatement(item)
    && item.declarationList.declarations.some((entry) => ts.isIdentifier(entry.name) && entry.name.text === name));
  assert.ok(node, `缺少 ${name}`);
  return node.getText(file);
}

function declaration(file: ts.SourceFile, name: string) {
  const node = file.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `缺少 ${name}`);
  return node.getText(file).replace(/^export\s+/, "");
}

function compile(code: string, bindings: Record<string, unknown>) {
  const output = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "h", jsxFragmentFactory: "Fragment" },
  }).outputText;
  return runInNewContext(output, bindings);
}

function h(type: Parameters<typeof createElement>[0] | string, props: Record<string, unknown> | null, ...children: ReactNode[]) {
  if (typeof type === "string") return createElement(Fragment, null, ...children.map((child) => typeof child === "string" || typeof child === "number" ? null : child));
  return createElement(type, props, ...children);
}

function childText(children: ReactNode): string {
  return Children.toArray(children).map((child) => typeof child === "string" || typeof child === "number" ? String(child)
    : isValidElement<{ children?: ReactNode }>(child) ? childText(child.props.children) : "").join("");
}

// 复用项目已有的真实 React/R3F root 测试方式；只替换 DOM 外壳和 UI 原语，不启动服务或添加依赖。
const require = createRequire(import.meta.url);
const fiberEntry = pathToFileURL(require.resolve("@react-three/fiber"));
const { createRoot } = await import(new URL("./react-three-fiber.esm.js", fiberEntry).href) as typeof import("@react-three/fiber");

async function createTestRoot() {
  const keys = ["requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const previous = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.assign(globalThis, { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, IS_REACT_ACT_ENVIRONMENT: true });
  const restore = () => keys.forEach((key, index) => {
    const descriptor = previous[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
  const surface = Object.assign(new EventTarget(), { clientWidth: 800, clientHeight: 600, style: {}, ownerDocument: new EventTarget() });
  const renderer = { domElement: surface, render() {}, setPixelRatio() {}, setSize() {} };
  const previousConsole = getConsoleFunction();
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    setConsoleFunction((type, message, ...args) => {
      if (type === "warn" && message === "THREE.Clock: This module has been deprecated. Please use THREE.Timer instead." && args.length === 0) return;
      if (previousConsole) previousConsole(type, message, ...args); else console[type](message, ...args);
    });
    try { root = createRoot(surface as unknown as HTMLCanvasElement); }
    finally { setConsoleFunction(previousConsole ?? (null as unknown as typeof previousConsole)); }
    await root.configure({ gl: renderer as unknown as WebGLRenderer, camera: new PerspectiveCamera(), size: { width: 800, height: 600, top: 0, left: 0 }, frameloop: "never" });
    const activeRoot = root;
    return {
      async render(element: ReactNode) { await act(async () => { activeRoot.render(element); }); },
      async dispose() { try { await act(async () => { activeRoot.unmount(); }); } finally { restore(); } },
    };
  } catch (error) {
    if (root) await act(async () => { root?.unmount(); });
    restore();
    throw error;
  }
}

const noop = () => null;
const pass = ({ children }: { children?: ReactNode }) => children;
const toolbarProps = (overrides: Partial<ComponentProps<typeof ProjectToolbar>> = {}): ComponentProps<typeof ProjectToolbar> => ({
  id: "desk", status: "已保存", savedAt: "12:34:56", saving: false, canSave: true,
  canUndo: true, canRedo: true, dirty: false, autoSave: true, readOnly: false, pending: false, invalid: false, saveBlocked: false,
  onAutoSaveChange() {}, onUndo() {}, onRedo() {}, onSave() {}, onExport() {}, onCopy() {}, onRefresh() {}, ...overrides,
});

function opening(markup: string, tag: string, attribute: string) {
  const match = markup.match(new RegExp(`<${tag}\\b[^>]*${attribute}[^>]*>`));
  assert.ok(match, `缺少 ${tag} ${attribute}`);
  return match[0];
}

test("主题首屏安全且呈轻量图标，工作台和项目库复用同一入口", async () => {
  const markup = renderToStaticMarkup(createElement(ThemeSelect));
  const trigger = opening(markup, "button", 'data-slot="select-trigger"');
  assert.match(trigger, /role="combobox"/);
  assert.match(trigger, /aria-haspopup="listbox"/);
  assert.match(trigger, /aria-expanded="false"/);
  assert.match(trigger, /aria-label="主题：选择主题"/);
  assert.match(trigger, /disabled=""/);
  assert.match(trigger, /size-\[var\(--control-icon-size\)\]/);
  assert.match(trigger, /border-transparent bg-transparent/);
  assert.match(trigger, /dark:bg-transparent/);
  assert.match(trigger, /dark:aria-expanded:bg-muted\/50/);
  assert.match(trigger, /focus-visible:ring-3/);
  assert.match(trigger, /\[&amp;&gt;svg:last-child\]:hidden/);
  assert.doesNotMatch(trigger, /border-border|bg-input\/30/);
  assert.match(markup, /lucide-sun-moon/);
  assert.doesNotMatch(markup, /lucide-monitor/);
  const selectSource = await readFile(new URL("../../components/ui/select.tsx", import.meta.url), "utf8");
  assert.match(selectSource, /<SelectPrimitive\.ItemIndicator[\s\S]*?<CheckIcon/);
  const providers = await readFile(new URL("../../components/Providers.tsx", import.meta.url), "utf8");
  assert.match(providers, /defaultTheme="system"\s+enableSystem/);
  const header = renderToStaticMarkup(createElement(Header, { design, onBack() {} }));
  assert.match(header, /aria-label="返回项目库"/);
  assert.match(header, /size-\[var\(--control-icon-size\)\]/);
  assert.ok(header.includes(design.name));
  assert.doesNotMatch(header, /项目工作台 · rev\./);
  assert.equal((header.match(/data-slot="select-trigger"/g) ?? []).length, 1);
  const library = await readFile(new URL("../../components/project/ProjectLibrary.tsx", import.meta.url), "utf8");
  assert.match(library, /import \{ ThemeSelect \} from "@\/components\/ThemeSelect"/);
  assert.match(library, /<ThemeSelect\s*\/>/);
  const css = await readFile(new URL("../../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /@media \(pointer: coarse\), \(max-width: 639px\), \(max-width: 1023px\) and \(max-height: 540px\) and \(orientation: landscape\)\s*\{\s*:root\s*\{\s*--control-height: 2\.75rem;\s*--control-icon-size: 2\.75rem;/);
});

test("主题三种选择和当前图标在水合后同步，空值不改变主题", async () => {
  type SelectProps = { value: string | null; disabled: boolean; onValueChange: (value: string | null) => void; children?: ReactNode };
  type TriggerProps = { "aria-label": string; children?: ReactNode };
  let select: SelectProps | undefined;
  let trigger: TriggerProps | undefined;
  let icon: unknown;
  let content: { align: string; alignItemWithTrigger: boolean } | undefined;
  const options = new Map<string, { label: string; icon: unknown; iconHidden: boolean }>();
  const changes: string[] = [];
  const icons = { SunMoon: () => null, Sun: () => null, Moon: () => null };
  let systemTheme = "light";
  let resolvedTheme: string | undefined;
  let setSystemTheme: ((value: string) => void) | undefined;
  function Select(props: SelectProps) { useLayoutEffect(() => { select = props; return () => { select = undefined; }; }, [props]); return props.children; }
  function Trigger(props: TriggerProps) { useLayoutEffect(() => { trigger = props; return () => { trigger = undefined; }; }, [props]); return props.children; }
  function Value({ children }: { children?: ReactNode }) { const child = Children.toArray(children)[0]; icon = isValidElement(child) ? child.type : undefined; return children; }
  function Content(props: { align: string; alignItemWithTrigger: boolean; children?: ReactNode }) { content = props; return props.children; }
  function Item({ value, children }: { value: string; children?: ReactNode }) {
    const label = childText(children);
    const itemIcon = Children.toArray(children)[0];
    const icon = isValidElement<{ "aria-hidden"?: string }>(itemIcon) ? itemIcon.type : undefined;
    const iconHidden = isValidElement<{ "aria-hidden"?: string }>(itemIcon) && itemIcon.props["aria-hidden"] === "true";
    useLayoutEffect(() => { options.set(value, { label, icon, iconHidden }); return () => { options.delete(value); }; }, [value, label, icon, iconHidden]);
    return children;
  }
  function useTheme() {
    const [theme, setTheme] = useState("system");
    const [system, setSystem] = useState(systemTheme);
    setSystemTheme = (value) => { systemTheme = value; setSystem(value); };
    resolvedTheme = theme === "system" ? system : theme;
    return { theme, resolvedTheme, setTheme(value: string) { changes.push(value); setTheme(value); } };
  }
  const component = compile([
    ...["THEMES", "subscribe", "clientSnapshot", "serverSnapshot"].map((name) => variable(themeSource, name)),
    declaration(themeSource, "ThemeSelect"), "ThemeSelect",
  ].join("\n"), { h, Fragment, useSyncExternalStore, useTheme, ...icons, Select, SelectTrigger: Trigger, SelectValue: Value, SelectContent: Content, SelectItem: Item }) as () => ReactNode;
  const root = await createTestRoot();
  try {
    await root.render(createElement(component));
    assert.ok(select);
    assert.equal(select.disabled, false);
    assert.deepEqual([...options], [
      ["system", { label: "跟随系统", icon: icons.SunMoon, iconHidden: true }],
      ["light", { label: "浅色", icon: icons.Sun, iconHidden: true }],
      ["dark", { label: "深色", icon: icons.Moon, iconHidden: true }],
    ]);
    assert.equal(content?.align, "end");
    assert.equal(content?.alignItemWithTrigger, false);
    assert.equal(select.value, "system");
    assert.equal(icon, icons.SunMoon);
    assert.equal(resolvedTheme, "light");
    await act(async () => { setSystemTheme?.("dark"); });
    assert.equal(resolvedTheme, "dark");
    assert.equal(select?.value, "system");
    assert.equal(icon, icons.SunMoon);
    for (const [value, label, expectedIcon] of [["light", "浅色", icons.Sun], ["dark", "深色", icons.Moon], ["system", "跟随系统", icons.SunMoon]] as const) {
      const current = select;
      await act(async () => { current?.onValueChange(value); });
      assert.equal(select?.value, value);
      assert.equal(trigger?.["aria-label"], `主题：${label}`);
      assert.equal(icon, expectedIcon);
      assert.equal(resolvedTheme, value === "system" ? "dark" : value);
    }
    const current = select;
    await act(async () => { current?.onValueChange(null); });
    assert.deepEqual(changes, ["light", "dark", "system"]);
    assert.equal(select?.value, "system");
  } finally { await root.dispose(); }
});

test("Header 只有一个项目操作入口，正常状态不占用额外行", async () => {
  const action = createElement(ProjectToolbar, toolbarProps());
  const markup = renderToStaticMarkup(createElement(Header, { design, onBack() {}, projectActions: action }));
  const button = opening(markup, "button", 'aria-label="项目操作"');
  assert.match(button, /size-\[var\(--control-icon-size\)\]/);
  assert.match(button, /hover:bg-muted/);
  assert.match(button, /focus-visible:ring-3/);
  assert.match(button, /aria-haspopup="dialog"/);
  assert.match(button, /aria-expanded="false"/);
  assert.match(markup, /lucide-file-cog/);
  assert.equal((markup.match(/aria-label="项目操作"/g) ?? []).length, 1);
  for (const text of ["已保存", "未保存", "自动保存关闭", "保存项目", "撤销上一步", "重做下一步"]) assert.ok(!markup.includes(text), text);
  const css = await readFile(new URL("../../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /--control-icon-size: 2\.25rem/);
  assert.match(css, /@media \(pointer: coarse\), \(max-width: 639px\), \(max-width: 1023px\) and \(max-height: 540px\) and \(orientation: landscape\)\s*\{\s*:root\s*\{\s*--control-height: 2\.75rem;\s*--control-icon-size: 2\.75rem/);
  const workspace = await readFile(new URL("../../components/Workspace.tsx", import.meta.url), "utf8");
  assert.match(workspace, /<Header[\s\S]*?projectActions=\{\s*<ProjectToolbar[\s\S]*?\}\s*\/>\s*<div className="max-h-\[24dvh\][^\"]*">\{project\.messages\}<\/div>\s*<main/);
  assert.equal((workspace.match(/<ProjectToolbar\b/g) ?? []).length, 1);
  assert.match(workspace, /dirty=\{project\.dirty\}/);
});

test("草稿未保存时始终显示单行提示，自动保存状态保留在项目操作内", () => {
  for (const dirty of [false, true]) for (const autoSave of [false, true]) {
    const markup = renderToStaticMarkup(createElement(ProjectToolbar, toolbarProps({ dirty, autoSave, status: "自定义状态" })));
    const warning = markup.match(/<span role="status"[^>]*>未保存<\/span>/)?.[0];
    assert.equal(Boolean(warning), dirty);
    if (warning) {
      assert.match(warning, /whitespace-nowrap/);
      assert.doesNotMatch(warning, /hidden|sr-only|truncate|line-clamp/);
    }
    assert.ok(!markup.includes("自定义状态"));
  }
});

test("项目文件说明默认折叠，保留路径及保存风险", async () => {
  const text = await readFile(new URL("../../components/project/ProjectToolbar.tsx", import.meta.url), "utf8");
  assert.match(text, /<DialogDescription>保存写入项目文件，导出下载一份副本。<\/DialogDescription>/);
  assert.match(text, /<details className="group text-sm leading-relaxed">/);
  assert.match(text, /<summary[^>]*min-h-\[var\(--control-height\)\][^>]*focus-visible:ring-3[^>]*>.*?保存与文件说明.*?<\/summary>/);
  const details = text.match(/<details\b[\s\S]*?<\/details>/)?.[0];
  assert.ok(details);
  assert.match(details, /designs\/\{id\}\.json/);
  for (const rule of [".alloyframe-data/", "ALLOYFRAME_DATA_DIR", "1.5 秒", "未应用的表单和无效 JSON 不会写入", "文件冲突或保存失败时暂停", "浏览器仅额外备份 JSON 草稿", "自动保存不是版本历史", "视图与主题设置不改变设计"]) {
    assert.ok(details.includes(rule), `说明中缺少：${rule}`);
    assert.ok(!text.slice(0, text.indexOf("<details")).includes(rule), `说明提前显示：${rule}`);
  }
  assert.match(text, /aria-label="项目保存与历史" className="grid grid-cols-3 gap-2/);
  assert.match(text, /<Button variant="outline" size="touch" disabled=\{saveBlocked\}/);
  assert.match(text, /disabled=\{pending \|\| invalid \|\| saveBlocked\}/);
  assert.match(text, /disabled=\{readOnly \|\| pending \|\| invalid \|\| saveBlocked\}/);
  assert.match(text, /disabled=\{saveBlocked\}/);
});

test("项目操作弹窗事件、状态、无障碍与禁用条件", async () => {
  type ButtonProps = { children?: ReactNode; onClick?: () => void; disabled?: boolean; size?: string; "aria-label"?: string; "aria-expanded"?: boolean; "aria-busy"?: boolean; "aria-haspopup"?: string; ref?: unknown };
  type SwitchProps = { checked: boolean; onCheckedChange: (value: boolean) => void; disabled?: boolean; "aria-label"?: string };
  type DialogProps = { open: boolean; modal: boolean; onOpenChange: (open: boolean) => void; children?: ReactNode };
  const buttons = new Map<string, ButtonProps>();
  let switchProps: SwitchProps | undefined;
  let dialog: DialogProps | undefined;
  let finalFocus: unknown;
  let dialogTitle = "";
  const calls: string[] = [];
  function Button(props: ButtonProps) {
    const name = props["aria-label"] ?? childText(props.children);
    useLayoutEffect(() => { buttons.set(name, props); return () => { buttons.delete(name); }; }, [name, props]);
    return props.children;
  }
  function Switch(props: SwitchProps) { useLayoutEffect(() => { switchProps = props; return () => { switchProps = undefined; }; }, [props]); return null; }
  function Dialog(props: DialogProps) { dialog = props; return props.open ? props.children : null; }
  function DialogContent({ children, finalFocus: target }: { children?: ReactNode; finalFocus: unknown }) { finalFocus = target; return children; }
  function DialogTitle({ children }: { children?: ReactNode }) { dialogTitle = childText(children); return children; }
  function IconButton({ label, ...props }: ButtonProps & { label: string; active?: boolean }) {
    return Button({ ...props, "aria-label": label, size: "icon-touch" });
  }
  const bindings: Record<string, unknown> = { h, Fragment, useId, useRef, useState, Button, IconButton, Switch, Dialog, DialogContent, DialogTitle, DialogDescription: pass };
  for (const name of ["ChevronDown", "ChevronLeft", "ChevronRight", "ChevronUp", "Copy", "Download", "FileCog", "FileJson", "LoaderCircle", "Redo2", "RefreshCw", "Save", "Undo2", "X"]) bindings[name] = noop;
  const component = compile(`${declaration(toolbarSource, "ProjectToolbar")}\nProjectToolbar`, bindings) as (props: ComponentProps<typeof ProjectToolbar>) => ReactNode;
  const root = await createTestRoot();
  const props = toolbarProps({
    onSave: () => calls.push("save"), onUndo: () => calls.push("undo"), onRedo: () => calls.push("redo"),
    onAutoSaveChange: (value) => calls.push(`auto:${value}`), onExport: () => calls.push("export"),
    onCopy: () => calls.push("copy"), onRefresh: () => calls.push("refresh"),
  });
  const render = (changes: Partial<ComponentProps<typeof ProjectToolbar>> = {}) => root.render(createElement(component, { ...props, ...changes }));
  const click = async (name: string) => {
    const button = buttons.get(name);
    assert.ok(button && !button.disabled && button.onClick, `按钮不可用：${name}`);
    await act(async () => { button.onClick?.(); });
  };
  try {
    await render();
    assert.deepEqual([...buttons.keys()], ["项目操作"]);
    assert.equal(buttons.get("项目操作")?.["aria-expanded"], false);
    assert.equal(buttons.get("项目操作")?.["aria-haspopup"], "dialog");
    assert.equal(buttons.get("项目操作")?.size, "icon-touch");
    assert.equal(dialog?.open, false);
    assert.equal(dialog?.modal, true);
    await click("项目操作");
    assert.equal(dialog?.open, true);
    assert.equal(dialogTitle, "项目操作");
    assert.equal(buttons.get("项目操作")?.["aria-expanded"], true);
    assert.equal(finalFocus, buttons.get("项目操作")?.ref);
    assert.deepEqual([...buttons.keys()], ["项目操作", "关闭项目操作", "保存项目", "撤销上一步", "重做下一步", "导出 JSON", "另存副本", "检查文件更新"]);
    for (const name of ["保存项目", "撤销上一步", "重做下一步", "导出 JSON", "另存副本", "检查文件更新"]) assert.equal(buttons.get(name)?.size, "touch", name);
    assert.equal(switchProps?.["aria-label"], "自动保存");
    assert.equal(switchProps?.checked, true);
    const currentSwitch = switchProps;
    await act(async () => { currentSwitch?.onCheckedChange(false); });
    await render({ autoSave: false, dirty: true });
    assert.equal(switchProps?.checked, false);
    const disabledSwitch = switchProps;
    await act(async () => { disabledSwitch?.onCheckedChange(true); });
    await click("保存项目"); await click("撤销上一步"); await click("重做下一步");
    assert.equal(dialog?.open, true);
    assert.deepEqual(calls, ["auto:false", "auto:true", "save", "undo", "redo"]);
    await click("关闭项目操作");
    assert.equal(dialog?.open, false);
    assert.ok(!buttons.has("导出 JSON"));
    await click("项目操作");
    await act(async () => { dialog?.onOpenChange(false); });
    assert.equal(dialog?.open, false);
    for (const [label, action] of [["导出 JSON", "export"], ["另存副本", "copy"], ["检查文件更新", "refresh"]] as const) {
      await click("项目操作"); await click(label);
      assert.equal(dialog?.open, false);
      assert.equal(calls.at(-1), action);
    }
    await click("项目操作");
    for (const flag of ["canSave", "canUndo", "canRedo"] as const) {
      await render({ [flag]: false });
      for (const [key, label] of [["canSave", "保存项目"], ["canUndo", "撤销上一步"], ["canRedo", "重做下一步"]] as const) assert.equal(buttons.get(label)?.disabled, flag === key, flag);
    }
    await render({ saving: true, canSave: false });
    assert.equal(buttons.get("保存项目")?.["aria-busy"], true);
    for (const flag of ["pending", "invalid", "saveBlocked", "readOnly"] as const) {
      await render({ [flag]: true });
      assert.equal(buttons.get("导出 JSON")?.disabled, flag !== "readOnly", flag);
      assert.equal(buttons.get("另存副本")?.disabled, true, flag);
      assert.equal(buttons.get("检查文件更新")?.disabled, flag === "saveBlocked", flag);
      assert.equal(switchProps?.disabled, undefined, `自动保存开关必须可用：${flag}`);
    }
    await render({ saveBlocked: true, readOnly: true, autoSave: true });
    const backupSwitch = switchProps;
    await act(async () => { backupSwitch?.onCheckedChange(false); });
    assert.equal(calls.at(-1), "auto:false");
    await click("关闭项目操作");
    assert.deepEqual([...buttons.keys()], ["项目操作"]);
  } finally { await root.dispose(); }
});

test("弹窗内完整显示状态并保留消息、指引和快捷键", async () => {
  const toolbar = await readFile(new URL("../../components/project/ProjectToolbar.tsx", import.meta.url), "utf8");
  assert.match(toolbar, /<DialogContent finalFocus=\{triggerRef\}>/);
  assert.match(toolbar, /<p role="status" aria-live="polite" className="[^\"]*wrap-anywhere">\{status\}<\/p>/);
  assert.doesNotMatch(toolbar, /status\.(?:includes|startsWith|match)/);
  const editor = await readFile(new URL("../../components/project/ProjectEditor.tsx", import.meta.url), "utf8");
  for (const text of ["文件发生冲突", "保存结果未确认", "当前数据未通过校验", "保存失败，自动保存已暂停", "顶部项目操作中重新检查", 'window.addEventListener("keydown", onKeyDown)', 'key === "z"', 'key === "y"']) assert.ok(editor.includes(text), text);
  const panel = await readFile(new URL("../../components/project/ProjectPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /导出、另存副本和文件更新在顶部「项目操作」中/);
});
