"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RawProject, ValidationIssue } from "@/lib/projects";
import { inspectDesign } from "@/lib/validation";
import type { AccessoryCatalog, Catalog } from "@/lib/schema";
import { ProjectRequestError, projectRequest } from "@/lib/project-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  id: string;
  raw: RawProject;
  catalog: Catalog;
  accessories: AccessoryCatalog;
  writable: boolean;
};

/**
 * 无效项目的修复面板：展示问题原文与校验问题，
 * 提供一个 JSON 编辑框，修复到校验通过后就地保存（不改 id、不生成副本）。
 */
export function ProjectRepair({ id, raw, catalog, accessories, writable }: Props) {
  const router = useRouter();
  const [text, setText] = useState(raw.text);
  const [fingerprint, setFingerprint] = useState(raw.fingerprint);
  const [issues, setIssues] = useState<ValidationIssue[]>(raw.issues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const analysis = useMemo(() => {
    if (!text.trim()) return { design: null, issues: [{ level: "error" as const, path: "(根)", message: "原文为空，请粘贴或输入设计 JSON。" }] };
    try {
      const result = inspectDesign(JSON.parse(text), catalog, accessories);
      if (result.design && result.design.id !== id) {
        return { design: null, issues: [{ level: "error" as const, path: "id", message: `设计 id 必须为 "${id}"，不能修改。` }] };
      }
      return result;
    } catch {
      return { design: null, issues: [{ level: "error" as const, path: "JSON", message: "JSON 无法解析，请检查引号、逗号和括号。" }] };
    }
  }, [text, id, catalog, accessories]);
  const valid = analysis.design != null;
  const displayIssues = text === raw.text && issues.length > 0 ? issues : analysis.issues;

  function revert() {
    setText(raw.text);
    setFingerprint(raw.fingerprint);
    setIssues(raw.issues);
    setError("");
    setNotice("");
    setConfirmDiscard(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await projectRequest<{ fingerprint: string }>(`/api/projects/${id}`, {
        method: "PUT", body: JSON.stringify({ design: analysis.design, fingerprint }),
      });
      setFingerprint(result.fingerprint);
      setNotice("已保存。正在重新载入编辑器…");
      // 新指纹反映当前落盘内容；刷新后回到常规编辑器。
      setTimeout(() => router.refresh(), 300);
    } catch (cause) {
      const status = cause instanceof ProjectRequestError ? cause.status : undefined;
      if (status === 409) {
        setError("文件已被其他客户端修改，指纹过期。请先「重新读取」后再修复。");
        setNotice("");
      } else {
        setError((cause as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function reload() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const fresh = await projectRequest<{ raw: RawProject }>(`/api/projects/${id}?raw=true`);
      setText(fresh.raw.text);
      setFingerprint(fresh.raw.fingerprint);
      setIssues(fresh.raw.issues);
      setNotice("已重新读取文件原文。");
      setConfirmDiscard(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-2xl content-center gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">修复项目「{id}」</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          文件未通过校验，无法进入常规编辑器。请在下方修正 JSON，校验通过后就地保存；保存前原文件不会被改动。
        </p>
      </div>

      {displayIssues.length > 0 && (
        <section aria-label="校验问题" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <h2 className="text-sm font-medium text-destructive">校验问题（{displayIssues.length}）</h2>
          <ul className="mt-1.5 list-outside list-disc space-y-1 pl-4 text-xs leading-5 text-destructive">
            {displayIssues.slice(0, 20).map((issue, index) => (
              <li key={index} className="wrap-anywhere">
                {issue.path}{issue.partId ? `（零件 ${issue.partId}）` : ""}：{issue.message}
              </li>
            ))}
            {displayIssues.length > 20 && <li>…其余 {displayIssues.length - 20} 条省略</li>}
          </ul>
        </section>
      )}

      <form onSubmit={save} className="min-w-0 space-y-3">
        <label htmlFor="repair-json" className="block text-sm font-medium">设计 JSON 原文</label>
        <Textarea
          id="repair-json"
          value={text}
          onChange={(event) => { setText(event.target.value); setNotice(""); }}
          rows={18}
          spellCheck={false}
          className="font-mono text-xs leading-5"
          readOnly={!writable}
          aria-invalid={!valid}
        />
        {!valid && <p role="alert" className="text-xs leading-5 text-destructive">当前内容未通过校验（{analysis.issues.length} 个问题）；修正后可保存。</p>}
        {error && <p role="alert" className="text-xs leading-5 text-destructive wrap-anywhere">{error}</p>}
        {notice && <p role="status" className="text-xs leading-5 text-muted-foreground">{notice}</p>}
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button type="submit" size="touch" disabled={!valid || !writable || saving}>{saving ? "保存中…" : "修复并保存"}</Button>
          <Button type="button" size="touch" variant="outline" disabled={saving} onClick={() => void reload()}>重新读取</Button>
          {text !== raw.text && (
            <Button type="button" size="touch" variant="ghost" disabled={saving} onClick={() => setConfirmDiscard(true)}>放弃修改</Button>
          )}
          <Link href="/" prefetch={false} className="inline-flex min-h-[var(--control-height)] items-center rounded-lg border px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">返回项目库</Link>
        </div>
      </form>

      {confirmDiscard && (
        <div role="alertdialog" aria-label="放弃修改" className="rounded-lg border border-border bg-background p-4">
          <p className="text-sm leading-relaxed">放弃当前修改，恢复到打开时的文件原文？</p>
          <div className="mt-3 flex gap-2">
            <Button size="touch" variant="destructive" onClick={revert}>放弃修改</Button>
            <Button size="touch" variant="outline" onClick={() => setConfirmDiscard(false)}>继续编辑</Button>
          </div>
        </div>
      )}
    </main>
  );
}
