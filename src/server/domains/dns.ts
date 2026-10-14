import dns from "node:dns/promises";

export const challengeName = (hostname: string) =>
  `_dealroom-challenge.${hostname}`;

export type DnsDeps = {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
  resolve4(name: string): Promise<string[]>;
};

const TIMEOUT_MS = 5_000;
const withTimeout = <T>(p: Promise<T>) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("dns timeout")), TIMEOUT_MS).unref(),
    ),
  ]);

export const realDnsDeps: DnsDeps = {
  resolveTxt: (n) => withTimeout(dns.resolveTxt(n)),
  resolveCname: (n) => withTimeout(dns.resolveCname(n)),
  resolve4: (n) => withTimeout(dns.resolve4(n)),
};

// Every lookup error (NXDOMAIN, ENODATA, timeout) counts as "no record".
const orEmpty = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);
const MAX_CNAME_HOPS = 5;

export async function checkDomainDns(
  input: {
    hostname: string;
    token: string;
    canonicalHost: string;
    baseDomain: string;
    serverIps: string[];
  },
  deps: DnsDeps,
): Promise<{ owned: boolean; routed: boolean }> {
  const { hostname, token, canonicalHost, baseDomain, serverIps } = input;
  const ours = (h: string) =>
    h === canonicalHost || h === baseDomain || h.endsWith(`.${baseDomain}`);

  const owned = orEmpty(deps.resolveTxt(challengeName(hostname))).then((txt) =>
    txt.some((chunks) => chunks.join("") === token),
  );
  // follow the CNAME chain a few hops; any hop landing on a platform host routes
  const byCname = (async () => {
    let name = hostname;
    for (let i = 0; i < MAX_CNAME_HOPS; i++) {
      const target = (await orEmpty(deps.resolveCname(name)))[0]
        ?.toLowerCase()
        .replace(/\.$/, "");
      if (!target) return false;
      if (ours(target)) return true;
      name = target;
    }
    return false;
  })();
  const byA = serverIps.length
    ? orEmpty(deps.resolve4(hostname)).then((ips) =>
        ips.some((ip) => serverIps.includes(ip)),
      )
    : Promise.resolve(false);
  // concurrent, so the worst case is about one lookup timeout, not one per lookup
  const [o, c, a] = await Promise.all([owned, byCname, byA]);
  return { owned: o, routed: c || a };
}
