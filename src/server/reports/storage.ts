import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "@/server/env";

// Local, content-addressed artefact store for issued report PDFs. Keys are
// "reports/<sha256>.pdf" so the same bytes are stored once and a stored file can
// always be verified against the hash recorded on its issue. Moving to object
// storage (S3/R2) means reimplementing put/get for the same keys; issue semantics
// do not change.

// Runtime data directory, not part of the build output (hence the tracing opt-out).
const root = () =>
  path.resolve(/*turbopackIgnore: true*/ env().VO_REPORT_STORAGE_DIR ?? path.join(process.cwd(), "storage", "reports"));

export const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

const fileFor = (key: string) => {
  const m = /^reports\/([0-9a-f]{64})\.pdf$/.exec(key);
  if (!m) throw new Error(`Invalid document key "${key}"`);
  return path.join(root(), `${m[1]}.pdf`);
};

export async function putDocument(bytes: Uint8Array): Promise<{ key: string; sha256: string; bytes: number }> {
  const hash = sha256(bytes);
  const key = `reports/${hash}.pdf`;
  const file = fileFor(key);
  const exists = await stat(file).then(
    () => true,
    () => false,
  );
  if (!exists) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, bytes, { flag: "wx" });
    await rename(tmp, file);
  }
  return { key, sha256: hash, bytes: bytes.byteLength };
}

/** The stored bytes, verified against the expected hash; null when not present in this environment. */
export async function getDocument(key: string, expectedSha256: string): Promise<Buffer | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(fileFor(key));
  } catch {
    return null;
  }
  if (sha256(bytes) !== expectedSha256) throw new Error(`Stored document ${key} does not match its recorded hash`);
  return bytes;
}
