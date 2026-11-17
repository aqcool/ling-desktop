import type { ReactNode } from "react";
import { cn } from "@/components/lib/utils.js";
import appLogoUrl from "@/assets/ling-app-icon.png";

interface RootStartupLoadingProps {
  label: string;
  children?: ReactNode;
  busy?: boolean;
}

export function RootStartupLoading({ label, children, busy = true }: RootStartupLoadingProps) {
  return (
    <div
      // Web 端全局 html/body/#root 为 Electron 透明背景让路，React 接管后会替换 HTML 启动壳。
      // 这里必须由阻塞态自身承接主题背景，否则远控链接会在 Root 恢复期间继续露出浏览器白底。
      className="flex h-full min-h-dvh flex-col items-center justify-center gap-6 bg-background text-foreground"
      role="status"
      aria-busy={busy}
      aria-label={label}
      data-testid="root-startup-loading"
    >
      <ZCodeStartupLogoBadge />
      {children}
    </div>
  );
}

/** 初始化、引导和标题栏共用应用图标。 */
export function ZCodeStartupLogoBadge({
  animated = true,
  size = "default",
}: {
  animated?: boolean;
  size?: "default" | "titlebar";
}) {
  return (
    <img
      src={appLogoUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-desktop-logo-badge={size === "titlebar" ? "true" : undefined}
      className={cn(
        "shrink-0 select-none object-contain",
        size === "titlebar" ? "size-5" : "size-24",
        animated && "motion-safe:animate-pulse motion-safe:[animation-delay:3s]",
      )}
    />
  );
}
