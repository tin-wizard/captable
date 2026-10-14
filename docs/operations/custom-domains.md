# Custom company domains

A company can serve its data room from its own hostname (for example `investors.example.com`) instead of `<label>.dealroom.tin.info`. This page covers what the customer does, the one-time server setup, how to change and roll back the Caddy configuration, how to test, and the known limits.

## How it works

1. An admin adds a hostname under Settings, Company, Custom domains. The app returns a TXT challenge value.
2. The customer creates the DNS records listed below. The admin presses "Verify", and the app checks DNS itself.
   - A verified domain is **not** the company address yet. It becomes a permanent alias (`ALIAS`, no expiry) that redirects to the current primary address.
3. Someone opens `https://<custom host>` once.
   - Caddy asks the app (`/api/domains/tls-ask`) whether it may get a certificate for that name.
   - The app answers 200 only for a verified custom domain, and only when the request carries the shared secret.
   - Caddy then obtains a Let's Encrypt certificate on demand. That first visit redirects to the current address.
4. The admin presses "Make primary" (with a confirmation). The custom domain becomes the company address, and the platform address permanently redirects to it.

Custom domains are only offered when `TLS_ASK_SECRET` is set in the app `.env`. Without it, the Settings card is hidden and every custom-domain API call answers "not found". This is deliberate: no custom host could ever get a certificate without the secret.

## Customer steps

| Record | Name | Value |
|---|---|---|
| `CNAME` | the subdomain, e.g. `investors.example.com` | `dealroom.tin.info` |
| `TXT` | `_dealroom-challenge.<host>`, e.g. `_dealroom-challenge.investors.example.com` | the value shown in the Settings card |

- **Apex domains:** `example.com` cannot hold a CNAME. Use an `A` record to the server IP (`91.98.230.192`) instead, or an ALIAS/ANAME record if the DNS provider offers one. The app accepts a hostname whose A record is in `CUSTOM_DOMAIN_IPS`.
- **Cloudflare-proxied records:** proxied (orange cloud) records hide the real target. Set them to "DNS only" until the domain is verified.
- **Timing:** DNS changes can take minutes to hours. "Verify" can be pressed again at any time.
- **After Verify:** open `https://<custom host>` once so its certificate is issued, then press "Make primary".
- **The default address:** `<label>.dealroom.tin.info` keeps working. Once the custom domain is primary, the default address redirects to it permanently, with no expiry. Switching back to the platform address makes the custom domain an alias for 30 days; after that it stops working.
- **Login and sign-up:** these happen on the canonical host `dealroom.tin.info`. A custom host only shows the company login page and hands the session over.

## Operator one-time setup

### Environment variables

| Variable | Where | Value |
|---|---|---|
| `TLS_ASK_SECRET` | app `.env` and `.caddy.env` (same value in both) | long random string, `openssl rand -hex 32` |
| `CUSTOM_DOMAIN_IPS` | app `.env` | `91.98.230.192` (comma separated if more) |
| `CLOUDFLARE_ACCOUNT_ID` | app `.env` | the Cloudflare account that owns the R2 buckets |
| `CLOUDFLARE_API_TOKEN` | app `.env` | scoped token, see below |

**The Cloudflare token:**
- Create it in the Cloudflare dashboard (My Profile, API Tokens) with a single permission: Account, "Workers R2 Storage: Edit", limited to the two R2 buckets' account.
- Type it into `.env` yourself. Never paste it in chat, tickets or the repository.
- It is used only to keep the buckets' CORS allow-list in sync with verified custom domains. Without it a custom domain still works, but uploads from that host fail until CORS is synced (see Known limits).
- Back up the CORS rules (below) **before** setting it.

**If `TLS_ASK_SECRET` is unset or empty:**
- The ask endpoint always answers 404, and Caddy issues no certificate for any custom host.
- The Settings card is hidden.
- That is the safe default.

**After editing the app `.env`:** recreate the app container so it reads the new values. A plain `up -d` does not pick up `.env` changes.

```sh
cd /opt/captable
docker compose up -d --force-recreate app
```

### Back up the R2 CORS rules before setting `CLOUDFLARE_API_TOKEN`

The sync replaces only its own rule (`id` `dealroom-custom-domains`) and keeps the others. Still, save the current rules of the bucket first, so you can restore them exactly. Run this on the server, with the bucket names from the app `.env` (`UPLOAD_BUCKET_PRIVATE`):

```sh
cd /opt/captable
read -rs CF_TOKEN            # paste the token; it is not echoed and not in shell history
CF_ACCOUNT=<CLOUDFLARE_ACCOUNT_ID>
for B in <UPLOAD_BUCKET_PRIVATE>; do
  curl -s -H "Authorization: Bearer $CF_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/r2/buckets/$B/cors" \
    | tee "cors-$B-$(date +%Y%m%d-%H%M).json" | jq '.success, .result.rules | length'
done
```

`wrangler r2 bucket cors list <bucket>` shows the same rules if you prefer Wrangler. Keep the saved JSON files.

**After the first sync**, which runs on the first verify, primary change or removal:
1. Read the bucket again with the same `curl`.
2. Diff them against the saved files: the platform rule must be unchanged, and only a `dealroom-custom-domains` rule may have been added.
3. Keep the restore command at hand:

```sh
# restore one bucket to the saved rules (PUT takes {"rules": [...]})
jq '{rules: .result.rules}' cors-<bucket>-<stamp>.json \
  | curl -s -X PUT -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
      --data @- "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/r2/buckets/<bucket>/cors"
```

If a bucket had no CORS configuration, the backup GET is not `success: true`. In that case the restore is a `DELETE` on the same URL.

### Caddyfile change

Work on the server in `/opt/captable`. The existing file has one site block, `dealroom.tin.info, *.dealroom.tin.info`.

**1. Check where the DNS challenge is configured** before adding anything:

```sh
grep -n acme_dns Caddyfile
```

- If `acme_dns cloudflare ...` is a **global option** (inside the top `{ }` block), it would also apply to the catch-all block below. Every custom host would then try a Cloudflare DNS-01 challenge for a zone we do not own, and fail.
- In that case, move the DNS challenge into the platform block first, and remove the global `acme_dns` line:

  ```caddyfile
  dealroom.tin.info, *.dealroom.tin.info {
  	tls {
  		dns cloudflare {env.CF_API_TOKEN}
  	}
  	# ...rest of the platform block unchanged...
  }
  ```

- Custom hosts get their certificates through the HTTP-01 or TLS-ALPN-01 challenge. Confirm that ports 80 and 443 are both published by the caddy service:

  ```sh
  docker compose port caddy 80
  docker compose port caddy 443
  ```

**2. Add the ask configuration** to the global options block at the very top. Create the block if it does not exist; if it already exists, add only the `on_demand_tls` section to it.

```caddyfile
{
	on_demand_tls {
		ask http://app:3000/api/domains/tls-ask?secret={env.TLS_ASK_SECRET}
	}
}
```

**3. Add a catch-all block at the end.** It must mirror every directive of the platform block except `tls`. Today those are:
- the `@activity path /api/activity/*` matcher and its 32KB `request_body` cap;
- `encode zstd gzip`;
- `reverse_proxy app:3000` with `header_up X-Real-IP {remote_host}`.

Copy them from the current platform block rather than from this page, in case they have changed since.

```caddyfile
# ...existing "dealroom.tin.info, *.dealroom.tin.info" block...

# Any other host gets a certificate only if the app says it is a verified custom domain.
https:// {
	tls {
		on_demand
	}
	@activity path /api/activity/*
	request_body @activity {
		max_size 32KB
	}
	encode zstd gzip
	reverse_proxy app:3000 {
		header_up X-Real-IP {remote_host}
	}
}
```

The platform names keep using the wildcard certificate (DNS challenge through Cloudflare). Caddy picks the most specific site block, so only other hostnames reach the catch-all.

#### Syntax check for Caddy 2.10 (verified)

- **`ask` is still valid:** `ask <endpoint>` inside the global `on_demand_tls { }` works in Caddy 2.10.
  - The Caddyfile reference (https://caddyserver.com/docs/caddyfile/options#on-demand-tls) lists `ask` and `permission`. `permission` is the module-based form, and `ask` is a shortcut kept for backwards compatibility that uses the built-in `http` permission module.
  - The JSON field `ask` is deprecated; the Caddyfile directive is not. No change to a `permission http { endpoint ... }` form is needed.
- **`on_demand`** goes in the site's `tls` block and only enables the feature. The global `ask` is what restricts it. It is required in production; otherwise anyone could trigger certificate issuance.
- **`{env.X}` inside the ask URL works.**
  - The Caddy docs say `{env.*}` works only where a module performs the replacement, and the `ask` page does not say so explicitly.
  - It was therefore tested directly against `caddy:2.10.2-alpine`, with `TLS_ASK_SECRET=s3cret` in the container environment and `ask http://askhost:9123/ask?secret={env.TLS_ASK_SECRET}`. `caddy validate` passed, and a TLS handshake for an unknown host made Caddy call `/ask?domain=foo.example.test&secret=s3cret`.
  - The parse-time form `{$TLS_ASK_SECRET}` produced the same request. Both work; this page uses `{env.TLS_ASK_SECRET}`.
  - Caddy appends `domain=` to the existing query string with `&`.
- **The production image** (`dealroom-caddy:2.10.2-cf0.2.4`) is the same Caddy core plus the Cloudflare DNS module, so the same syntax applies. Run the validate step below on the server to confirm with the real image.

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

Before the reload, confirm all of the following:
1. `TLS_ASK_SECRET` is in both `.env` (app) and `.caddy.env`, with the same value.
2. The app container was recreated after the `.env` change (`docker compose up -d --force-recreate app`).
3. The app image with the `/api/domains/tls-ask` route is deployed and healthy.

Certificates and ACME state live in Caddy's data volume and survive the recreate.

### Release steps (in order)

1. Neon backup branch, then apply the migration by hand.
2. Deploy the app image.
3. Set the new variables in the app `.env`, then run `docker compose up -d --force-recreate app`.
4. Back up the R2 CORS rules (above). Only then set `CLOUDFLARE_API_TOKEN`, and recreate the app again.
5. Caddyfile change: `acme_dns` check, validate, `docker compose up -d --force-recreate caddy`.
6. Throwaway-domain test (below).

### Rollback

**1. First, switch every company whose primary address is a custom domain back to its platform address.**

Do this in each company's Settings, using Make primary on the default address. This must happen before Caddy or the image is rolled back:
- Once Caddy is rolled back, those companies' addresses stop working.
- The previous image treats the platform rows' null-expiry aliases as not live, and may fail on `PENDING` rows.

Find the companies with a read-only query:

```sql
SELECT c."publicId", d."hostname"
FROM "CompanyDomain" d JOIN "Company" c ON c."id" = d."companyId"
WHERE d."kind" = 'CUSTOM' AND d."isPrimary";
```

The query must return no rows before you continue.

**2. Restore the Caddy backup:**
1. `cp Caddyfile.bak-<stamp> Caddyfile`
2. `docker compose up -d --force-recreate caddy`

Custom hosts then fail the TLS handshake (there is no site for them); platform addresses are unaffected.

**3. Image rollback:** roll the image back only after step 1, then recreate the app.

**4. CORS:** restore the saved CORS JSON with the restore command above if needed.

**A softer stop that keeps the config:** unset or empty `TLS_ASK_SECRET` in the app `.env` and run `docker compose up -d --force-recreate app`.
- The ask endpoint then answers 404, so no new certificate is issued. Certificates already issued keep being served until they expire.
- The Settings card disappears.
- Setting the secret in `.caddy.env` alone is not enough: the app is what compares it.

## Test with a throwaway domain

Use a name you control that is not a customer's, for example `test-custom.tin.info`.

1. **DNS:** `CNAME test-custom.tin.info -> dealroom.tin.info`, DNS only (not proxied).
2. **Add and verify:** in a test company's Settings, Company, Custom domains, add `test-custom.tin.info`, create the TXT record shown, and press Verify.
   - The card shows "Redirects to primary" and "Open test-custom.tin.info to finish setup, then make it primary".
   - The company address is unchanged.
3. **Certificate:** run `curl -sI https://test-custom.tin.info/login`. It should return a response with a valid Let's Encrypt certificate: 200, or a redirect to the current address. The first request may take a few seconds while the certificate is issued.
4. **Make primary:** press "Make primary" on the test domain and confirm.
5. **Login and sign-up:** open `https://test-custom.tin.info/login` in a browser. It must show the company login page, titled with the host. `/signup` must redirect to `https://dealroom.tin.info/signup`.
6. **Redirect:** open the platform address. It must redirect to `test-custom.tin.info`.
7. **Switch back:** use Make primary on the platform address. The dialog says the test domain "will redirect for 30 days, then stop working", and the card then shows "Redirects until <date>". Remove the test domain afterwards.
8. **Negative check:** `curl -svk --resolve unverified.tin.info:443:91.98.230.192 https://unverified.tin.info/` must fail the handshake. No certificate is issued for a hostname the app does not know.

## Checking certificate issuance

```sh
cd /opt/captable
docker compose logs --since 30m caddy | grep -Ei 'tls-ask|on_demand|obtain|certificate|acme|error'
```

- **Success:** `tls.obtain ... certificate obtained successfully` with `identifier: <host>`, then `tls.issuance.acme ... served key authentication`.
- **Refused by the app:** `tls.on_demand ... certificate request not allowed by permission module`, or a decision-function error with status `404`. Possible causes:
  - the domain is not verified, or was removed;
  - `TLS_ASK_SECRET` differs between `.env` and `.caddy.env`;
  - the app was not recreated after the `.env` change.
- **Let's Encrypt failures** (rate limit, DNS pointing elsewhere): the `tls.obtain` error includes the ACME problem detail. Let's Encrypt allows 50 certificates per registered domain per week and 5 duplicates per week, so do not repeatedly add and remove the same host.
- **Checking the ask endpoint from the app side:** it returns 200 only for `?domain=<verified custom host>&secret=<TLS_ASK_SECRET>`. Anything else answers 404: a wrong or missing secret, an unknown, pending or removed domain, or the feature being off. Do not paste the secret into shell history on shared machines.

## Known limits

- **One server IP:** apex `A` records and the verification check assume `CUSTOM_DOMAIN_IPS` (currently `91.98.230.192`). Moving the server means updating that variable and every customer's apex record.
- **At most 5 custom domains** per company.
- **Renaming:** the platform address cannot be renamed while a custom domain is primary. Switch the primary back first.
- **No automatic re-verification:** DNS is checked when an admin presses Verify. A domain whose DNS later points elsewhere keeps working until it is removed.
- **No wildcard custom domains:** each hostname is verified and issued separately.
- **Permanent aliases:** a verified custom domain that is not primary stays a permanent alias until it is removed. Only the row that was primary before a switch back to the platform address gets the 30-day expiry.
- **CORS sync:**
  - The R2 buckets' CORS allow-list is synced on verify, primary change and removal, and needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
  - If they are missing, or Cloudflare is unreachable, the domain still verifies, but document uploads from that host fail until the sync succeeds.
  - The Settings card shows the sync state.
- **The `/login` address box** still takes the platform address (it then redirects).

## End-to-end coverage

**The harness:** `pnpm e2e` runs Caddy with an internal CA in front of `next start`. It resolves the extra host `custom-e2e.test` through a Chromium host-resolver rule and a Caddy site name.

**What is checked:** `e2e/seed.ts` creates "Custom Co", whose primary row is an `ACTIVE` `CUSTOM` domain on that host. `e2e/subdomains.spec.ts` then asserts that:
- the platform address redirects to it;
- `/login` there shows the company login page;
- `/signup` redirects to the canonical host.

The spec skips when `E2E_CUSTOM_HOST` is unset, that is, when the seed has not run.

**Not covered there:**
- **TLS issuance through the ask endpoint:** the harness uses `tls internal`. The unit and integration tests for the ask route cover its decisions, and the throwaway-domain test above covers real issuance.
- **The verify-then-Make-primary flow:** covered by the integration and router tests.
