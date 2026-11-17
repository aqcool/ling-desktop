import { useEffect, useState } from "react";
import type { SubscriptionOAuthLoginStatus } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const SIGNED_OUT: SubscriptionOAuthLoginStatus = { status: "signed-out" };

export function SubscriptionOAuthSection({ providerId }: { providerId: string }) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const { providerSettingsService } = useServices();
  const [status, setStatus] = useState<SubscriptionOAuthLoginStatus>(SIGNED_OUT);
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
    if (status.status !== "waiting") return;
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
  }, [providerId, providerSettingsService, status.status]);

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

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      {status.status === "signed-in" ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-ui-sm leading-6 text-foreground">
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
