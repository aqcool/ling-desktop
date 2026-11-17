import { useEffect, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import type { SubscriptionOAuthVendor } from "@zcode/provider";
import type { SubscriptionOAuthLoginStatus } from "@zcode/services";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Progress } from "@/components/ui/progress.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useSubscriptionUsage } from "@/hooks/useSubscriptionUsage.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { formatQuotaResetTime } from "@/lib/codingPlanQuotaPresentation.js";

const USAGE_URLS = {
  anthropic: "https://claude.ai/settings/usage",
  xai: "https://grok.com/dashboard",
};
const PLAN_LABELS = new Map([
  ["prolite", "Pro 100"],
  ["pro", "Pro 200"],
  ["promax", "Pro 500"],
  ["education", "Edu"],
  ["self_serve_business_prolite", "Business Pro Lite"],
  ["self_serve_business_usage_based", "Business (usage-based)"],
]);

export function SubscriptionOAuthSection({
  providerId,
  vendor,
}: {
  providerId: string;
  vendor: SubscriptionOAuthVendor;
}) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const { providerSettingsService } = useServices();
  const [status, setStatus] = useState<SubscriptionOAuthLoginStatus | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void providerSettingsService
      .getSubscriptionOAuthStatus(providerId)
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus({
            status: "failed",
            message: error instanceof Error ? error.message : "Sign-in failed.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, providerSettingsService]);

  useEffect(() => {
    if (status?.status !== "waiting") return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void providerSettingsService
        .getSubscriptionOAuthStatus(providerId)
        .then((next) => {
          if (!cancelled) setStatus(next);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setStatus({
              status: "failed",
              message: error instanceof Error ? error.message : "Sign-in failed.",
            });
          }
        });
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [providerId, providerSettingsService, status?.status]);

  async function run(
    action: () => Promise<SubscriptionOAuthLoginStatus>,
  ): Promise<SubscriptionOAuthLoginStatus | null> {
    setBusy(true);
    try {
      const next = await action();
      setStatus(next);
      return next;
    } catch (error) {
      setStatus({
        status: "failed",
        message: error instanceof Error ? error.message : "Sign-in failed.",
      });
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      {status.status === "signed-in" ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-ui-sm leading-6 text-foreground">
              <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
              {intl.formatMessage({ id: "settings.modelProvider.subscriptionOAuth.signedIn" })}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                void run(() => providerSettingsService.signOutSubscriptionOAuth(providerId));
              }}
            >
              {intl.formatMessage({ id: "settings.modelProvider.subscriptionOAuth.signOut" })}
            </Button>
          </div>
          {vendor === "openai-chatgpt" ? (
            <SubscriptionUsage providerId={providerId} />
          ) : (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3">
              <Button
                className="px-0"
                type="button"
                variant="link"
                onClick={() => platform.openExternal(USAGE_URLS[vendor])}
              >
                {intl.formatMessage({ id: "settings.modelProvider.subscriptionUsage.openUsage" })}
                <ArrowUpRight aria-hidden="true" />
              </Button>
              {vendor === "xai" ? <GrokPlanBadge providerId={providerId} /> : null}
            </div>
          )}
        </>
      ) : status.status === "waiting" ? null : (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            void run(() => providerSettingsService.startSubscriptionOAuth(providerId)).then(
              (next) => {
                if (next?.status === "waiting" && next.verificationUrl) {
                  platform.openExternal(next.verificationUrl);
                }
              },
            );
          }}
        >
          {intl.formatMessage({ id: "settings.modelProvider.subscriptionOAuth.action" })}
        </Button>
      )}

      {status.status === "waiting" && status.mode === "device" && status.userCode ? (
        <p className="mt-3 text-ui-sm leading-6 text-foreground">
          {intl.formatMessage({ id: "settings.modelProvider.subscriptionOAuth.deviceCode" })}{" "}
          <span className="font-mono text-ui-base">{status.userCode}</span>
        </p>
      ) : null}

      {status.status === "waiting" && status.mode === "browser" ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              providerSettingsService.submitSubscriptionOAuthCode(providerId, code),
            ).then((next) => {
              if (next?.status === "signed-in") setCode("");
            });
          }}
        >
          <Input
            value={code}
            disabled={busy}
            placeholder={intl.formatMessage({
              id: "settings.modelProvider.subscriptionOAuth.pastePlaceholder",
            })}
            onChange={(event) => {
              setCode(event.target.value);
            }}
          />
          <Button type="submit" variant="outline" disabled={busy || code.trim().length === 0}>
            {intl.formatMessage({ id: "settings.modelProvider.subscriptionOAuth.continue" })}
          </Button>
        </form>
      ) : null}

      {status.status === "waiting" ? (
        <Button
          className="mt-3"
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setCode("");
            void run(() => providerSettingsService.cancelSubscriptionOAuth(providerId));
          }}
        >
          {intl.formatMessage({ id: "settings.modelProvider.subscriptionOAuth.cancel" })}
        </Button>
      ) : null}

      {status.status === "failed" ? (
        <p className="mt-3 text-ui-sm leading-6 text-destructive">{status.message}</p>
      ) : null}
    </div>
  );
}

function GrokPlanBadge({ providerId }: { providerId: string }) {
  const { state } = useSubscriptionUsage(providerId);
  const plan = state.status === "ready" ? state.usage.planType : undefined;
  return plan ? <Badge variant="secondary">{plan}</Badge> : null;
}

function SubscriptionUsage({ providerId }: { providerId: string }) {
  const { intl, locale } = useZCodeIntl();
  const { state, refresh } = useSubscriptionUsage(providerId);
  const refreshLabel = intl.formatMessage({ id: "common.refresh" });
  const loading = state.status === "loading";
  const usage = state.status === "ready" ? state.usage : undefined;
  const plan = formatPlanType(usage?.planType);
  const resetCount = usage?.availableResetCount;
  const percentFormat = new Intl.NumberFormat(locale, { style: "percent" });

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-ui-sm font-medium">
            {intl.formatMessage({ id: "settings.modelProvider.subscriptionUsage.title" })}
          </p>
          {plan ? <Badge variant="secondary">{plan}</Badge> : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={loading}
          aria-label={refreshLabel}
          title={refreshLabel}
          onClick={refresh}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </div>
      <div className="space-y-3" aria-live="polite">
        {usage?.windows.length ? (
          usage.windows.map(({ windowSeconds, usedPercent, resetsAt }) => {
            const label =
              windowSeconds === 604_800
                ? intl.formatMessage({ id: "settings.modelProvider.subscriptionUsage.weekly" })
                : intl.formatMessage(
                    { id: "settings.modelProvider.subscriptionUsage.window" },
                    { duration: formatQuotaDuration(locale, windowSeconds) },
                  );
            const used = intl.formatMessage(
              { id: "settings.modelProvider.subscriptionUsage.used" },
              { percent: percentFormat.format(usedPercent / 100) },
            );
            const resetTime = formatQuotaResetTime({
              locale,
              value: resetsAt,
              format: "dateTime",
              compactToday: true,
            });
            const time =
              resetTime && new Date(resetsAt).toDateString() === new Date().toDateString()
                ? `${new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "day")} ${resetTime}`
                : resetTime;
            const progressValue = Math.min(usedPercent, 100);
            return (
              <div className="space-y-1.5" key={windowSeconds}>
                <div className="flex items-baseline justify-between gap-3 text-ui-sm">
                  <span>{label}</span>
                  <span className="text-muted-foreground tabular-nums">{used}</span>
                </div>
                <Progress
                  value={progressValue}
                  className="h-1.5"
                  indicatorClassName="bg-success"
                  aria-label={label}
                  aria-valuenow={progressValue}
                  aria-valuetext={used}
                />
                {time ? (
                  <p className="text-ui-xs text-muted-foreground">
                    {intl.formatMessage(
                      { id: "settings.modelProvider.subscriptionUsage.resetAt" },
                      { time },
                    )}
                  </p>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className="text-ui-sm text-muted-foreground">
            {intl.formatMessage({
              id: loading
                ? "common.loading"
                : state.status === "unavailable"
                  ? "settings.modelProvider.subscriptionUsage.unavailable"
                  : "settings.modelProvider.subscriptionUsage.empty",
            })}
          </p>
        )}
        {resetCount !== undefined ? (
          <div className="flex items-baseline justify-between gap-3 text-ui-sm">
            <span>
              {intl.formatMessage({ id: "settings.modelProvider.subscriptionUsage.resetCards" })}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {intl.formatMessage(
                { id: "settings.modelProvider.subscriptionUsage.resetCardsAvailable" },
                { count: new Intl.NumberFormat(locale).format(resetCount) },
              )}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatQuotaDuration(locale: string, seconds: number): string {
  const [unit, unitSeconds] = (
    [
      ["day", 86_400],
      ["hour", 3_600],
      ["minute", 60],
    ] as const
  ).find(([, duration]) => seconds % duration === 0) ?? ["second", 1];
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(
    seconds / unitSeconds,
  );
}

function formatPlanType(planType: string | undefined): string | undefined {
  if (!planType || planType === "unknown") return undefined;
  return (
    PLAN_LABELS.get(planType) ??
    planType.replaceAll("_", " ").replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
  );
}
