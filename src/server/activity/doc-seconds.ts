// ViewEvent.docSeconds: per data room document (keyed by bucketId), its page
// count `n` and seconds per page `p`. Only ever raised by the heartbeat.
export type DocSeconds = Record<
  string,
  { n: number; p: Record<string, number> }
>;

export const MAX_DOCS = 20;
export const MAX_DOC_PAGES = 500;
const PAGE_KEY = /^[1-9]\d{0,3}$/;

// Per page max(stored, min(incoming, ceiling)); n is the largest seen; pages
// beyond n, malformed keys, documents past 20 and pages past 500 are dropped.
export function mergeDocSeconds(
  stored: DocSeconds,
  incoming: DocSeconds,
  ceiling: number,
): DocSeconds {
  const out: DocSeconds = {};
  for (const [id, doc] of Object.entries(stored)) {
    out[id] = { n: doc.n, p: { ...doc.p } };
  }
  for (const [id, doc] of Object.entries(incoming)) {
    const prev = out[id];
    if (!prev && Object.keys(out).length >= MAX_DOCS) continue;
    const n = Math.max(prev?.n ?? 0, doc.n);
    const p = prev?.p ?? {};
    for (const [page, secs] of Object.entries(doc.p)) {
      if (!PAGE_KEY.test(page) || Number(page) > n) continue;
      if (!(page in p) && Object.keys(p).length >= MAX_DOC_PAGES) continue;
      p[page] = Math.max(p[page] ?? 0, Math.min(secs, ceiling));
    }
    out[id] = { n, p };
  }
  return out;
}
