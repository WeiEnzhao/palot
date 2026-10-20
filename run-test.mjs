import { execSync } from "node:child_process";
const file = process.argv[2];
try {
  const result = execSync(
    `node ./node_modules/vitest/vitest.mjs run --config apps/desktop/vitest.config.ts --root apps/desktop ${file}`,
    { encoding: "utf-8", timeout: 120000, stdio: "pipe" }
  );
  const lines = result.split("\n");
  // Print last 20 lines
  console.log(lines.slice(-20).join("\n"));
} catch (e) {
  const output = (e.stdout || "") + (e.stderr || "");
  const lines = output.split("\n");
  console.log(lines.slice(-30).join("\n"));
}
