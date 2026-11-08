import Link from "next/link";
import { Suspense } from "react";
import { io } from "next/cache";
import { getProject, getStoreWritable, ProjectStoreError } from "@/lib/project-store";
import { loadAccessories, loadCatalog } from "@/lib/data";
import { ProjectEditor } from "@/components/project/ProjectEditor";

async function Project({ params }: { params: Promise<{ id: string }> }) {
  await io();
  const { id } = await params;
  const result = await getProject(id).then((initial) => ({ initial, catalog: loadCatalog(), accessories: loadAccessories() })).catch((cause: unknown) => ({ error: cause }));
  if ("initial" in result) {
    return <ProjectEditor key={id} initial={result.initial} catalog={result.catalog} accessories={result.accessories} writable={getStoreWritable()} />;
  }
  const error = result.error instanceof ProjectStoreError ? result.error : null;
  return <main className="mx-auto grid min-h-dvh max-w-xl content-center gap-4 p-6">
    <h1 className="text-xl font-semibold">{error?.status === 404 ? "项目不存在或已归档" : "项目暂时无法打开"}</h1>
    <p className="text-sm leading-relaxed text-muted-foreground wrap-anywhere">{error?.message ?? "读取项目失败，请检查数据目录和共享目录库。"}</p>
    {error?.issues && <ul className="space-y-2 text-xs text-destructive">{error.issues.map((issue, index) => <li key={index}>{issue.path}：{issue.message}</li>)}</ul>}
    <p className="text-xs leading-relaxed text-muted-foreground">不会自动覆盖文件。损坏的数据可由人或 Agent 在 data/designs 中修复，再运行 pnpm validate。</p>
    <Link href="/" prefetch={false} className="inline-flex min-h-11 w-fit items-center rounded-lg border px-4 text-sm hover:bg-muted">返回项目库</Link>
  </main>;
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<div className="grid h-dvh place-items-center text-sm text-muted-foreground">载入项目…</div>}><Project params={params} /></Suspense>;
}
