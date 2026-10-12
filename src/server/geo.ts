import { existsSync } from "node:fs";
import { type Reader, type Response, open } from "maxmind";

export type Geo = { country?: string; asn?: string; network?: string };

// IPinfo Lite MMDB record (country and ASN only)
export type IpinfoLite = {
  country_code?: string;
  asn?: string;
  as_name?: string;
};

// The Docker build puts the database here when IPINFO_TOKEN was available.
const DB_PATH = process.env.IPINFO_DB_PATH ?? "/app/data/ipinfo_lite.mmdb";

// maxmind constrains T to its own Response union, which has no IPinfo shape.
type Rec = IpinfoLite & Response;

let reader: Promise<Reader<Rec> | null> | undefined;
const load = () => {
  reader ??= existsSync(DB_PATH)
    ? open<Rec>(DB_PATH).catch(() => null)
    : Promise.resolve(null);
  return reader;
};

export function toGeo(rec: IpinfoLite | null): Geo {
  const geo: Geo = {};
  if (rec?.country_code) geo.country = rec.country_code;
  if (rec?.asn) geo.asn = rec.asn;
  if (rec?.as_name) geo.network = rec.as_name;
  return geo;
}

// Never throws: a missing or unreadable database, or a private/invalid address,
// means "no location", never a failed view.
export async function lookupGeo(ip: string): Promise<Geo> {
  try {
    const r = await load();
    return r ? toGeo(r.get(ip)) : {};
  } catch {
    return {};
  }
}
