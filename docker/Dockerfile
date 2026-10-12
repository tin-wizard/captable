ARG NODE_VERSION=20.11.0

FROM --platform=linux/amd64 node:${NODE_VERSION}-alpine AS base
LABEL fly_launch_runtime="Next.js/Prisma"

FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# Install Prisma Client - remove if not using Prisma

COPY prisma ./prisma

ENV HUSKY 0

# Install dependencies
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable pnpm && pnpm i --frozen-lockfile

FROM base AS geo
RUN apk add --no-cache curl && mkdir -p /geo
# IPINFO_TOKEN is a BuildKit secret (never an ARG/ENV, so it cannot reach a layer).
# The URL goes to curl as a config on stdin, so the token is in no argv and no error message.
# Missing token, failed download or a suspiciously small file all end the same
# way: no database, and the app simply records no location.
RUN --mount=type=secret,id=ipinfo_token \
    if [ -s /run/secrets/ipinfo_token ]; then \
      printf 'url = "https://ipinfo.io/data/ipinfo_lite.mmdb?token=%s"\n' "$(cat /run/secrets/ipinfo_token)" \
        | curl -fsSL -K - -o /geo/ipinfo_lite.mmdb \
      && [ "$(wc -c < /geo/ipinfo_lite.mmdb)" -gt 1000000 ] \
      || { echo "ipinfo database not available; continuing without location"; rm -f /geo/ipinfo_lite.mmdb; }; \
    else echo "no ipinfo token; continuing without location"; fi

##### BUILDER

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED 1
ENV DOCKER_OUTPUT 1
ENV SKIP_ENV_VALIDATION 1
RUN corepack enable pnpm && pnpm run build

##### RUNNER

FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

ENV DOCKER_OUTPUT 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=geo --chown=nextjs:nodejs /geo /app/data

# copy prisma and migrate script
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrate.sh ./scripts/migrate.sh
COPY --from=builder --chown=nextjs:nodejs /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma/migrations ./prisma/migrations


USER nextjs

EXPOSE 3000

ENV PORT 3000

# Run the migration script
# RUN chmod +x ./scripts/migrate.sh
# ENTRYPOINT [ "./scripts/migrate.sh" ]

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD HOSTNAME="0.0.0.0" node server.js
