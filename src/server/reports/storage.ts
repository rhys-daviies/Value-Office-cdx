import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import { COMMANDS } from "@/server/commands/names";
import { runCommand, type Actor } from "@/server/commands/run";
import { db, schema } from "@/server/db/client";
import { env } from "@/server/env";

// Content-addressed, immutable storage for issued report PDFs. Keys are
// "reports/<sha256>.pdf": the same bytes are stored once, a stored object is never
// overwritten, and every read is verified against the hash recorded on its issue.
//
// Adapters (VO_REPORT_STORAGE): local (default for development/test) or s3 (any private
// S3-compatible store: AWS S3, Cloudflare R2, …). Objects are private; access is only ever
// through the authenticated PDF route, never a raw storage URL.

export interface DocumentStore {
  /** Store bytes under key unless an object already exists there (as `actor`, where the store audits writes). */
  put(key: string, bytes: Uint8Array, actor?: Actor): Promise<void>;
  /** The bytes under key, or null when absent. */
  get(key: string): Promise<Buffer | null>;
}

export const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

const KEY = /^reports\/([0-9a-f]{64})\.pdf$/;
const checkKey = (key: string) => {
  const m = KEY.exec(key);
  if (!m) throw new Error("Invalid document key");
  return m[1]!;
};

export function localStore(dir: string): DocumentStore {
  // Runtime data directory, not part of the build output (hence the tracing opt-out).
  const root = path.resolve(/*turbopackIgnore: true*/ dir);
  const fileFor = (key: string) => path.join(root, `${checkKey(key)}.pdf`);
  return {
    async put(key, bytes) {
      const file = fileFor(key);
      const exists = await stat(file).then(
        () => true,
        () => false,
      );
      if (exists) return;
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${randomUUID()}.tmp`;
      await writeFile(tmp, bytes, { flag: "wx" });
      await rename(tmp, file);
    },
    async get(key) {
      const file = fileFor(key);
      try {
        return await readFile(file);
      } catch {
        return null;
      }
    },
  };
}

export type S3Config = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  prefix?: string;
};

export function s3Store(config: S3Config): DocumentStore {
  const client = import("@aws-sdk/client-s3").then((sdk) => ({
    sdk,
    s3: new sdk.S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Plain Content-MD5-free requests work across S3-compatible providers (e.g. R2).
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  }));
  const objectKey = (key: string) => {
    checkKey(key);
    return `${config.prefix ?? ""}${key}`;
  };
  const status = (err: unknown) => (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;

  return {
    async put(key, bytes) {
      const { sdk, s3 } = await client;
      const Key = objectKey(key);
      try {
        await s3.send(
          new sdk.PutObjectCommand({
            Bucket: config.bucket,
            Key,
            Body: bytes,
            ContentType: "application/pdf",
            // Never overwrite: an existing object under a content hash already holds these bytes.
            IfNoneMatch: "*",
            Metadata: { sha256: checkKey(key) },
          }),
        );
      } catch (err) {
        if (status(err) === 412 || status(err) === 409) return; // already stored
        throw new Error(`Report storage write failed (${(err as Error).name})`);
      }
    },
    async get(key) {
      const { sdk, s3 } = await client;
      const Key = objectKey(key);
      try {
        const res = await s3.send(new sdk.GetObjectCommand({ Bucket: config.bucket, Key }));
        return Buffer.from(await res.Body!.transformToByteArray());
      } catch (err) {
        if (status(err) === 404 || (err as Error).name === "NoSuchKey") return null;
        throw new Error(`Report storage read failed (${(err as Error).name})`);
      }
    },
  };
}

/**
 * PostgreSQL store (internal / pilot tier): durable across serverless instances with no extra
 * infrastructure. Insert-only via reports.storeDocument; the database re-checks the hash.
 */
export function databaseStore(): DocumentStore {
  return {
    async put(key, bytes, actor) {
      const hash = checkKey(key);
      if (!actor) throw new Error("The database report store records who stored each document");
      await runCommand(COMMANDS.storeReportDocument, actor, async ({ tx }) => {
        await tx
          .insert(schema.reportDocument)
          .values({ key, sha256: hash, content: Buffer.from(bytes), bytes: bytes.byteLength, createdBy: actor.userId })
          .onConflictDoNothing({ target: schema.reportDocument.key });
      });
    },
    async get(key) {
      checkKey(key);
      const [row] = await db()
        .select({ content: schema.reportDocument.content })
        .from(schema.reportDocument)
        .where(eq(schema.reportDocument.key, key));
      return row ? Buffer.from(row.content) : null;
    },
  };
}

let configured: DocumentStore | undefined;

/** The store selected by configuration (validated by env(): s3 mode fails closed if incomplete). */
export function documentStore(): DocumentStore {
  if (configured) return configured;
  const e = env();
  configured =
    e.VO_REPORT_STORAGE === "database"
      ? databaseStore()
      : e.VO_REPORT_STORAGE === "s3"
        ? s3Store({
            bucket: e.VO_S3_BUCKET!,
            region: e.VO_S3_REGION!,
            endpoint: e.VO_S3_ENDPOINT,
            accessKeyId: e.VO_S3_ACCESS_KEY_ID!,
            secretAccessKey: e.VO_S3_SECRET_ACCESS_KEY!,
            forcePathStyle: e.VO_S3_FORCE_PATH_STYLE,
            prefix: e.VO_S3_PREFIX,
          })
        : localStore(e.VO_REPORT_STORAGE_DIR ?? path.join(process.cwd(), "storage", "reports"));
  return configured;
}

/** Tests only. */
export function resetDocumentStore(): void {
  configured = undefined;
}

export async function putDocument(
  bytes: Uint8Array,
  store = documentStore(),
  actor?: Actor,
): Promise<{ key: string; sha256: string; bytes: number }> {
  const hash = sha256(bytes);
  const key = `reports/${hash}.pdf`;
  await store.put(key, bytes, actor);
  return { key, sha256: hash, bytes: bytes.byteLength };
}

/** The stored bytes, verified against the expected hash; null when not present in this store. */
export async function getDocument(
  key: string,
  expectedSha256: string,
  store = documentStore(),
): Promise<Buffer | null> {
  const bytes = await store.get(key);
  if (!bytes) return null;
  if (sha256(bytes) !== expectedSha256) throw new Error(`Stored document ${key} does not match its recorded hash`);
  return bytes;
}
