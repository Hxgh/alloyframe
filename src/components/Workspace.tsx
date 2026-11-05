"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import type { AccessoryCatalog, Catalog, Design } from "@/lib/schema";
import { explodeOffsets } from "@/lib/explode";
import { PartsList } from "@/components/panel/PartsList";
import { BomPanel } from "@/components/panel/BomPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/Header";

const Scene = dynamic(() => import("./scene/Scene").then((m) => m.Scene), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-sm text-muted-foreground">
      载入 3D 场景…
    </div>
  ),
});

type Props = {
  design: Design;
  catalog: Catalog;
  accessoryCatalog: AccessoryCatalog;
};

export function Workspace({ design, catalog, accessoryCatalog }: Props) {
  const { resolvedTheme } = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [explodeAmount, setExplodeAmount] = useState(0);
  const dark = resolvedTheme === "dark";

  const offsets = useMemo(
    () => explodeOffsets(design.parts, explodeAmount / 100),
    [design.parts, explodeAmount],
  );

  const selectedPart = design.parts.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Header design={design} />

      <div className="flex min-h-0 flex-1">
        {/* 3D 视口 */}
        <div className="relative min-w-0 flex-1">
          <Scene
            design={design}
            catalog={catalog}
            selectedId={selectedId}
            explodeAmount={explodeAmount}
            offsets={offsets}
            showGrid
            dark={dark}
            onSelect={(id) => setSelectedId(id || null)}
          />

          {/* 左下角：拆解控制 */}
          <div className="pointer-events-auto absolute bottom-4 left-4 w-64 rounded-lg border border-border/60 bg-background/80 p-3 backdrop-blur-sm">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs font-medium">拆解</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {explodeAmount}%
              </span>
            </div>
            <Slider
              value={[explodeAmount]}
              min={0}
              max={100}
              step={1}
              onValueChange={(v) => setExplodeAmount(Array.isArray(v) ? v[0] : v)}
            />
            {explodeAmount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-6 w-full text-xs"
                onClick={() => setExplodeAmount(0)}
              >
                复位
              </Button>
            )}
          </div>

          {/* 右上角：选中零件信息 */}
          {selectedPart && (
            <div className="absolute right-4 top-4 max-w-xs rounded-lg border border-border/60 bg-background/85 p-3 text-xs backdrop-blur-sm">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-medium">{selectedPart.role}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{selectedPart.id}</span>
              </div>
              <Separator className="my-2" />
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">规格</dt>
                <dd className="font-mono">
                  {selectedPart.size.join(" × ")} mm
                </dd>
                <dt className="text-muted-foreground">材料</dt>
                <dd>{selectedPart.material}</dd>
                {selectedPart.profile && (
                  <>
                    <dt className="text-muted-foreground">型材</dt>
                    <dd className="font-mono">{selectedPart.profile}</dd>
                  </>
                )}
              </dl>
              {selectedPart.note && (
                <p className="mt-2 border-t border-border/60 pt-2 text-muted-foreground">
                  {selectedPart.note}
                </p>
              )}
            </div>
          )}
        </div>

        {/* 右侧面板 */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-border/60">
          <Tabs defaultValue="parts" className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="px-3 pt-3">
              <TabsList className="w-full">
                <TabsTrigger value="parts">零件</TabsTrigger>
                <TabsTrigger value="bom">算料</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="parts" className="min-h-0 flex-1 overflow-hidden">
              <PartsList
                design={design}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </TabsContent>
            <TabsContent value="bom" className="min-h-0 flex-1 overflow-hidden">
              <BomPanel design={design} catalog={catalog} accessories={accessoryCatalog} />
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}
