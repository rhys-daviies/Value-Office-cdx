import type { Metadata } from "next";
import Link from "next/link";

import { currentConsultantOrNull } from "@/server/auth/actor";
import { env } from "@/server/env";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Cardaxia Value Office", template: "%s · Value Office" },
  description: "Consultant-operated Value Office",
  robots: { index: false, follow: false },
};

// Every page reads live Value Record data (and a per-request CSP nonce).
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const consultant = await currentConsultantOrNull();
  const canSignOut = consultant && env().VO_AUTH_MODE === "password";
  const internal = env().deployment === "internal";
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white print:hidden">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <Link href="/projects" className="text-sm font-semibold tracking-tight text-slate-900">
              Cardaxia Value Office
            </Link>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              {internal && (
                <span
                  className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900"
                  title="Internal pilot environment: demo and non-sensitive data only"
                  data-testid="deployment-internal"
                >
                  Internal pilot — no sensitive client data
                </span>
              )}
              <span data-testid="actor">{consultant ? `Consultant: ${consultant.email}` : "Not signed in"}</span>
              {canSignOut && (
                <form method="post" action="/api/auth/sign-out">
                  <button type="submit" className="text-slate-700 underline underline-offset-2" data-testid="sign-out">
                    Sign out
                  </button>
                </form>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
