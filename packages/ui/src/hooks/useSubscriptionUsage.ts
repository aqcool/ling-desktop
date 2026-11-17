import { useEffect, useState } from "react";
import type { SubscriptionUsage } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";

type SubscriptionUsageState =
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | { readonly status: "ready"; readonly usage: SubscriptionUsage };

export function useSubscriptionUsage(providerId: string) {
  const { providerSettingsService } = useServices();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<SubscriptionUsageState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void providerSettingsService.getSubscriptionUsage(providerId).then(
      (usage) => {
        if (active) setState({ status: "ready", usage });
      },
      () => {
        if (active) setState({ status: "unavailable" });
      },
    );
    return () => {
      active = false;
    };
  }, [providerId, providerSettingsService, revision]);

  function refresh() {
    setState({ status: "loading" });
    setRevision((value) => value + 1);
  }

  return { state, refresh };
}
