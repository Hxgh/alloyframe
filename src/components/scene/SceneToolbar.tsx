"use client";

import { useState, useEffect, useRef, type RefObject } from "react";
import { CircleHelp, Focus, Maximize, Minimize, RotateCcw, Ruler, View, X } from "lucide-react";
import type { ViewAction } from "@/lib/scene-fit";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Props = {
  amount: number;
  empty: boolean;
  fullscreen: boolean;
  fullscreenSupported: boolean;
  fullscreenBusy: boolean;
  fullscreenContainer: RefObject<HTMLElement | null>;
  error: string;
  showDimensions?: boolean;
  onShowDimensionsChange?: (enabled: boolean) => void;
  onAmountChange: (amount: number) => void;
  onView: (action: ViewAction) => void;
  onFullscreen: () => void;
};

const VIEWS = [
  { action: "front", label: "正视", axis: "+Z", description: "从正面看，X 向右、Y 向上" },
  { action: "right", label: "右视", axis: "+X", description: "从右侧看，Z 向左、Y 向上" },
  { action: "top", label: "顶视", axis: "+Y", description: "从上方看，X 向右、−Z 朝屏幕上方" },
] as const;

export function SceneToolbar({ amount, empty, fullscreen, fullscreenSupported, fullscreenBusy, fullscreenContainer, error, showDimensions = false, onShowDimensionsChange, onAmountChange, onView, onFullscreen }: Props) {
  const [dialog, setDialog] = useState<"views" | "help" | null>(null);
  const [touchStart, setTouchStart] = useState<{ y: number; amount: number } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const explodeButtonRef = useRef<HTMLButtonElement>(null);

  // PC 端滚轮微调
  useEffect(() => {
    if (empty) return;

    function handleWheel(e: WheelEvent) {
      // 仅在工具栏区域内触发
      if (!toolbarRef.current?.contains(e.target as Node)) return;
      
      e.preventDefault();
      const step = e.shiftKey ? 1 : 5; // Shift 精细调整
      const delta = e.deltaY > 0 ? -step : step;
      const newAmount = Math.max(0, Math.min(100, amount + delta));
      onAmountChange(newAmount);
    }

    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    toolbar.addEventListener("wheel", handleWheel, { passive: false });
    return () => toolbar.removeEventListener("wheel", handleWheel);
  }, [amount, empty, onAmountChange]);

  // 移动端触摸滑动调整
  useEffect(() => {
    if (empty) return;

    function handleTouchStart(e: TouchEvent) {
      if (!explodeButtonRef.current?.contains(e.target as Node)) return;
      const touch = e.touches[0];
      setTouchStart({ y: touch.clientY, amount });
    }

    function handleTouchMove(e: TouchEvent) {
      if (!touchStart) return;
      e.preventDefault();
      
      const touch = e.touches[0];
      const deltaY = touchStart.y - touch.clientY; // 向上滑动为正
      const step = deltaY / 2; // 2px = 1%
      const newAmount = Math.max(0, Math.min(100, touchStart.amount + step));
      onAmountChange(Math.round(newAmount));
    }

    function handleTouchEnd() {
      setTouchStart(null);
    }

    const button = explodeButtonRef.current;
    if (!button) return;

    button.addEventListener("touchstart", handleTouchStart);
    button.addEventListener("touchmove", handleTouchMove, { passive: false });
    button.addEventListener("touchend", handleTouchEnd);
    button.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      button.removeEventListener("touchstart", handleTouchStart);
      button.removeEventListener("touchmove", handleTouchMove);
      button.removeEventListener("touchend", handleTouchEnd);
      button.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [amount, empty, touchStart, onAmountChange]);

  const explodeScale = 1 - amount / 100 * 0.28;

  return (
    <>
      <div ref={toolbarRef} role="group" aria-label="3D 视图工具栏" className="scene-tools">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div role="group" aria-label="视图操作" className="flex items-center gap-1">
            <IconButton label="视角" title="切换观察方向" aria-haspopup="dialog" onClick={() => setDialog("views")}><View className="size-4" /></IconButton>
            <IconButton label="适应视图" title="适应当前展示并重新居中，保留观察方向" onClick={() => onView("fit")}><Focus className="size-4" /></IconButton>
            {onShowDimensionsChange && (
              <IconButton label={showDimensions ? "隐藏尺寸标注" : "显示尺寸标注"} active={showDimensions} disabled={empty} onClick={() => onShowDimensionsChange(!showDimensions)}><Ruler className="size-4" /></IconButton>
            )}
            <IconButton className="scene-extended-control" label="重置视角" title="重置视角 · 恢复默认斜视" onClick={() => onView("reset")}><RotateCcw className="size-4" /></IconButton>
            <IconButton label={fullscreen ? "退出全屏" : "全屏视图"} aria-pressed={fullscreen} aria-busy={fullscreenBusy}
              title={fullscreenBusy ? "正在切换全屏…" : fullscreen ? "退出全屏 · Esc" : fullscreenSupported ? "全屏视图" : "当前浏览器不支持全屏"}
              disabled={fullscreenBusy || (!fullscreen && !fullscreenSupported)} onClick={onFullscreen}>{fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}</IconButton>
            <IconButton className="scene-extended-control" label="坐标与拆解说明" aria-haspopup="dialog" onClick={() => setDialog("help")}><CircleHelp className="size-4" /></IconButton>
          </div>
          <div role="group" aria-label="结构展示" className="flex min-w-0 items-center gap-1">
            <IconButton
              ref={explodeButtonRef}
              label={amount === 0 ? "拆解" : "装配"}
              title={`当前拆解 ${amount}% · 点击${amount > 0 ? "恢复装配" : "完全拆解"}${empty ? "" : " · 滚轮微调，Shift 精调 · 上下滑动调整"}`}
              active={amount > 0}
              disabled={empty}
              onClick={() => onAmountChange(amount > 0 ? 0 : 100)}
              data-testid="explode-button"
            >
              <svg className="scene-explode-icon size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={4 / 3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d="M12 2 22 7 12 12 2 7Z" vectorEffect="non-scaling-stroke" style={{ transformOrigin: "12px 2px", transform: `scale(${explodeScale})` }} />
                <path d="M2 7 12 12 12 22 2 17Z" vectorEffect="non-scaling-stroke" style={{ transformOrigin: "2px 22px", transform: `scale(${explodeScale})` }} />
                <path d="M12 12 22 7 22 17 12 22Z" vectorEffect="non-scaling-stroke" style={{ transformOrigin: "22px 22px", transform: `scale(${explodeScale})` }} />
              </svg>
            </IconButton>
          </div>
        </div>
        {error && <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}
      </div>
      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}>
        <DialogContent container={fullscreenContainer}>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>{dialog === "views" ? "切换观察方向" : "坐标与拆解说明"}</DialogTitle>
            <IconButton label="关闭视图说明" onClick={() => setDialog(null)}><X className="size-4" /></IconButton>
          </div>
          <DialogDescription>{dialog === "views" ? "按世界坐标选择观察方向，切换视角只影响画布，不改变设计。" : "坐标帮助确定零件位置；自动拆解帮助观察结构，不是装配求解器。"}</DialogDescription>
          {dialog === "views" ? <div role="group" aria-label="观察方向" className="grid gap-2">
            {VIEWS.map(({ action, label, axis, description }) => <Button key={action} variant="outline" size="touch" className="justify-start text-left" aria-label={`${label}（${axis}）`} onClick={() => { setDialog(null); onView(action); }}>
              <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">{axis}</span><span><span className="block">{label}</span><span className="block text-xs font-normal text-muted-foreground">{description}</span></span>
            </Button>)}
            <Button variant="ghost" size="touch" aria-label="重置视角" onClick={() => { setDialog(null); onView("reset"); }}><RotateCcw className="size-4" />默认斜视 · 重置视角</Button>
            <Button variant="ghost" size="touch" onClick={() => setDialog("help")}><CircleHelp className="size-4" />坐标与拆解说明</Button>
          </div> : <div className="space-y-4 text-sm leading-relaxed">
            <section className="space-y-2" aria-label="世界坐标约定">
              <h3 className="text-sm font-medium">右手坐标 · 全局毫米</h3>
              <p><span className="axis-x font-mono">+X</span> 向右　<span className="axis-y font-mono">+Y</span> 向上　<span className="axis-z font-mono">+Z</span> 朝正面。</p>
              <p>以上方向以正视为基准；模型原点在地面中心，地面为 Y=0。零件位置是中心点，不是端点。右上角坐标轴会随观察姿态旋转。</p>
              <p className="text-muted-foreground">“适应视图”保留方向并按当前装配或拆解状态重新居中；“重置视角”恢复默认斜视。两者都不改变拆解状态。</p>
            </section>
            <section className="space-y-2 border-t border-border pt-3" aria-label="拆解视图说明">
              <h3 className="text-sm font-medium">拆解视图</h3>
              <p>点击“拆解”展开零件，点击“装配”恢复；分离程度可调整展示距离。</p>
              <p className="text-muted-foreground">拆解仅用于观察，不表示实际拆装顺序或结构安全；完全展开也不保证所有零件分离或可拆。</p>
            </section>
          </div>}
        </DialogContent>
      </Dialog>
    </>
  );
}
