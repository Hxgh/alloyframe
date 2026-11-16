import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { act, Children, createElement, Fragment, isValidElement, useId, useLayoutEffect, useState, type ReactNode } from "react";
import { getConsoleFunction, PerspectiveCamera, setConsoleFunction, type WebGLRenderer } from "three";
import ts from "typescript";
import { AccessoryCatalogSchema, DesignAccessorySchema, DesignSchema, type Design } from "../schema";

function declarations(text: string, names: string[]) {
  const source = ts.createSourceFile("form.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return names.map((name) => {
    const node = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
    assert.ok(node, `缺少真实表单函数 ${name}`);
    return node.getText(source).replace(/^export\s+/, "");
  }).join("\n");
}

const panel = await readFile(new URL("../../components/project/ProjectPanel.tsx", import.meta.url), "utf8");
const fields = await readFile(new URL("../../components/project/FormFields.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(`${declarations(fields, ["numberFromText", "numberError"])}\n${declarations(panel, ["initialAccessories", "AccessoriesForm"])}\nAccessoriesForm`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "h", jsxFragmentFactory: "Fragment" },
}).outputText;
const require = createRequire(import.meta.url);
const fiberEntry = pathToFileURL(require.resolve("@react-three/fiber"));
const { createRoot } = await import(new URL("./react-three-fiber.esm.js", fiberEntry).href) as typeof import("@react-three/fiber");

type Props = Record<string, unknown> & { children?: ReactNode };

function childText(children: ReactNode): string {
  return Children.toArray(children).map((child) => typeof child === "string" || typeof child === "number" ? String(child)
    : isValidElement<{ children?: ReactNode }>(child) ? childText(child.props.children) : "").join("");
}

const catalog = AccessoryCatalogSchema.parse({ version: 1, accessories: [{
  id: "bracket-i8-kit", name: "I8 二孔角码完整套件", category: "连接套件", fitsSlot: ["profile4040-i8"],
  unitPrice: 10, unit: "套", connectionFamily: "i8", mounting: "profile-profile",
  components: [{ name: "二孔角码", qty: 1 }, { name: "内六角螺栓", qty: 2, spec: "DIN 912 M8×16" }, { name: "槽 8 T 型螺母", qty: 2, spec: "M8" }],
}, { id: "loose-fastener", name: "旧清单紧固件", category: "紧固件", fitsSlot: [], unitPrice: 1, unit: "个" }] });

function fixture(instances = true): Design {
  return DesignSchema.parse({
    id: "form-connection-test", name: "连接表单测试", units: "mm", meta: {},
    parts: [
      { id: "left-post", role: "左立柱", kind: "beam", profile: "profile4040-i8", material: "铝", size: [40, 800, 40], position: [-100, 400, 0] },
      { id: "upper-rail", role: "上横梁", kind: "beam", profile: "profile4040-i8", material: "铝", size: [160, 40, 40], position: [0, 780, 0] },
    ],
    accessories: [{ ref: "bracket-i8-kit", qty: instances ? 2 : 7, note: "原套件备注", ...(instances ? { instances: [
      { id: "connection-one", position: [-80, 760, 0], rotation: [0, 0, 0], anchorPartId: "left-post", partIds: ["left-post", "upper-rail"], note: "前侧安装" },
      { id: "connection-two", position: [-80, 760, 20], rotation: [0, 180, 0], anchorPartId: "upper-rail", partIds: ["left-post", "upper-rail"], note: "后侧安装" },
    ] } : {}) }, { ref: "loose-fastener", qty: 9, note: "独立散件" }],
  });
}

// 执行真实表单 hook 与提交事件；沿用项目已有的 R3F 无 DOM 渲染方式，不引入测试依赖。
async function harness(design = fixture()) {
  const globalKeys = ["requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const previous = globalKeys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.assign(globalThis, { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, IS_REACT_ACT_ENVIRONMENT: true });
  const elements = new Map<string, Props>();
  const changes: Design[] = [];
  let pending = false;
  function useRegistration(key: string, props: Props) {
    useLayoutEffect(() => { elements.set(key, props); return () => { if (elements.get(key) === props) elements.delete(key); }; }, [key, props]);
  }
  const Host = ({ host, ...props }: Props & { host: string }) => {
    useRegistration(host, props);
    return createElement(Fragment, null, ...Children.toArray(props.children).filter((child) => typeof child !== "string" && typeof child !== "number"));
  };
  const TextField = (props: Props) => { useRegistration(String(props["aria-label"]), props); return null; };
  const Button = (props: Props) => { useRegistration(`button:${props["aria-label"] ?? childText(props.children)}`, props); return null; };
  const FormErrors = (props: Props) => { useRegistration("errors", props); return null; };
  const noop = () => null;
  function h(type: Parameters<typeof createElement>[0] | string, props: Props | null, ...children: ReactNode[]) {
    return typeof type === "string" ? createElement(Host, { ...props, host: type }, ...children) : createElement(type as React.ComponentType<Props>, props, ...children);
  }
  const AccessoriesForm = runInNewContext(code, {
    h, Fragment, useId, useState, DesignAccessorySchema, TextField, Button, FormErrors,
    SelectField: noop, ConfirmDialog: noop, PlusIcon: noop, CheckIcon: noop, RotateCcwIcon: noop, Trash2Icon: noop, ChevronDownIcon: noop,
    unappliedFieldsWarning: "有未应用输入。",
  }) as (props: Props) => ReactNode;
  const surface = Object.assign(new EventTarget(), { clientWidth: 800, clientHeight: 600, style: {}, ownerDocument: new EventTarget() });
  const renderer = { domElement: surface, render() {}, setPixelRatio() {}, setSize() {} };
  const consoleFunction = getConsoleFunction();
  setConsoleFunction((type, message, ...args) => {
    if (type === "warn" && message === "THREE.Clock: This module has been deprecated. Please use THREE.Timer instead." && args.length === 0) return;
    if (consoleFunction) consoleFunction(type, message, ...args); else console[type](message, ...args);
  });
  let root: ReturnType<typeof createRoot> | undefined;
  const restore = () => globalKeys.forEach((key, index) => {
    const descriptor = previous[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  });
  try {
    try { root = createRoot(surface as unknown as HTMLCanvasElement); }
    finally { setConsoleFunction(consoleFunction ?? (null as unknown as typeof consoleFunction)); }
    await root.configure({ gl: renderer as unknown as WebGLRenderer, camera: new PerspectiveCamera(), size: { width: 800, height: 600, top: 0, left: 0 }, frameloop: "never" });
    await act(async () => { root!.render(createElement(AccessoriesForm, {
      design, accessories: catalog, disabled: false, onChange: (value: Design) => changes.push(value),
      onPendingChange: (_form: string, value: boolean) => { pending = value; },
    })); });
    const get = (key: string) => { const props = elements.get(key); assert.ok(props, `缺少表单控件 ${key}`); return props; };
    return {
      get, changes, pending: () => pending,
      async edit(label: string, value: string) { await act(async () => { (get(label).onChange as (event: { target: { value: string } }) => void)({ target: { value } }); }); },
      async apply() { await act(async () => { (get("form").onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} }); }); },
      async undo() { await act(async () => { (get("button:撤销配件输入").onClick as () => void)(); }); },
      async dispose() { try { await act(async () => { root?.unmount(); }); } finally { restore(); } },
    };
  } catch (error) {
    if (root) await act(async () => { root?.unmount(); });
    restore();
    throw error;
  }
}

test("连接配件表单仅修改备注时无损保留所有实例与采购数量", async () => {
  const design = fixture();
  const ui = await harness(design);
  try {
    await ui.edit("I8 二孔角码完整套件的备注", "修改后的备注");
    assert.equal(ui.pending(), true);
    await ui.apply();
    assert.equal(ui.changes.length, 1);
    assert.deepEqual(ui.changes[0].accessories, [{ ...design.accessories[0], note: "修改后的备注" }, design.accessories[1]]);
    assert.equal(ui.pending(), false);
  } finally { await ui.dispose(); }
});

test("连接实例数量不匹配时明确报错且不提交，撤销保留实例", async () => {
  const ui = await harness();
  try {
    await ui.edit("I8 二孔角码完整套件的数量", "3");
    await ui.apply();
    assert.equal(ui.changes.length, 0);
    assert.match(String(ui.get("I8 二孔角码完整套件的数量").error), /已有 2 个安装实例，数量必须与实例数一致/);
    assert.equal(ui.pending(), true);
    await ui.undo();
    assert.equal(ui.get("I8 二孔角码完整套件的数量").value, "2");
    await ui.edit("旧清单紧固件的备注", "另一行改动");
    await ui.apply();
    assert.deepEqual(ui.changes[0].accessories[0], fixture().accessories[0]);
  } finally { await ui.dispose(); }
});

test("旧式无实例配件可改数量且不会自动生成连接", async () => {
  const ui = await harness(fixture(false));
  try {
    assert.ok(childText(ui.get("form").children).includes("当前配件仅计入物料清单，未建模安装关系；清单数量和几何校验通过不代表已连接"));
    await ui.edit("I8 二孔角码完整套件的数量", "8");
    await ui.apply();
    assert.equal(ui.changes[0].accessories[0].qty, 8);
    assert.equal("instances" in ui.changes[0].accessories[0], false);
    assert.equal(ui.changes[0].accessories[1].qty, 9);
  } finally { await ui.dispose(); }
});

test("连接详情列出双方名字和ID、逐实例备注，完整套件内含件只显示一次", async () => {
  const ui = await harness();
  try {
    assert.equal(childText(ui.get("form").children).includes("当前配件仅计入物料清单"), false);
    const text = childText(ui.get("details").children);
    for (const label of ["2 个安装实例（只读）", "左立柱", "left-post", "上横梁", "upper-rail", "前侧安装", "后侧安装", "世界坐标", "高级 JSON", "不自动装配求解"]) assert.ok(text.includes(label), label);
    assert.equal(text.split("DIN 912 M8×16").length - 1, 1);
    assert.ok(text.includes("内含件已计入本套件"));
  } finally { await ui.dispose(); }
});
