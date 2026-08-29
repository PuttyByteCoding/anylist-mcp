import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readKeychainAccount, readKeychainPassword } from "../src/keychain.js";

describe("macOS Keychain password lookup", () => {
  it("reads the AnyList account from the Keychain item", async () => {
    const account = await readKeychainAccount("anylist-mcp", async () => ({
      stdout: "attributes:\n    \"acct\"<blob>=\"cook@example.com\"\n",
      stderr: "",
    }));
    assert.equal(account, "cook@example.com");
  });

  it("returns the saved password without exposing it in command arguments", async () => {
    let args;
    const password = await readKeychainPassword("cook@example.com", "anylist-mcp", async (_command, commandArgs) => {
      args = commandArgs;
      return { stdout: "secret-password\n" };
    });
    assert.equal(password, "secret-password");
    assert.deepEqual(args, ["find-generic-password", "-a", "cook@example.com", "-s", "anylist-mcp", "-w"]);
  });

  it("gives setup guidance when no Keychain item exists", async () => {
    await assert.rejects(
      () => readKeychainPassword("cook@example.com", "anylist-mcp", async () => { throw new Error("not found"); }),
      /npm run keychain:set/,
    );
  });
});
