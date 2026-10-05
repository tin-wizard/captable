# Phase 2 evidence and retrospective (2026-10-05)

## Evidence

| Task | Commit | Tests after | Reviewer verdict |
|---|---|---|---|
| T1 no default admin role | `6197ab6` | 194 | checked by the phase review: all creation paths explicit |
| T2 roles on every mutation, last-admin | `07724f3` | 250 | review: two blockers found (below) |
| T2b only ADMIN grants ADMIN | `b1a1cbb` | 255 | superseded by `855d303` |
| T3 scoped helper for pages, T5 active-only lists | `3c62586` | 260 | review: clean |
| test fix (unhandled rejection) | `5b5faf1` | 260 | found while verifying T3/T5 |
| T4 30-day links, previous-secret verification | `de4031b` | 273 | review: correct; legacy no-expiry tokens accepted by design |
| Review fixes (B1, B2, S1, S4) | `855d303` | 297 | verified here: three runs exit 0; production build passes |

Independent review (opus, read-only): two blockers, both confirmed in code and fixed.
- B1: a member with `roles:update` could grant itself every permission.
- B2: the REST API had no role checks; a user-scoped API token worked in every company the owner belonged to.

## Retrospective

- **Completed:** T1 to T5 done. T6a (owner and approval for ADR-0001) waits on you.
- **Changes needed to the plan:** added F11 (open reads), F12 (no resend for e-sign links), F13 (last-admin race). The blueprint is updated: authorization and pages are now built.
- **What the review caught that tests did not:** both blockers. The earlier roles tests proved each mutation needs a permission; none asked whether a permission-holder could rewrite the permissions, and none covered REST. The Phase 2 tests now do.
- **Process:** the same-family review remains valuable but is the only reviewer so far; the cross-family review the plan calls for on security tasks has not been run.
- **Decision:** Continue to Phase 3 after the PR gate (G0). Operator actions before real data: grant the five new subjects to existing CUSTOM roles, and enable `PUBLIC_LINK_REQUIRE_EXPIRY=1` 30 days after deploy.
