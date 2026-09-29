import { existsSync } from "node:fs";

/** Load .env.local then .env for CLI scripts (Next.js loads these itself at runtime). */
export function loadLocalEnv(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
