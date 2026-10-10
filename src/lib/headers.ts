// Only x-real-ip: Caddy overwrites it; x-forwarded-for is client-controllable.
export function getIp(headers: Headers) {
  return headers.get("x-real-ip") ?? "127.0.0.1";
}

export function getUserAgent(headers: Headers) {
  return headers.get("user-agent") ?? "";
}
