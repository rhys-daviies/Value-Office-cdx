import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Server-side authentication is enforced in code, not by UI hiding or the proxy alone:
// every page, route handler and server action must resolve the signed-in consultant.

const root = path.resolve(import.meta.dirname, "../../src");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const rel = (p: string) => path.relative(root, p);

const PUBLIC_PAGES = ["app/page.tsx", "app/sign-in/page.tsx"]; // redirect to /projects; the sign-in form
const PUBLIC_ROUTES = ["app/api/health/route.ts", "app/api/auth/sign-in/route.ts", "app/api/auth/sign-out/route.ts"];

describe("authentication boundaries", () => {
  it("every page resolves the consultant server-side", () => {
    const pages = walk(path.join(root, "app")).filter((f) => f.endsWith("page.tsx"));
    expect(pages.length).toBeGreaterThan(20);
    for (const page of pages) {
      if (PUBLIC_PAGES.includes(rel(page))) continue;
      expect(readFileSync(page, "utf8"), rel(page)).toMatch(/requireProject\(|requireConsultant\(/);
    }
  });

  it("every route handler checks the session, except the public health and auth endpoints", () => {
    const routes = walk(path.join(root, "app")).filter((f) => /route\.tsx?$/.test(f));
    for (const route of routes) {
      if (PUBLIC_ROUTES.includes(rel(route))) continue;
      expect(readFileSync(route, "utf8"), rel(route)).toContain("currentConsultantOrNull()");
    }
  });

  it("every server action runs through perform(), which resolves the authenticated actor", () => {
    const actions = walk(path.join(root, "server/actions")).filter((f) =>
      readFileSync(f, "utf8").startsWith('"use server"'),
    );
    expect(actions.length).toBeGreaterThan(5);
    for (const file of actions) {
      const source = readFileSync(file, "utf8");
      const exported = source.match(/export async function \w+/g) ?? [];
      const performed = source.match(/(?:await |return )perform\(/g) ?? [];
      expect(performed.length, rel(file)).toBe(exported.length);
    }
    expect(readFileSync(path.join(root, "server/actions/perform.ts"), "utf8")).toContain("await getCurrentActor()");
  });

  it("no module exposes server secrets to the client bundle", () => {
    for (const file of walk(root).filter((f) => /\.(ts|tsx)$/.test(f))) {
      const source = readFileSync(file, "utf8");
      if (source.startsWith('"use client"')) {
        expect(source, rel(file)).not.toMatch(/process\.env|@\/server\/env|VO_SESSION_SECRET|VO_S3_/);
      }
      expect(source, rel(file)).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SECRET|KEY|PASSWORD|DATABASE)/);
    }
  });
});
