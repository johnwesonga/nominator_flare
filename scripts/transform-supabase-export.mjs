import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const definitions = {
  families: ["id", "email", "family_token", "created_at"],
  swimmers: ["id", "family_id", "name", "group_name", "has_voted", "created_at"],
  votes: ["id", "voter_id", "candidate_id", "created_at"],
  voting_settings: ["id", "is_open", "closed_at"],
  admins: ["email", "created_at"],
};

export function parseCsv(source, label = "CSV") {
  const text = source.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'; index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field === "") quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") {
      row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = "";
    } else field += character;
  }
  if (quoted) throw new Error(`${label}: unterminated quoted field`);
  if (field !== "" || row.length > 0) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  while (rows.length && rows.at(-1).every((value) => value === "")) rows.pop();
  if (!rows.length) throw new Error(`${label}: file is empty`);
  const headers = rows[0];
  if (new Set(headers).size !== headers.length) throw new Error(`${label}: duplicate header`);
  return rows.slice(1).map((values, index) => {
    if (values.length !== headers.length) throw new Error(`${label}: row ${index + 2} has ${values.length} fields; expected ${headers.length}`);
    return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
  });
}

function loadTable(inputDirectory, name) {
  const file = join(inputDirectory, `${name}.csv`);
  const rows = parseCsv(readFileSync(file, "utf8"), file);
  const actual = rows.length ? Object.keys(rows[0]) : parseCsvHeaders(readFileSync(file, "utf8"));
  const expected = definitions[name];
  if (actual.length !== expected.length || expected.some((column) => !actual.includes(column))) {
    throw new Error(`${name}.csv: headers must be exactly ${expected.join(",")}`);
  }
  return rows;
}

function parseCsvHeaders(source) {
  const line = source.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
  return line.split(",");
}

function required(value, field) {
  if (value === undefined || value.trim() === "") throw new Error(`${field}: value is required`);
  return value;
}

function uuid(value, field) {
  required(value, field);
  if (!UUID.test(value)) throw new Error(`${field}: invalid UUID`);
  return value;
}

function timestamp(value, field, nullable = false) {
  if (nullable && value === "") return null;
  required(value, field);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`${field}: invalid timestamp`);
  return parsed.toISOString();
}

function boolean(value, field) {
  const normalized = value.trim().toLowerCase();
  if (["true", "t", "1"].includes(normalized)) return 1;
  if (["false", "f", "0"].includes(normalized)) return 0;
  throw new Error(`${field}: invalid boolean`);
}

function email(value, field, normalize = false) {
  const result = required(value, field).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new Error(`${field}: invalid email`);
  return normalize ? result.toLowerCase() : result;
}

function unique(rows, field, label, normalize = (value) => value) {
  const seen = new Set();
  for (const row of rows) {
    const value = normalize(row[field]);
    if (seen.has(value)) throw new Error(`${label}: duplicate ${field}`);
    seen.add(value);
  }
}

function sql(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function insert(table, columns, row) {
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((column) => sql(row[column])).join(", ")});`;
}

function digest(values) {
  return createHash("sha256").update([...values].sort().join("\n"), "utf8").digest("hex");
}

export function transformExport({ inputDirectory, outputFile, reportFile }) {
  const raw = Object.fromEntries(Object.keys(definitions).map((name) => [name, loadTable(inputDirectory, name)]));
  const families = raw.families.map((row, index) => ({
    id: uuid(row.id, `families row ${index + 2} id`),
    email: email(row.email, `families row ${index + 2} email`),
    family_token: uuid(row.family_token, `families row ${index + 2} family_token`),
    created_at: timestamp(row.created_at, `families row ${index + 2} created_at`),
  }));
  const swimmers = raw.swimmers.map((row, index) => ({
    id: uuid(row.id, `swimmers row ${index + 2} id`),
    family_id: uuid(row.family_id, `swimmers row ${index + 2} family_id`),
    name: required(row.name, `swimmers row ${index + 2} name`),
    group_name: row.group_name === "" ? null : row.group_name,
    has_voted: boolean(row.has_voted, `swimmers row ${index + 2} has_voted`),
    created_at: timestamp(row.created_at, `swimmers row ${index + 2} created_at`),
  }));
  const votes = raw.votes.map((row, index) => ({
    id: uuid(row.id, `votes row ${index + 2} id`),
    voter_id: uuid(row.voter_id, `votes row ${index + 2} voter_id`),
    candidate_id: uuid(row.candidate_id, `votes row ${index + 2} candidate_id`),
    created_at: timestamp(row.created_at, `votes row ${index + 2} created_at`),
  }));
  const admins = raw.admins.map((row, index) => ({
    email: email(row.email, `admins row ${index + 2} email`, true),
    created_at: timestamp(row.created_at, `admins row ${index + 2} created_at`),
  }));
  if (raw.voting_settings.length !== 1) throw new Error("voting_settings.csv: exactly one row is required");
  const setting = raw.voting_settings[0];
  if (setting.id !== "1") throw new Error("voting_settings.csv: singleton id must be 1");
  const votingSettings = {
    is_open: boolean(setting.is_open, "voting_settings is_open"),
    closed_at: timestamp(setting.closed_at, "voting_settings closed_at", true),
  };
  if (votingSettings.is_open === 1 && votingSettings.closed_at !== null) throw new Error("voting_settings.csv: open voting must not have closed_at");

  unique(families, "id", "families"); unique(families, "email", "families", (v) => v.toLowerCase()); unique(families, "family_token", "families");
  unique(swimmers, "id", "swimmers"); unique(votes, "id", "votes"); unique(votes, "voter_id", "votes"); unique(admins, "email", "admins");
  const familyIds = new Set(families.map(({ id }) => id));
  const swimmerIds = new Set(swimmers.map(({ id }) => id));
  for (const swimmer of swimmers) if (!familyIds.has(swimmer.family_id)) throw new Error("swimmers.csv: orphan family_id");
  for (const vote of votes) {
    if (!swimmerIds.has(vote.voter_id)) throw new Error("votes.csv: orphan voter_id");
    if (!swimmerIds.has(vote.candidate_id)) throw new Error("votes.csv: orphan candidate_id");
  }
  const voters = new Set(votes.map(({ voter_id }) => voter_id));
  for (const swimmer of swimmers) {
    if (swimmer.has_voted !== Number(voters.has(swimmer.id))) throw new Error("swimmers.csv: has_voted disagrees with votes; repair the source before migration");
  }

  const updatedAt = votingSettings.closed_at ?? new Date(Math.max(0, ...families.map(({ created_at }) => new Date(created_at).valueOf()))).toISOString();
  const lines = [
    "-- Generated by scripts/transform-supabase-export.mjs.",
    "-- Intentionally contains no transaction; Wrangler wraps --file imports.",
    ...families.map((row) => insert("families", ["id", "email", "family_token", "created_at"], row)),
    ...swimmers.map(({ has_voted: _, ...row }) => insert("swimmers", ["id", "family_id", "name", "group_name", "created_at"], row)),
    ...votes.map((row) => insert("votes", ["id", "voter_id", "candidate_id", "created_at"], row)),
    ...admins.map((row) => insert("admins", ["email", "created_at"], row)),
    `UPDATE voting_settings SET is_open = ${votingSettings.is_open}, closed_at = ${sql(votingSettings.closed_at)}, updated_at = ${sql(updatedAt)}, updated_by = 'supabase-migration' WHERE id = 1;`,
    "",
  ];
  const candidateCounts = new Map();
  for (const vote of votes) candidateCounts.set(vote.candidate_id, (candidateCounts.get(vote.candidate_id) ?? 0) + 1);
  const report = {
    formatVersion: 1,
    counts: { families: families.length, swimmers: swimmers.length, votes: votes.length, admins: admins.length },
    voting: { isOpen: Boolean(votingSettings.is_open), closedAt: votingSettings.closed_at },
    digests: {
      familyTokensSha256: digest(families.map(({ family_token }) => family_token)),
      voteResultsSha256: digest([...candidateCounts].map(([candidateId, count]) => `${candidateId}:${count}`)),
    },
  };
  mkdirSync(dirname(outputFile), { recursive: true }); mkdirSync(dirname(reportFile), { recursive: true });
  writeFileSync(outputFile, lines.join("\n"), { mode: 0o600 });
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const inputDirectory = resolve(argument("--input", join(root, "migration/input")));
  const outputFile = resolve(argument("--output", join(root, "migration/output/import.sql")));
  const reportFile = resolve(argument("--report", join(root, "migration/output/report.json")));
  const report = transformExport({ inputDirectory, outputFile, reportFile });
  console.log(`Migration transform passed: ${report.counts.families} families, ${report.counts.swimmers} swimmers, ${report.counts.votes} votes, ${report.counts.admins} admins`);
}
