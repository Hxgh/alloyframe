"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import type { Design } from "@/lib/schema";
import { Separator } from "@/components/ui/separator";
import { ThemeSelect } from "@/components/ThemeSelect";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  design: Design;
  onBack: (event: MouseEvent<HTMLAnchorElement>) => void;
  projectActions?: ReactNode;
};

export function Header({ design, onBack, projectActions }: Props) {
  return (
    <header className="app-header flex min-h-14 min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 sm:gap-3 sm:px-4">
      <Link
        href="/"
        prefetch={false}
        onClick={onBack}
        aria-label="返回项目库"
        title="返回项目库"
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon-touch" }),
          "grid shrink-0 place-items-center"
        )}
      >
        <ArrowLeft className="size-4" />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold" title={design.name}>{design.name}</h1>
      </div>
      {projectActions}
      <Separator orientation="vertical" className="my-1 hidden sm:block" />
      <div role="group" aria-label="系统外观" className="flex shrink-0 items-center">
        <ThemeSelect />
      </div>
    </header>
  );
}
