import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";

const html = await readFile("dist/index.html", "utf8");
const headers = await readFile("dist/_headers", "utf8");
const files = (await readdir("dist/assets")).sort();

assert(
  files.some((file) => /^nominator_flare\.[a-f0-9]{16}\.js$/.test(file)),
  "A fingerprinted JavaScript bundle is required.",
);
assert(
  files.some((file) => /^styles\.[a-f0-9]{16}\.css$/.test(file)),
  "A fingerprinted stylesheet is required.",
);
assert(files.length === 2, "Only the two fingerprinted local assets are expected.");

for (const file of files) {
  const url = `/assets/${file}`;
  assert(html.includes(url), `index.html must reference ${url}.`);
  await access(`dist${url}`);
  const contents = await readFile(`dist${url}`);
  const digest = createHash("sha256").update(contents).digest("hex").slice(0, 16);
  assert(file.includes(`.${digest}.`), `${file} does not match its contents.`);
}

assert(!html.includes('/nominator_flare.js'), "The unhashed script URL remains.");
assert(!html.includes('/styles.css'), "The unhashed stylesheet URL remains.");
assert(
  headers.includes("/assets/*\n  Cache-Control: public, max-age=31536000, immutable"),
  "Fingerprint assets must have an immutable cache rule.",
);
assert(
  headers.includes("/admin*\n  Cache-Control: no-store"),
  "The admin SPA shell must not be cached.",
);
assert(
  headers.includes("/vote/*\n  Cache-Control: no-store"),
  "The ballot SPA shell must not be cached.",
);

console.log("Static asset package checks passed");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
