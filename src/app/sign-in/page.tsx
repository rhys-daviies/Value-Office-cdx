import { redirect } from "next/navigation";

import { currentConsultantOrNull } from "@/server/auth/actor";
import { safeNextPath } from "@/server/auth/request";
import { env } from "@/server/env";

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  if (await currentConsultantOrNull()) redirect(next);
  const devMode = env().VO_AUTH_MODE === "dev";

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
      <p className="mt-1 text-sm text-slate-600">Cardaxia consultants only.</p>
      {params.error && (
        <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          The email or password is not correct.
        </p>
      )}
      {params.signedOut && (
        <p className="mt-4 rounded border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700" role="status">
          You have signed out.
        </p>
      )}
      {devMode ? (
        <p className="mt-4 text-sm text-amber-800">Development identity is active; sign-in is not required locally.</p>
      ) : (
        <form method="post" action="/api/auth/sign-in" className="mt-6 space-y-3" data-testid="sign-in-form">
          <input type="hidden" name="next" value={next} />
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Email</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5"
            />
          </label>
          <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            Sign in
          </button>
        </form>
      )}
    </div>
  );
}
