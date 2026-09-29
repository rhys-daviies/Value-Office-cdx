import "server-only";

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Password hashing with Node's built-in scrypt (memory-hard, no native dependency, runs on
// Vercel's Node runtime). Format: scrypt$N$r$p$salt$hash, base64url. Parameters travel with
// the hash so they can be raised later without invalidating existing passwords.

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Promise<Buffer> {
  const opts: ScryptOptions = { N: n, r, p, maxmem: 256 * n * r + 1024 * 1024 };
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export function passwordPolicyProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Passwords must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Passwords must be at most ${PASSWORD_MAX_LENGTH} characters`;
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const problem = passwordPolicyProblem(password);
  if (problem) throw new RangeError(problem);
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, KEY_LENGTH);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** Constant-time verification. Malformed hashes verify as false. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || password.length > PASSWORD_MAX_LENGTH) return false;
  const [n, r, p] = parts.slice(1, 4).map((x) => Number.parseInt(x, 10)) as [number, number, number];
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0) || n > 2 ** 20) return false;
  const salt = Buffer.from(parts[4]!, "base64url");
  const expected = Buffer.from(parts[5]!, "base64url");
  const actual = await derive(password, salt, n, r, p, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummy: Promise<string> | undefined;
/** A real hash to verify against when the account does not exist, so timing does not reveal it. */
export function dummyPasswordHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(24).toString("base64url"));
  return dummy;
}
