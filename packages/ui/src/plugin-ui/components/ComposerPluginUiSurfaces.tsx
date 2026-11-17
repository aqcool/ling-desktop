import { Button } from "@/components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useZCodeStoreWithDefault } from "@/store/StoreProvider.js";
import { resolveTheme } from "@/useTheme.js";
import { isRemoteWorkspaceIdentity, type ZCodePluginUiSurface } from "@zcode/shared";
import { ServerIcon } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { usePluginUiHost } from "../adapters/usePluginUiHost.js";
import { resolvePluginUiSurfaceTitle, usePluginUiSurfaces } from "../adapters/usePluginUiSurfaces.js";
import { claimPluginUiSurface } from "../app/pluginUiSurfaceStore.js";
import { buildPluginUiSessionKey, type PluginUiSessionScope } from "../contract.js";
import { PluginUiCard } from "./PluginUiCard.js";

export function ComposerPluginUiSurfaces(scope: PluginUiSessionScope) {
  const platform = useOptionalPlatform();
  const enabled = Boolean(
    platform?.pluginSandbox &&
    !scope.remoteSessionId &&
    !isRemoteWorkspaceIdentity(scope.workspaceIdentity ?? ""),
  );
  const surfaces = usePluginUiSurfaces({ ...scope, enabled });
  if (!enabled) return null;

  return surfaces
    .filter((surface) => surface.placement === "composer")
    .map((surface) => (
      <ComposerPluginUiButton
        key={JSON.stringify([buildPluginUiSessionKey(scope), surface.pluginId, surface.id])}
        scope={scope}
        surface={surface}
      />
    ));
}

function ComposerPluginUiButton({
  scope,
  surface,
}: {
  scope: PluginUiSessionScope;
  surface: ZCodePluginUiSurface;
}) {
  const { intl, locale } = useZCodeIntl();
  const theme = useZCodeStoreWithDefault((state) => state.theme, "system");
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState(false);
  const host = usePluginUiHost({
    presentation: {
      pluginId: surface.pluginId,
      serverName: surface.server,
      resourceUri: surface.resourceUri,
    },
    scope: {
      ...scope,
      remoteSessionId: undefined,
      scope: { kind: "surface", surfaceId: surface.id },
    },
    theme: resolveTheme(theme),
    locale,
    displayMode: "inline",
    passive: !open,
    availableDisplayModes: ["inline"],
    toolInput: undefined,
    toolResult: undefined,
    hostVersion: "zcode",
    width,
  });
  useLayoutEffect(() => {
    if (open) return claimPluginUiSurface(host.pageKey, "composer");
  }, [open, host.pageKey]);

  const title = resolvePluginUiSurfaceTitle(surface.title, locale);
  const badge =
    host.widgetState && typeof host.widgetState === "object" && "badge" in host.widgetState
      ? host.widgetState.badge
      : undefined;
  const count = typeof badge === "number" && Number.isSafeInteger(badge) && badge > 0 ? badge : 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ControlHintTooltip title={title} open={open ? false : undefined}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 min-w-7 gap-1 rounded-lg px-1.5 text-foreground-subtle data-[state=open]:bg-menu-hover"
            data-plugin-ui-composer-trigger={surface.id}
            aria-label={count ? `${title} · ${count}` : title}
          >
            <ServerIcon className="size-4" aria-hidden="true" />
            {count > 0 ? (
              <span className="min-w-4 rounded-full bg-surface px-1 text-center text-ui-xs tabular-nums">
                {count}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
      </ControlHintTooltip>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={4}
        aria-label={title}
        className="w-64 max-w-(--radix-popover-content-available-width) gap-0 rounded-lg border-popover-border bg-menu p-1 text-foreground !shadow-md focus:!shadow-md focus-visible:!shadow-md [app-region:no-drag]"
        data-plugin-ui-composer-popover
      >
        <PluginUiCard
          pageKey={host.pageKey}
          handle={host.handle}
          phase={host.phase}
          height={host.height}
          prefersBorder={false}
          error={host.error}
          loadingLabel={intl.formatMessage({ id: "pluginUi.loading" })}
          errorLabel={intl.formatMessage({ id: "pluginUi.loadFailed" })}
          retryLabel={intl.formatMessage({ id: "pluginUi.retry" })}
          onRetry={host.reload}
          onWidthChange={setWidth}
        />
      </PopoverContent>
    </Popover>
  );
}
