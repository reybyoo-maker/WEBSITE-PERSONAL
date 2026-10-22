import { mkdir, copyFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
const publicFiles = ["index.html", "styles.css", "app.js", "config.js"];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of publicFiles) {
  await copyFile(resolve(root, file), resolve(output, file));
}

console.log(`Built ${publicFiles.length} public website files into dist/.`);
