"use client";

import { useMemo } from "react";
import type { Design } from "@/lib/schema";
import { materialLook } from "@/lib/materials";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type Props = {
  design: Design;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function PartsList({ design, selectedId, onSelect }: Props) {
  // 按角色分组，保持 design.json 里的原始顺序
  const groups = useMemo(() => {
    const map = new Map<string, typeof design.parts>();
    for (const part of design.parts) {
      if (!map.has(part.role)) map.set(part.role, []);
      map.get(part.role)!.push(part);
    }
    return [...map.entries()];
  }, [design.parts]);

  return (
    <ScrollArea className="h-full">
      <div className="px-3 pb-4 pt-3">
        <div className="mb-2 flex items-baseline justify-between px-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            零件
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {design.parts.length}
          </span>
        </div>

        <div className="space-y-2.5">
          {groups.map(([role, parts]) => (
            <div key={role}>
              <div className="mb-1 flex items-baseline gap-1.5 px-1">
                <span className="text-xs font-medium">{role}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  ×{parts.length}
                </span>
              </div>
              <div className="space-y-0.5">
                {parts.map((part) => {
                  const look = materialLook(part.material);
                  const active = selectedId === part.id;
                  return (
                    <button
                      key={part.id}
                      onClick={() => onSelect(active ? "" : part.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                        active
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-muted/60",
                      )}
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15"
                        style={{ backgroundColor: look.color }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[11px] leading-tight">
                          {part.size.join("×")}
                        </span>
                        <span className="block truncate text-[10px] leading-tight text-muted-foreground">
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
