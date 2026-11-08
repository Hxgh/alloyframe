"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto grid min-h-dvh max-w-lg content-center gap-4 p-6">
    <h1 className="text-xl font-semibold">暂时无法载入项目库</h1>
    <p className="text-sm leading-relaxed text-muted-foreground">请检查项目数据目录与共享型材、配件目录是否可读且格式有效。不会自动重置或覆盖项目文件。</p>
    <Button size="touch" variant="outline" className="w-fit" onClick={reset}>重试读取</Button>
  </main>;
}
