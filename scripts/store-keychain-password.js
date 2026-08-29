import { spawn } from "node:child_process";
import { DEFAULT_KEYCHAIN_SERVICE } from "../src/keychain.js";

const username = process.argv[2];
const service = process.env.ANYLIST_KEYCHAIN_SERVICE || DEFAULT_KEYCHAIN_SERVICE;

if (!username) {
  console.error("Usage: npm run keychain:set -- you@example.com");
  process.exit(1);
}

// Keep -w last: macOS securely prompts for the password instead of receiving it as an argument.
const command = spawn(
  "/usr/bin/security",
  ["add-generic-password", "-U", "-a", username, "-s", service, "-l", `AnyList MCP (${username})`, "-w"],
  { stdio: "inherit" },
);

command.on("error", (error) => {
  console.error(`Could not open macOS Keychain: ${error.message}`);
  process.exit(1);
});

command.on("exit", (code) => {
  if (code === 0) {
    console.log(`Saved the AnyList password in macOS Keychain as ${service}/${username}.`);
  }
  process.exit(code ?? 1);
});
