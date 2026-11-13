"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Archive, ArrowUpRight, Copy, FileJson, FolderOpen, Plus, RotateCcw } from "lucide-react";
import type { ProjectLibrary as Library, ProjectRecord, ProjectSummary } from "@/lib/projects";
import { createProjectImportReader, ProjectRequestError, projectRequest } from "@/lib/project-client";
import { PROJECT_TEMPLATES, type ProjectTemplateId } from "@/lib/project-templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ThemeSelect } from "@/components/ThemeSelect";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = { initial: Library };
type FormMode = { type: "create"; templateId?: ProjectTemplateId } | { type: "import" } | { type: "rename"; project: ProjectSummary };
const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "UTC" });

export function ProjectLibrary({ initial }: Props) {
  const router = useRouter();
  const [library, setLibrary] = useState(initial);
  const [writable, setWritable] = useState(false);
  const [permissionReady, setPermissionReady] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [writeRejected, setWriteRejected] = useState(false);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [form, setForm] = useState<FormMode | null>(null);
  const [name, setName] = useState("");
  const nameEdited = useRef(false);
  const [json, setJson] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [importReader] = useState(() => createProjectImportReader({ onText: setJson, onError: setError, onPending: setReading }));
  const [archive, setArchive] = useState<ProjectSummary | null>(null);
  const active = useRef(false);
  const activityEpoch = useRef(0);
  useLayoutEffect(() => {
    active.current = true;
    const epoch = ++activityEpoch.current;
    return () => { active.current = false; activityEpoch.current = epoch + 1; };
  }, []);
  useEffect(() => () => importReader.cancel(), [importReader]);
  const refresh = useCallback(async () => {
    try {
      const result = await projectRequest<Library>("/api/projects");
      setLibrary(result);
      setWritable(result.writable);
      setPermissionReady(true);
      setCheckError("");
    } catch (cause) {
      setCheckError((cause as Error).message);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(timer); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  function showForm(value: FormMode) {
    importReader.cancel();
    setForm(value);
    nameEdited.current = false;
    setName(value.type === "rename" ? value.project.name : "");
    setJson("");
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form || busy || importReader.pending) return;
    const epoch = activityEpoch.current;
    setBusy(true);
    setError("");
    try {
      if (form.type === "rename") {
        await projectRequest(`/api/projects/${form.project.id}`, { method: "PATCH", body: JSON.stringify({ action: "rename", name, fingerprint: form.project.fingerprint }) });
      } else {
        const body = form.type === "import"
          ? { action: "import", design: JSON.parse(json), name: name.trim() || undefined }
          : { action: "create", name, ...(form.templateId && form.templateId !== "blank" ? { templateId: form.templateId } : {}) };
        const project = await projectRequest<ProjectRecord>("/api/projects", { method: "POST", body: JSON.stringify(body) });
        setForm(null);
        setName("");
        setJson("");
        if (active.current && epoch === activityEpoch.current) router.push(`/projects/${project.design.id}`);
        return;
      }
      setForm(null);
      await refresh();
    } catch (cause) {
      if (cause instanceof ProjectRequestError && cause.status === 403) setWriteRejected(true);
      setError(cause instanceof SyntaxError ? "JSON 无法解析，请检查逗号、引号和括号。" : (cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function action(project: ProjectSummary, type: "copy" | "archive" | "restore") {
    setBusy(true);
    setError("");
    try {
      if (type === "copy") {
        await projectRequest("/api/projects", { method: "POST", body: JSON.stringify({ action: "copy", id: project.id, fingerprint: project.fingerprint }) });
      } else {
        await projectRequest(`/api/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ action: type, fingerprint: project.fingerprint }) });
      }
      setArchive(null);
      await refresh();
    } catch (cause) {
      if (cause instanceof ProjectRequestError && cause.status === 403) setWriteRejected(true);
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const projects = (archived ? library.archived : library.projects).filter((project) => `${project.name} ${project.id} ${project.description}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="app-shell flex h-dvh min-w-0 flex-col overflow-hidden">
      <header className="app-header flex min-h-14 min-w-0 shrink-0 items-center gap-2 border-b px-3 py-1.5 sm:gap-3 sm:px-4">
        <Link href="/" className="inline-flex min-h-[var(--control-height)] min-w-0 items-center rounded-lg text-sm font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50">铝构 <span className="ml-2 text-xs font-normal text-muted-foreground">AlloyFrame</span></Link>
        <span className="hidden text-xs text-muted-foreground sm:inline">结构设计工作台</span>
        <div className="ml-auto shrink-0"><ThemeSelect /></div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-6xl space-y-4 px-3 py-4 sm:px-4 sm:py-5">
          <section className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight">项目</h1>
              <p className="text-sm leading-6 text-muted-foreground">新建项目，或导入已有设计。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="touch" disabled={!writable || busy} onClick={() => showForm({ type: "import" })}><FileJson className="size-4" />导入 JSON</Button>
              <Button size="touch" disabled={!writable || busy} onClick={() => showForm({ type: "create" })}><Plus className="size-4" />新建项目</Button>
            </div>
          </section>
          {!writable && !checkError && <p role="status" className="rounded-lg border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
            {!permissionReady ? "正在检查写入权限…" : "当前无法写入，可查看项目。"}
          </p>}
          {writeRejected && <p role="status" className="rounded-lg border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">上次写入被拒绝，请检查服务权限。</p>}
          {checkError && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm leading-6 text-destructive wrap-anywhere">项目库检查失败：{checkError}切回页面可重试。</p>}
          {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm leading-6 text-destructive wrap-anywhere">{error}</p>}
          {form && (
            <section className="min-w-0 rounded-lg border bg-card p-3" aria-label={form.type === "create" ? "新建项目" : form.type === "import" ? "导入项目" : "重命名项目"}>
              <form onSubmit={submit} className="min-w-0 space-y-4">
                <h2 className="text-sm font-semibold">{form.type === "create" ? "新建项目" : form.type === "import" ? "导入为新项目" : "重命名项目"}</h2>
                <label className="grid min-w-0 gap-1.5 text-sm"><span className="font-medium">{form.type === "import" ? "项目名称（留空沿用 JSON 名称）" : "项目名称"}<span className="ml-1 text-xs font-normal text-muted-foreground">{form.type === "import" ? "（可选）" : "（必填）"}</span></span><Input value={name} onChange={(event) => { nameEdited.current = true; setName(event.target.value); }} required={form.type !== "import"} maxLength={120} disabled={busy} /></label>
                {form.type === "create" && (() => {
                  const selectedTemplate = PROJECT_TEMPLATES.find((item) => item.id === (form.templateId ?? "blank"));
                  if (!selectedTemplate) throw new Error(`未知项目模板: ${String(form.templateId)}`);
                  return (
                    <div className="grid min-w-0 gap-1.5 text-sm">
                      <span className="font-medium">起始构型模板</span>
                      <Select
                        value={selectedTemplate.id}
                        items={PROJECT_TEMPLATES.map((item) => ({ value: item.id, label: item.label }))}
                        onValueChange={(value) => {
                          if (!value) return;
                          const nextTemplate = PROJECT_TEMPLATES.find((item) => item.id === value);
                          if (!nextTemplate) { setError(`未知项目模板: ${value}`); return; }
                          setForm({ type: "create", templateId: nextTemplate.id });
                          if (!nameEdited.current) setName(nextTemplate.id === "blank" ? "" : nextTemplate.label);
                        }}
                        disabled={busy}
                      >
                        <SelectTrigger size="touch" className="w-full min-w-0" aria-label="起始构型模板">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start" alignItemWithTrigger={false}>
                          {PROJECT_TEMPLATES.map((item) => (
                            <SelectItem key={item.id} value={item.id} className="min-h-[var(--control-height)] py-1.5 pr-8 pl-3">
                              <span className="min-w-0 whitespace-normal wrap-anywhere">{item.label}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs leading-5 text-muted-foreground">{selectedTemplate.summary}</p>
                    </div>
                  );
                })()}
                {form.type === "import" && <>
                  <label className="grid min-w-0 gap-1.5 text-sm"><span className="font-medium">粘贴设计 JSON<span className="ml-1 text-xs font-normal text-muted-foreground">（必填）</span></span><Textarea value={json} onChange={(event) => { importReader.cancel(); setJson(event.target.value); }} className="min-h-52 font-mono" required disabled={busy} spellCheck={false} /></label>
                  <label className="grid min-w-0 gap-1.5 text-sm"><span className="font-medium">或读取 JSON 文件</span><input type="file" accept=".json,application/json" className="min-h-[var(--control-height)] w-full min-w-0 max-w-full rounded-lg border bg-background px-3 py-1 text-base outline-none file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-0.5 file:text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm" disabled={busy} onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void importReader.read(file);
                  }} /></label>
                  {reading && <p role="status" className="text-xs leading-5 text-muted-foreground">正在读取 JSON 文件，读取完成前不会提交导入；也可直接粘贴内容以取消读取。</p>}
                  <p className="text-xs leading-5 text-muted-foreground">会生成新 ID，不覆盖已有项目。JSON 引用的型材和配件必须存在于当前共享目录库中。</p>
                </>}
                <div className="flex flex-wrap gap-2 border-t pt-3"><Button type="submit" size="touch" disabled={busy || reading || !writable}>{busy ? "处理中…" : form.type === "import" ? "校验并导入" : "确定"}</Button><Button type="button" variant="outline" size="touch" disabled={busy} onClick={() => { importReader.cancel(); setForm(null); }}>取消</Button></div>
              </form>
            </section>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="搜索项目" placeholder="搜索名称、说明或 ID" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 basis-full flex-1 sm:max-w-sm sm:basis-auto" />
            <div role="group" aria-label="项目范围" className="flex shrink-0 gap-1">
              <Button size="touch" variant={!archived ? "secondary" : "ghost"} aria-pressed={!archived} onClick={() => setArchived(false)}>进行中 {library.projects.length}</Button>
              <Button size="touch" variant={archived ? "secondary" : "ghost"} aria-pressed={archived} onClick={() => setArchived(true)}>已归档 {library.archived.length}</Button>
            </div>
          </div>
          {projects.length === 0 ? <section className="grid min-h-52 place-content-center gap-3 rounded-lg border border-dashed p-6 text-center"><FolderOpen className="mx-auto size-6 text-muted-foreground" /><h2 className="text-sm font-medium">{query ? "没有匹配的项目" : archived ? "暂无归档项目" : "还没有项目"}</h2><p className="text-xs text-muted-foreground">{query ? "试试其他关键词。" : archived ? "归档项目会保留数据，可以随时恢复。" : "新建项目，或导入已有设计。"}</p></section> : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((project) => (
                <article key={project.id} className="flex min-w-0 flex-col rounded-lg border bg-card p-3">
                  <div className="flex items-start justify-between gap-2"><h2 className="min-w-0 flex-1 text-sm leading-5 font-semibold wrap-anywhere">{project.name}</h2><span className={project.status === "invalid" ? "shrink-0 rounded-md bg-destructive/10 px-2 py-0.5 text-xs leading-5 text-destructive" : "shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs leading-5 text-muted-foreground"}>{project.status === "invalid" ? "需修复" : project.status === "empty" ? "待添加零件" : "可打开"}</span></div>
                  <p className="mt-2 min-h-10 text-xs leading-5 text-muted-foreground wrap-anywhere">{project.description || "暂无项目说明"}</p>
                  <div className="mt-2 mb-3 space-y-1">
                    <p className="truncate font-mono text-xs leading-5 text-muted-foreground" title={project.id}>{project.id}</p>
                    <p className="text-xs leading-5 text-muted-foreground">{project.partCount} 个零件 · rev.{project.revision} · {Number.isNaN(Date.parse(project.updatedAt)) ? "时间未知" : dateFormat.format(new Date(project.updatedAt))}</p>
                    {project.error && <p className="text-xs leading-5 text-destructive wrap-anywhere">{project.error}</p>}
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
                    {!archived && <Link href={`/projects/${project.id}`} prefetch={false} className="inline-flex min-h-[var(--control-height)] items-center gap-2 rounded-lg border border-transparent bg-secondary px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">{project.status === "invalid" ? "查看问题" : "打开项目"}<ArrowUpRight className="size-4" /></Link>}
                    {archived ? <Button size="touch" variant="outline" disabled={!writable || busy} onClick={() => { void action(project, "restore"); }}><RotateCcw className="size-4" />恢复</Button> : <>
                      <Button size="touch" variant="ghost" disabled={!writable || busy || project.status === "invalid"} onClick={() => showForm({ type: "rename", project })}>重命名</Button>
                      <Button size="icon-touch" variant="ghost" aria-label={`复制项目：${project.name}`} title="复制项目" disabled={!writable || busy || project.status === "invalid"} onClick={() => { void action(project, "copy"); }}><Copy className="size-4" /></Button>
                      <Button size="icon-touch" variant="ghost" aria-label={`归档项目：${project.name}`} title="归档项目" disabled={!writable || busy} onClick={() => setArchive(project)}><Archive className="size-4" /></Button>
                    </>}
                  </div>
                </article>
              ))}
            </div>
          )}
          <footer className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">校验只检查格式、引用与几何一致性，不代表承重或可制造性认证。材料价格为估算，不是报价。</footer>
        </div>
      </main>
      <ConfirmDialog open={archive !== null} onOpenChange={(open) => { if (!open && !busy) setArchive(null); }} title="归档项目" description={`将“${archive?.name ?? ""}”移到已归档。数据不会删除，之后可以恢复。`} confirmLabel={busy ? "归档中…" : "归档"} onConfirm={() => { if (archive && !busy) void action(archive, "archive"); }} />
    </div>
  );
}
