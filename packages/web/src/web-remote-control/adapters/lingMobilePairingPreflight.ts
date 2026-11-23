import { LING_MOBILE_PAIRING } from "@zcode/shared/ling-mobile-pairing";
import { withWebRemoteControlHttpSignal } from "./webRemoteControlHttpSignal.js";

// 小入口先兑换配对码，再下载应用代码。
export async function redeemLingMobilePairingCode(
  url: URL,
  replaceHref: (href: string) => void,
): Promise<boolean> {
  if (
    (url.pathname !== "/remote/v4" && url.pathname !== "/remote/v4/") ||
    !url.searchParams.has(LING_MOBILE_PAIRING.queryKey) ||
    !url.hash
  ) {
    return true;
  }
  const code = url.hash.slice(1);
  const sid = url.searchParams.get("sid");
  // 局域网链接保留在地址栏，刷新或从书签打开时继续兑换 Cookie。
  if (
    url.protocol !== "http:" ||
    url.searchParams.get(LING_MOBILE_PAIRING.queryKey) !== LING_MOBILE_PAIRING.lanQueryValue
  ) {
    url.hash = "";
    replaceHref(url.href);
  }
  if (!sid) return false;

  return withWebRemoteControlHttpSignal(new AbortController().signal, async (signal) => {
    const response = await fetch(new URL(LING_MOBILE_PAIRING.exchangePath, url.origin), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid, code }),
      signal,
      redirect: "error",
    });
    return response.ok;
  }).catch(() => false);
}
