import { Suspense } from "react";
import { io } from "next/cache";
import { getProjectLibrary } from "@/lib/project-store";
import { ProjectLibrary } from "@/components/project/ProjectLibrary";

async function Library() {
  await io();
  const initial = await getProjectLibrary();
  return <ProjectLibrary initial={initial} />;
}

export default function Home() {
  return <Suspense fallback={<div className="grid h-dvh place-items-center text-sm text-muted-foreground">载入项目库…</div>}><Library /></Suspense>;
}
