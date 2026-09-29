import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  VO_DEV_USER_EMAIL: z.string().email().optional(),
  VO_DEV_USER_NAME: z.string().min(1).optional(),
  /** Directory for issued report PDFs (local artefact store). Default: ./storage/reports */
  VO_REPORT_STORAGE_DIR: z.string().min(1).optional(),
  /** Optional Chromium executable for PDF generation; default: Playwright's installed Chromium. */
  VO_CHROMIUM_EXECUTABLE: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= EnvSchema.parse(process.env);
  return cached;
}
