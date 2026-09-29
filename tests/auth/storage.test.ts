import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { COMMANDS } from "@/server/commands/names";
import { db, schema } from "@/server/db/client";
import {
  databaseStore,
  getDocument,
  localStore,
  putDocument,
  s3Store,
  sha256,
  type DocumentStore,
} from "@/server/reports/storage";

import { startFakeS3, type FakeS3 } from "../support/fake-s3";
import { asCommand, expectDomainError, newActor, sql } from "../support/fixtures";

const pdf = Buffer.from("%PDF-1.7\nfake test document\n%%EOF");

async function behavesAsContentAddressedStore(store: DocumentStore, bytes = pdf) {
  const actor = await newActor();
  const stored = await putDocument(bytes, store, actor);
  expect(stored).toEqual({ key: `reports/${sha256(bytes)}.pdf`, sha256: sha256(bytes), bytes: bytes.length });
  expect(await getDocument(stored.key, stored.sha256, store)).toEqual(bytes);
  // Idempotent: storing the same bytes again is a no-op, never an overwrite error.
  await expect(putDocument(bytes, store, actor)).resolves.toEqual(stored);
  // Absent → null; wrong recorded hash → refused.
  expect(await getDocument(`reports/${"0".repeat(64)}.pdf`, "0".repeat(64), store)).toBeNull();
  await expect(getDocument(stored.key, "f".repeat(64), store)).rejects.toThrow(/does not match its recorded hash/);
  await expect(store.get("../etc/passwd")).rejects.toThrow(/Invalid document key/);
}

describe("local report storage", () => {
  it("stores content-addressed PDFs and verifies hashes", async () => {
    await behavesAsContentAddressedStore(localStore(mkdtempSync(path.join(tmpdir(), "vo-store-"))));
  });
});

describe("S3-compatible report storage", () => {
  let s3: FakeS3;
  beforeAll(async () => {
    s3 = await startFakeS3();
  });
  afterAll(() => s3.close());

  const store = () =>
    s3Store({
      bucket: "vo-reports",
      region: "auto",
      endpoint: s3.url,
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      forcePathStyle: true,
      prefix: "prod/",
    });

  it("stores and reads private, content-addressed objects with signed, conditional writes", async () => {
    await behavesAsContentAddressedStore(store());
    const key = `/vo-reports/prod/reports/${sha256(pdf)}.pdf`;
    expect([...s3.objects.keys()]).toEqual([key]);
    const puts = s3.requests.filter((r) => r.method === "PUT");
    expect(puts).toHaveLength(2);
    for (const put of puts) {
      expect(put.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=test-key\//);
      expect(put.headers["if-none-match"]).toBe("*"); // never overwrites
      expect(put.headers["x-amz-acl"]).toBeUndefined(); // never public
      expect(put.headers["content-type"]).toBe("application/pdf");
    }
    expect(s3.objects.get(key)!.body).toEqual(pdf);
  });

  it("does not expose credentials in storage errors", async () => {
    const broken = s3Store({
      bucket: "vo-reports",
      region: "auto",
      endpoint: "http://127.0.0.1:9",
      accessKeyId: "leak-check-key",
      secretAccessKey: "leak-check-secret",
      forcePathStyle: true,
    });
    const err = await broken.put(`reports/${sha256(pdf)}.pdf`, pdf).catch((e: Error) => e);
    expect(String(err)).toMatch(/Report storage write failed/);
    expect(String(err)).not.toMatch(/leak-check/);
  });
});

describe("database report storage (internal / pilot tier)", () => {
  const unique = () => Buffer.from(`%PDF-1.7\ninternal pilot ${Math.random()}\n%%EOF`);

  it("stores durable, content-addressed PDFs in PostgreSQL and verifies hashes", async () => {
    await behavesAsContentAddressedStore(databaseStore(), unique());
  });

  it("is insert-only, hash-checked by the database, and audited without the bytes", async () => {
    const actor = await newActor();
    const bytes = unique();
    const { key } = await putDocument(bytes, databaseStore(), actor);
    const [row] = await db().select().from(schema.reportDocument).where(eq(schema.reportDocument.key, key));
    await expectDomainError(
      asCommand(actor, COMMANDS.storeReportDocument, (tx) =>
        tx.update(schema.reportDocument).set({ bytes: 1 }).where(eq(schema.reportDocument.id, row!.id)),
      ),
      "VO_REPORT_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.storeReportDocument, (tx) =>
        tx.delete(schema.reportDocument).where(eq(schema.reportDocument.id, row!.id)),
      ),
      "VO_REPORT_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.storeReportDocument, (tx) => tx.execute(sql`truncate report_document`)),
      "VO_REPORT_IMMUTABLE",
    );
    const forged = Buffer.from("%PDF-forged");
    await expectDomainError(
      asCommand(actor, COMMANDS.storeReportDocument, (tx) =>
        tx.insert(schema.reportDocument).values({
          key: `reports/${sha256(bytes).replace(/^./, "0")}.pdf`,
          sha256: sha256(bytes).replace(/^./, "0"),
          content: forged,
          bytes: forged.length,
          createdBy: actor.userId,
        }),
      ),
      "VO_HASH_MISMATCH",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.issueReport, (tx) =>
        tx.insert(schema.reportDocument).values({
          key: `reports/${sha256(forged)}.pdf`,
          sha256: sha256(forged),
          content: forged,
          bytes: forged.length,
          createdBy: actor.userId,
        }),
      ),
      "VO_WRONG_COMMAND",
    );
    const [audit] = await db().select().from(schema.auditEvent).where(eq(schema.auditEvent.rowId, row!.id));
    expect(audit).toMatchObject({ command: "reports.storeDocument", actorUserId: actor.userId });
    expect(Object.keys(audit!.newRow as object)).not.toContain("content");
  });

  it("requires the storing consultant", async () => {
    await expect(databaseStore().put(`reports/${sha256(pdf)}.pdf`, pdf)).rejects.toThrow(/records who stored/);
  });
});
