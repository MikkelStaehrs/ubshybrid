// Brug:
//   npm run parse -- <fil.drawio>                         → én JSON pr. linjefane
//   npm run parse -- <fil.drawio> <id> "<Navn>" <nr>      → første linjefane med egne værdier
// Faner navngives "Linje 2 – Sliberiet". Faner der starter med "Vejledning" eller "_" springes over.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { linePages, parseDrawio } from "../src/lib/drawio";

const args = process.argv.slice(2);
const legacyDefault = args.length === 0; // `npm run parse` uden argumenter = den første Sliberi-tegning
const [file = "data/drawio/flow-sliberi.drawio", argId, argName, argOrder] = args;
const xml = readFileSync(file, "utf8");

const slug = (s: string) =>
  s.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "linje";

function fromPageName(name: string) {
  const m = name.match(/^\s*linje\s*(\d+)\s*[–—:-]?\s*(.*)$/i);
  return m ? { order: Number(m[1]), name: m[2].trim() || `Linje ${m[1]}` } : null;
}

const pages = linePages(xml);
if (!pages.length) {
  console.error("✖ Ingen linjefaner fundet (kun vejledning?).");
  process.exit(1);
}
const targets = argId ? [pages[0]] : pages;
let problems = 0;
let written = 0;

mkdirSync("data/lines", { recursive: true });
for (const page of targets) {
  const parsed = fromPageName(page.name);
  if (/^linje\s*n\b/i.test(page.name.trim())) {
    console.log(`\n✖ Fanen "${page.name}" er ikke omdøbt – kald den fx "Linje 3 – Renselinjen". Springer over.`);
    problems++;
    continue;
  }
  if (!parsed && !argId && !legacyDefault) {
    console.log(`\n⚠ Fanen "${page.name}" følger ikke navnet "Linje N – Navn" – bruger fanens navn.`);
  }
  const fallback = legacyDefault ? { name: "Sliberiet", order: 2, id: "sliberi" } : { name: page.name, order: 0, id: slug(page.name) };
  const lineName = argName ?? parsed?.name ?? fallback.name;
  const order = argOrder ? Number(argOrder) : parsed?.order ?? fallback.order;
  const lineId = argId ?? (parsed ? slug(lineName) : fallback.id);

  const data = parseDrawio(xml, {
    lineId, lineName, order, page: page.index,
    sourceFile: basename(file),
    inflateRaw: (b) => inflateRawSync(b),
  });
  const out = join("data/lines", `${lineId}.json`);
  writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
  written++;

  console.log(`\n✔ Linje ${order} – ${lineName}: ${data.machines.length} maskiner, ${data.edges.length} forbindelser, spor: ${data.lanes.join(", ") || "–"} → ${out}`);
  if (data.issues.length) {
    problems += data.issues.length;
    console.log(`⚠ ${data.issues.length} ting at rette i tegningen:`);
    for (const i of data.issues) console.log("  - " + i);
  }
}
if (targets.length > 1 || problems) console.log(`\nI alt ${written} linje(r) læst, ${problems} ting at rette.`);
