"use client";

import { useMemo } from "react";
import { Download } from "lucide-react";
import type { AccessoryCatalog, Catalog, Design } from "@/lib/schema";
import { bomCsv, buildBom, cutListCsv } from "@/lib/bom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Props = {
  design: Design;
  catalog: Catalog;
  accessories: AccessoryCatalog;
};

const CATEGORY_ORDER = ["型材", "板材", "外购件", "配件"] as const;

function download(filename: string, content: string) {
  // 加 BOM 让 Excel 正确识别 UTF-8 中文
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function BomPanel({ design, catalog, accessories }: Props) {
  const bom = useMemo(() => buildBom(design, catalog, accessories), [design, catalog, accessories]);

  const grouped = useMemo(() => {
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      lines: bom.lines.filter((l) => l.category === cat),
    })).filter((g) => g.lines.length > 0);
  }, [bom]);

  return (
    <ScrollArea className="h-full">
      <div className="px-3 pb-4 pt-3">
        {/* 概览 */}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-muted/50 p-3">
          <div>
            <dt className="text-[10px] text-muted-foreground">型材总长</dt>
            <dd className="font-mono text-sm tabular-nums">
              {bom.profileLengthM.toFixed(2)}
              <span className="ml-0.5 text-[10px] text-muted-foreground">m</span>
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-muted-foreground">总重</dt>
            <dd className="font-mono text-sm tabular-nums">
              {bom.totalMassKg.toFixed(1)}
              <span className="ml-0.5 text-[10px] text-muted-foreground">kg</span>
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-[10px] text-muted-foreground">材料估算</dt>
            <dd className="flex items-baseline gap-1.5">
              <span className="font-mono text-sm tabular-nums">
                ¥{bom.knownTotal.toFixed(0)}
              </span>
              <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-normal">
                估算 · 非报价
              </Badge>
            </dd>
          </div>
        </dl>

        {bom.hasUnknownPrice && (
          <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-muted-foreground">
            部分项目无公开价格，未计入合计。
          </p>
        )}

        <div className="mt-3 flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 text-[11px]"
            onClick={() => download(`${design.id}-cutlist.csv`, cutListCsv(bom))}
          >
            <Download className="size-3" />
            切割清单
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 text-[11px]"
            onClick={() => download(`${design.id}-bom.csv`, bomCsv(bom))}
          >
            <Download className="size-3" />
            完整算料
          </Button>
        </div>

        <Separator className="my-3" />

        {/* 明细 */}
        <div className="space-y-3">
          {grouped.map(({ category, lines }) => (
            <div key={category}>
              <div className="mb-1 flex items-baseline justify-between px-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {category}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">{lines.length}</span>
              </div>
              <ul className="space-y-0.5">
                {lines.map((line) => (
                  <li
                    key={line.key}
                    className="rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[11px]">{line.label}</span>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                        ×{line.qty}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                        {line.spec}
                      </span>
                      {line.lineTotal != null && (
                        <span className="shrink-0 font-mono text-[10px] tabular-nums">
                          ¥{line.lineTotal.toFixed(0)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-4 border-t border-border/60 pt-2 text-[10px] leading-relaxed text-muted-foreground">
          型材米重与单价为公开资料估算，采购前请以供应商实测手册为准。
        </p>
      </div>
    </ScrollArea>
  );
}
