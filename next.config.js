import withBundleAnalyzer from "@next/bundle-analyzer";
import { withSentryConfig } from "@sentry/nextjs/config";

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
await import("./src/env.js");

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: process.env.DOCKER_OUTPUT ? "standalone" : undefined,
  images: {
    remotePatterns: [
      {
        hostname: "randomuser.me",
        protocol: "https",
      },
      {
        hostname: "avatars.githubusercontent.com",
        protocol: "https",
      },
    ],
  },
  turbopack: {
    // prevents "Module parse failed" on canvas.node (an optional pdfjs dependency)
    resolveAlias: { canvas: "./empty-module.js" },
  },
  serverExternalPackages: [
    "pino",
    "pino-pretty",
    "pdf-lib",
    "@aws-sdk/s3-request-presigner",
    "@react-pdf/renderer",
  ],
};

const hasSentry = !!(
  process.env.SENTRY_ORG &&
  process.env.SENTRY_PROJECT &&
  process.env.NEXT_PUBLIC_SENTRY_DSN
);

export default hasSentry
  ? withSentryConfig(bundleAnalyzer(nextConfig), {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: true,
      widenClientFileUpload: true,
      sourcemaps: { deleteSourcemapsAfterUpload: true },
    })
  : bundleAnalyzer(nextConfig);
