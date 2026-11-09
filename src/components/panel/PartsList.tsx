"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";
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
          <h2 className="text-sm font-semibold">零件清单</h2>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {design.parts.length} 件
          </span>
        </div>

        <div className="min-w-0 space-y-3">
          {groups.map(([role, parts]) => (
            <div key={role} className="min-w-0">
              <div className="mb-1 flex min-w-0 items-baseline gap-2 px-2">
                <h3 className="min-w-0 text-xs font-medium text-muted-foreground wrap-anywhere">{role}</h3>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  ×{parts.length}
                </span>
              </div>
              <div className="min-w-0 space-y-1">
                {parts.map((part) => {
                  const active = selectedId === part.id;
                  return (
                    <button
                      key={part.id}
                      type="button"
                      aria-pressed={active}
                      title={`${part.id} · ${part.material}`}
                      aria-label={`${part.role}，${part.id}，${part.size.join(" × ")} 毫米，${part.profile ?? part.material}`}
                      onClick={() => onSelect(active ? "" : part.id)}
                      className={cn(
                        "flex min-h-[var(--control-height)] w-full min-w-0 items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        active
                          ? "border-foreground/20 bg-muted text-foreground"
                          : "hover:bg-muted/50",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="material-swatch size-2.5 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15"
                        style={{
                          "--material-color": materialLook(part.material).color,
                          "--material-color-dark": materialLook(part.material, true).color,
                        } as CSSProperties}
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
