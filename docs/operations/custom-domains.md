# Custom company domains

A company can serve its data room from its own hostname (for example `investors.example.com`) instead of `<label>.dealroom.tin.info`. This page covers what the customer does, the one-time server setup, how to change and roll back the Caddy configuration, how to test, and the known limits.

## How it works

1. An admin adds a hostname under Settings, Company, Custom domains. The app returns a TXT challenge value.
2. The customer creates DNS records (below). The admin presses "Verify"; the app checks DNS itself and marks the domain `ACTIVE`.
3. When the first visitor opens `https://<custom host>`, Caddy asks the app (`/api/domains/tls-ask`) whether it may get a certificate for that name. The app answers 200 only for a verified custom domain, and only with the shared secret. Caddy then obtains a Let's Encrypt certificate on demand.
4. An admin can make the custom domain the primary address. The platform address then permanently redirects to it.

## Customer steps

| Record | Name | Value |
|---|---|---|
| `CNAME` | the subdomain, e.g. `investors.example.com` | `dealroom.tin.info` |
| `TXT` | `_dealroom-challenge.<host>`, e.g. `_dealroom-challenge.investors.example.com` | the value shown in the Settings card |

- Apex domains (`example.com`) cannot hold a CNAME. Use an `A` record to the server IP (`91.98.230.192`) instead, or an ALIAS/ANAME record if the DNS provider offers one. The app accepts a hostname whose A record is in `CUSTOM_DOMAIN_IPS`.
- Cloudflare-proxied (orange cloud) records hide the real target; set them to "DNS only" until the domain is verified.
- DNS changes can take minutes to hours. "Verify" can be pressed again at any time.
- The default address `<label>.dealroom.tin.info` keeps working. Once the custom domain is set as primary, the default address redirects to it (permanently, no expiry). Switching back to the platform address makes the custom domain an alias for 30 days.
- Login and sign-up happen on the canonical host `dealroom.tin.info`; a custom host only shows the company login page and hands the session over.

## Operator one-time setup

### Environment variables

| Variable | Where | Value |
|---|---|---|
| `TLS_ASK_SECRET` | app `.env` and `.caddy.env` (same value in both) | long random string, `openssl rand -hex 32` |
| `CUSTOM_DOMAIN_IPS` | app `.env` | `91.98.230.192` (comma separated if more) |
| `CLOUDFLARE_ACCOUNT_ID` | app `.env` | the Cloudflare account that owns the R2 buckets |
| `CLOUDFLARE_API_TOKEN` | app `.env` | scoped token, see below |

Create the Cloudflare token in the Cloudflare dashboard (My Profile, API Tokens) with a single permission: Account, "Workers R2 Storage: Edit", limited to the two R2 buckets' account. Type it into `.env` yourself; never paste it in chat, tickets or the repository. It is used only to keep the buckets' CORS allow-list in sync with verified custom domains. Without it the domain still works but uploads from that host fail until CORS is synced (see Known limits).

`TLS_ASK_SECRET` unset or empty means the ask endpoint always answers 403 and Caddy issues no certificate for any custom host. That is the safe default.

### Caddyfile change

Work on the server in `/opt/captable`. The existing file has one site block, `dealroom.tin.info, *.dealroom.tin.info`; leave it as it is. Add a global options block at the very top and a catch-all block at the end:

```caddyfile
{
	on_demand_tls {
		ask http://app:3000/api/domains/tls-ask?secret={env.TLS_ASK_SECRET}
	}
}

# ...existing "dealroom.tin.info, *.dealroom.tin.info" block unchanged...

# Any other host gets a certificate only if the app says it is a verified custom domain.
https:// {
	tls {
		on_demand
	}
	encode zstd gzip
	reverse_proxy app:3000 {
		header_up X-Real-IP {remote_host}
	}
}
```

Copy the existing `@activity path /api/activity/*` matcher and its 32KB request-body cap from the platform block into the catch-all as well, so custom hosts have the same limit on the activity beacon. If a global options block already exists, add only the `on_demand_tls` section to it.

The platform names keep using the wildcard certificate (DNS challenge through Cloudflare); Caddy picks the most specific site block, so only other hostnames reach the catch-all.

#### Syntax check for Caddy 2.10 (verified)

- `ask <endpoint>` inside the global `on_demand_tls { }` is still valid in Caddy 2.10. The Caddyfile reference (https://caddyserver.com/docs/caddyfile/options#on-demand-tls) lists `ask` and `permission`; `permission` is the module-based form, and the built-in `http` permission module is what `ask` uses, "a shortcut for backwards compatibility". The JSON field `ask` is deprecated, the Caddyfile directive is not. No change to a `permission http { endpoint ... }` form is needed.
- `on_demand` goes in the site's `tls` block and only enables the feature; the global `ask` is what restricts it (required in production, otherwise anyone could trigger issuance).
- `{env.X}` placeholder inside the ask URL: the Caddy docs say `{env.*}` works only where a module performs the replacement, and the `ask` page does not say so explicitly. It was tested directly against `caddy:2.10.2-alpine`: with `TLS_ASK_SECRET=s3cret` in the container environment and `ask http://askhost:9123/ask?secret={env.TLS_ASK_SECRET}`, `caddy validate` passes and the TLS handshake for an unknown host made Caddy call `/ask?domain=foo.example.test&secret=s3cret`. The same request was produced by the parse-time form `{$TLS_ASK_SECRET}`. Both work; `{env.TLS_ASK_SECRET}` is used here. Caddy appends `domain=` to the existing query string with `&`.
- The image in production (`dealroom-caddy:2.10.2-cf0.2.4`) is the same Caddy core plus the Cloudflare DNS module, so the same syntax applies. Run the validate step below on the server to confirm with the real image.

### Backup, validate, reload

```sh
cd /opt/captable
cp Caddyfile Caddyfile.bak-$(date +%Y%m%d-%H%M)

# edit Caddyfile, then validate with the production image and env
docker run --rm --entrypoint caddy \
  --env-file /opt/captable/.caddy.env \
  -v /opt/captable/Caddyfile:/etc/caddy/Caddyfile:ro \
  dealroom-caddy:2.10.2-cf0.2.4 validate --config /etc/caddy/Caddyfile
# expect: "Valid configuration"; do not continue on any error

# apply (also picks up a changed .caddy.env); a few seconds of interruption
docker compose up -d --force-recreate caddy
docker compose logs --tail 50 caddy
```

Before the reload, confirm `TLS_ASK_SECRET` is in both `.env` (app) and `.caddy.env` with the same value, and that the app image with the `/api/domains/tls-ask` route is deployed and healthy. Certificates and ACME state live in Caddy's data volume and survive the recreate.

### Rollback

1. Restore the backup: `cp Caddyfile.bak-<stamp> Caddyfile`.
2. `docker compose up -d --force-recreate caddy`.

Custom hosts then fail the TLS handshake (no site for them); platform addresses are unaffected. For a softer stop that keeps the config, unset or empty `TLS_ASK_SECRET` in the app `.env` and redeploy the app: the ask endpoint answers 403, so no new certificate is issued (certificates already issued keep being served until they expire). Setting the secret in `.caddy.env` alone is not enough; the app compares it.

## Test with a throwaway domain

Use a name you control that is not a customer's, for example `test-custom.tin.info`.

1. DNS: `CNAME test-custom.tin.info -> dealroom.tin.info`, DNS only (not proxied).
2. In a test company's Settings, Company, Custom domains, add `test-custom.tin.info`, create the TXT record shown, press Verify.
3. `curl -sI https://test-custom.tin.info/login` should return 200 with a valid Let's Encrypt certificate (first request may take a few seconds while the certificate is issued).
4. Open `https://test-custom.tin.info/login` in a browser: the company login page, titled with the host. `/signup` must redirect to `https://dealroom.tin.info/signup`.
5. Set it as primary, then open the platform address: it must redirect to `test-custom.tin.info`. Switch back to the platform address and remove the test domain afterwards.
6. Negative check: `curl -svk --resolve unverified.tin.info:443:91.98.230.192 https://unverified.tin.info/` must fail the handshake (no certificate is issued for a hostname the app does not know).

## Checking certificate issuance

```sh
cd /opt/captable
docker compose logs --since 30m caddy | grep -Ei 'tls-ask|on_demand|obtain|certificate|acme|error'
```

- Success: `tls.obtain ... certificate obtained successfully` with `identifier: <host>`, then `tls.issuance.acme ... served key authentication`.
- Refused by the app: `tls.on_demand ... certificate request not allowed by permission module` or `decision func: ... 403`: the domain is not verified, was removed, or `TLS_ASK_SECRET` differs between `.env` and `.caddy.env`.
- Let's Encrypt failures (rate limit, DNS pointing elsewhere): the `tls.obtain` error includes the ACME problem detail. Let's Encrypt allows 50 certificates per registered domain per week and 5 duplicates per week; do not repeatedly add and remove the same host.
- Ask endpoint check from the app side: the endpoint returns 200 only for `?domain=<verified custom host>&secret=<TLS_ASK_SECRET>`; anything else is 403. Do not paste the secret into shell history on shared machines.

## Known limits

- One server IP: apex `A` records and the verification check assume `CUSTOM_DOMAIN_IPS` (currently `91.98.230.192`). Moving the server means updating that variable and every customer's apex record.
- At most 5 custom domains per company.
- The platform address cannot be renamed while a custom domain is primary (switch the primary back first).
- No automatic re-verification: DNS is checked when an admin presses Verify. A domain whose DNS later points elsewhere keeps working until it is removed.
- No wildcard custom domains; each hostname is verified and issued separately.
- The CORS allow-list on the R2 buckets is synced on verify, primary change and removal and needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. If they are missing or Cloudflare is unreachable, the domain still verifies but document uploads from that host fail until the sync succeeds; the Settings card shows the sync state.
- The address box on `/login` still takes the platform address (it then redirects).

## End-to-end coverage

The e2e harness (`pnpm e2e`, Caddy with an internal CA in front of `next start`) resolves the extra host `custom-e2e.test` through a Chromium host-resolver rule and a Caddy site name. `e2e/seed.ts` creates "Custom Co" whose primary row is an `ACTIVE` `CUSTOM` domain on that host, and `e2e/subdomains.spec.ts` asserts that the platform address redirects to it, that `/login` there shows the company login page, and that `/signup` redirects to the canonical host. TLS issuance through the ask endpoint is not covered there (the harness uses `tls internal`); the unit and integration tests for the ask route cover its decisions, and the throwaway-domain test above covers the real issuance.
