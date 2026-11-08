"use client";

import { useId, useState, type RefObject } from "react";
import { Box, Boxes, CircleHelp, Focus, Maximize, Minimize, RotateCcw, SlidersHorizontal, View, X } from "lucide-react";
import type { ViewAction } from "@/lib/scene-fit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";

type Props = {
  amount: number;
  empty: boolean;
  fullscreen: boolean;
  fullscreenSupported: boolean;
  fullscreenContainer: RefObject<HTMLElement | null>;
  error: string;
  onAmountChange: (amount: number) => void;
  onView: (action: ViewAction) => void;
  onFullscreen: () => void;
};

const VIEWS = [
  { action: "front", label: "正视", axis: "+Z", description: "从正面看，X 向右、Y 向上" },
  { action: "right", label: "右视", axis: "+X", description: "从右侧看，Z 向左、Y 向上" },
  { action: "top", label: "顶视", axis: "+Y", description: "从上方看，X 向右、−Z 朝屏幕上方" },
] as const;

export function SceneToolbar({ amount, empty, fullscreen, fullscreenSupported, fullscreenContainer, error, onAmountChange, onView, onFullscreen }: Props) {
  const [adjusting, setAdjusting] = useState(false);
  const [dialog, setDialog] = useState<"views" | "help" | null>(null);
  const labelId = useId();
  const sliderId = useId();

  return (
    <>
      <div role="group" aria-label="3D 视图工具栏" className="scene-tools border-t border-border bg-background">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-1.5">
          <div role="group" aria-label="视图操作" className="flex items-center gap-1">
            <Button variant="outline" size="touch" className="px-2" onClick={() => setDialog("views")} aria-haspopup="dialog"><View className="size-4" />视角</Button>
            <Button variant="ghost" size="icon-touch" aria-label="适应视图" title="适应视图 · 保留观察方向" onClick={() => onView("fit")}><Focus className="size-4" /></Button>
            <Button variant="ghost" size="icon-touch" className="hidden sm:inline-flex" aria-label="重置视角" title="重置视角 · 恢复默认斜视" onClick={() => onView("reset")}><RotateCcw className="size-4" /></Button>
            <Button variant="ghost" size="icon-touch" aria-label={fullscreen ? "退出全屏" : "全屏视图"} title={fullscreenSupported ? fullscreen ? "退出全屏 · Esc" : "全屏视图" : "当前浏览器不支持全屏"} disabled={!fullscreenSupported} onClick={onFullscreen}>{fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}</Button>
            <Button variant="ghost" size="icon-touch" className="hidden sm:inline-flex" aria-label="坐标与拆解说明" title="坐标与拆解说明" aria-haspopup="dialog" onClick={() => setDialog("help")}><CircleHelp className="size-4" /></Button>
          </div>
          <div role="group" aria-label="结构展示" className="flex min-w-0 items-center gap-1">
            <Button variant="secondary" size="touch" className="px-2" disabled={empty} onClick={() => onAmountChange(amount === 100 ? 0 : 100)} aria-label={amount === 100 ? "恢复装配" : "一键拆解"}>
              {amount === 100 ? <Box className="size-4" /> : <Boxes className="size-4" />}{amount === 100 ? "装配" : "拆解"}
            </Button>
            <span className="hidden w-9 text-right font-mono text-xs tabular-nums text-muted-foreground min-[360px]:inline" aria-label={`分离程度 ${amount}%`}>{amount}%</span>
            <Button variant="ghost" size="icon-touch" aria-label="调整分离程度" title="调整分离程度" disabled={empty} aria-expanded={adjusting} aria-controls={sliderId} onClick={() => setAdjusting((value) => !value)}><SlidersHorizontal className="size-4" /></Button>
          </div>
        </div>
        {adjusting && <div id={sliderId} className="flex min-w-0 items-center gap-2 border-t border-border pt-2">
          <span id={labelId} className="shrink-0 text-xs text-muted-foreground">分离 {amount}%</span>
          <Slider className="min-w-0 flex-1 px-3" aria-labelledby={labelId} thumbProps={{ getAriaLabel: () => "分离程度", getAriaValueText: (_, value) => `分离 ${value}%` }} value={[amount]} min={0} max={100} step={1} onValueChange={(value) => onAmountChange(Array.isArray(value) ? value[0] : value)} />
          <Button variant="ghost" size="icon-touch" aria-label="恢复装配" title="恢复装配 · 分离程度归零" disabled={amount === 0} onClick={() => onAmountChange(0)}><Box className="size-4" /></Button>
        </div>}
        {error && <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}
      </div>
      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}>
        <DialogContent container={fullscreen ? fullscreenContainer : undefined}>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>{dialog === "views" ? "切换观察方向" : "坐标与拆解说明"}</DialogTitle>
            <Button variant="ghost" size="icon-touch" aria-label="关闭视图说明" onClick={() => setDialog(null)}><X className="size-4" /></Button>
          </div>
          <DialogDescription>{dialog === "views" ? "按世界坐标选择观察方向，切换视角只影响画布，不改变设计。" : "坐标帮助确定零件位置；自动拆解帮助观察结构，不是装配求解器。"}</DialogDescription>
          {dialog === "views" ? <div role="group" aria-label="观察方向" className="grid gap-2">
            {VIEWS.map(({ action, label, axis, description }) => <Button key={action} variant="outline" size="touch" className="justify-start text-left" aria-label={`${label}（${axis}）`} onClick={() => { setDialog(null); onView(action); }}>
              <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">{axis}</span><span><span className="block">{label}</span><span className="block text-xs font-normal text-muted-foreground">{description}</span></span>
            </Button>)}
            <Button variant="ghost" size="touch" aria-label="重置视角" onClick={() => { setDialog(null); onView("reset"); }}><RotateCcw className="size-4" />默认斜视 · 重置视角</Button>
            <Button variant="ghost" size="touch" onClick={() => setDialog("help")}><CircleHelp className="size-4" />坐标与拆解说明</Button>
          </div> : <div className="space-y-4 text-xs leading-relaxed">
            <section className="space-y-2" aria-label="世界坐标约定">
              <h3 className="text-sm font-medium">右手坐标 · 全局毫米</h3>
              <p><span className="axis-x font-mono">+X</span> 向右　<span className="axis-y font-mono">+Y</span> 向上　<span className="axis-z font-mono">+Z</span> 朝正面。</p>
              <p>以上方向以正视为基准；模型原点在地面中心，地面为 Y=0。零件位置是中心点，不是端点。右上角坐标轴会随观察姿态旋转。</p>
              <p className="text-muted-foreground">“适应视图”保留方向重新居中；“重置视角”恢复默认斜视。两者都不改变拆解状态。</p>
            </section>
            <section className="space-y-2 border-t border-border pt-3" aria-label="拆解机制说明">
              <h3 className="text-sm font-medium">为什么仍有分离程度？</h3>
              <p>点“拆解”直接到 100%，点“装配”回到 0%；微调用于观察中间关系。百分比是展示位移的强度，不是拆装工序的完成进度。</p>
              <p>自动拆解按零件位置、尺寸、类型和角色关键词同时展开，不包含连接拓扑、碰撞检测或真实拆装顺序。旋转、密集及特殊结构可能仍有遮挡；100% 不保证完全分离或实际可拆。</p>
              <p className="text-muted-foreground">不同项目可能需要专门的方向、分组和步骤方案，当前没有配置这些规则。展示不会修改正式 JSON，也不代表结构安全或可制造性认证。</p>
            </section>
          </div>}
        </DialogContent>
      </Dialog>
    </>
  );
}
