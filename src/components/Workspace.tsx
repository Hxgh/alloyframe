"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import type { AccessoryCatalog, Catalog, Design, Part } from "@/lib/schema";
import { explodeOffsets } from "@/lib/explode";
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
import { nextPartId, unappliedFieldsWarning, type PendingProjectForm } from "@/lib/project-draft";
import type { ValidationIssue } from "@/lib/projects";

const Scene = dynamic(() => import("./scene/Scene").then((m) => m.Scene), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-sm text-muted-foreground">
      载入 3D 场景…
    </div>
  ),
});

const subscribeClient = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
function subscribeFullscreen(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
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
    <section aria-label="选中零件详情" className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 self-center">
          <h2 className="font-medium">{part.role}</h2>
          <p className="break-all font-mono text-xs text-muted-foreground">{part.id}</p>
        </div>
        <Button variant="ghost" size="icon-touch" aria-label="取消选择零件" onClick={onClear}>
          <X className="size-4" />
        </Button>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
        <dt className="text-muted-foreground">规格</dt>
        <dd className="break-words font-mono text-xs leading-5">{part.size.join(" × ")} mm</dd>
        <dt className="text-muted-foreground">材料</dt>
        <dd className="break-words">{part.material}</dd>
        {part.profile && <><dt className="text-muted-foreground">型材</dt><dd>{part.profile}</dd></>}
      </dl>
      {part.note && <p className="mt-3 border-t pt-2 text-xs leading-relaxed text-muted-foreground">{part.note}</p>}
    </section>
  );
}

export function Workspace({ design, catalog, accessoryCatalog, project }: Props) {
  const { resolvedTheme } = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [explodeAmount, setExplodeAmount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("parts");
  const [viewRequest, setViewRequest] = useState<ViewRequest>({ id: 0, action: "fit" });
  const sceneContainer = useRef<HTMLElement>(null);
  const hydrated = useSyncExternalStore(subscribeClient, clientReady, serverReady);
  const fullscreen = useSyncExternalStore(subscribeFullscreen, () => document.fullscreenElement !== null && document.fullscreenElement === sceneContainer.current, () => false);
  const fullscreenSupported = hydrated && document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function";
  const [fullscreenError, setFullscreenError] = useState("");
  const [fullscreenBusy, setFullscreenBusy] = useState(false);
  const [editingState, setEditingState] = useState<{ target: Part | "new"; epoch: number } | null>(null);
  const [deletingState, setDeletingState] = useState<{ target: Part; epoch: number } | null>(null);
  const editing = editingState?.epoch === project.formEpoch ? editingState.target : null;
  const deleting = deletingState?.epoch === project.formEpoch ? deletingState.target : null;

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

  async function toggleFullscreen() {
    if (!fullscreenSupported || fullscreenBusy || !sceneContainer.current) return;
    setFullscreenBusy(true);
    setFullscreenError("");
    try {
      if (document.fullscreenElement === sceneContainer.current) await document.exitFullscreen();
      else await sceneContainer.current.requestFullscreen();
    } catch {
      setFullscreenError("浏览器未能切换全屏。可继续使用当前画布，或检查浏览器的全屏权限。");
    } finally {
      setFullscreenBusy(false);
    }
  }

  function selectPart(id: string) {
    if (editing) return; // 编辑期间锁住目标，3D 点击不能丢弃表单输入。
    setSelectedId(id || null);
    if (id) {
      setActiveTab("parts");
      setPanelOpen(true);
    }
  }

  return (
    <div className="app-shell flex h-dvh min-w-0 flex-col overflow-hidden">
      <Header design={design} onBack={project.onBack} />
      <ProjectToolbar id={design.id} status={project.status} savedAt={project.savedAt} saving={project.saving} canSave={project.canSave}
        autoSave={project.autoSave} onAutoSaveChange={project.onAutoSaveChange} readOnly={project.readOnly} pending={project.pending}
        invalid={project.invalid} saveBlocked={project.saveBlocked} onSave={project.onSave} onExport={project.onExport} onCopy={project.onCopy} onRefresh={project.onRefresh} />
      <div className="max-h-[24dvh] shrink-0 overflow-y-auto">{project.messages}</div>
      <main className="workspace-main" data-panel-open={panelOpen}>
        <section ref={sceneContainer} className="workspace-scene" aria-label="3D 构建区">
          <div className="relative min-h-0 flex-1" data-testid="scene-viewport">
            <Scene
              design={design}
              catalog={catalog}
              selectedId={selectedId}
              explodeAmount={explodeAmount}
              offsets={offsets}
              viewRequest={viewRequest}
              showGrid
              dark={resolvedTheme === "dark"}
              onSelect={selectPart}
            />
            <div role="img" aria-label="世界坐标方向指示：X 向右、Y 向上、Z 朝正面" className="absolute right-2 top-2 size-28" />
            <div className="scene-coordinate-label pointer-events-none absolute right-3 top-28 rounded-md border border-border/70 bg-background/80 px-2 py-1 text-[10px] leading-4 text-muted-foreground">
              <span className="axis-x font-mono">X</span> 右 · <span className="axis-y font-mono">Y</span> 上 · <span className="axis-z font-mono">Z</span> 正面
            </div>
            {design.parts.length === 0 && <div className="absolute inset-0 grid place-content-center gap-3 bg-background/70 p-4 text-center"><h2 className="text-base font-medium">从第一个零件开始</h2><p className="max-w-xs text-sm leading-relaxed text-muted-foreground">添加型材、板材或其他构件，或到项目面板粘贴设计 JSON。</p><Button size="touch" className="mx-auto" disabled={project.readOnly || project.invalid || Boolean(editing)} onClick={() => { setEditing("new"); setActiveTab("parts"); setPanelOpen(true); }}><Plus className="size-4" />添加零件</Button></div>}
            <p className="scene-hint pointer-events-none absolute bottom-3 left-3 right-3 text-center text-xs leading-5 text-muted-foreground">
              {editing ? "正在编辑零件 · 应用或取消后可重新选择" : <><span className="scene-hint-mouse">左键旋转 · 滚轮缩放 · 右键平移 · 点击选中</span>
              <span className="scene-hint-touch">单指旋转 · 双指缩放 / 平移 · 轻点选中</span></>}
            </p>
          </div>
          <SceneToolbar amount={explodeAmount} empty={design.parts.length === 0} onAmountChange={setExplodeAmount}
            onView={(action) => setViewRequest((current) => ({ id: current.id + 1, action }))}
            fullscreen={fullscreen} fullscreenSupported={fullscreenSupported && !fullscreenBusy} fullscreenContainer={sceneContainer}
            error={fullscreenError} onFullscreen={() => { void toggleFullscreen(); }} />
        </section>

        <aside className="workspace-panel" aria-label="设计面板">
          <Tabs value={activeTab} onValueChange={(value) => { setActiveTab(String(value)); setPanelOpen(true); }} className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
            <div className="panel-toolbar flex shrink-0 items-center gap-2 p-2">
              <TabsList className="panel-tab-list min-w-0 flex-1 group-data-horizontal/tabs:h-[50px]">
                <TabsTrigger value="parts" className="min-h-11 text-sm">零件</TabsTrigger>
                <TabsTrigger value="bom" className="min-h-11 text-sm">算料</TabsTrigger>
                <TabsTrigger value="project" className="min-h-11 text-sm">项目</TabsTrigger>
              </TabsList>
              <Button
                variant="ghost"
                size="icon-touch"
                aria-label={panelOpen ? "收起面板" : "展开面板"}
                aria-expanded={panelOpen}
                aria-controls="workspace-panel-content"
                title={panelOpen ? "收起面板" : "展开面板"}
                onClick={() => setPanelOpen((open) => !open)}
              >
                {panelOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
              </Button>
            </div>
            <div id="workspace-panel-content" hidden={!panelOpen} className="min-h-0 min-w-0 flex-1">
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
                /> : <PartsList design={design} selectedId={selectedId} onSelect={selectPart}>
                  <div className="mb-3 flex flex-wrap gap-2"><Button size="touch" variant="outline" disabled={project.readOnly || project.invalid} onClick={() => setEditing("new")}><Plus className="size-4" />添加零件</Button></div>
                  {selectedPart && <>
                    <PartDetails part={selectedPart} onClear={() => setSelectedId(null)} />
                    <div className="mb-4 flex flex-wrap gap-2">
                      <Button size="touch" variant="outline" disabled={project.readOnly || project.invalid} onClick={() => setEditing(selectedPart)}><Pencil className="size-4" />编辑</Button>
                      <Button size="touch" variant="ghost" disabled={project.readOnly || project.invalid} onClick={() => {
                        const part = { ...selectedPart, id: nextPartId(design.parts.map((item) => item.id), selectedPart.id) };
                        project.onChange({ ...design, parts: [...design.parts, part] });
                        setSelectedId(part.id);
                      }}><Copy className="size-4" />复制</Button>
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
                  onDiscard={project.onDiscard} dirty={project.dirty} pending={project.pending} formEpoch={project.formEpoch} onPendingChange={project.onPendingChange} /></div>
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
