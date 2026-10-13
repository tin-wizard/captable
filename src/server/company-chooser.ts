export type ChooserDecision =
  | { kind: "none" }
  | { kind: "single"; url: string }
  | { kind: "many" };

/** What "/" does for a signed-in user, given getCompanyList's entries. */
export function chooserDecision(companies: { url: string }[]): ChooserDecision {
  const [first, ...rest] = companies;
  if (!first) return { kind: "none" };
  return rest.length ? { kind: "many" } : { kind: "single", url: first.url };
}
