import type { Metadata } from "next";
import Link from "next/link";

import { getCurrentActor } from "@/server/auth/actor";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Cardaxia Value Office", template: "%s · Value Office" },
  description: "Consultant-operated Value Office",
};

// Every page reads live Value Record data.
export const dynamic = "force-dynamic";

async function consultantLabel(): Promise<string | null> {
  try {
    return (await getCurrentActor()).email;
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const consultant = await consultantLabel();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white print:hidden">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <Link href="/projects" className="text-sm font-semibold tracking-tight text-slate-900">
              Cardaxia Value Office
            </Link>
            <span className="text-xs text-slate-500" data-testid="actor">
              {consultant ? `Consultant: ${consultant}` : "Not signed in"}
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
