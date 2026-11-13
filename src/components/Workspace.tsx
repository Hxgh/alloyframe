"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode, type TouchEvent } from "react";
import { ChevronDown, ChevronUp, Copy, FlipHorizontal2, Pencil, Plus, Trash2, X } from "lucide-react";
import type { AccessoryCatalog, Catalog, Design, Part } from "@/lib/schema";
import { explodeOffsets } from "@/lib/explode";
import { createFullscreenController } from "@/lib/fullscreen";
import { PartsList } from "@/components/panel/PartsList";
import { BomPanel } from "@/components/panel/BomPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/Header";
import { ProjectToolbar } from "@/components/project/ProjectToolbar";
import { SceneToolbar } from "@/components/scene/SceneToolbar";
import type { ViewRequest } from "@/lib/scene-fit";
import { PartEditor } from "@/components/project/PartEditor";
import { ProjectPanel } from "@/components/project/ProjectPanel";
import { ConfirmDialog } from "@/components/project/ConfirmDialog";
import { mirrorPart, nextPartId, unappliedFieldsWarning, type MirrorAxis, type PendingProjectForm } from "@/lib/project-draft";
import type { ValidationIssue } from "@/lib/projects";

const Scene = dynamic(() => import("./scene/Scene").then((m) => m.Scene), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-sm text-muted-foreground">
      载入 3D 场景…
    </div>
  ),
});

// 与 globals.css 的移动布局保持一致；短横屏也使用覆盖式抽屉。
const MOBILE_WORKSPACE_QUERY = "(max-width: 639px), (max-width: 1023px) and (max-height: 540px) and (orientation: landscape)";

type PanelTab = "parts" | "bom" | "project";

function subscribeMobileWorkspace(onChange: () => void) {
  const media = window.matchMedia(MOBILE_WORKSPACE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getMobileWorkspaceSnapshot() {
  return window.matchMedia(MOBILE_WORKSPACE_QUERY).matches;
}

function getServerMobileWorkspaceSnapshot() {
  // 首屏先按收起渲染，避免手机水合前展示打开的面板。
  return true;
}

type Props = {
  design: Design;
  catalog: Catalog;
  accessoryCatalog: AccessoryCatalog;
  project: {
    text: string;
    issues: ValidationIssue[];
    invalid: boolean;
    dirty: boolean;
    pending: boolean;
    formEpoch: number;
    onPendingChange: (form: PendingProjectForm, pending: boolean) => void;
    readOnly: boolean;
    status: string;
    savedAt: string;
    saving: boolean;
    saveBlocked: boolean;
    autoSave: boolean;
    onAutoSaveChange: (enabled: boolean) => void;
    canSave: boolean;
    canUndo?: boolean;
    canRedo?: boolean;
    onUndo?: () => void;
    onRedo?: () => void;
    onSave: () => void;
    onBack: (event: MouseEvent<HTMLAnchorElement>) => void;
    onChange: (design: Design) => void;
    onJsonChange: (text: string) => void;
    onExport: () => void;
    onCopy: () => void;
    onArchive: () => void;
    onDiscard: () => void;
    onRefresh: () => void;
    messages: ReactNode;
  };
};

function PartDetails({ part, onClear }: { part: Part; onClear: () => void }) {
  return (
    <section aria-label="选中零件详情" className="mb-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 self-center">
          <h2 className="font-semibold wrap-anywhere">{part.role}</h2>
          <p className="break-all font-mono text-xs text-muted-foreground">{part.id}</p>
        </div>
        <Button variant="ghost" size="icon-touch" aria-label="取消选择零件" onClick={onClear}>
          <X className="size-4" />
        </Button>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt className="text-muted-foreground">规格</dt>
        <dd className="font-mono text-sm leading-5 wrap-anywhere">{part.size.join(" × ")} mm</dd>
        <dt className="text-muted-foreground">材料</dt>
        <dd className="wrap-anywhere">{part.material}</dd>
        {part.profile && <><dt className="text-muted-foreground">型材</dt><dd className="font-mono wrap-anywhere">{part.profile}</dd></>}
      </dl>
      {part.note && <p className="mt-3 border-t pt-2 text-xs leading-relaxed text-muted-foreground wrap-anywhere">{part.note}</p>}
    </section>
  );
}

export function Workspace({ design, catalog, accessoryCatalog, project }: Props) {
  const { resolvedTheme } = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [explodeAmount, setExplodeAmount] = useState(0);
  const [showDimensions, setShowDimensions] = useState(false);
  const isMobile = useSyncExternalStore(subscribeMobileWorkspace, getMobileWorkspaceSnapshot, getServerMobileWorkspaceSnapshot);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [desktopPanelOpen, setDesktopPanelOpen] = useState(true);
  const panelOpen = isMobile ? mobilePanelOpen : desktopPanelOpen;
  const [activeTab, setActiveTab] = useState<PanelTab>("parts");
  const [viewRequest, setViewRequest] = useState<ViewRequest>({ id: 0, action: "fit" });
  const appShell = useRef<HTMLDivElement>(null);
  const sceneContainer = useRef<HTMLElement>(null);
  const panelContent = useRef<HTMLDivElement>(null);
  const panelTabs = useRef<HTMLDivElement>(null);
  const panelGesture = useRef<{ id: number; x: number; y: number; moved: boolean; multi: boolean; open: boolean; invalid: boolean; touches: Set<number> } | null>(null);
  const suppressPanelClick = useRef(false);
  const fullscreenSelection = useRef(false);
  const previousMobile = useRef(isMobile);
  const [fullscreenController] = useState(createFullscreenController);
  const setSceneContainer = useCallback((element: HTMLElement | null) => {
    sceneContainer.current = element;
    fullscreenController.setElement(element);
  }, [fullscreenController]);
  const { fullscreen, supported: fullscreenSupported, busy: fullscreenBusy, error: fullscreenError } = useSyncExternalStore(
    fullscreenController.subscribe, fullscreenController.getSnapshot, fullscreenController.getServerSnapshot,
  );
  const [editingState, setEditingState] = useState<{ target: Part | "new"; epoch: number } | null>(null);
  const [deletingState, setDeletingState] = useState<{ target: Part; epoch: number } | null>(null);
  const editing = editingState?.epoch === project.formEpoch ? editingState.target : null;
  const deleting = deletingState?.epoch === project.formEpoch ? deletingState.target : null;

  const focusActiveTab = useCallback(() => {
    panelTabs.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
  }, []);

  const closePanel = useCallback((restoreFocus = false) => {
    const focusedInContent = panelContent.current?.contains(document.activeElement) ?? false;
    if (isMobile) setMobilePanelOpen(false);
    else setDesktopPanelOpen(false);
    if (restoreFocus || focusedInContent) focusActiveTab();
  }, [focusActiveTab, isMobile]);

  function openPanel() {
    if (isMobile) setMobilePanelOpen(true);
    else setDesktopPanelOpen(true);
  }

  function startPanelGesture(event: TouchEvent<HTMLDivElement>) {
    if (!isMobile) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    if (panelGesture.current) {
      panelGesture.current.multi = true;
      for (const item of Array.from(event.changedTouches)) panelGesture.current.touches.add(item.identifier);
      return;
    }
    suppressPanelClick.current = false;
    panelGesture.current = {
      id: touch.identifier, x: touch.clientX, y: touch.clientY, moved: false,
      multi: event.touches.length !== 1, open: panelOpen, invalid: false,
      touches: new Set(Array.from(event.changedTouches, (item) => item.identifier)),
    };
  }

  function movePanelGesture(event: TouchEvent<HTMLDivElement>) {
    const gesture = panelGesture.current;
    if (!gesture) return;
    if (event.touches.length !== 1) gesture.multi = true;
    const touch = Array.from(event.touches).find((item) => item.identifier === gesture.id);
    if (touch && Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) > 10) gesture.moved = true;
  }

  function endPanelGesture(event: TouchEvent<HTMLDivElement>) {
    const gesture = panelGesture.current;
    if (!gesture) return;
    const changed = Array.from(event.changedTouches).filter((item) => gesture.touches.has(item.identifier));
    if (changed.length === 0) return;
    const touch = changed.find((item) => item.identifier === gesture.id);
    for (const item of changed) gesture.touches.delete(item.identifier);
    if (gesture.multi) {
      suppressPanelClick.current = true;
      event.preventDefault();
      if (gesture.touches.size === 0) panelGesture.current = null;
      return;
    }
    panelGesture.current = null;
    if (!touch) return;
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    if (gesture.invalid || gesture.moved || Math.hypot(dx, dy) > 10) {
      suppressPanelClick.current = true;
      event.preventDefault();
    }
    if (isMobile && !gesture.invalid && panelOpen === gesture.open && event.cancelable && event.nativeEvent.defaultPrevented
      && Math.abs(dy) >= 40 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      if (dy < 0 && !panelOpen) openPanel();
      if (dy > 0 && panelOpen) closePanel();
    }
  }

  function cancelPanelGesture() {
    panelGesture.current = null;
    suppressPanelClick.current = false;
  }

  useEffect(() => {
    if (!isMobile) return;
    function onTouchStart(event: globalThis.TouchEvent) {
      if (panelGesture.current && event.touches.length > 1) panelGesture.current.multi = true;
    }
    window.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    window.addEventListener("blur", cancelPanelGesture);
    return () => {
      window.removeEventListener("touchstart", onTouchStart, true);
      window.removeEventListener("blur", cancelPanelGesture);
    };
  }, [isMobile]);

  // 当从桌面切回收起的手机抽屉时，不能让焦点留在隐藏表单中。
  useLayoutEffect(() => {
    if (previousMobile.current !== isMobile && !panelOpen && panelContent.current?.contains(document.activeElement)) {
      focusActiveTab();
    }
    if (previousMobile.current !== isMobile && panelGesture.current) panelGesture.current.invalid = true;
    previousMobile.current = isMobile;
  }, [focusActiveTab, isMobile, panelOpen]);

  useEffect(() => {
    if (!isMobile || !panelOpen || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const shell = appShell.current;
    if (!shell) return;
    function syncViewport() {
      // 仅输入控件获得焦点时将视觉视口变化视为软键盘，避免浏览器工具栏缩放画布。
      const focused = document.activeElement;
      const editingText = focused instanceof HTMLElement && (
        focused.tagName === "TEXTAREA" || focused.isContentEditable || (focused instanceof HTMLInputElement
          && !["button", "checkbox", "color", "file", "hidden", "radio", "range", "reset", "submit"].includes(focused.type))
      );
      const scale = viewport.scale || 1;
      const keyboardOffset = editingText && scale === 1
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      shell?.style.setProperty("--workspace-keyboard-offset", `${keyboardOffset}px`);
    }
    syncViewport();
    viewport.addEventListener("resize", syncViewport);
    viewport.addEventListener("scroll", syncViewport);
    document.addEventListener("focusin", syncViewport);
    document.addEventListener("focusout", syncViewport);
    return () => {
      viewport.removeEventListener("resize", syncViewport);
      viewport.removeEventListener("scroll", syncViewport);
      document.removeEventListener("focusin", syncViewport);
      document.removeEventListener("focusout", syncViewport);
      shell.style.removeProperty("--workspace-keyboard-offset");
    };
  }, [isMobile, panelOpen]);

  useEffect(() => {
    if (!isMobile || !panelOpen || fullscreen) return;
    function onKeyDown(event: KeyboardEvent) {
      // 弹出层、全屏与输入法优先处理 Esc；抽屉本身不是模态窗口。
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || document.fullscreenElement
        || document.querySelector('[data-slot="dialog-content"]:not([hidden]), [role="listbox"]:not([hidden]), [role="menu"]:not([hidden])')) return;
      event.preventDefault();
      closePanel(true);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closePanel, fullscreen, isMobile, panelOpen]);

  function setEditing(target: Part | "new" | null) {
    setEditingState(target === null ? null : { target, epoch: project.formEpoch });
  }

  function setDeleting(target: Part | null) {
    setDeletingState(target === null ? null : { target, epoch: project.formEpoch });
  }

  const offsets = useMemo(
    () => explodeOffsets(design.parts, explodeAmount / 100),
    [design.parts, explodeAmount],
  );
  const selectedPart = design.parts.find((p) => p.id === selectedId) ?? null;
  const sceneSelectedId = selectedPart?.id ?? null;

  function selectPart(id: string) {
    if (editing) return; // 编辑期间锁住目标，3D 点击不能丢弃表单输入。
    setSelectedId(id || null);
    if (id) {
      setActiveTab("parts");
      if (fullscreen) fullscreenSelection.current = true;
      openPanel();
    }
  }

  // 全屏只包含场景；零件选择需要等退出全屏后才能看到面板。
  useEffect(() => fullscreenController.subscribe(() => {
    if (fullscreenController.getSnapshot().fullscreen || !fullscreenSelection.current) return;
    fullscreenSelection.current = false;
    if (getMobileWorkspaceSnapshot()) setMobilePanelOpen(true);
    else setDesktopPanelOpen(true);
  }), [fullscreenController]);

  function activateCurrentTab(tab: PanelTab) {
    if (tab !== activeTab) return; // 其他标签由 Tabs 的 onValueChange 处理。
    if (!panelOpen) openPanel();
    else if (isMobile) closePanel();
  }

  return (
    <div ref={appShell} className="app-shell flex h-dvh min-w-0 flex-col overflow-hidden">
      <Header design={design} onBack={project.onBack} projectActions={
        <ProjectToolbar id={design.id} status={project.status} savedAt={project.savedAt} saving={project.saving} canSave={project.canSave}
          canUndo={project.canUndo} canRedo={project.canRedo} onUndo={project.onUndo} onRedo={project.onRedo}
          dirty={project.dirty} autoSave={project.autoSave} onAutoSaveChange={project.onAutoSaveChange} readOnly={project.readOnly} pending={project.pending}
          invalid={project.invalid} saveBlocked={project.saveBlocked} onSave={project.onSave} onExport={project.onExport} onCopy={project.onCopy} onRefresh={project.onRefresh} />
      } />
      <div className="max-h-[24dvh] shrink-0 overflow-y-auto">{project.messages}</div>
      <main className="workspace-main" data-panel-open={panelOpen}>
        <section ref={setSceneContainer} className="workspace-scene" aria-label="3D 构建区">
          <div className="relative min-h-0 flex-1" data-testid="scene-viewport">
            <Scene
              design={design}
              catalog={catalog}
              selectedId={sceneSelectedId}
              explodeAmount={explodeAmount}
              offsets={offsets}
              viewRequest={viewRequest}
              showGrid
              showDimensions={showDimensions}
              dark={resolvedTheme === "dark"}
              onSelect={selectPart}
            />
            <div role="img" aria-label="世界坐标方向指示：X 向右、Y 向上、Z 朝正面" className="pointer-events-none absolute right-2 top-2 size-28" />
            <div className="scene-coordinate-label pointer-events-none absolute right-3 top-28 rounded-md border border-border/70 bg-background/80 px-2 py-1 text-xs leading-4 text-muted-foreground">
              <span className="axis-x font-mono">X</span> 右 · <span className="axis-y font-mono">Y</span> 上 · <span className="axis-z font-mono">Z</span> 正面
            </div>
            {design.parts.length === 0 && <div className="absolute inset-0 grid place-content-center gap-3 bg-background/70 p-4 text-center"><h2 className="text-base font-medium">从第一个零件开始</h2><p className="max-w-xs text-sm leading-relaxed text-muted-foreground">添加型材、板材或其他构件，或到项目面板粘贴设计 JSON。</p><Button size="touch" className="mx-auto" disabled={project.readOnly || project.invalid || Boolean(editing)} onClick={() => { setEditing("new"); setActiveTab("parts"); openPanel(); }}><Plus className="size-4" />添加零件</Button></div>}
            {editing && <p className="scene-editing-hint pointer-events-none absolute left-3 right-3 top-3 text-center text-xs leading-5 text-muted-foreground">正在编辑零件 · 应用或取消后可重新选择</p>}
          </div>
          <SceneToolbar amount={explodeAmount} empty={design.parts.length === 0} onAmountChange={setExplodeAmount}
            showDimensions={showDimensions} onShowDimensionsChange={setShowDimensions}
            onView={(action) => setViewRequest((current) => ({ id: current.id + 1, action }))}
            fullscreen={fullscreen} fullscreenSupported={fullscreenSupported} fullscreenBusy={fullscreenBusy} fullscreenContainer={sceneContainer}
            error={fullscreenError} onFullscreen={() => { void fullscreenController.toggle(); }} />
        </section>

        <aside className="workspace-panel" aria-label="设计面板">
          <Tabs value={activeTab} onValueChange={(value) => { setActiveTab(value as PanelTab); openPanel(); }} className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
            <div ref={panelTabs} className="panel-toolbar flex shrink-0 items-center gap-1 p-2"
              onTouchStart={startPanelGesture} onTouchMove={movePanelGesture} onTouchEnd={endPanelGesture} onTouchCancel={cancelPanelGesture}
              onClickCapture={(event) => {
                if (suppressPanelClick.current && event.detail !== 0 && typeof PointerEvent !== "undefined" && event.nativeEvent instanceof PointerEvent && event.nativeEvent.pointerType === "touch") {
                  suppressPanelClick.current = false;
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
            >
              <TabsList variant="line" className="panel-tab-list min-w-0 flex-1">
                <TabsTrigger value="parts" aria-expanded={panelOpen && activeTab === "parts"} onClick={() => activateCurrentTab("parts")}>零件</TabsTrigger>
                <TabsTrigger value="bom" aria-expanded={panelOpen && activeTab === "bom"} onClick={() => activateCurrentTab("bom")}>算料</TabsTrigger>
                <TabsTrigger value="project" aria-expanded={panelOpen && activeTab === "project"} onClick={() => activateCurrentTab("project")}>项目</TabsTrigger>
              </TabsList>
              <Button
                variant="ghost"
                size="icon-touch"
                aria-label={panelOpen ? "收起面板" : "展开面板"}
                aria-expanded={panelOpen}
                aria-controls="workspace-panel-content"
                title={panelOpen ? "收起面板" : "展开面板"}
                onClick={() => { if (panelOpen) closePanel(); else openPanel(); }}
              >
                {panelOpen ? <ChevronDown className="panel-toggle-icon size-4" /> : <ChevronUp className="panel-toggle-icon size-4" />}
              </Button>
            </div>
            <div ref={panelContent} id="workspace-panel-content" hidden={!panelOpen} className="min-h-0 min-w-0 flex-1">
              <TabsContent value="parts" keepMounted hidden={activeTab !== "parts"} className="h-full min-h-0 overflow-hidden">
                {editing ? <PartEditor
                  key={`${project.formEpoch}-${editing === "new" ? "new" : editing.id}`}
                  part={editing === "new" ? null : editing}
                  catalog={catalog}
                  existingIds={design.parts.map((part) => part.id)}
                  readOnly={project.readOnly || project.invalid}
                  onCancel={() => setEditing(null)}
                  onPendingChange={(pending) => project.onPendingChange("part", pending)}
                  onApply={(part) => {
                    const parts = editing === "new" ? [...design.parts, part] : design.parts.map((current) => current.id === part.id ? part : current);
                    project.onChange({ ...design, parts });
                    setEditing(null);
                    setSelectedId(part.id);
                  }}
                /> : <PartsList design={design} selectedId={sceneSelectedId} onSelect={selectPart} issues={project.issues}>
                  <div className="mb-3"><Button size="touch" variant="outline" className="w-full" disabled={project.readOnly || project.invalid} onClick={() => setEditing("new")}><Plus className="size-4" />添加零件</Button></div>
                  {selectedPart && <>
                    <PartDetails part={selectedPart} onClear={() => setSelectedId(null)} />
                    <div className="mb-3 flex min-w-0 flex-wrap gap-2">
                      <Button size="touch" variant="outline" disabled={project.readOnly || project.invalid} onClick={() => setEditing(selectedPart)}><Pencil className="size-4" />编辑</Button>
                      <Button size="touch" variant="ghost" disabled={project.readOnly || project.invalid} onClick={() => {
                        const part = { ...selectedPart, id: nextPartId(design.parts.map((item) => item.id), selectedPart.id) };
                        project.onChange({ ...design, parts: [...design.parts, part] });
                        setSelectedId(part.id);
                      }}><Copy className="size-4" />复制</Button>
                      {(["x", "z"] as const satisfies readonly MirrorAxis[]).filter((axis) => selectedPart.position[axis === "x" ? 0 : 2] !== 0).map((axis) => (
                        <Button key={axis} size="touch" variant="ghost" disabled={project.readOnly || project.invalid}
                          title={axis === "x" ? "沿 X 轴生成左右对称零件" : "沿 Z 轴生成前后对称零件"}
                          onClick={() => {
                            const part = mirrorPart(selectedPart, design.parts.map((item) => item.id), axis);
                            project.onChange({ ...design, parts: [...design.parts, part] });
                            setSelectedId(part.id);
                          }}
                        >
                          <FlipHorizontal2 className="size-4" />{axis === "x" ? "左右镜像" : "前后镜像"}
                        </Button>
                      ))}
                      <Button size="icon-touch" variant="ghost" aria-label="删除选中零件" title="删除选中零件" disabled={project.readOnly || project.invalid} onClick={() => setDeleting(selectedPart)}><Trash2 className="size-4" /></Button>
                    </div>
                  </>}
                </PartsList>}
              </TabsContent>
              <TabsContent value="bom" keepMounted hidden={activeTab !== "bom"} className="h-full min-h-0 overflow-hidden">
                {project.pending ? <p className="p-4 text-sm leading-relaxed text-muted-foreground">{unappliedFieldsWarning}算料与 CSV 导出已暂停，以免遗漏输入；应用或撤销后恢复。</p> : <BomPanel design={design} catalog={catalog} accessories={accessoryCatalog} draft={project.dirty} invalid={project.invalid} />}
              </TabsContent>
              <TabsContent value="project" keepMounted hidden={activeTab !== "project"} className="flex h-full min-h-0 flex-col overflow-hidden hidden:hidden">
                <div className="min-h-0 flex-1"><ProjectPanel design={design} catalog={catalog} accessories={accessoryCatalog} onChange={project.onChange}
                  readOnly={project.readOnly} autoSave={project.autoSave} saveBlocked={project.saveBlocked} jsonInvalid={project.invalid} jsonText={project.text} onJsonChange={project.onJsonChange}
                  issues={project.issues} onArchive={project.onArchive}
                  onDiscard={project.onDiscard} dirty={project.dirty} pending={project.pending} formEpoch={project.formEpoch} onPendingChange={project.onPendingChange} onSelectPart={selectPart} /></div>
              </TabsContent>
            </div>
          </Tabs>
        </aside>
      </main>
      <ConfirmDialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }} title="删除零件" description={`从当前草稿移除“${deleting?.role ?? ""}”。${project.autoSave ? "自动保存开启，删除后有效草稿将写入服务端文件；已保存的删除没有历史回滚。" : "保存项目后才会写入服务端文件。"}`} confirmLabel="删除零件" destructive onConfirm={() => {
        if (deleting && !project.readOnly && !project.invalid) project.onChange({ ...design, parts: design.parts.filter((part) => part.id !== deleting.id) });
        setSelectedId(null);
        setDeleting(null);
      }} />
    </div>
  );
}
