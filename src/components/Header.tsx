"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { ArrowLeft } from "lucide-react";
import type { Design } from "@/lib/schema";
import { Separator } from "@/components/ui/separator";
import { ThemeSelect } from "@/components/ThemeSelect";

type Props = {
  design: Design;
  onBack: (event: MouseEvent<HTMLAnchorElement>) => void;
};

export function Header({ design, onBack }: Props) {
  return (
    <header className="app-header flex min-h-14 min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 sm:gap-3 sm:px-4">
      <Link href="/" prefetch={false} onClick={onBack} aria-label="返回项目库" title="返回项目库" className="grid size-[var(--control-icon-size)] shrink-0 place-items-center rounded-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ArrowLeft className="size-4" />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold" title={design.name}>{design.name}</h1>
        <p className="truncate text-xs text-muted-foreground">铝构 · AlloyFrame<span className="hidden sm:inline"> · 项目工作台</span><span className="hidden sm:inline"> · rev.{design.revision}</span></p>
      </div>
      <Separator orientation="vertical" className="my-1" />
      <div role="group" aria-label="系统外观" className="flex shrink-0 items-center gap-2 pl-1">
        <span className="hidden text-xs text-muted-foreground sm:inline">外观</span>
        <ThemeSelect />
      </div>
    </header>
  );
}
