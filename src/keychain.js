import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const DEFAULT_KEYCHAIN_SERVICE = "anylist-mcp";

export async function readKeychainAccount(service = DEFAULT_KEYCHAIN_SERVICE, run = execFileAsync) {
  try {
    const { stdout = "", stderr = "" } = await run(
      "/usr/bin/security",
      ["find-generic-password", "-s", service],
      { encoding: "utf8" },
    );
    const account = `${stdout}\n${stderr}`.match(/"acct"<blob>="([^"]+)"/u)?.[1];
    if (!account) throw new Error("Keychain item has no account");
    return account;
  } catch {
    throw new Error(
      `No AnyList credentials found in macOS Keychain for service ${service}. Run npm run keychain:set -- you@example.com, or set ANYLIST_USERNAME and ANYLIST_PASSWORD.`,
    );
  }
}

export async function readKeychainPassword(username, service = DEFAULT_KEYCHAIN_SERVICE, run = execFileAsync) {
  try {
    const { stdout } = await run(
      "/usr/bin/security",
      ["find-generic-password", "-a", username, "-s", service, "-w"],
      { encoding: "utf8" },
    );
    const password = stdout.trim();
    if (!password) throw new Error("Keychain item has no password");
    return password;
  } catch {
    throw new Error(
      `No AnyList password found in macOS Keychain for ${username}. Run npm run keychain:set -- ${username}, or set ANYLIST_PASSWORD.`,
    );
  }
}
