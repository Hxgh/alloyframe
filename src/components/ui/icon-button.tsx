import * as React from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface IconButtonProps extends React.ComponentProps<typeof Button> {
  label: string;
  active?: boolean;
}

/**
 * 统一工具栏图标按钮封装：
 * - 尺寸严格受 `--control-icon-size`（桌面 36px，触控 44px）约束
 * - 默认 ghost 样式，支持 active/secondary 切换态
 * - 自动关联 aria-label 与 title，规范按钮与图标外观
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, label, active, variant, size = "icon-touch", ...props }, ref) => {
    const isPressed = active !== undefined ? active : (props["aria-pressed"] !== undefined ? Boolean(props["aria-pressed"]) : undefined);
    const resolvedVariant = variant ?? (isPressed ? "secondary" : "ghost");
    return (
      <Button
        ref={ref}
        variant={resolvedVariant}
        size={size}
        aria-label={label}
        title={props.title ?? label}
        aria-pressed={props["aria-pressed"] ?? (active !== undefined ? active : undefined)}
        className={cn("size-[var(--control-icon-size)] shrink-0 p-0", className)}
        {...props}
      />
    );
  }
);

IconButton.displayName = "IconButton";
export { buttonVariants };
