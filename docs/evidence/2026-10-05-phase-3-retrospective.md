# Phase 3 evidence and retrospective (2026-10-05)

## Evidence

| Task | Commit | Tests after | Reviewer verdict |
|---|---|---|---|
| T6 per-company stakeholder email, T7 bucket relation and upload size limits | `25d3c41` | 317 | review: no blockers; migrations atomic and safe to apply |
| T8 REST cookie writes, optional header, pagination, page hygiene | `69a381e` | 324 | review: no blockers; new surface noted (cookie-authenticated REST writes) |
| T9 leaking reads, T10 resend link, T11 serializable last-admin | `4dcfc0e` | 343 | review: sound; race reproduced before the fix |
| Cancelled envelope no longer serves the document | `5d81356` | 344 | found by the review; fixed and tested here |

Independent review (opus, read-only): no blockers. Verified by running the real presigner that the size is signed (`content-length`) and the content type is not.

## Retrospective

- **Completed:** T6 to T11 and one review fix. Phase 3 is closed.
- **Changes needed to the plan:** new findings F14 (public content type is not signed) and F15 (small follow-ups). The blueprint's three stale residual cells are updated.
- **What the review caught that tests did not:** the cancelled-envelope exposure and the unsigned content type. Both were about what a public endpoint returns or accepts when called directly, which the page-level tests do not exercise.
- **Process:** the race was reproduced before it was fixed, which is the standard to keep. The cross-family review for security tasks has still not been run.
- **Decision:** Continue to the PR gate (G0). Operator actions before real data: apply the four migrations (gate G4) after running `docs/bucket-owner-backfill-report.sql`; grant the five new subjects to existing custom roles; enable `PUBLIC_LINK_REQUIRE_EXPIRY=1` 30 days after deploy; do a real upload test against the storage backend (size limit and content type).
