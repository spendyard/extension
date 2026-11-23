// Builds the extension into dist/, to load unpacked (chrome://extensions →
// Load unpacked → extension/dist) or to zip for the Chrome Web Store.
//
//   bun run build             once
//   bun run build --watch     again on every change

import { cp, rm } from "node:fs/promises";
import { watch } from "node:fs";

const out = "dist";

async function build() {
  const built = await Bun.build({
    entrypoints: ["src/background.ts", "src/panel.ts", "src/detect.ts"],
    outdir: out,
    target: "browser",
    // detect.js runs in pages as a plain script: no imports left in any of them.
    format: "esm",
    splitting: false,
    minify: false,
  });

  if (!built.success) {
    built.logs.forEach((log) => console.error(log));

    return false;
  }

  await cp("public", out, { recursive: true });
  await cp("src/panel.html", `${out}/panel.html`);
  await cp("src/panel.css", `${out}/panel.css`);

  console.log(`built ${out}/ at ${new Date().toLocaleTimeString()}`);

  return true;
}

await rm(out, { recursive: true, force: true });

const ok = await build();

if (process.argv.includes("--watch")) {
  watch("src", { recursive: true }, () => void build());
  watch("public", { recursive: true }, () => void build());
} else if (!ok) {
  process.exit(1);
}
