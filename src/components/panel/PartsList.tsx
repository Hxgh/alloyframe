"use client";

import { useMemo, type ReactNode } from "react";
import { useTheme } from "next-themes";
import type { Design } from "@/lib/schema";
import { materialLook } from "@/lib/materials";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type Props = {
  design: Design;
  selectedId: string | null;
  onSelect: (id: string) => void;
  children?: ReactNode;
};

export function PartsList({ design, selectedId, onSelect, children }: Props) {
  const { resolvedTheme } = useTheme();
  // 按角色分组，保持 design.json 里的原始顺序
  const groups = useMemo(() => {
    const map = new Map<string, Design["parts"]>();
    for (const part of design.parts) {
      if (!map.has(part.role)) map.set(part.role, []);
      map.get(part.role)!.push(part);
    }
    return [...map.entries()];
  }, [design.parts]);

  return (
    <ScrollArea className="h-full min-w-0">
      <div className="min-w-0 px-3 pb-4 pt-3">
        {children}
        <div className="mb-2 flex min-w-0 items-baseline justify-between gap-2 px-2">
          <span className="text-xs font-medium text-muted-foreground">
            零件
          </span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {design.parts.length}
          </span>
        </div>

        <div className="min-w-0 space-y-3">
          {groups.map(([role, parts]) => (
            <div key={role} className="min-w-0">
              <div className="mb-1 flex min-w-0 items-baseline gap-2 px-2">
                <span className="min-w-0 text-xs font-medium text-muted-foreground wrap-anywhere">{role}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  ×{parts.length}
                </span>
              </div>
              <div className="min-w-0 space-y-1">
                {parts.map((part) => {
                  const look = materialLook(part.material, resolvedTheme === "dark");
                  const active = selectedId === part.id;
                  return (
                    <button
                      key={part.id}
                      type="button"
                      aria-pressed={active}
                      aria-label={`${part.role}，${part.id}，${part.size.join(" × ")} 毫米，${part.profile ?? part.material}`}
                      onClick={() => onSelect(active ? "" : part.id)}
                      className={cn(
                        "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        active
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-muted/50",
                      )}
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15"
                        style={{ backgroundColor: look.color }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-sm leading-snug wrap-anywhere">
                          {part.size.join("×")}
                        </span>
                        <span className="block text-xs leading-snug text-muted-foreground wrap-anywhere">
                          {part.profile ?? part.material}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
