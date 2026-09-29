import { createInterface } from "node:readline";

import { createConsultant, disableConsultant, resetConsultantPassword } from "@/server/auth/accounts";
import { closeDb } from "@/server/db/client";

import { loadLocalEnv } from "./load-env";

// Operator tool for internal consultant accounts (no public sign-up):
//
//   npm run user:create -- --email rhys@cardaxia.ai --name "Rhys Davies"
//   npm run user:set-password -- --email rhys@cardaxia.ai
//   npm run user:disable -- --email rhys@cardaxia.ai
//
// Passwords are never command-line arguments (shell history): they are typed at a hidden
// prompt, or piped on stdin with --password-stdin for automation.

loadLocalEnv();
const [command, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (args.some((a) => a.startsWith("--password") && a !== "--password-stdin")) {
  console.error("Passwords are not accepted as arguments. Use the prompt or --password-stdin.");
  process.exit(1);
}

async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.replace(/\r?\n$/, "");
}

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) =>
      write.call(rl, s.startsWith(question) ? s : "");
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function password(): Promise<string> {
  if (args.includes("--password-stdin")) return readStdin();
  if (!process.stdin.isTTY) throw new Error("No terminal for the password prompt; use --password-stdin");
  const first = await prompt("Password (min 12 characters): ");
  const second = await prompt("Repeat password: ");
  if (first !== second) throw new Error("Passwords do not match");
  return first;
}

try {
  const email = flag("email");
  if (!email) throw new Error("--email is required");
  switch (command) {
    case "create": {
      const name = flag("name");
      if (!name) throw new Error("--name is required");
      await createConsultant(email, name, await password());
      console.log(`Created sign-in for ${email}`);
      break;
    }
    case "set-password":
      await resetConsultantPassword(email, await password());
      console.log(`Password changed for ${email}`);
      break;
    case "disable":
      await disableConsultant(email);
      console.log(`Disabled ${email} and revoked their sessions`);
      break;
    default:
      throw new Error("Usage: user.ts create|set-password|disable --email <email> [--name <name>]");
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : "Failed");
  process.exitCode = 1;
} finally {
  await closeDb();
}
