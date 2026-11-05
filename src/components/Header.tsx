"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import type { Design } from "@/lib/schema";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";

type Props = { design: Design };

const THEMES = [
  { value: "system", label: "跟随系统", Icon: Monitor },
  { value: "light", label: "浅色", Icon: Sun },
  { value: "dark", label: "深色", Icon: Moon },
] as const;

export function Header({ design }: Props) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // next-themes 在挂载前无法得知实际主题，避免水合不一致
  useEffect(() => setMounted(true), []);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/60 px-4">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold tracking-tight">榫卯</span>
        <span className="font-mono text-[11px] text-muted-foreground">sunmao</span>
      </div>

      <Separator orientation="vertical" className="h-4" />

      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-xs text-muted-foreground">{design.name}</span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
          rev.{design.revision}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {design.meta.heightRange && (
          <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
            高度 {design.meta.heightRange[0]}–{design.meta.heightRange[1]} mm
          </span>
        )}
        {design.meta.loadRating && (
          <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
            承重 {design.meta.loadRating} kg
          </span>
        )}

        <Separator orientation="vertical" className="h-4" />

        <div className="flex items-center rounded-md border border-border/60 p-0.5">
          {THEMES.map(({ value, label, Icon }) => (
            <Button
              key={value}
              variant={mounted && theme === value ? "secondary" : "ghost"}
              size="sm"
              className="h-6 w-6 p-0"
              aria-label={label}
              title={label}
              onClick={() => setTheme(value)}
            >
              <Icon className="size-3.5" />
            </Button>
          ))}
        </div>
      </div>
    </header>
  );
}
