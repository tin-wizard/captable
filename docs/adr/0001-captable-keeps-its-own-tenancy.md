# ADR-0001: Captable keeps its own tenancy and links to the Hub by reference

**Status:** Proposed (needs a named owner and approval; see "Decisions needed")
**Date:** 2026-10-05
**Applies platform rules:** Decision register D7 (compose by default; a fork needs a recorded decision with a named owner and a reconciliation plan) and ADR-0002 (a table has exactly one owning package).

## Context

The TIN platform provides identity, tenancy and authorization as Hub packages (`shared-identity-hub`: `schema-identity`, `domain-identity`) and, over HTTP, `tin-boss-api`. The platform's own risk list names two foundations (R1) and duplicated implementations (R2) as the most expensive failure modes.

Captable is a Next.js 14 app on Prisma, NextAuth and Neon. It already has a working multi-company model: `Company` is the tenant, `Member` joins a user to a company with a status and a role, and every tenant-owned row is reached through a scoped Prisma client (`tenantDb`) behind a request lifecycle that verifies one active membership per request. This is a fork of a capability the Hub also provides, so D7 requires this record.

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

## Reconciliation plan

Revisit this decision when **all** of these exist in the Hub: a signing-key endpoint, a claims contract carrying a tenant id, a membership read endpoint or webhook, tenant switching, and a framework-neutral adapter. Then evaluate: federated login through an OIDC or WorkOS provider mapping the identity organisation to `hubTenantId`, a signed membership webhook, and retiring any duplicated logic. Until then the duplication is deliberate and bounded to the section above.

## Consequences

- No second foundation is created inside the Hub; Captable's model is contained and tested.
- Captable can adopt Hub identity later without a data migration, because `hubTenantId` is nullable and additive.
- Captable carries its own authorization code (about one subject list and one middleware); changes to the Hub's permission model do not reach it automatically.
- The Hub-side work this depends on (tenant-header bypass, one operator definition, tenant and membership endpoints) is tracked in the plan, section 10, not here.

## Decisions needed

- **Owner:** a named person accountable for this fork (the register requires one).
- **Audit:** whether Captable's audit events should also be shipped to the Hub's `audit_logs`, or stay separate.
