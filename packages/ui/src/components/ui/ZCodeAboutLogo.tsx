import { cn } from "@/components/lib/utils.js";
import appLogoUrl from "@/assets/ling-app-icon.png";

export function ZCodeAboutLogo({ className }: { className?: string }) {
  return (
    <img
      src={appLogoUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("shrink-0 select-none object-contain", className)}
    />
  );
}

export function ZCodeWordmarkLogo({ className }: { className?: string }) {
  return (
    <span className={cn("shrink-0 font-semibold", className)} aria-hidden="true">
      LING
    </span>
  );
}
