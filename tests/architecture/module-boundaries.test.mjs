import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const sourceRoots = ["apps", "packages"];
const files = sourceRoots.flatMap((root) => listFiles(root));

for (const file of files) {
  const source = readFileSync(file, "utf8");
  assert.equal(
    /from\s+["'].*database\/migrations/.test(source),
    false,
    `${file} must not import database migrations directly. Use repositories/application services.`
  );
  assert.equal(
    /process\.env\.(DATABASE_URL|REDIS_URL|OBJECT_STORAGE)/.test(source),
    false,
    `${file} must read infrastructure settings through packages/configuration.`
  );
}

console.log(`Architecture boundary check passed for ${files.length} files.`);

function listFiles(path) {
  const entries = safeReadDir(path);
  return entries.flatMap((entry) => {
    const fullPath = join(path, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      return listFiles(fullPath);
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
