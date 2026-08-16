import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const distDirectory = "dist";
const assetsDirectory = join(distDirectory, "assets");

await rm(assetsDirectory, { recursive: true, force: true });
await mkdir(assetsDirectory, { recursive: true });

let html = await readFile(join(distDirectory, "index.html"), "utf8");
html = await fingerprintAsset(html, "nominator_flare.js", "nominator_flare");
html = await fingerprintAsset(html, "styles.css", "styles");

await writeFile(join(distDirectory, "index.html"), html);
await writeFile(
  join(distDirectory, "_headers"),
  `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY

/
  Cache-Control: no-store

/index.html
  Cache-Control: no-store

/admin*
  Cache-Control: no-store

/vote/*
  Cache-Control: no-store

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);

async function fingerprintAsset(html, sourceName, outputStem) {
  const sourcePath = join(distDirectory, sourceName);
  const contents = await readFile(sourcePath);
  const digest = createHash("sha256").update(contents).digest("hex").slice(0, 16);
  const outputName = `${outputStem}.${digest}${sourceName.slice(sourceName.lastIndexOf("."))}`;
  const outputPath = join(assetsDirectory, outputName);

  await rename(sourcePath, outputPath);

  const sourceUrl = `/${sourceName}`;
  if (!html.includes(sourceUrl)) {
    throw new Error(`Generated index.html does not reference ${sourceUrl}.`);
  }

  return html.replaceAll(sourceUrl, `/assets/${outputName}`);
}
