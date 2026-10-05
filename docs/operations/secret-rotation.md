# Rotating `NEXTAUTH_SECRET` and expiring public links

## What the secret signs

| Use | Signed by | Survives a rotation? |
|---|---|---|
| Login sessions (NextAuth JWT cookie) | `NEXTAUTH_SECRET` only | **No.** NextAuth accepts one secret, so every user is signed out once after the switch |
| Public links: e-sign, data room, investor update | `NEXTAUTH_SECRET`, verified against `NEXTAUTH_SECRET_PREVIOUS` as a fallback | **Yes**, for as long as the previous secret is set |

Public links expire 30 days after they are issued (`LINK_TTL` in `src/lib/jwt.ts`). An expired or invalid link shows a not-found or "link not valid" page and no data.

## Rotation procedure

1. Generate a new secret: `openssl rand -base64 32` (the app refuses to start with fewer than 32 characters).
2. In the environment, set `NEXTAUTH_SECRET_PREVIOUS` to the **old** value and `NEXTAUTH_SECRET` to the **new** value.
3. Deploy. Users sign in again once. Links already sent keep working because they are verified against the previous secret.
4. After 30 days every link signed with the old secret has expired. Remove `NEXTAUTH_SECRET_PREVIOUS` and deploy again.

Only a signature mismatch falls back to the previous secret. An expired token, a missing claim or a wrong algorithm is rejected even if it was signed with the previous secret.

## Links sent before expiry existed

Links emailed before this change carry no expiry. By default they keep working, so nobody's inbox breaks on deploy day. 30 days after the deploy, every link still in use has been re-issued with an expiry, so turn the strict mode on:

- set `PUBLIC_LINK_REQUIRE_EXPIRY=1` and redeploy; tokens without an expiry are then rejected.

## Variables

| Variable | Required | Meaning |
|---|---|---|
| `NEXTAUTH_SECRET` | yes, 32+ characters | Signs sessions and public links |
| `NEXTAUTH_SECRET_PREVIOUS` | no, 32+ characters | Old secret, kept only during a rotation |
| `PUBLIC_LINK_REQUIRE_EXPIRY` | no, `0` or `1` | `1` rejects public links that have no expiry |
