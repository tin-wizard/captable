import * as Sentry from "@sentry/nextjs";

// Next 16 builds with Turbopack, which only loads this file (the old
// sentry.client.config.ts was webpack-only). Read the DSN from process.env,
// which Next inlines at build time: the `env` helper is undefined in the
// browser at this point because window.___ENV is set later. Without a DSN,
// init() does nothing.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1,
  debug: false,
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
