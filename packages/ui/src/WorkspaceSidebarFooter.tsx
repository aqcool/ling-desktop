import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useDesktopUpdateMenu } from "@/hooks/useDesktopUpdateMenu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { runExportLogsAction } from "@/lib/exportLogsAction.js";
import { setPendingSettingsUsageIntent } from "@/lib/settingsNavigation.js";
import { WorkspaceWebRemoteControlTrigger } from "@/WorkspaceWebRemoteControlTrigger.js";
import { DesktopCommandIds } from "@zcode/shared";
import {
  TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON,
  TID_TASK_SETTINGS_BUTTON,
  TID_WORKSPACE_HELP_MENU_RESOURCE_MANAGER,
  TID_WORKSPACE_HELP_MENU_TRIGGER,
} from "@zcode/shared/test-ids";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Download,
  Ellipsis,
  Info,
  RefreshCw,
  Settings,
} from "lucide-react";
import { memo, type ReactNode } from "react";

export const WorkspaceSidebarFooter = memo(function WorkspaceSidebarFooter({
  onSettingsButtonClick,
  onUsageClick,
  settingsButtonMode = "settings",
  workspacePath,
  workspaceIdentity,
  workspaceRemoteSessionId,
  isDesktop,
  banner,
  className,
}: {
  onSettingsButtonClick?: () => void;
  onUsageClick: () => void;
  settingsButtonMode?: "settings" | "back";
  workspacePath?: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  isDesktop?: boolean;
  banner?: ReactNode;
  className?: string;
}) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const update = useDesktopUpdateMenu(Boolean(isDesktop));
  const back = settingsButtonMode === "back";
  const SettingsIcon = back ? ArrowLeft : Settings;
  const settingsLabel = intl.formatMessage({
    id: back ? "workspace.backToWorkspace" : "settings.title",
  });
  const moreLabel = intl.formatMessage({ id: "common.more" });

  return (
    <footer className={cn("flex shrink-0 flex-col gap-2.5 px-4 pt-2 pb-4", className)}>
      {banner}
      <div className="flex min-w-0 items-center gap-2">
        {onSettingsButtonClick ? (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="min-w-0 shrink gap-2 px-2"
            data-testid={TID_TASK_SETTINGS_BUTTON}
            onClick={onSettingsButtonClick}
          >
            <SettingsIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{settingsLabel}</span>
          </Button>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {isDesktop && workspacePath ? (
            <WorkspaceWebRemoteControlTrigger
              workspacePath={workspacePath}
              workspaceIdentity={workspaceIdentity}
              remoteSessionId={workspaceRemoteSessionId}
              compact
            />
          ) : null}
          <DropdownMenu>
            <ControlHintTooltip title={moreLabel}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  className="text-foreground-subtle data-[state=open]:bg-menu-hover data-[state=open]:text-foreground"
                  aria-label={moreLabel}
                  data-testid={TID_WORKSPACE_HELP_MENU_TRIGGER}
                >
                  <Ellipsis className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </ControlHintTooltip>
            <DropdownMenuContent side="top" align="end" sideOffset={4} className="min-w-40">
              <DropdownMenuItem
                data-testid={TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON}
                onSelect={() => {
                  setPendingSettingsUsageIntent();
                  onUsageClick();
                }}
              >
                <BarChart3 className="size-4" aria-hidden="true" />
                {intl.formatMessage({ id: "sidebar.usage.plan.openStats" })}
              </DropdownMenuItem>
              {isDesktop ? (
                <>
                  <DropdownMenuItem
                    data-testid={TID_WORKSPACE_HELP_MENU_RESOURCE_MANAGER}
                    onSelect={() =>
                      void platform.executeDesktopCommand(DesktopCommandIds.OpenResourceManager)
                    }
                  >
                    <Activity className="size-4" aria-hidden="true" />
                    {intl.formatMessage({ id: "titleBar.menu.help.resourceManager" })}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void runExportLogsAction(platform, intl)}>
                    <Download className="size-4" aria-hidden="true" />
                    {intl.formatMessage({ id: "titleBar.menu.help.exportLogs" })}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={update.disabled} onSelect={update.checkForUpdates}>
                    <RefreshCw className="size-4" aria-hidden="true" />
                    {intl.formatMessage({ id: update.labelId }, update.labelValues)}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      void platform.executeDesktopCommand(DesktopCommandIds.ShowAbout)
                    }
                  >
                    <Info className="size-4" aria-hidden="true" />
                    {intl.formatMessage({ id: "titleBar.menu.help.about" })}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </footer>
  );
});
