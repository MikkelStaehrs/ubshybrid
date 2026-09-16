// Bygger én selvstændig HTML-fil (til deling/artifact) af de samme komponenter
// som Next-appen bruger. Brug: npm run preview
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const fonts: [family: string, pkg: string, file: string, weight: number][] = [
  ["Barlow Condensed", "barlow-condensed", "barlow-condensed-latin-500-normal.woff2", 500],
  ["Barlow Condensed", "barlow-condensed", "barlow-condensed-latin-600-normal.woff2", 600],
  ["IBM Plex Sans", "ibm-plex-sans", "ibm-plex-sans-latin-400-normal.woff2", 400],
  ["IBM Plex Sans", "ibm-plex-sans", "ibm-plex-sans-latin-500-normal.woff2", 500],
  ["IBM Plex Sans", "ibm-plex-sans", "ibm-plex-sans-latin-600-normal.woff2", 600],
  ["IBM Plex Mono", "ibm-plex-mono", "ibm-plex-mono-latin-400-normal.woff2", 400],
  ["IBM Plex Mono", "ibm-plex-mono", "ibm-plex-mono-latin-500-normal.woff2", 500],
];
const fontCss = fonts
  .map(([family, pkg, file, weight]) => {
    const b64 = readFileSync(`node_modules/@fontsource/${pkg}/files/${file}`).toString("base64");
    return `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
  })
  .join("\n");

async function main() {
const result = await build({
  entryPoints: ["preview/entry.tsx"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  write: false,
  define: { "process.env.NODE_ENV": '"production"' },
  logOverride: { "unsupported-directive": "silent" },
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = readFileSync("src/components/factory-map.css", "utf8");

const html = `<title>Fabrikskort Sliberiet</title>
<style>
${fontCss}
${css}
html, body, #app { height: 100%; }
</style>
<div id="app"></div>
<script>${js}</script>
`;
mkdirSync("preview/dist", { recursive: true });
writeFileSync("preview/dist/fabrikskort-sliberiet.html", html);
console.log(`✔ preview/dist/fabrikskort-sliberiet.html (${(html.length / 1024).toFixed(0)} KB)`);
}
main();
