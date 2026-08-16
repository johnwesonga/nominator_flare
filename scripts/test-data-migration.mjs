import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { transformExport } from "./transform-supabase-export.mjs";
import { validateMigration } from "./validate-migration.mjs";

const fixture = resolve("migration/fixtures/supabase-export");

function run(directory) {
  const outputFile = join(directory, "import.sql");
  const reportFile = join(directory, "report.json");
  const report = transformExport({ inputDirectory: directory, outputFile, reportFile });
  validateMigration({ importFile: outputFile, reportFile });
  return { outputFile, reportFile, report };
}

function sandbox() {
  const directory = mkdtempSync(join(tmpdir(), "nominator-migration-"));
  cpSync(fixture, directory, { recursive: true });
  return directory;
}

function expectFailure(name, mutate, expected) {
  const directory = sandbox();
  mutate(directory);
  try { run(directory); } catch (error) {
    if (String(error.message).includes(expected)) return;
    throw new Error(`${name}: unexpected error: ${error.message}`);
  }
  throw new Error(`${name}: expected failure`);
}

const valid = run(sandbox());
if (valid.report.counts.families !== 2 || valid.report.counts.swimmers !== 3 || valid.report.counts.votes !== 2) throw new Error("fixture counts differ");
const generated = readFileSync(valid.outputFile, "utf8");
if (!generated.includes("River, Jr.")) throw new Error("quoted CSV value was not preserved");
if (/\bBEGIN\b|\bCOMMIT\b/i.test(generated.replace(/^--.*$/gm, ""))) throw new Error("generated SQL contains transaction control");

expectFailure("has_voted drift", (directory) => {
  const file = join(directory, "swimmers.csv");
  writeFileSync(file, readFileSync(file, "utf8").replace(",Sky,,false,", ",Sky,,true,"));
}, "has_voted disagrees");

expectFailure("orphan family", (directory) => {
  const file = join(directory, "swimmers.csv");
  writeFileSync(file, readFileSync(file, "utf8").replace("00000000-0000-4000-8000-000000000002,Ocean", "90000000-0000-4000-8000-000000000009,Ocean"));
}, "orphan family_id");

expectFailure("duplicate token", (directory) => {
  const file = join(directory, "families.csv");
  writeFileSync(file, readFileSync(file, "utf8").replace("10000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000001"));
}, "duplicate family_token");

console.log("Production data migration checks passed");
