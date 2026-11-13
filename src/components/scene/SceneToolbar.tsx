"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Box, Boxes, CircleHelp, Focus, Maximize, Minimize, RotateCcw, Ruler, View, X } from "lucide-react";
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const clickTimeout = useRef<number | null>(null);
  const touchStart = useRef<{ x: number; y: number; value: number } | null>(null);
  const isHovering = useRef(false);

  // 清理 timeout
  useEffect(() => {
    return () => {
      if (clickTimeout.current !== null) {
        clearTimeout(clickTimeout.current);
      }
    };
  }, []);

  // 单击：切换 0% 和 100%
  // 双击：回到 0% 或 100%（取决于当前是拆还是不拆）
  function handleClick() {
    if (clickTimeout.current !== null) {
      // 双击
      clearTimeout(clickTimeout.current);
      clickTimeout.current = null;
      onAmountChange(amount > 0 ? 100 : 0);
    } else {
      // 等待可能的双击
      // 在测试环境中，如果 setTimeout 不可用，立即执行单击
      if (typeof setTimeout === 'undefined') {
        onAmountChange(amount > 0 ? 0 : 100);
      } else {
        clickTimeout.current = setTimeout(() => {
          clickTimeout.current = null;
          // 单击：切换装配/拆解
          onAmountChange(amount > 0 ? 0 : 100);
        }, 300) as unknown as number;
      }
    }
  }

  // 移动端：按住滑动改变百分比
  function handleTouchStart(event: React.TouchEvent<HTMLButtonElement>) {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, value: amount };
  }

  function handleTouchMove(event: React.TouchEvent<HTMLButtonElement>) {
    if (!touchStart.current || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = touch.clientY - touchStart.current.y;
    
    // 检测是否移动超过阈值
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      // 清除单击/双击定时器
      if (clickTimeout.current) {
        clearTimeout(clickTimeout.current);
        clickTimeout.current = null;
      }
      
      // 水平或垂直滑动改变百分比，每 2px 改变 1%
      const delta = Math.abs(dx) > Math.abs(dy) ? dx : -dy;
      const newValue = Math.max(0, Math.min(100, touchStart.current.value + Math.round(delta / 2)));
      onAmountChange(newValue);
      event.preventDefault();
    }
  }

  function handleTouchEnd() {
    touchStart.current = null;
  }

  // PC端：鼠标悬停时用滚轮改变百分比
  function handleMouseEnter() {
    isHovering.current = true;
  }

  function handleMouseLeave() {
    isHovering.current = false;
  }

  function handleWheel(event: React.WheelEvent<HTMLButtonElement>) {
    if (!isHovering.current || empty) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -5 : 5; // 每次滚轮滚动改变 5%
    const newValue = Math.max(0, Math.min(100, amount + delta));
    onAmountChange(newValue);
  }

  return (
    <>
      <div role="group" aria-label="3D 视图工具栏" className="scene-tools">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
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
            <Button
              ref={buttonRef}
              variant={amount > 0 ? "secondary" : "ghost"}
              size={amount > 0 ? "touch" : "icon-touch"}
              className={amount > 0 ? "min-h-[var(--control-height)] gap-1 px-2.5 font-mono text-xs tabular-nums" : "size-[var(--control-icon-size)] p-0"}
              disabled={empty}
              onClick={handleClick}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onWheel={handleWheel}
              aria-label={amount === 100 ? "恢复装配" : amount > 0 ? `当前分离 ${amount}%` : "拆解"}
              title={amount === 100 ? "点击：恢复装配 · 双击：保持完全拆解 · 滚轮或滑动：调整" : amount > 0 ? `点击：完全拆解 · 双击：恢复装配 · 滚轮或滑动：调整` : "点击：拆解 · 滚轮或滑动：调整"}
            >
              {amount === 100 ? <Boxes className="size-4 shrink-0" /> : <Box className="size-4 shrink-0" />}
              {amount > 0 && <span>{amount}%</span>}
            </Button>
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
