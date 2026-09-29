import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

// Minimal in-memory S3-compatible object store for tests and the CI deployment smoke:
// path-style PUT / GET / HEAD, If-None-Match: * conditional writes, S3-style XML errors.
// It does not verify signatures, but records that every request carried one.

export type FakeS3 = {
  url: string;
  objects: Map<string, { body: Buffer; headers: IncomingHttpHeaders }>;
  requests: { method: string; path: string; headers: IncomingHttpHeaders }[];
  close(): Promise<void>;
};

const xmlError = (code: string, message: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;

export function startFakeS3(port = 0): Promise<FakeS3> {
  const objects: FakeS3["objects"] = new Map();
  const requests: FakeS3["requests"] = [];
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    requests.push({ method: req.method ?? "", path, headers: req.headers });
    if (!req.headers.authorization?.startsWith("AWS4-HMAC-SHA256")) {
      res.writeHead(403, { "content-type": "application/xml" }).end(xmlError("AccessDenied", "Unsigned request"));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (req.method === "PUT") {
        if (req.headers["if-none-match"] === "*" && objects.has(path)) {
          res.writeHead(412, { "content-type": "application/xml" }).end(xmlError("PreconditionFailed", "Exists"));
          return;
        }
        objects.set(path, { body: Buffer.concat(chunks), headers: req.headers });
        res.writeHead(200, { etag: '"fake"' }).end();
        return;
      }
      if (req.method === "GET" || req.method === "HEAD") {
        const obj = objects.get(path);
        if (!obj) {
          res.writeHead(404, { "content-type": "application/xml" }).end(xmlError("NoSuchKey", "Missing"));
          return;
        }
        res.writeHead(200, {
          "content-type": String(obj.headers["content-type"] ?? "application/octet-stream"),
          "content-length": obj.body.length,
        });
        res.end(req.method === "GET" ? obj.body : undefined);
        return;
      }
      res.writeHead(405).end();
    });
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => {
      const { port: bound } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${bound}`,
        objects,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    }),
  );
}

// CLI (CI deployment smoke): tsx tests/support/fake-s3.ts <port>
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const s3 = await startFakeS3(Number(process.argv[2] ?? 9000));
  console.log(`fake S3 listening on ${s3.url}`);
}
