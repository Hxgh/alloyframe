"use client";

import { useId, useState, type FormEvent } from "react";
import { CheckIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { PartSchema, type Catalog, type Part, type PartKind } from "@/lib/schema";
import { unappliedFieldsWarning } from "@/lib/project-draft";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  FormErrors,
  FormField,
  SelectField,
  TextField,
  VectorFields,
  numberError,
  numberFromText,
  type FieldErrors,
  type VectorText,
} from "./FormFields";

export type PartEditorProps = {
  part: Part | null;
  catalog: Catalog;
  onApply: (part: Part) => void;
  onCancel: () => void;
  onPendingChange: (pending: boolean) => void;
  existingIds: string[];
  readOnly?: boolean;
};

type PartFields = {
  id: string;
  kind: PartKind;
  role: string;
  material: string;
  profile: string;
  size: VectorText;
  position: VectorText;
  rotation: VectorText;
  massKg: string;
  note: string;
};

const kindOptions: Array<{ value: PartKind; label: string }> = [
  { value: "box", label: "通用方块 · box" },
  { value: "beam", label: "型材 · beam" },
  { value: "plate", label: "平板 · plate" },
  { value: "column", label: "升降柱 · column" },
];

function vectorText(values: [number, number, number]): VectorText {
  return [String(values[0]), String(values[1]), String(values[2])];
}

function initialFields(part: Part | null): PartFields {
  return {
    id: part?.id ?? "",
    kind: part?.kind ?? "box",
    role: part?.role ?? "通用零件",
    material: part?.material ?? "铝合金",
    profile: part?.profile ?? "",
    size: vectorText(part?.size ?? [40, 40, 40]),
    position: vectorText(part?.position ?? [0, 20, 0]),
    rotation: vectorText(part?.rotation ?? [0, 0, 0]),
    massKg: part?.massKg == null ? "" : String(part.massKg),
    note: part?.note ?? "",
  };
}

export function PartEditor(props: PartEditorProps) {
  // 切换零件或由外部更新零件时重置草稿，普通父组件重渲染不丢输入。
  return <PartEditorForm key={JSON.stringify(props.part)} {...props} />;
}

function PartEditorForm({
  part,
  catalog,
  onApply,
  onCancel,
  onPendingChange,
  existingIds,
  readOnly = false,
}: PartEditorProps) {
  const prefix = useId();
  const [fields, setFields] = useState(() => initialFields(part));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirmCancel, setConfirmCancel] = useState(false);
  const changed = JSON.stringify(fields) !== JSON.stringify(initialFields(part));
  const profileOptions = catalog.profiles.map((profile) => ({ value: profile.id, label: profile.name }));
  if (fields.profile && !catalog.profiles.some((profile) => profile.id === fields.profile)) {
    profileOptions.unshift({ value: fields.profile, label: `${fields.profile}（型材库中不存在）` });
  }

  function update<K extends keyof PartFields>(field: K, value: PartFields[K]) {
    const nextFields = { ...fields, [field]: value };
    setFields(nextFields);
    onPendingChange(JSON.stringify(nextFields) !== JSON.stringify(initialFields(part)));
  }

  function undo() {
    setFields(initialFields(part));
    setErrors({});
    onPendingChange(false);
  }

  function cancel() {
    if (changed) setConfirmCancel(true);
    else {
      onPendingChange(false);
      onCancel();
    }
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;

    const nextErrors: FieldErrors = {};
    const id = part?.id ?? fields.id.trim();
    if (!id) nextErrors.id = "请填写零件 ID。";
    const matchingIds = existingIds.filter((existing) => existing === id).length;
    if (id && matchingIds > (part?.id === id ? 1 : 0)) {
      nextErrors.id = `零件 ID「${id}」已存在，请使用唯一 ID。`;
    }
    if (!fields.role.trim()) nextErrors.role = "请填写零件角色。";
    if (!fields.material.trim()) nextErrors.material = "请填写材料。";
    if (fields.kind === "beam") {
      if (!fields.profile) nextErrors.profile = "型材零件必须选择型材截面。";
      else if (!catalog.profiles.some((profile) => profile.id === fields.profile)) {
        nextErrors.profile = "所选截面不在型材库中，请重新选择。";
      }
    }

    for (const [field, label] of [["size", "尺寸"], ["position", "位置"], ["rotation", "旋转"]] as const) {
      fields[field].forEach((value, index) => {
        const error = numberError(value, `${label} ${["X", "Y", "Z"][index]}`, { positive: field === "size" });
        if (error) nextErrors[`${field}.${index}`] = error;
      });
    }
    const massError = numberError(fields.massKg, "单件重量", { optional: true, positive: true });
    if (massError) nextErrors.massKg = massError;

    const candidate = {
      id,
      kind: fields.kind,
      role: fields.role.trim(),
      material: fields.material.trim(),
      profile: fields.kind === "beam" ? fields.profile || null : null,
      size: fields.size.map(numberFromText),
      position: fields.position.map(numberFromText),
      rotation: fields.rotation.map(numberFromText),
      ...(fields.massKg.trim() ? { massKg: numberFromText(fields.massKg) } : {}),
      ...(fields.note.trim() ? { note: fields.note.trim() } : {}),
    };
    const result = PartSchema.safeParse(candidate);
    if (!result.success) {
      const labels: Record<string, string> = {
        id: "零件 ID", kind: "几何类型", role: "角色", material: "材料", profile: "型材截面",
        size: "尺寸", position: "位置", rotation: "旋转", massKg: "单件重量", note: "备注",
      };
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        const label = labels[String(issue.path[0])] ?? "零件字段";
        nextErrors[path] ??= /[\u3400-\u9fff]/.test(issue.message)
          ? `${label}：${issue.message}`
          : `${label}格式不正确，请检查输入。`;
      }
    }
    setErrors(nextErrors);
    if (result.success && Object.keys(nextErrors).length === 0) {
      onPendingChange(false);
      onApply(result.data);
    }
  }

  return (
    <ScrollArea className="h-full min-h-0 min-w-0">
      <form onSubmit={apply} noValidate className="min-w-0 space-y-4 p-4 text-sm" aria-label={part ? "编辑零件" : "新建零件"}>
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">{readOnly ? "零件详情" : part ? "编辑零件" : "新建零件"}</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {readOnly ? "当前项目只读，不能修改零件。" : "应用后仅更新当前项目草稿，不会写入正式文件。"}
          </p>
        </div>
        {changed && <p role="status" className="text-xs leading-relaxed text-destructive">{unappliedFieldsWarning}</p>}
        <FormErrors errors={errors} />
        <TextField
          id={`${prefix}-id`}
          label="零件 ID"
          value={fields.id}
          onChange={(event) => update("id", event.target.value)}
          disabled={readOnly || part !== null}
          hint={part ? "现有零件的 ID 不可修改。" : "须在当前项目中唯一，使用小写字母、数字和短横线（如 side-beam）。"}
          error={errors.id}
          autoComplete="off"
          required
        />
        <SelectField
          id={`${prefix}-kind`}
          label="几何类型"
          value={fields.kind}
          options={kindOptions}
          onValueChange={(value) => update("kind", value as PartKind)}
          disabled={readOnly}
          error={errors.kind}
          required
        />
        <TextField
          id={`${prefix}-role`}
          label="角色"
          value={fields.role}
          onChange={(event) => update("role", event.target.value)}
          disabled={readOnly}
          error={errors.role}
          placeholder="例如：横梁、台面、支脚"
          required
        />
        <TextField
          id={`${prefix}-material`}
          label="材料"
          value={fields.material}
          onChange={(event) => update("material", event.target.value)}
          disabled={readOnly}
          error={errors.material}
          required
        />
        {fields.kind === "beam" && (
          <SelectField
            id={`${prefix}-profile`}
            label="型材截面"
            value={fields.profile}
            options={profileOptions}
            onValueChange={(value) => update("profile", value)}
            disabled={readOnly}
            error={errors.profile}
            hint="仅型材使用截面引用；切换为其他类型后不携带型材引用。"
            required
          />
        )}
        <VectorFields id={`${prefix}-size`} path="size" label="尺寸" unit="mm" values={fields.size} onChange={(values) => update("size", values)} errors={errors} disabled={readOnly} positive />
        <VectorFields id={`${prefix}-position`} path="position" label="中心点位置" unit="mm" values={fields.position} onChange={(values) => update("position", values)} errors={errors} disabled={readOnly} />
        <VectorFields id={`${prefix}-rotation`} path="rotation" label="旋转" unit="度" values={fields.rotation} onChange={(values) => update("rotation", values)} errors={errors} disabled={readOnly} />
        <TextField
          id={`${prefix}-mass`}
          label="单件重量（kg，可选）"
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          value={fields.massKg}
          onChange={(event) => update("massKg", event.target.value)}
          disabled={readOnly}
          error={errors.massKg}
          hint="留空使用估算重量，不能代替实测或工程校核。"
        />
        <FormField id={`${prefix}-note`} label="备注（可选）" error={errors.note}>
          <Textarea
            id={`${prefix}-note`}
            value={fields.note}
            onChange={(event) => update("note", event.target.value)}
            disabled={readOnly}
            aria-invalid={Boolean(errors.note)}
            aria-describedby={errors.note ? `${prefix}-note-error` : undefined}
            rows={3}
          />
        </FormField>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button type="submit" size="touch" disabled={readOnly}>
            <CheckIcon className="size-4" aria-hidden="true" />
            {part ? "应用零件修改" : "添加零件"}
          </Button>
          <Button type="button" size="touch" variant="outline" disabled={!changed} onClick={undo}>
            <RotateCcwIcon className="size-4" aria-hidden="true" />撤销输入
          </Button>
          <Button type="button" size="touch" variant="outline" onClick={cancel}>
            <XIcon className="size-4" aria-hidden="true" />
            {readOnly ? "关闭详情" : "取消"}
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="取消零件编辑？"
        description={`${unappliedFieldsWarning}继续取消将丢弃这些输入。`}
        confirmLabel="丢弃输入并取消"
        destructive
        onConfirm={() => { onPendingChange(false); onCancel(); }}
      />
    </ScrollArea>
  );
}
