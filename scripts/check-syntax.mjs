import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps", "packages", "tests", "scripts"];
const files = roots.flatMap((root) => listJavaScriptFiles(root));
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failures.push({ file, output: result.stderr || result.stdout });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`Syntax check failed: ${failure.file}`);
    console.error(failure.output);
  }
  process.exit(1);
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);

function listJavaScriptFiles(path) {
  const entries = safeReadDir(path);
  return entries.flatMap((entry) => {
    const fullPath = join(path, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      return listJavaScriptFiles(fullPath);
    }
    return /\.(js|mjs)$/.test(entry) ? [fullPath] : [];
  });
}

function safeReadDir(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}
