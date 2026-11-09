"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const THEMES = [
  { value: "system", label: "跟随系统", Icon: Monitor },
  { value: "light", label: "浅色", Icon: Sun },
  { value: "dark", label: "深色", Icon: Moon },
] as const;
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function ThemeSelect() {
  const { theme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const selected = hydrated ? THEMES.find((item) => item.value === theme) : null;
  const Icon = selected?.Icon ?? Monitor;

  return (
    <Select value={selected?.value ?? null} onValueChange={(value) => { if (value) setTheme(value); }} disabled={!hydrated}>
      <SelectTrigger size="touch" aria-label={`主题：${selected?.label ?? "选择主题"}`}>
        <SelectValue>
          <Icon aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">{selected?.label ?? "主题"}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false}>
        {THEMES.map(({ value, label, Icon: OptionIcon }) => (
          <SelectItem key={value} value={value} className="text-sm">
            <OptionIcon aria-hidden="true" className="size-4" />{label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
