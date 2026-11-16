"use client";

import { useId, useRef, useState } from "react";
import { ChevronDown, Copy, Download, FileCog, FileJson, LoaderCircle, Redo2, RefreshCw, Save, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

type Props = {
  id: string;
  status: string;
  savedAt: string;
  saving: boolean;
  canSave: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  dirty: boolean;
  autoSave: boolean;
  readOnly: boolean;
  pending: boolean;
  invalid: boolean;
  saveBlocked: boolean;
  onAutoSaveChange: (enabled: boolean) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onSave: () => void;
  onExport: () => void;
  onCopy: () => void;
  onRefresh: () => void;
};

export function ProjectToolbar({ id, status, savedAt, saving, canSave, canUndo = false, canRedo = false, dirty, autoSave, readOnly, pending, invalid, saveBlocked, onAutoSaveChange, onUndo, onRedo, onSave, onExport, onCopy, onRefresh }: Props) {
  const switchId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [filesOpen, setFilesOpen] = useState(false);

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5">
        {dirty && <span role="status" className="whitespace-nowrap text-xs text-muted-foreground">未保存</span>}
        <IconButton ref={triggerRef} label="项目操作" aria-haspopup="dialog" aria-expanded={filesOpen} onClick={() => setFilesOpen(true)}>
          <FileCog aria-hidden="true" className="size-4" />
        </IconButton>
      </div>
      <Dialog open={filesOpen} onOpenChange={setFilesOpen} modal>
        <DialogContent finalFocus={triggerRef}>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>项目操作</DialogTitle>
            <IconButton label="关闭项目操作" onClick={() => setFilesOpen(false)}><X className="size-4" /></IconButton>
          </div>
          <DialogDescription>保存写入项目文件，导出下载一份副本。</DialogDescription>
          <p role="status" aria-live="polite" className="text-xs leading-5 text-muted-foreground wrap-anywhere">{status}</p>
          <div role="group" aria-label="项目保存与历史" className="grid grid-cols-3 gap-2 [&>button]:min-w-0 [&>button]:px-1">
            <Button size="touch" onClick={onSave} disabled={!canSave} aria-label="保存项目" aria-busy={saving} title="立即保存有效草稿到服务端文件">
              {saving ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <Save aria-hidden="true" className="size-4" />}保存
            </Button>
            {onUndo && <Button variant="outline" size="touch" onClick={onUndo} disabled={!canUndo} aria-label="撤销上一步" title="撤销上一步草稿修改（Ctrl/Cmd+Z）"><Undo2 aria-hidden="true" className="size-4" />撤销</Button>}
            {onRedo && <Button variant="outline" size="touch" onClick={onRedo} disabled={!canRedo} aria-label="重做下一步" title="重做下一步草稿修改（Ctrl/Cmd+Shift+Z）"><Redo2 aria-hidden="true" className="size-4" />重做</Button>}
          </div>
          <label htmlFor={switchId} className="flex min-h-[var(--control-height)] cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-muted has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 dark:hover:bg-muted/50">
            <Switch id={switchId} checked={autoSave} onCheckedChange={onAutoSaveChange} aria-label="自动保存" />
            自动保存
          </label>
          <div role="group" aria-label="项目文件操作" className="grid gap-2">
            <Button variant="outline" size="touch" disabled={pending || invalid || saveBlocked} onClick={() => { setFilesOpen(false); onExport(); }}><Download className="size-4" />导出 JSON</Button>
            <Button variant="outline" size="touch" disabled={readOnly || pending || invalid || saveBlocked} onClick={() => { setFilesOpen(false); onCopy(); }}><Copy className="size-4" />另存副本</Button>
            <Button variant="outline" size="touch" disabled={saveBlocked} onClick={() => { setFilesOpen(false); onRefresh(); }}><RefreshCw className="size-4" />检查文件更新</Button>
          </div>
          <details className="group text-sm leading-relaxed">
            <summary className="flex min-h-[var(--control-height)] cursor-pointer items-center gap-2 rounded-lg px-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:bg-muted/50"><FileJson aria-hidden="true" className="size-4" />保存与文件说明<ChevronDown aria-hidden="true" className="ml-auto size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
            <section className="space-y-2 pt-2" aria-label="保存机制说明">
              <p>正式位置：服务端数据根中的 <code className="break-all">designs/{id}.json</code>。从项目根启动时默认使用被 Git 忽略的 <code>.alloyframe-data/</code>；部署者可通过 <code>ALLOYFRAME_DATA_DIR</code> 指定其他目录。{savedAt && <span className="block text-muted-foreground">上次文件保存：{savedAt}</span>}</p>
              <p>自动保存开启时，有效且已应用的草稿停止编辑 1.5 秒后写入正式文件；未应用的表单和无效 JSON 不会写入。文件冲突或保存失败时暂停，需处理冲突或手动重试。</p>
              <p className="text-muted-foreground">浏览器仅额外备份 JSON 草稿，不跨设备同步，也不含未应用表单。自动保存不是版本历史；“放弃修改”只能放弃上次成功保存后的草稿。归档和放弃在「项目」面板中。</p>
              <p className="text-muted-foreground">视图与主题设置不改变设计。</p>
            </section>
          </details>
        </DialogContent>
      </Dialog>
    </>
  );
}
