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

/**
 * Chooser click. A company without its own host is served on canonical
 * `/${publicId}`, which shows the session's company, so switch first (as the
 * sidebar switcher does). Host-bound companies enter through the handoff link.
 */
export async function enterCompany(
  company: { url: string; memberId: string },
  deps: {
    switchCompany: (memberId: string) => Promise<unknown>;
    refreshSession: () => Promise<unknown>;
    assign: (url: string) => void;
  },
) {
  if (company.url.startsWith("/")) {
    await deps.switchCompany(company.memberId);
    await deps.refreshSession();
  }
  deps.assign(company.url);
}
