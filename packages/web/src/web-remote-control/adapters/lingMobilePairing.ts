import { parseWebRemoteControlExternalQrParams } from "@zcode/shared";
import {
  LING_MOBILE_PAIRING,
  parseWebRemoteControlRelayV2HttpResponse,
  WebRemoteControlV2ConnectionError,
} from "@zcode/shared/web-remote-relay";
import type { WebRemoteControlEntryConnection } from "#src/web-remote-control/contract.js";
import { withWebRemoteControlHttpSignal } from "./webRemoteControlHttpSignal.js";

export function createLingMobileConnection(
  url: URL,
  onFailure: WebRemoteControlEntryConnection["onFailure"],
): WebRemoteControlEntryConnection {
  const params = parseWebRemoteControlExternalQrParams(url.searchParams);
  if (!params?.deviceSid) throw new WebRemoteControlV2ConnectionError("auth-required");
  const sid = params.deviceSid;
  const signal = new AbortController().signal;

  async function getTokenResponse(parentSignal: AbortSignal) {
    return withWebRemoteControlHttpSignal(parentSignal, async (requestSignal) => {
      const response = await fetch(new URL(LING_MOBILE_PAIRING.tokenPath, url.origin), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid }),
        signal: requestSignal,
        redirect: "error",
      }).catch(() => {
        throw new WebRemoteControlV2ConnectionError("relay-unavailable", true);
      });
      if (response.status === 401) throw new WebRemoteControlV2ConnectionError("auth-required");
      if (!response.ok)
        throw new WebRemoteControlV2ConnectionError("relay-unavailable", response.status >= 500);
      return response.json();
    });
  }

  return {
    params: { ...params, deviceSid: sid },
    signal,
    getToken: async (tokenSignal) => {
      const response = await getTokenResponse(tokenSignal);
      const token = parseWebRemoteControlRelayV2HttpResponse("token", response);
      if (token?.code !== 0 || !token.data)
        throw new WebRemoteControlV2ConnectionError("relay-unavailable");
      return token.data.token;
    },
    onPaired: () => {},
    onFailure: (failure) =>
      onFailure(
        failure.reason === "auth-required" ? { reason: "invalid-mobile-connection" } : failure,
      ),
  };
}
