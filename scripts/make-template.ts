// Genererer Draw.io-skabelonen og maskinbiblioteket til line managers.
// Brug: npm run template  → templates/UBS-linjeskabelon.drawio + templates/UBS-maskiner.xml
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");

// Feltrækkefølge = rækkefølgen i "Rediger data" (Ctrl+M).
// navn…rot styrer selve kortet; resten er stamdata til maskinpanelet.
const FIELDS = ["navn", "wid", "maskintype", "spor", "x", "z", "rot", "producent", "model", "aar", "proces", "kapacitet", "dim", "ot", "noter"] as const;
type Fields = Partial<Record<(typeof FIELDS)[number], string>>;

type Kind = "Indtag" | "Elevator" | "Fordeler" | "Proces" | "Analyse";
const KIND_STYLE: Record<Kind, { style: string; w: number; h: number; title: string }> = {
  Indtag: { title: "Indtag", w: 120, h: 60, style: "rounded=1;arcSize=10;fillColor=#E3E7EB;strokeColor=#8B98A3;" },
  Elevator: { title: "Elevator", w: 120, h: 60, style: "rounded=1;arcSize=10;fillColor=#F6E7C4;strokeColor=#D4A03C;" },
  Fordeler: { title: "Fordeler", w: 120, h: 60, style: "ellipse;fillColor=#D8E6EA;strokeColor=#4C7B88;" },
  Proces: { title: "Procesmaskine", w: 120, h: 60, style: "rounded=1;arcSize=10;fillColor=#D5E9E5;strokeColor=#2E6D64;" },
  Analyse: { title: "Analyseudstyr", w: 120, h: 60, style: "rounded=1;arcSize=10;fillColor=#E6DDEF;strokeColor=#8A6BA3;" },
};
const BASE = "whiteSpace=wrap;html=1;strokeWidth=1.5;fontFamily=Helvetica;fontSize=12;fontColor=#18201E;";
const LABEL = `<b>%navn%</b><br><font style="font-size: 10px;" color="#5B6763">W-ID: %wid%</font>`;
const EDGE = "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=1.5;strokeColor=#5D6F69;endArrow=block;endFill=1;";
const TEXT = "text;html=1;align=left;verticalAlign=top;whiteSpace=wrap;fontFamily=Helvetica;fontColor=#18201E;spacing=0;";

let seq = 0;
const nid = (p: string) => `${p}-${++seq}`;

function machine(kind: Kind, x: number, y: number, f: Fields = {}, id = nid("m")) {
  const k = KIND_STYLE[kind];
  const data: Fields = { navn: "", wid: "", maskintype: kind, ...f };
  const attrs = FIELDS.map((key) => `${key}="${esc(data[key] ?? "")}"`).join(" ");
  return {
    id,
    xml:
      `<UserObject label="${esc(LABEL)}" placeholders="1" ${attrs} id="${id}">` +
      `<mxCell style="${BASE}${k.style}" vertex="1" parent="1">` +
      `<mxGeometry x="${x}" y="${y}" width="${k.w}" height="${k.h}" as="geometry"/></mxCell></UserObject>`,
  };
}

function edge(from: string, to: string, exit?: "left" | "right") {
  const ex = exit === "left" ? "exitX=0;exitY=0.5;exitDx=0;exitDy=0;" : exit === "right" ? "exitX=1;exitY=0.5;exitDx=0;exitDy=0;" : "";
  return `<mxCell id="${nid("e")}" style="${EDGE}${ex}entryX=0.5;entryY=0;entryDx=0;entryDy=0;" edge="1" parent="1" source="${from}" target="${to}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
}

function text(html: string, x: number, y: number, w: number, h: number, extra = "") {
  return `<mxCell id="${nid("t")}" value="${esc(html)}" style="${TEXT}${extra}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
}

function note(html: string, x: number, y: number, w: number, h: number, fill: string, stroke: string) {
  return `<mxCell id="${nid("n")}" value="${esc(html)}" style="text;html=1;whiteSpace=wrap;align=left;verticalAlign=top;fontFamily=Helvetica;fontColor=#18201E;fillColor=${fill};strokeColor=${stroke};rounded=1;arcSize=4;spacing=14;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
}

const page = (name: string, id: string, cells: string[], w = 1169, h = 827) =>
  `<diagram name="${esc(name)}" id="${id}"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${w}" pageHeight="${h}" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join("")}</root></mxGraphModel></diagram>`;

// ---------------------------------------------------------------------------
// Fane 1: Vejledning (springes over af parseren)
// ---------------------------------------------------------------------------
const guide: string[] = [];
guide.push(text(`<font style="font-size: 30px;"><b>UBS linjeskabelon</b></font>`, 40, 30, 700, 40));
guide.push(text(`<font style="font-size: 14px;" color="#5B6763">Sådan tegner du en produktionslinje, så den kan læses direkte ind i fabrikskortet.</font>`, 40, 74, 700, 24));

guide.push(text(
  `<font style="font-size: 16px;"><b>Sådan gør du</b></font><br><br>` +
  `<b>1. Én fane pr. linje.</b> Opret en ny fane og kald den <i>Linje 3 – Renselinjen</i> (nummer og navn). Faner der starter med <i>Vejledning</i> eller <i>_</i> bliver ikke læst.<br><br>` +
  `<b>2. Træk maskiner ind.</b> Brug biblioteket <i>UBS maskiner</i> (Fil → Åbn bibliotek → UBS-maskiner.xml), eller kopiér en boks herfra.<br><br>` +
  `<b>3. Udfyld felterne.</b> Markér boksen og tryk <b>Ctrl+M</b> (Rediger data). Navn og W-ID vises selv i boksen – skriv <u>ikke</u> direkte i boksen.<br><br>` +
  `<b>4. Forbind med pile i flowretningen.</b> Træk pilen fra boks til boks, til kanten bliver blå/grøn. En pil der ikke sidder fast i begge ender, tæller ikke.<br><br>` +
  `<b>5. Tegn oppefra og ned.</b> Deler linjen sig, så læg sporene side om side og skriv sporet i feltet <i>spor</i> (fx S og N).`,
  40, 130, 520, 360, "fontSize=13;"));

const fieldRows: [string, string, string][] = [
  ["navn", "Ja", "Maskinens navn, fx Jetpealer S"],
  ["wid", "Ja", "W-ID. Flere: 793/794/795"],
  ["maskintype", "Ja", "Indtag, Elevator, Fordeler, Proces eller Analyse"],
  ["spor", "Ved deling", "Sporets bogstav, fx S eller N"],
  ["x", "Ved opmåling", "Meter mod øst fra fabrikkens nulpunkt"],
  ["z", "Ved opmåling", "Meter mod syd fra fabrikkens nulpunkt"],
  ["rot", "", "Grader med uret. 0 = maskinen vender mod øst"],
  ["producent", "", "Fabrikat, fx Cimbria"],
  ["model", "", "Modelbetegnelse"],
  ["aar", "", "Årgang"],
  ["proces", "", "Hvad maskinen gør, fx rensning, sortering"],
  ["kapacitet", "", "Fx 2 t/h"],
  ["dim", "", "DIM-skab maskinen hænger på"],
  ["ot", "", "OT-net: IP, switch-port eller VLAN"],
  ["noter", "", "Alt andet"],
];
const td = "padding:3px 8px;border-bottom:1px solid #D3D9D3;";
guide.push(text(
  `<font style="font-size: 16px;"><b>Felter (Ctrl+M)</b></font><br><br>` +
  `<table style="border-collapse:collapse;font-size:12px;width:100%;">` +
  `<tr><td style="${td}"><b>Felt</b></td><td style="${td}"><b>Skal udfyldes</b></td><td style="${td}"><b>Eksempel / betydning</b></td></tr>` +
  fieldRows.map(([f, req, d]) => `<tr><td style="${td}font-family:Courier New;">${f}</td><td style="${td}">${req}</td><td style="${td}">${d}</td></tr>`).join("") +
  `</table>`,
  40, 500, 520, 400));

// Maskintyper
guide.push(text(`<font style="font-size: 16px;"><b>Maskintyper</b></font>`, 600, 130, 300, 24));
const types: [Kind, Fields][] = [
  ["Indtag", { navn: "Påslag", wid: "100" }],
  ["Elevator", { navn: "Elevator", wid: "101" }],
  ["Fordeler", { navn: "Fordeler", wid: "102" }],
  ["Proces", { navn: "Triør", wid: "103" }],
  ["Analyse", { navn: "Videometer", wid: "104" }],
];
types.forEach(([k, f], i) => guide.push(machine(k, 600 + i * 110, 165, f).xml));

// Eksempel-flow
guide.push(text(`<font style="font-size: 16px;"><b>Eksempel på en linje, der deler sig</b></font>`, 620, 260, 500, 24));
const a = machine("Indtag", 800, 300, { navn: "Påslag", wid: "200", proces: "Tømning af big bags" });
const b = machine("Elevator", 800, 380, { navn: "Elevator", wid: "201" });
const c = machine("Fordeler", 800, 460, { navn: "Fordeler", wid: "202" });
const s1 = machine("Proces", 680, 550, { navn: "Triør S", wid: "203", spor: "S", producent: "Eksempel A/S", model: "T-100", aar: "2012" });
const n1 = machine("Proces", 920, 550, { navn: "Triør N", wid: "204", spor: "N" });
const s2 = machine("Elevator", 680, 630, { navn: "Elevator", wid: "205", spor: "S" });
const n2 = machine("Elevator", 920, 630, { navn: "Elevator", wid: "206", spor: "N" });
guide.push(...[a, b, c, s1, n1, s2, n2].map((m) => m.xml));
guide.push(edge(a.id, b.id), edge(b.id, c.id), edge(c.id, s1.id, "left"), edge(c.id, n1.id, "right"), edge(s1.id, s2.id), edge(n1.id, n2.id));

guide.push(note(
  `<b>Tjek før du sender</b><br>` +
  `☐ Alle bokse har navn, W-ID og maskintype<br>` +
  `☐ Alle pile sidder fast i begge ender<br>` +
  `☐ Sporene er udfyldt efter en fordeler<br>` +
  `☐ Fanen hedder <i>Linje N – Navn</i>`,
  620, 720, 420, 110, "#F6EFE3", "#B7791F"));

guide.push(note(
  `<b>Målfast placering – kun hvis linjen er målt op</b><br><br>` +
  `Felterne <i>x</i>, <i>z</i> og <i>rot</i> flytter maskinerne hen, hvor de står i virkeligheden. ` +
  `<b>Lad dem stå tomme</b>, hvis linjen ikke er målt op – så placeres maskinerne efter tegningen som hidtil.<br><br>` +
  `Alle mål er i meter fra fabrikkens aftalte nulpunkt. Både 12,5 og 12.5 virker. ` +
  `Har du målt maskinen op, kan du selv tilføje felterne <i>bredde</i>, <i>dybde</i> og <i>hoejde</i>.`,
  620, 860, 420, 150, "#EEF3F1", "#2E6D64"));

// ---------------------------------------------------------------------------
// Fane 2: tom linje
// ---------------------------------------------------------------------------
const line: string[] = [];
line.push(note(
  `<b>Start her</b><br>1. Omdøb fanen (dobbeltklik på fanen nederst), fx <i>Linje 3 – Renselinjen</i>.<br>` +
  `2. Markér boksen herunder og tryk <b>Ctrl+M</b> for at udfylde den.<br>` +
  `3. Slet gerne denne note, når du er i gang – den bliver ikke læst.`,
  40, 30, 420, 100, "#EEF3F1", "#2E6D64"));
const start = machine("Indtag", 200, 180, { navn: "Indtag" });
line.push(start.xml);

const drawio =
  `<mxfile host="app.diagrams.net" compressed="false">` +
  page("Vejledning", "vejledning", guide, 1169, 1040) +
  page("Linje N – Navn", "linje", line) +
  `</mxfile>\n`;

// ---------------------------------------------------------------------------
// Bibliotek (Fil → Åbn bibliotek)
// ---------------------------------------------------------------------------
const compress = (xml: string) => deflateRawSync(Buffer.from(encodeURIComponent(xml), "utf8")).toString("base64");
const library = (Object.keys(KIND_STYLE) as Kind[]).map((k) => {
  const m = machine(k, 0, 0, { navn: KIND_STYLE[k].title === "Procesmaskine" ? "Maskine" : KIND_STYLE[k].title }, "2");
  const model = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${m.xml}</root></mxGraphModel>`;
  return { xml: compress(model), w: KIND_STYLE[k].w, h: KIND_STYLE[k].h, aspect: "fixed", title: KIND_STYLE[k].title };
});

mkdirSync("templates", { recursive: true });
writeFileSync("templates/UBS-linjeskabelon.drawio", drawio);
writeFileSync("templates/UBS-maskiner.xml", `<mxlibrary>${JSON.stringify(library)}</mxlibrary>\n`);
console.log("✔ templates/UBS-linjeskabelon.drawio\n✔ templates/UBS-maskiner.xml");
