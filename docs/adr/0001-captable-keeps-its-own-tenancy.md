# ADR-0001: Captable keeps its own tenancy and links to the Hub by reference

**Status:** Proposed (needs a named owner and approval; see "Decisions needed")
**Date:** 2026-10-05
**Applies platform rules:** Decision register D7 (compose by default; a fork needs a recorded decision with a named owner and a reconciliation plan) and ADR-0002 (a table has exactly one owning package).

## Context

The TIN platform provides identity, tenancy and authorization as Hub packages (`shared-identity-hub`: `schema-identity`, `domain-identity`) and, over HTTP, `tin-boss-api`. The platform's own risk list names two foundations (R1) and duplicated implementations (R2) as the most expensive failure modes.

Captable is a Next.js app (14 when this was written; 16 since PRs #11 and #12) on Prisma, NextAuth and Neon. It already has a working multi-company model: `Company` is the tenant, `Member` joins a user to a company with a status and a role, and every tenant-owned row is reached through a scoped Prisma client (`tenantDb`) behind a request lifecycle that verifies one active membership per request. This is a fork of a capability the Hub also provides, so D7 requires this record.

Why the Hub packages cannot be used directly today:

- **Isolation depends on Supabase.** The Hub's row-level security reads `auth.uid()` from a Supabase login. A Prisma connection gives it nothing to enforce.
- **Unbuilt pieces.** Tenant switching, the Next.js adapter, membership sync and provisioning are specified but not built; `tin-boss-api` has no tenant or membership endpoints and no signing-key endpoint.
- **Single tenant per user.** The Hub resolves one primary tenant per user today; Captable users belong to several companies.

## Decision

1. Captable keeps its own tenancy model, scoping and authorization. They are tested by the isolation matrix and guarded by the architecture test.
2. The link to the Hub is a **reference, not a copy**: a nullable, unique `Company.hubTenantId` (and later `User.hubUserId`) on a Captable-owned table. The Hub owns who a person is and which tenant a customer is; Captable owns membership, roles and what a member may do inside a company.
3. **Table ownership (ADR-0002):** Captable never creates or alters a table owned by a Hub package (`users`, `tenants`, `roles`, `workspaces`, `audit_logs`, `partners`, `role_bindings`, `impersonation_grants`). Captable's own `Audit` table remains Captable's; its relation to the Hub's `audit_logs` is an open question.
4. Platform operator access to a tenant uses the Hub's pattern (a reason-bearing, time-limited, audited grant read from a Hub claim), never a role name in Captable's database.
5. Captable is listed in the cross-hub register as a non-consumer with this recorded divergence.

## Update (2026-10-07)

`tin-boss-api` now has the membership read endpoints, signed membership webhooks and a JWKS endpoint merged on `main`, but no Captable cell is deployed and Captable has no integration code. The "unbuilt pieces" above are therefore partly stale. The membership responses carry Hub user ids but no email, so linking a Hub user to a Captable person is an open question for the Hub owner. The reconciliation plan above still applies.

## Reconciliation plan

Revisit this decision when **all** of these exist in the Hub: a signing-key endpoint, a claims contract carrying a tenant id, a membership read endpoint or webhook, tenant switching, and a framework-neutral adapter. Then evaluate: federated login through an OIDC or WorkOS provider mapping the identity organisation to `hubTenantId`, a signed membership webhook, and retiring any duplicated logic. Until then the duplication is deliberate and bounded to the section above.

## Standalone contract (added 2026-10-07)

Captable must keep working as an independent package if `tin-boss-api` is slow, changed or gone. Any Hub or Boss API link is built to these rules, and a change to a rule needs a change to this ADR.

1. **Off by default.** With no Boss API settings present, the integration does nothing and the app behaves exactly as it does without it. Self-hosted Captable has no Boss API. A test runs the suite with the integration off.
2. **Never in the request path.** No login, page load, tRPC call or REST call waits on Boss API. Only a background sync job calls it.
3. **A Captable-owned local copy, ids and status only.** The sync stores, in a Captable table, the Hub tenant id, the Hub user id, the member status and the time of the last sync. It stores no profile data (no names, emails or roles). This refines decision 2: the Hub owns the facts, Captable owns a minimal cache of who belongs.
4. **Boss API down means the last copy stays.** No lockout, and nothing is granted or revoked because of silence. The cost is accepted: a person removed in the Hub stays a Captable member until the next successful sync. Captable favours availability over instant revocation. The opposite policy (cut off Hub-managed users when the Hub is unreachable) makes Captable depend on the Hub and needs a new ADR.
5. **Roles never come from the Hub.** The sync can map a Hub status (`pending`, `suspended`) onto a Captable member state through an explicit, tested mapping. It never creates a role, an admin or a permission.
6. **The shape is fixed at build time.** The client and its validators are generated from Boss API's `openapi.json` and committed to this repository (vendored), or pinned to an exact package version. Captable never fetches a schema at runtime. Unknown response fields are ignored. Captable stays on the contract version it was built against until the owner moves it on purpose.
7. **Builds do not depend on the private registry.** A vendored client needs no registry token to install, so a registry outage cannot stop a build or a deploy.
8. **Tokens, if ever added.** Verify against cached JWKS keys, keep serving with a stale cache when the endpoint is down, and keep NextAuth sign-in as the fallback. A Boss API outage must never block sign-in.
9. **Proof.** A test runs the existing suite with a Boss API client that always fails. Every existing flow must still pass.

## Consequences

- No second foundation is created inside the Hub; Captable's model is contained and tested.
- Captable can adopt Hub identity later without a data migration, because `hubTenantId` is nullable and additive.
- Captable carries its own authorization code (about one subject list and one middleware); changes to the Hub's permission model do not reach it automatically.
- The Hub-side work this depends on (tenant-header bypass, one operator definition, tenant and membership endpoints) is tracked in the plan, section 10, not here.

## Decisions needed

- **Owner:** a named person accountable for this fork (the register requires one).
- **Audit:** whether Captable's audit events should also be shipped to the Hub's `audit_logs`, or stay separate.
- **Client form:** whether the Boss API client is vendored into this repository (recommended, rule 7) or installed as a pinned private package.
- **Removal policy:** confirm rule 4 (keep the last known copy when Boss API is unreachable) or choose to depend on the Hub.
