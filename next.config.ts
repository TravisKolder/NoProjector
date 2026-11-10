import type { NextConfig } from "next";

/** The Supabase project's host (e.g. abcd.supabase.co), read at build time. */
function supabaseHost() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  } catch {
    return "";
  }
}

function contentSecurityPolicy() {
  const host = supabaseHost();
  const https = host ? ` https://${host}` : "";
  const wss = host ? ` wss://${host}` : "";
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    // Next.js needs inline scripts; development also needs eval for fast refresh.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${https}`,
    "font-src 'self' data:",
    // blob: lets the PowerPoint import fetch the pictures inside a deck while it renders slides.
    `connect-src 'self' blob:${https}${wss}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), screen-wake-lock=(self)" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
        ],
      },
    ];
  },
};

export default nextConfig;
