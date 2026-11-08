"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Archive, ArrowUpRight, Copy, FileJson, FolderOpen, Plus, RotateCcw } from "lucide-react";
import type { ProjectLibrary as Library, ProjectRecord, ProjectSummary } from "@/lib/projects";
import { projectRequest } from "@/lib/project-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ThemeSelect } from "@/components/ThemeSelect";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = { initial: Library };
type FormMode = { type: "create" | "import" } | { type: "rename"; project: ProjectSummary };
const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "UTC" });

export function ProjectLibrary({ initial }: Props) {
  const router = useRouter();
  const [library, setLibrary] = useState(initial);
  const [writable, setWritable] = useState(false);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [form, setForm] = useState<FormMode | null>(null);
  const [name, setName] = useState("");
  const [json, setJson] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [archive, setArchive] = useState<ProjectSummary | null>(null);
  const refresh = useCallback(async () => {
    try {
      const result = await projectRequest<Library>("/api/projects");
      setLibrary(result);
      setWritable(result.writable);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(timer); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  function showForm(value: FormMode) {
    setForm(value);
    setName(value.type === "rename" ? value.project.name : "");
    setJson("");
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    setError("");
    try {
      if (form.type === "rename") {
        await projectRequest(`/api/projects/${form.project.id}`, { method: "PATCH", body: JSON.stringify({ action: "rename", name, fingerprint: form.project.fingerprint }) });
      } else {
        const body = form.type === "import" ? { action: "import", design: JSON.parse(json), name: name.trim() || undefined } : { action: "create", name };
        const project = await projectRequest<ProjectRecord>("/api/projects", { method: "POST", body: JSON.stringify(body) });
        setForm(null);
        setName("");
        setJson("");
        router.push(`/projects/${project.design.id}`);
        return;
      }
      setForm(null);
      await refresh();
    } catch (cause) {
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
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const projects = (archived ? library.archived : library.projects).filter((project) => `${project.name} ${project.id} ${project.description}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="app-shell flex h-dvh min-w-0 flex-col overflow-hidden">
      <header className="app-header flex min-h-16 shrink-0 items-center gap-3 border-b px-4 py-2 sm:px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight">铝构 <span className="ml-2 text-xs font-normal text-muted-foreground">AlloyFrame</span></Link>
        <span className="hidden text-xs text-muted-foreground sm:inline">结构设计工作台</span>
        <div className="ml-auto"><ThemeSelect /></div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
          <section className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">项目</h1>
              <p className="text-sm leading-relaxed text-muted-foreground">一份结构，一个项目。从空白开始，也可以复制现有设计。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="touch" disabled={!writable || busy} onClick={() => showForm({ type: "import" })}><FileJson className="size-4" />导入 JSON</Button>
              <Button size="touch" disabled={!writable || busy} onClick={() => showForm({ type: "create" })}><Plus className="size-4" />新建项目</Button>
            </div>
          </section>
          <p className="rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">{writable ? "项目保存在当前服务的 JSON 文件中；与连接此服务的设备共享。未保存草稿仅在本浏览器恢复。" : "只读模式：可以查看和导出项目。写入仅对本机或显式配置的受信私网来源开放。"}</p>
          {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive wrap-anywhere">{error}</p>}
          {form && (
            <section className="rounded-lg border bg-muted/40 p-4 sm:p-6" aria-label={form.type === "create" ? "新建项目" : form.type === "import" ? "导入项目" : "重命名项目"}>
              <form onSubmit={submit} className="space-y-4">
                <h2 className="text-sm font-medium">{form.type === "create" ? "新建空白项目" : form.type === "import" ? "导入为新项目" : "重命名项目"}</h2>
                <label className="grid gap-2 text-sm">{form.type === "import" ? "项目名称（留空沿用 JSON 名称）" : "项目名称"}<Input value={name} onChange={(event) => setName(event.target.value)} required={form.type !== "import"} maxLength={120} disabled={busy} /></label>
                {form.type === "import" && <>
                  <label className="grid gap-2 text-sm">粘贴设计 JSON<Textarea value={json} onChange={(event) => setJson(event.target.value)} className="min-h-52 font-mono text-xs" required disabled={busy} spellCheck={false} /></label>
                  <label className="grid gap-2 text-sm">或读取 JSON 文件<input type="file" accept=".json,application/json" className="min-h-11 max-w-full rounded-lg border bg-background p-2 text-xs" disabled={busy} onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024) { setError("项目文件不能超过 2 MiB。"); return; }
                    try { setJson(await file.text()); setError(""); } catch { setError("文件读取失败，请重新选择或粘贴 JSON。"); }
                  }} /></label>
                  <p className="text-xs leading-relaxed text-muted-foreground">会生成新 ID，不覆盖已有项目。JSON 引用的型材和配件必须存在于当前共享目录库中。</p>
                </>}
                <div className="flex flex-wrap gap-2"><Button type="submit" size="touch" disabled={busy || !writable}>{busy ? "处理中…" : form.type === "import" ? "校验并导入" : "确定"}</Button><Button type="button" variant="outline" size="touch" disabled={busy} onClick={() => setForm(null)}>取消</Button></div>
              </form>
            </section>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Input aria-label="搜索项目" placeholder="搜索名称、说明或 ID" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 sm:max-w-sm" />
            <div role="group" aria-label="项目范围" className="flex gap-2">
              <Button size="touch" variant={!archived ? "secondary" : "ghost"} aria-pressed={!archived} onClick={() => setArchived(false)}>进行中 {library.projects.length}</Button>
              <Button size="touch" variant={archived ? "secondary" : "ghost"} aria-pressed={archived} onClick={() => setArchived(true)}>已归档 {library.archived.length}</Button>
            </div>
          </div>
          {projects.length === 0 ? <section className="grid min-h-52 place-content-center gap-3 rounded-lg border border-dashed p-6 text-center"><FolderOpen className="mx-auto size-6 text-muted-foreground" /><h2 className="text-sm font-medium">{query ? "没有匹配的项目" : archived ? "暂无归档项目" : "还没有项目"}</h2><p className="text-xs text-muted-foreground">{query ? "试试其他关键词。" : archived ? "归档项目会保留数据，可以随时恢复。" : "新建空白项目，或导入已有设计 JSON。"}</p></section> : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((project) => (
                <article key={project.id} className="flex min-w-0 flex-col rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-3"><h2 className="min-w-0 text-base font-medium wrap-anywhere">{project.name}</h2><span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{project.status === "invalid" ? "需修复" : project.status === "empty" ? "待添加零件" : "有效设计"}</span></div>
                  <p className="mt-2 min-h-10 text-sm leading-relaxed text-muted-foreground wrap-anywhere">{project.description || "暂无项目说明"}</p>
                  <p className="mt-3 truncate font-mono text-xs text-muted-foreground" title={project.id}>{project.id}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{project.partCount} 个零件 · rev.{project.revision} · {Number.isNaN(Date.parse(project.updatedAt)) ? "时间未知" : dateFormat.format(new Date(project.updatedAt))}</p>
                  {project.error && <p className="mt-3 text-xs leading-relaxed text-destructive wrap-anywhere">{project.error}</p>}
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
                    {!archived && <Link href={`/projects/${project.id}`} prefetch={false} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-secondary px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">{project.status === "invalid" ? "查看问题" : "打开项目"}<ArrowUpRight className="size-4" /></Link>}
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
