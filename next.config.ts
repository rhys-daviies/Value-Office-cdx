import type { NextConfig } from "next";

const production = process.env.NODE_ENV === "production";

// Static security headers for every response. The per-request, nonce-based
// Content-Security-Policy for pages is set in src/proxy.ts.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

// Issuing a report runs as a server action of the report preview page: that function must
// ship the serverless Chromium binary (Vercel traces files per route).
// Keys are picomatch globs, so the dynamic-segment brackets are escaped.
const REPORT_ISSUE_ROUTE = "/projects/\\[projectId\\]/reports/\\[kind\\]/\\[subjectId\\]";

const nextConfig: NextConfig = {
  // Pin the workspace root to this repository (an unrelated lockfile exists higher up on some machines).
  turbopack: { root: import.meta.dirname },
  poweredByHeader: false,
  // Loaded from node_modules at runtime rather than bundled (native binary / large SDK).
  serverExternalPackages: ["@sparticuz/chromium", "@aws-sdk/client-s3"],
  outputFileTracingIncludes: { [REPORT_ISSUE_ROUTE]: ["./node_modules/@sparticuz/chromium/bin/**"] },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Authenticated content is never cached by browsers or shared caches.
      {
        source: "/((?!_next/static|_next/image|favicon.ico).*)",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
