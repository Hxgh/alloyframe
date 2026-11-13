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
  draft?: boolean;
  invalid?: boolean;
};

const CATEGORY_ORDER = ["型材", "板材", "外购件", "配件"] as const;

function download(filename: string, content: string) {
  // 加 BOM 让 Excel 正确识别 UTF-8 中文
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 给移动 Safari 留出读取 Blob 的时间，避免点击后立即失效。
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BomPanel({ design, catalog, accessories, draft = false, invalid = false }: Props) {
  const bom = useMemo(() => buildBom(design, catalog, accessories), [design, catalog, accessories]);

  const grouped = useMemo(() => {
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      lines: bom.lines.filter((l) => l.category === cat),
    })).filter((g) => g.lines.length > 0);
  }, [bom]);

  if (invalid) return <div className="p-4 text-sm leading-relaxed text-muted-foreground">当前数据未通过校验，算料和 CSV 导出已暂停。修复后会自动恢复。</div>;
  if (design.parts.length === 0 && design.accessories.length === 0) return <div className="p-4 text-sm leading-relaxed text-muted-foreground">尚无零件或配件。添加构件后，这里会生成算料与切割清单。</div>;

  return (
    <ScrollArea className="h-full min-w-0">
      <div className="min-w-0 px-3 pb-4 pt-3">
        <div className="mb-2 flex min-w-0 items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">材料清单</h2>
          <span className="shrink-0 text-xs text-muted-foreground">{draft ? "未保存草稿" : "已保存"}</span>
        </div>
        {/* 概览 */}
        <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/40 p-3">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">型材总长</dt>
            <dd className="font-mono text-base font-medium leading-6 tabular-nums wrap-anywhere">
              {bom.profileLengthM.toFixed(2)}
              <span className="ml-1 text-xs text-muted-foreground">m</span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">估算重量</dt>
            <dd className="font-mono text-base font-medium leading-6 tabular-nums wrap-anywhere">
              {bom.totalMassKg.toFixed(1)}
              <span className="ml-1 text-xs text-muted-foreground">kg</span>
            </dd>
          </div>
          <div className="col-span-2 min-w-0">
            <dt className="text-xs text-muted-foreground">材料估算</dt>
            <dd className="flex min-w-0 flex-wrap items-baseline gap-2">
              <span className="min-w-0 font-mono text-base font-medium tabular-nums wrap-anywhere">
                {bom.lines.some((line) => line.lineTotal != null) ? `¥${bom.knownTotal.toFixed(0)}` : "暂无估价"}
              </span>
              <Badge variant="outline" className="h-auto min-w-0 shrink border-border whitespace-normal px-1.5 text-xs font-normal">
                估算 · 非报价
              </Badge>
            </dd>
          </div>
        </dl>

        <p className="mt-2 text-xs leading-relaxed text-muted-foreground wrap-anywhere">
          重量不含配件，部分零件按尺寸估算。{bom.hasUnknownPrice && "未设置价格的项目未计入合计。"}
        </p>

        <div className="mt-3 grid min-w-0 grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="touch"
            className="min-w-0"
            onClick={() => download(`${design.id}-cutlist.csv`, cutListCsv(bom))}
          >
            <Download aria-hidden="true" className="size-4" />
            <span className="min-w-0 wrap-anywhere">切割清单</span>
          </Button>
          <Button
            variant="outline"
            size="touch"
            className="min-w-0"
            onClick={() => download(`${design.id}-bom.csv`, bomCsv(bom))}
          >
            <Download aria-hidden="true" className="size-4" />
            <span className="min-w-0 wrap-anywhere">完整算料</span>
          </Button>
        </div>

        <Separator className="my-3" />

        {/* 明细 */}
        <div className="min-w-0 space-y-3">
          {grouped.map(({ category, lines }) => (
            <div key={category} className="min-w-0">
              <div className="mb-1 flex min-w-0 items-baseline justify-between gap-2 px-2">
                <h3 className="text-xs font-medium text-muted-foreground">{category}</h3>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{lines.length} 项</span>
              </div>
              <ul className="min-w-0 space-y-1">
                {lines.map((line) => (
                  <li
                    key={line.key}
                    className="min-w-0 rounded-lg px-2 py-1.5"
                  >
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="min-w-0 flex-1 text-sm leading-snug wrap-anywhere">{line.label}</span>
                      <span className="shrink-0 font-mono text-sm tabular-nums">
                        ×{line.qty}
                      </span>
                    </div>
                    <div className="mt-1 flex min-w-0 items-baseline gap-2">
                      <span className="min-w-0 flex-1 font-mono text-sm leading-5 text-muted-foreground wrap-anywhere">
                        {line.spec}
                      </span>
                      {line.lineTotal != null && (
                        <span className="shrink-0 font-mono text-sm tabular-nums">
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

        <p className="mt-4 border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground wrap-anywhere">
          型材米重与单价为公开资料估算，采购前请以供应商实测手册为准。
        </p>
      </div>
    </ScrollArea>
  );
}
