// 手机扫码入口在加载应用之前读取，保持独立于报文校验和 WebSocket transport。
export const LING_MOBILE_PAIRING = {
  queryKey: "ling-pair",
  exchangePath: "/api/v1/remote/ling/pair",
  tokenPath: "/api/v1/remote/ling/token",
} as const;
