import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider } from "next-themes";
import designJson from "../../../data/designs/standing-desk.json";
import profilesJson from "../../../data/catalog/profiles.json";
import accessoriesJson from "../../../data/catalog/accessories.json";
import { PartsList } from "../../components/panel/PartsList";
import { BomPanel } from "../../components/panel/BomPanel";
import { TextField, VectorFields } from "../../components/project/FormFields";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { AccessoryCatalogSchema, CatalogSchema, DesignSchema } from "../schema";
import { buildBom } from "../bom";
import { materialLook } from "../materials";

const design = DesignSchema.parse(designJson);
const catalog = CatalogSchema.parse(profilesJson);
const accessories = AccessoryCatalogSchema.parse(accessoriesJson);
const css = await readFile(new URL("../../app/globals.css", import.meta.url), "utf8");

function slot(markup: string, name: string) {
  const element = markup.match(new RegExp(`<[^>]*data-slot="${name}"[^>]*>`))?.[0];
  assert.ok(element, `缺少 ${name}`);
  return element;
}

function partsMarkup(theme: "light" | "dark") {
  return renderToStaticMarkup(createElement(ThemeProvider, { forcedTheme: theme },
    createElement(PartsList, { design, selectedId: "desktop", onSelect() {} }),
  ));
}

test("标准按钮、输入、选择与标签页使用同一控件高度，触屏保留 44px 与 16px 输入", () => {
  for (const element of [
    createElement(Button, { size: "touch" }, "保存"),
    createElement(Input, { value: "尺寸", onChange() {} }),
    createElement(Select, { defaultValue: "front" },
      createElement(SelectTrigger, { size: "touch" }, createElement(SelectValue)),
    ),
    createElement(Tabs, { defaultValue: "parts" },
      createElement(TabsList, { variant: "line" }, createElement(TabsTrigger, { value: "parts" }, "零件")),
    ),
  ]) {
    const markup = renderToStaticMarkup(element);
    assert.match(markup, /min-h-\[var\(--control-height\)\]/);
    assert.doesNotMatch(markup, /min-h-11|h-\[50px\]/);
  }
  const icon = renderToStaticMarkup(createElement(Button, { size: "icon-touch", "aria-label": "全屏" }));
  assert.match(slot(icon, "button"), /size-\[var\(--control-icon-size\)\]/);
  assert.match(css, /:root\s*\{\s*--control-height: 2\.25rem;\s*--control-icon-size: 2\.25rem;/);
  assert.match(css, /@media \(pointer: coarse\), \(max-width: 639px\), \(max-width: 1023px\) and \(max-height: 540px\) and \(orientation: landscape\)\s*\{\s*:root\s*\{\s*--control-height: 2\.75rem;\s*--control-icon-size: 2\.75rem;/);
  assert.match(css, /\[data-slot="input"\],\s*\[data-slot="textarea"\],[^{]+\{\s*font-size: 1rem;/);
});

test("3D 优先布局保留桌面侧栏和手机抽屉入口，工具按自身宽度适配", async () => {
  assert.match(css, /--workspace-panel-width: clamp\(17\.5rem, 24vw, 19\.5rem\);/);
  assert.match(css, /@media \(min-width: 1024px\)/);
  assert.match(css, /@media \(max-width: 639px\), \(max-width: 1023px\) and \(max-height: 540px\) and \(orientation: landscape\)/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) var\(--workspace-panel-width\);/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) calc\(var\(--control-icon-size\) \+ 1rem\);/);
  assert.match(css, /\.workspace-scene\s*\{\s*position: relative;\s*container-type: inline-size;\s*container-name: scene;/);
  assert.match(css, /\.scene-tools\s*\{[^}]*\bwidth: max-content;/);
  assert.match(css, /\.scene-tools\s*\{[^}]*max-width: calc\(100% - 1\.25rem\);/);
  assert.doesNotMatch(css, /\.scene-tools\s*\{[^}]*\bwidth: min\(/);
  assert.match(css, /@container scene \(min-width: 34rem\)\s*\{\s*\.scene-extended-control\s*\{\s*display: inline-flex;/);
  assert.match(css, /\.workspace-scene,\s*\.workspace-panel\s*\{\s*display: flex;\s*flex-direction: column;\s*min-width: 0;\s*min-height: 0;\s*overflow: hidden;/);
  const workspace = await readFile(new URL("../../components/Workspace.tsx", import.meta.url), "utf8");
  assert.match(workspace, /<TabsList variant="line"/);
  assert.doesNotMatch(workspace, /min-h-11|h-\[50px\]/);
  const toolbar = await readFile(new URL("../../components/scene/SceneToolbar.tsx", import.meta.url), "utf8");
  assert.equal(toolbar.match(/className="scene-extended-control"/g)?.length, 2);
  assert.doesNotMatch(toolbar, /hidden sm:inline-flex/);
  assert.match(toolbar, /setDialog\("views"\)/);
  assert.match(toolbar, /setDialog\("help"\)/);
  assert.match(toolbar, /label="视角"/);
});

test("拆解图标仅过渡自身面的变换，减少动态效果时直接显示目标状态", () => {
  assert.match(css, /\.scene-explode-icon > path\s*\{\s*transition: transform 200ms cubic-bezier\(0\.2, 0, 0, 1\);\s*\}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.scene-explode-icon > path\s*\{\s*transition: none;\s*\}/);
});

test("材料色块同时输出深浅色，主题不改变首屏标记、零件顺序或设计数据", () => {
  const before = JSON.stringify(design);
  const light = partsMarkup("light");
  const dark = partsMarkup("dark");
  const swatches = (markup: string) => [...markup.matchAll(/<span[^>]*class="material-swatch[^>]*>/g)].map((match) => match[0]);
  assert.equal(swatches(light).length, design.parts.length);
  assert.deepEqual(swatches(light), swatches(dark));
  design.parts.forEach((part, index) => {
    assert.ok(swatches(light)[index].includes(`--material-color:${materialLook(part.material).color}`));
    assert.ok(swatches(light)[index].includes(`--material-color-dark:${materialLook(part.material, true).color}`));
  });
  assert.match(css, /\.material-swatch\s*\{\s*background-color: var\(--material-color\);/);
  assert.match(css, /\.dark \.material-swatch\s*\{\s*background-color: var\(--material-color-dark\);/);
  assert.match(light, /aria-pressed="true" title="desktop/);
  assert.match(light, /font-mono text-sm[^>]*>1400×25×700/);
  for (const role of [...new Set(design.parts.map((part) => part.role))]) {
    assert.ok(light.indexOf(`>${role}</h3>`) >= 0);
  }
  assert.equal(JSON.stringify(design), before);
});

test("缩紧材料面板仍完整展示算料，区分草稿、已保存与无效数据", () => {
  const before = JSON.stringify(design);
  const bom = buildBom(design, catalog, accessories);
  const render = (draft = false, invalid = false) => renderToStaticMarkup(createElement(BomPanel, { design, catalog, accessories, draft, invalid }));
  const markup = render();
  assert.match(markup, />材料清单<\/h2>/);
  assert.match(markup, />已保存<\/span>/);
  assert.ok(markup.includes(bom.profileLengthM.toFixed(2)));
  assert.ok(markup.includes(bom.totalMassKg.toFixed(1)));
  assert.ok(markup.includes(`¥${bom.knownTotal.toFixed(0)}`));
  assert.match(markup, /估算 · 非报价/);
  assert.match(markup, /估算重量/);
  assert.match(markup, /重量不含配件，部分零件按尺寸估算/);
  assert.doesNotMatch(markup, /无公开价格/);
  for (const line of bom.lines) {
    assert.ok(markup.includes(line.label));
    assert.ok(markup.includes(line.spec));
    assert.ok(markup.includes(`×${line.qty}`));
  }
  assert.match(markup, /font-mono text-sm leading-5 text-muted-foreground wrap-anywhere/);
  assert.match(render(true), />未保存草稿<\/span>/);
  const unpriced = DesignSchema.parse({ ...design, parts: design.parts.filter((part) => part.kind !== "beam"), accessories: [] });
  const unpricedMarkup = renderToStaticMarkup(createElement(BomPanel, { design: unpriced, catalog, accessories }));
  assert.match(unpricedMarkup, /暂无估价/);
  assert.match(unpricedMarkup, /未设置价格的项目未计入合计/);
  const invalid = render(true, true);
  assert.match(invalid, /算料和 CSV 导出已暂停/);
  assert.doesNotMatch(invalid, /data-slot="button"/);
  assert.equal(JSON.stringify(design), before);
});

test("浅色辅助文字与危险操作在白底和浅灰底保持 4.5:1 对比度", () => {
  function color(token: string) {
    const match = css.match(new RegExp(`--${token}: oklch\\(([^)]+)\\)`));
    assert.ok(match);
    const [lightness, chroma, hue] = match[1].split(" ").map(Number);
    const a = chroma * Math.cos(hue * Math.PI / 180);
    const b = chroma * Math.sin(hue * Math.PI / 180);
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ].map((value) => value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
  }
  function luminance(rgb: number[]) {
    return rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  }
  const destructive = color("destructive");
  for (const base of [color("background"), color("muted")]) {
    for (const [foreground, opacity] of [[color("muted-foreground"), 0], [destructive, 0.05], [destructive, 0.1], [destructive, 0.2]] as const) {
      const background = base.map((value, index) => value * (1 - opacity) + foreground[index] * opacity);
      const contrast = (luminance(background) + 0.05) / (luminance(foreground) + 0.05);
      assert.ok(contrast >= 4.5, `对比度 ${contrast.toFixed(2)}:1 低于 4.5:1`);
    }
  }
});

test("紧凑表单保留标签、必填与错误关联，三轴输入可读且没有缩小字号", () => {
  const field = renderToStaticMarkup(createElement(TextField, {
    id: "part-role", label: "角色", value: "", required: true, hint: "用于分组", error: "请填写角色", onChange() {},
  }));
  assert.match(field, /<label for="part-role"/);
  assert.match(field, /（必填）/);
  const input = slot(field, "input");
  assert.match(input, /required=""/);
  assert.match(input, /aria-invalid="true"/);
  assert.match(input, /aria-describedby="part-role-hint part-role-error"/);
  const vector = renderToStaticMarkup(createElement(VectorFields, {
    id: "part-size", path: "size", label: "尺寸", unit: "mm", values: ["1400", "40", "700"],
    onChange() {}, errors: {}, positive: true,
  }));
  for (const axis of ["X", "Y", "Z"]) assert.ok(vector.includes(`aria-label="尺寸 ${axis}（mm）"`));
  assert.match(vector, /class="vector-inputs grid min-w-0 gap-2/);
  assert.match(css, /\.vector-inputs > div\s*\{\s*display: grid;\s*grid-template-columns: 1\.25rem minmax\(0, 1fr\);/);
  assert.match(css, /@container vector-fields \(min-width: 19rem\)\s*\{\s*\.vector-inputs\s*\{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(vector, /\[&amp;_input\]:px-2/);
  assert.doesNotMatch(vector, /text-xs[^>]*type="number"/);
});
