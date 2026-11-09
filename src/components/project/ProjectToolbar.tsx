"use client";

import { useId, useState } from "react";
import { Copy, Download, Ellipsis, FileJson, LoaderCircle, RefreshCw, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

type Props = {
  id: string;
  status: string;
  savedAt: string;
  saving: boolean;
  canSave: boolean;
  autoSave: boolean;
  readOnly: boolean;
  pending: boolean;
  invalid: boolean;
  saveBlocked: boolean;
  onAutoSaveChange: (enabled: boolean) => void;
  onSave: () => void;
  onExport: () => void;
  onCopy: () => void;
  onRefresh: () => void;
};

export function ProjectToolbar({ id, status, savedAt, saving, canSave, autoSave, readOnly, pending, invalid, saveBlocked, onAutoSaveChange, onSave, onExport, onCopy, onRefresh }: Props) {
  const switchId = useId();
  const [filesOpen, setFilesOpen] = useState(false);

  return (
    <>
      <div role="group" aria-label="项目工具栏" className="project-toolbar flex min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-background px-3 py-1.5 sm:px-4">
        <div role="group" aria-label="项目保存" className="flex shrink-0 items-center gap-2">
          <Button size="touch" onClick={onSave} disabled={!canSave} aria-label="保存项目" aria-busy={saving} title="立即保存有效草稿到服务端文件">
            {saving ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Save className="size-4" />}保存
          </Button>
          <label htmlFor={switchId} className="flex min-h-[var(--control-height)] cursor-pointer items-center gap-2 rounded-lg px-1 text-sm">
            <Switch id={switchId} checked={autoSave} onCheckedChange={onAutoSaveChange} aria-label="自动保存" />
            <span>自动保存</span>
          </label>
        </div>
        <Separator orientation="vertical" className="my-2 hidden sm:block" />
        <p role="status" aria-live="polite" className="order-last min-w-0 basis-full truncate text-xs text-muted-foreground sm:order-none sm:flex-1 sm:basis-auto" title={savedAt ? `${status} · 上次文件保存 ${savedAt}` : status}>
          {status}
        </p>
        <Button variant="ghost" size="icon-touch" className="ml-auto" onClick={() => setFilesOpen(true)} aria-label="项目文件与保存说明" title="项目文件与保存说明" aria-haspopup="dialog">
          <Ellipsis className="size-4" />
        </Button>
      </div>
      <Dialog open={filesOpen} onOpenChange={setFilesOpen}>
        <DialogContent>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>项目文件与保存</DialogTitle>
            <Button variant="ghost" size="icon-touch" onClick={() => setFilesOpen(false)} aria-label="关闭项目文件面板"><X className="size-4" /></Button>
          </div>
          <DialogDescription>项目保存到服务端 JSON 文件，导出下载是另一份副本；视图与主题设置不改变设计。</DialogDescription>
          <div role="group" aria-label="项目文件操作" className="grid gap-2">
            <Button variant="outline" size="touch" disabled={pending || invalid || saveBlocked} onClick={() => { setFilesOpen(false); onExport(); }}><Download className="size-4" />导出 JSON</Button>
            <Button variant="outline" size="touch" disabled={readOnly || pending || invalid || saveBlocked} onClick={() => { setFilesOpen(false); onCopy(); }}><Copy className="size-4" />另存副本</Button>
            <Button variant="ghost" size="touch" disabled={saveBlocked} onClick={() => { setFilesOpen(false); onRefresh(); }}><RefreshCw className="size-4" />检查文件更新</Button>
          </div>
          <Separator />
          <section className="space-y-2 text-sm leading-relaxed" aria-label="保存机制说明">
            <h3 className="flex items-center gap-2 text-sm font-medium"><FileJson className="size-4" />保存到哪里？</h3>
            <p>正式位置：服务端数据根中的 <code className="break-all">designs/{id}.json</code>。从项目根启动时默认使用 <code>data/</code>；部署者可通过 <code>ALLOYFRAME_DATA_DIR</code> 指定外部目录。{savedAt && <span className="block text-muted-foreground">上次文件保存：{savedAt}</span>}</p>
            <p>自动保存开启时，有效且已应用的草稿停止编辑 1.5 秒后写入正式文件；未应用的表单和无效 JSON 不会写入。文件冲突或保存失败时暂停，需处理冲突或手动重试。</p>
            <p className="text-muted-foreground">浏览器仅额外备份 JSON 草稿，不跨设备同步，也不含未应用表单。自动保存不是版本历史；“放弃修改”只能放弃上次成功保存后的草稿。归档和放弃在「项目」面板中。</p>
          </section>
        </DialogContent>
      </Dialog>
    </>
  );
}
