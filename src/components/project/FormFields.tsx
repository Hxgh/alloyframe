"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type FieldErrors = Record<string, string>;
export type VectorText = [string, string, string];

export function numberFromText(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

export function numberError(
  value: string,
  label: string,
  options: { optional?: boolean; positive?: boolean; integer?: boolean } = {},
): string | undefined {
  if (value.trim() === "") {
    return options.optional ? undefined : `请填写${label}。`;
  }
  const number = numberFromText(value);
  if (!Number.isFinite(number)) return `${label}须为有效的有限数字。`;
  if (options.integer && !Number.isInteger(number)) return `${label}须为整数。`;
  if (options.positive && number <= 0) return `${label}须大于 0。`;
  return undefined;
}

export function FormField({
  id,
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm leading-5 font-medium wrap-anywhere">
        {label}
        {required && <span className="ml-1 text-xs font-normal text-muted-foreground">（必填）</span>}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground wrap-anywhere">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs leading-5 text-destructive wrap-anywhere">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({
  id,
  label,
  hint,
  error,
  required,
  ...props
}: Omit<ComponentProps<"input">, "id"> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;

  return (
    <FormField id={id} label={label} required={required} hint={hint} error={error}>
      <Input
        {...props}
        id={id}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
      />
    </FormField>
  );
}

export function SelectField({
  id,
  label,
  value,
  onValueChange,
  options,
  placeholder = "请选择",
  required,
  disabled,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  error?: string;
}) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;

  return (
    <FormField id={id} label={label} required={required} hint={hint} error={error}>
      <Select
        value={value || null}
        items={options}
        onValueChange={(next) => onValueChange(next ?? "")}
        disabled={disabled}
        required={required}
      >
        <SelectTrigger
          id={id}
          size="touch"
          className="w-full min-w-0"
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        >
          <SelectValue placeholder={placeholder} className="min-w-0 truncate" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="start">
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="min-h-[var(--control-height)] py-1.5 pr-8 pl-3 [&>span:first-child]:min-w-0 [&>span:first-child]:shrink"
            >
              <span className="min-w-0 whitespace-normal wrap-anywhere">{option.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

export function VectorFields({
  id,
  path,
  label,
  unit,
  values,
  onChange,
  errors,
  disabled,
  positive,
  hint,
}: {
  id: string;
  path: string;
  label: string;
  unit: string;
  values: VectorText;
  onChange: (values: VectorText) => void;
  errors: FieldErrors;
  disabled?: boolean;
  positive?: boolean;
  hint?: string;
}) {
  return (
    <fieldset disabled={disabled} className="vector-fields min-w-0 space-y-2 rounded-lg border border-border bg-muted/20 px-2.5 pt-1 pb-2.5">
      <legend className="px-1 text-sm leading-5 font-medium">
        {label} <span className="text-xs font-normal text-muted-foreground">（{unit}）</span>
        <span className="ml-1 text-xs font-normal text-muted-foreground">（必填）</span>
      </legend>
      {hint && <p className="text-xs leading-5 text-muted-foreground wrap-anywhere">{hint}</p>}
      <div className="vector-inputs grid min-w-0 gap-2 [&_input]:px-2 [&_input]:font-mono [&_input]:tabular-nums [&_label>span]:sr-only">
        {(["X", "Y", "Z"] as const).map((axis, index) => (
          <TextField
            key={axis}
            id={`${id}-${axis.toLowerCase()}`}
            label={axis}
            aria-label={`${label} ${axis}（${unit}）`}
            type="number"
            inputMode="decimal"
            step="any"
            min={positive ? 0 : undefined}
            value={values[index]}
            onChange={(event) => {
              const next: VectorText = [...values];
              next[index] = event.target.value;
              onChange(next);
            }}
            error={errors[`${path}.${index}`] ?? errors[path]}
            required
          />
        ))}
      </div>
    </fieldset>
  );
}

export function FormErrors({ errors }: { errors: FieldErrors }) {
  const messages = [...new Set(Object.values(errors))];
  if (messages.length === 0) return null;

  return (
    <div role="alert" className="min-w-0 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <p className="font-medium text-destructive">尚未应用，请检查以下内容</p>
      <ul className="mt-1.5 list-outside list-disc space-y-1 pl-4 text-xs leading-5 text-destructive">
        {messages.map((message) => <li key={message} className="wrap-anywhere">{message}</li>)}
      </ul>
    </div>
  );
}
