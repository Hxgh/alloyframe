"use client";

import { useId, useState, type FormEvent } from "react";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import {
  DesignAccessorySchema,
  DesignSchema,
  type AccessoryCatalog,
  type Catalog,
  type Design,
} from "@/lib/schema";
import { unappliedFieldsWarning, type PendingProjectForm } from "@/lib/project-draft";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  FormErrors,
  FormField,
  SelectField,
  TextField,
  numberError,
  numberFromText,
  type FieldErrors,
} from "./FormFields";

export type ProjectPanelProps = {
  design: Design;
  catalog: Catalog;
  accessories: AccessoryCatalog;
  onChange: (design: Design) => void;
  readOnly: boolean;
  autoSave: boolean;
  saveBlocked: boolean;
  jsonText: string;
  onJsonChange: (text: string) => void;
  issues: Array<{
    level: "error" | "warning";
    path: string;
    partId?: string;
    message: string;
  }>;
  onArchive: () => void;
  onDiscard: () => void;
  dirty: boolean;
  pending: boolean;
  formEpoch: number;
  onPendingChange: (form: PendingProjectForm, pending: boolean) => void;
  onSelectPart?: (id: string) => void;
  jsonInvalid?: boolean;
};

type MetadataFields = {
  name: string;
  description: string;
  note: string;
  frameHeight: string;
  loadRating: string;
  minHeight: string;
  maxHeight: string;
  profileSeries: string;
};

type AccessoryFields = { ref: string; qty: string; note: string };

function initialMetadata(design: Design): MetadataFields {
  return {
    name: design.name,
    description: design.meta.description,
    note: design.meta.note ?? "",
    frameHeight: design.meta.frameHeight == null ? "" : String(design.meta.frameHeight),
    loadRating: design.meta.loadRating == null ? "" : String(design.meta.loadRating),
    minHeight: design.meta.heightRange == null ? "" : String(design.meta.heightRange[0]),
    maxHeight: design.meta.heightRange == null ? "" : String(design.meta.heightRange[1]),
    profileSeries: design.meta.profileSeries ?? "",
  };
}

function initialAccessories(design: Design): AccessoryFields[] {
  return design.accessories.map((item) => ({ ref: item.ref, qty: String(item.qty), note: item.note ?? "" }));
}

function MetadataForm({
  design,
  catalog,
  disabled,
  onChange,
  onPendingChange,
}: Pick<ProjectPanelProps, "design" | "catalog" | "onChange" | "onPendingChange"> & { disabled: boolean }) {
  const prefix = useId();
  const [fields, setFields] = useState(() => initialMetadata(design));
  const [appliedFields, setAppliedFields] = useState(() => initialMetadata(design));
  const [errors, setErrors] = useState<FieldErrors>({});
  const changed = JSON.stringify(fields) !== JSON.stringify(appliedFields);
  const series = [...new Set(catalog.profiles.map((profile) => String(profile.series)))].join(" / ");

  function update<K extends keyof MetadataFields>(field: K, value: MetadataFields[K]) {
    const nextFields = { ...fields, [field]: value };
    setFields(nextFields);
    onPendingChange("metadata", JSON.stringify(nextFields) !== JSON.stringify(appliedFields));
  }

  function undo() {
    setFields(appliedFields);
    setErrors({});
    onPendingChange("metadata", false);
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;

    const nextErrors: FieldErrors = {};
    if (!fields.name.trim()) nextErrors.name = "请填写项目名称。";
    for (const [field, label] of [["frameHeight", "模型顶面高度"], ["loadRating", "额定载荷"]] as const) {
      const error = numberError(fields[field], label, { optional: true, positive: true });
      if (error) nextErrors[field] = error;
    }
    const hasHeightRange = Boolean(fields.minHeight.trim() || fields.maxHeight.trim());
    if (hasHeightRange) {
      for (const [field, label] of [["minHeight", "最低高度"], ["maxHeight", "最高高度"]] as const) {
        const error = numberError(fields[field], label);
        if (error) nextErrors[field] = error;
      }
      if (!nextErrors.minHeight && !nextErrors.maxHeight && numberFromText(fields.minHeight) > numberFromText(fields.maxHeight)) {
        nextErrors.maxHeight = "最高高度不能小于最低高度。";
      }
    }
    const meta = {
      description: fields.description,
      ...(fields.note.trim() ? { note: fields.note.trim() } : {}),
      ...(fields.profileSeries.trim() ? { profileSeries: fields.profileSeries.trim() } : {}),
      ...(fields.frameHeight.trim() ? { frameHeight: numberFromText(fields.frameHeight) } : {}),
      ...(fields.loadRating.trim() ? { loadRating: numberFromText(fields.loadRating) } : {}),
      ...(hasHeightRange ? { heightRange: [numberFromText(fields.minHeight), numberFromText(fields.maxHeight)] } : {}),
    };
    const result = DesignSchema.pick({ name: true, meta: true }).safeParse({ name: fields.name.trim(), meta });
    if (!result.success && Object.keys(nextErrors).length === 0) {
      nextErrors.form = "基础信息格式不正确，请检查名称与数值后重试。";
    }
    setErrors(nextErrors);
    if (result.success && Object.keys(nextErrors).length === 0) {
      const nextDesign = { ...design, name: result.data.name, meta: result.data.meta };
      const nextFields = initialMetadata(nextDesign);
      setFields(nextFields);
      setAppliedFields(nextFields);
      onPendingChange("metadata", false);
      onChange(nextDesign);
    }
  }

  return (
    <form onSubmit={apply} noValidate aria-labelledby={`${prefix}-heading`} className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-3">
      <h3 id={`${prefix}-heading`} className="text-sm font-semibold">基础信息</h3>
      <FormErrors errors={errors} />
      <TextField id={`${prefix}-name`} label="项目名称" value={fields.name} onChange={(event) => update("name", event.target.value)} disabled={disabled} error={errors.name} required />
      <FormField id={`${prefix}-description`} label="项目说明">
        <Textarea id={`${prefix}-description`} rows={3} value={fields.description} onChange={(event) => update("description", event.target.value)} disabled={disabled} />
      </FormField>
      <TextField id={`${prefix}-frame-height`} label="模型顶面高度（mm，可选）" type="number" inputMode="decimal" step="any" min={0} value={fields.frameHeight} onChange={(event) => update("frameHeight", event.target.value)} disabled={disabled} error={errors.frameHeight} hint="声明整个模型的最高点高度（含旋转后的零件），不是某一块板材或零件的高度；留空则不做声明值校验。" />
      <TextField id={`${prefix}-load-rating`} label="额定载荷（kg，可选）" type="number" inputMode="decimal" step="any" min={0} value={fields.loadRating} onChange={(event) => update("loadRating", event.target.value)} disabled={disabled} error={errors.loadRating} hint="仅记录标注值，不代表已完成承载校核。" />
      <fieldset disabled={disabled} className="min-h-[var(--control-height)] min-w-0 space-y-2 rounded-lg border border-border bg-muted/20 px-2.5 pt-1 pb-2.5">
        <legend className="px-1 text-sm leading-5 font-medium">高度范围（mm，可选）</legend>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <TextField id={`${prefix}-min-height`} label="最低" aria-label="最低高度（mm）" type="number" inputMode="decimal" step="any" value={fields.minHeight} onChange={(event) => update("minHeight", event.target.value)} error={errors.minHeight} />
          <TextField id={`${prefix}-max-height`} label="最高" aria-label="最高高度（mm）" type="number" inputMode="decimal" step="any" value={fields.maxHeight} onChange={(event) => update("maxHeight", event.target.value)} error={errors.maxHeight} />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">可同时留空；填写时须提供最低和最高两个数值。</p>
      </fieldset>
      <TextField id={`${prefix}-series`} label="型材系列（可选）" value={fields.profileSeries} onChange={(event) => update("profileSeries", event.target.value)} disabled={disabled} hint={series ? `型材库现有系列：${series}。此处仅作标注。` : "仅作系列标注，不会修改零件截面。"} />
      <FormField id={`${prefix}-note`} label="项目备注（可选）">
        <Textarea id={`${prefix}-note`} rows={3} value={fields.note} onChange={(event) => update("note", event.target.value)} disabled={disabled} />
      </FormField>
      <div className="grid min-w-0 grid-cols-1 gap-2 border-t border-border pt-3">
        <Button type="submit" size="touch" disabled={disabled || !changed}>
          <CheckIcon className="size-4" aria-hidden="true" />应用基础信息
        </Button>
        <Button type="button" size="touch" variant="outline" disabled={!changed} onClick={undo}>
          <RotateCcwIcon className="size-4" aria-hidden="true" />撤销基础信息输入
        </Button>
      </div>
      <p role={changed ? "status" : undefined} className="text-xs leading-5 text-muted-foreground">{changed ? unappliedFieldsWarning : "输入暂存于表单，应用后才更新项目草稿。"}</p>
    </form>
  );
}

function AccessoriesForm({
  design,
  accessories,
  disabled,
  onChange,
  onPendingChange,
}: Pick<ProjectPanelProps, "design" | "accessories" | "onChange" | "onPendingChange"> & { disabled: boolean }) {
  const prefix = useId();
  const [rows, setRows] = useState(() => initialAccessories(design));
  const [appliedRows, setAppliedRows] = useState(() => initialAccessories(design));
  const [selectedRef, setSelectedRef] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const changed = JSON.stringify(rows) !== JSON.stringify(appliedRows);
  const pending = changed || Boolean(selectedRef);
  const options = accessories.accessories
    .filter((item) => !rows.some((row) => row.ref === item.id))
    .map((item) => ({ value: item.id, label: item.name }));
  const removalRow = pendingRemoval === null ? undefined : rows[pendingRemoval];
  const removalName = accessories.accessories.find((item) => item.id === removalRow?.ref)?.name ?? removalRow?.ref ?? "此配件";

  function changeRows(nextRows: AccessoryFields[], nextSelectedRef = selectedRef) {
    setRows(nextRows);
    onPendingChange("accessories", JSON.stringify(nextRows) !== JSON.stringify(appliedRows) || Boolean(nextSelectedRef));
  }

  function selectAccessory(value: string) {
    setSelectedRef(value);
    onPendingChange("accessories", changed || Boolean(value));
  }

  function undo() {
    setRows(appliedRows);
    setSelectedRef("");
    setPendingRemoval(null);
    setErrors({});
    onPendingChange("accessories", false);
  }

  function addAccessory() {
    if (disabled) return;
    if (!selectedRef || !accessories.accessories.some((item) => item.id === selectedRef)) {
      setErrors((current) => ({ ...current, addRef: "请先选择配件库中的配件。" }));
      return;
    }
    if (rows.some((row) => row.ref === selectedRef)) {
      setErrors((current) => ({ ...current, addRef: "该配件已在清单中，请直接修改数量，不要重复添加。" }));
      return;
    }
    changeRows([...rows, { ref: selectedRef, qty: "1", note: "" }], "");
    setSelectedRef("");
    setErrors({});
  }

  function updateRow(index: number, field: "qty" | "note", value: string) {
    changeRows(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const nextErrors: FieldErrors = {};
    if (selectedRef) nextErrors.addRef = "所选配件尚未添加到清单，请先添加或撤销选择。";
    const refs = new Set<string>();
    rows.forEach((row, index) => {
      const name = accessories.accessories.find((item) => item.id === row.ref)?.name ?? row.ref;
      if (!accessories.accessories.some((item) => item.id === row.ref)) {
        nextErrors[`${index}.ref`] = `配件「${name}」不在配件库中，请移除后重新选择。`;
      }
      if (refs.has(row.ref)) nextErrors[`${index}.ref`] = `配件「${name}」重复，请移除重复项。`;
      refs.add(row.ref);
      const error = numberError(row.qty, `「${name}」的数量`, { positive: true, integer: true });
      if (error) nextErrors[`${index}.qty`] = error;
    });
    const result = DesignAccessorySchema.array().safeParse(rows.map((row) => ({
      ref: row.ref,
      qty: numberFromText(row.qty),
      ...(row.note.trim() ? { note: row.note.trim() } : {}),
    })));
    if (!result.success && Object.keys(nextErrors).length === 0) {
      nextErrors.form = "配件清单格式不正确，请检查引用和数量。";
    }
    setErrors(nextErrors);
    if (result.success && Object.keys(nextErrors).length === 0) {
      const nextDesign = { ...design, accessories: result.data };
      const nextRows = initialAccessories(nextDesign);
      setRows(nextRows);
      setAppliedRows(nextRows);
      setPendingRemoval(null);
      onPendingChange("accessories", false);
      onChange(nextDesign);
    }
  }

  return (
    <>
      <form onSubmit={apply} noValidate aria-labelledby={`${prefix}-heading`} className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-3">
        <h3 id={`${prefix}-heading`} className="text-sm font-semibold">项目配件</h3>
        <FormErrors errors={errors} />
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">尚未添加配件。</p>
        ) : (
          <ul className="min-w-0 space-y-3">
            {rows.map((row, index) => {
              const item = accessories.accessories.find((accessory) => accessory.id === row.ref);
              const referenceError = errors[`${index}.ref`];
              return (
                <li key={`${index}-${row.ref}`} className="min-w-0 space-y-3 rounded-lg border border-border bg-background p-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium wrap-anywhere">{item?.name ?? "未知配件"}</p>
                      <p className="font-mono text-xs text-muted-foreground wrap-anywhere">{row.ref}</p>
                    </div>
                    <Button type="button" size="icon-touch" variant="destructive" disabled={disabled} aria-label={`移除${item?.name ?? row.ref}`} title={`移除${item?.name ?? row.ref}`} onClick={() => setPendingRemoval(index)}>
                      <Trash2Icon className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                  {referenceError && <p className="text-xs leading-5 text-destructive wrap-anywhere">{referenceError}</p>}
                  <div className="grid min-w-0 grid-cols-1 gap-3">
                    <TextField id={`${prefix}-${index}-qty`} label={`数量${item?.unit ? `（${item.unit}）` : ""}`} aria-label={`${item?.name ?? row.ref}的数量`} type="number" inputMode="numeric" min={1} step={1} value={row.qty} onChange={(event) => updateRow(index, "qty", event.target.value)} disabled={disabled} error={errors[`${index}.qty`]} required />
                    <TextField id={`${prefix}-${index}-note`} label="备注（可选）" aria-label={`${item?.name ?? row.ref}的备注`} value={row.note} onChange={(event) => updateRow(index, "note", event.target.value)} disabled={disabled} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="min-w-0 space-y-2 border-t border-border pt-3">
          <SelectField id={`${prefix}-add`} label="从配件库添加" value={selectedRef} options={options} placeholder={options.length ? "选择配件" : "没有可添加的配件"} onValueChange={selectAccessory} disabled={disabled || options.length === 0} error={errors.addRef} />
          <Button type="button" variant="outline" size="touch" className="w-full" onClick={addAccessory} disabled={disabled || !selectedRef}>
            <PlusIcon className="size-4" aria-hidden="true" />添加到清单
          </Button>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-2 border-t border-border pt-3">
          <Button type="submit" size="touch" disabled={disabled || !changed || Boolean(selectedRef)}>
            <CheckIcon className="size-4" aria-hidden="true" />应用配件清单
          </Button>
          <Button type="button" size="touch" variant="outline" disabled={!pending} onClick={undo}>
            <RotateCcwIcon className="size-4" aria-hidden="true" />撤销配件输入
          </Button>
        </div>
        <p role={pending ? "status" : undefined} className="text-xs leading-5 text-muted-foreground">{pending ? `${unappliedFieldsWarning}${selectedRef ? "所选配件须先添加到清单。" : ""}` : "数量须为正整数。同一配件只保留一行；确认移除后仍需应用清单。"}</p>
      </form>
      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => { if (!open) setPendingRemoval(null); }}
        title="移除项目配件？"
        description={`将从待应用的配件清单中移除「${removalName}」。配件库本身不会改变。`}
        confirmLabel="移除配件"
        destructive
        onConfirm={() => {
          if (!disabled && pendingRemoval !== null) {
            changeRows(rows.filter((_, index) => index !== pendingRemoval));
            setPendingRemoval(null);
            setErrors({});
          }
        }}
      />
    </>
  );
}

export function ProjectPanel({
  design,
  catalog,
  accessories,
  onChange,
  readOnly,
  autoSave,
  saveBlocked,
  jsonText,
  onJsonChange,
  issues,
  onArchive,
  onDiscard,
  dirty,
  pending,
  formEpoch,
  onPendingChange,
  onSelectPart,
  jsonInvalid = false,
}: ProjectPanelProps) {
  const prefix = useId();
  const structuredDisabled = readOnly || jsonInvalid;

  return (
    <ScrollArea className="h-full min-h-0 min-w-0">
      <div className="min-w-0 space-y-4 p-3 text-sm">
        <section aria-labelledby={`${prefix}-heading`} className="min-w-0 space-y-3">
          <div className="space-y-1">
            <h2 id={`${prefix}-heading`} className="text-sm font-semibold">项目设置</h2>
            <p className="text-xs leading-5 text-muted-foreground">
              {pending && <>{unappliedFieldsWarning} </>}
              {readOnly ? "当前暂不可编辑，请查看页面中的状态提示。" : autoSave ? "应用后的有效草稿停止编辑 1.5 秒后自动保存；未应用输入不会保存。" : "应用后更新草稿，需手动保存。"}
            </p>
          </div>
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg border border-border bg-card p-3 text-xs leading-5">
            <dt className="text-muted-foreground">稳定 ID</dt><dd className="min-w-0 select-text font-mono wrap-anywhere">{design.id}</dd>
            <dt className="text-muted-foreground">修订</dt><dd className="min-w-0 font-mono tabular-nums">{design.revision}（不可手动修改）</dd>
            <dt className="text-muted-foreground">单位</dt><dd>毫米（mm）</dd>
          </dl>
        </section>
        {jsonInvalid && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs leading-5 text-destructive">
            JSON 尚未通过校验，基础信息与配件编辑已暂停。下方仍展示最近有效的项目；请展开高级 JSON 修复原文，输入内容不会被丢弃。
          </p>
        )}
        <MetadataForm key={`metadata-${formEpoch}`} design={design} catalog={catalog} disabled={structuredDisabled} onChange={onChange} onPendingChange={onPendingChange} />
        <AccessoriesForm key={`accessories-${formEpoch}`} design={design} accessories={accessories} disabled={structuredDisabled} onChange={onChange} onPendingChange={onPendingChange} />
        <section aria-labelledby={`${prefix}-issues`} className="min-w-0 space-y-2 rounded-lg border border-border bg-card p-3">
          <h3 id={`${prefix}-issues`} className="text-sm font-semibold">数据检查</h3>
          {issues.length === 0 ? (
            <p className="text-xs leading-5 text-muted-foreground">未发现数据问题。数据校验不代表结构、承载或安全校核已完成。</p>
          ) : (
            <ul className="min-w-0 divide-y divide-border" aria-label="项目数据问题">
              {issues.map((issue, index) => (
                <li key={`${issue.level}-${issue.path}-${index}`} className="min-w-0 space-y-1 py-2 first:pt-0 last:pb-0">
                  <p className={issue.level === "error" ? "text-sm leading-6 text-destructive wrap-anywhere" : "text-sm leading-6 wrap-anywhere"}>
                    <span className="mr-1 font-medium">{issue.level === "error" ? "错误" : "警告"}</span>{issue.message}
                  </p>
                  <p className="min-w-0 text-xs leading-5 text-muted-foreground wrap-anywhere">
                    路径：<code className="select-text">{issue.path || "项目根节点"}</code>
                    {issue.partId ? (
                      onSelectPart ? (
                        <>
                          {" · "}
                          <button
                            type="button"
                            className="font-mono underline underline-offset-2 hover:text-foreground"
                            onClick={() => onSelectPart(issue.partId!)}
                          >
                            定位零件 {issue.partId}
                          </button>
                        </>
                      ) : ` · 零件 ${issue.partId}`
                    ) : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <details className="group min-w-0 rounded-lg border border-border bg-card">
          <summary className="flex min-h-[var(--control-height)] min-w-0 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            高级 JSON
            <ChevronDownIcon className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="min-w-0 space-y-3 border-t border-border p-3">
            <FormField id={`${prefix}-json`} label="项目 JSON" hint={`${pending ? `${unappliedFieldsWarning}高级 JSON 编辑已暂停。` : ""}${readOnly ? "当前暂不可编辑，仍可选择和复制原文。" : pending ? "" : autoSave ? "原文进入草稿；有效且静止 1.5 秒后自动保存。" : "原文进入草稿，有效后需手动保存。"}`}>
              <Textarea
                id={`${prefix}-json`}
                className="min-h-64 select-text whitespace-pre-wrap break-all font-mono"
                value={jsonText}
                onChange={(event) => { if (!pending) onJsonChange(event.target.value); }}
                readOnly={readOnly || pending}
                aria-invalid={jsonInvalid}
                aria-describedby={`${prefix}-json-hint`}
                rows={14}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </FormField>
          </div>
        </details>
        <section aria-labelledby={`${prefix}-actions`} className="min-w-0 space-y-3 border-t border-border pt-4">
          <h3 id={`${prefix}-actions`} className="text-sm font-semibold">项目管理</h3>
          <div className="grid min-w-0 grid-cols-1 gap-2">
            <Button type="button" variant="outline" size="touch" className="w-full" onClick={onArchive} disabled={readOnly || saveBlocked || dirty || pending} title={pending ? unappliedFieldsWarning : dirty ? "请先保存或放弃草稿，再归档项目。" : undefined}>
              <ArchiveIcon className="size-4" aria-hidden="true" />归档项目
            </Button>
            <Button type="button" variant="destructive" size="touch" className="w-full" onClick={onDiscard} disabled={readOnly || saveBlocked || (!dirty && !pending)}>
              <RotateCcwIcon className="size-4" aria-hidden="true" />放弃未保存修改
            </Button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">归档可恢复，不是删除。“放弃”仅恢复上次成功保存的文件，不撤销已自动保存的修改。导出、另存副本和文件更新在顶部「项目操作」中。</p>
        </section>
      </div>
    </ScrollArea>
  );
}
