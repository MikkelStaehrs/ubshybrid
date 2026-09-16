import { XMLParser } from "fast-xml-parser";
import type { FlowEdge, Footprint, LineData, Machine, MachineDetails, MachineKind, Placement } from "./types";

// ---------------------------------------------------------------------------
// Draw.io → LineData
// Understøtter: HTML-labels, komprimerede diagrammer, "Edit Data"-felter
// (<object>/<UserObject>), løse pile (targetPoint uden target) og manglende
// pile mellem maskiner der står lige under hinanden.
// ---------------------------------------------------------------------------

export interface ParseOptions {
  lineId: string;
  lineName: string;
  order: number;
  sourceFile: string;
  /** Fanens navn eller nummer. Standard: første linjefane. */
  page?: string | number;
  /** Kræves kun for komprimerede diagrammer (Node: zlib.inflateRawSync). */
  inflateRaw?: (data: Uint8Array) => Uint8Array;
  /**
   * "floorplan" = brug de målfaste x/z fra tegningen. Standard er "schematic",
   * så en linje først bliver målfast når nogen aktivt beder om det.
   */
  positionMode?: "schematic" | "floorplan";
}

type Attrs = Record<string, string>;
interface RawCell {
  id: string;
  attrs: Attrs;
  userData: Attrs;
  geometry?: { x: number; y: number; w: number; h: number; targetPoint?: { x: number; y: number } };
}

const DETAIL_ALIASES: Record<string, keyof MachineDetails> = {
  producent: "producent", manufacturer: "producent", fabrikat: "producent",
  model: "model",
  aar: "aar", år: "aar", year: "aar", aargang: "aar", årgang: "aar",
  proces: "proces", process: "proces", funktion: "proces",
  kapacitet: "kapacitet", capacity: "kapacitet",
  dim: "dimSkab", dimskab: "dimSkab", "dim-skab": "dimSkab",
  ot: "otNet", otnet: "otNet", "ot-net": "otNet", ip: "otNet",
  noter: "noter", note: "noter", notes: "noter",
};
const IGNORED_USER_KEYS = new Set([
  "label", "placeholders", "id", "tooltip", "link", "navn", "wid", "maskintype", "spor",
  // Målfast placering — havner i machine.placement, ikke i details.
  "x", "plan-x", "z", "plan-z", "rot", "rotation",
  "bredde", "width", "dybde", "depth", "hoejde", "højde", "height",
]);

/** "12,5" og "12.5" → 12.5. Tom eller ugyldig → undefined. */
function num(v: string | undefined): number | undefined {
  const s = v?.trim().replace(",", ".");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

const pickField = (u: Attrs, ...keys: string[]) =>
  keys.map((k) => u[k]).find((v) => v !== undefined && v.trim() !== "");

/**
 * Læser placeringen fra "Edit Data" (Ctrl+M): x, z og rot.
 * Er x/z slet ikke udfyldt, returneres undefined uden brok — maskinen er bare ikke opmålt endnu.
 */
function readPlacement(u: Attrs, name: string, issues: string[]): Placement | undefined {
  const rawX = pickField(u, "x", "plan-x");
  const rawZ = pickField(u, "z", "plan-z");
  if (rawX === undefined && rawZ === undefined) return undefined;

  const x = num(rawX);
  const z = num(rawZ);
  if (x === undefined || z === undefined) {
    issues.push(`"${name}": x og z skal begge være tal i meter (fik "${rawX ?? ""}" / "${rawZ ?? ""}") – placeringen bruges ikke.`);
    return undefined;
  }

  let rot = 0;
  const rawRot = pickField(u, "rot", "rotation");
  if (rawRot !== undefined) {
    const r = num(rawRot);
    if (r === undefined) issues.push(`"${name}": rot "${rawRot}" er ikke et tal – bruger 0°.`);
    else rot = ((r % 360) + 360) % 360;
  }
  return { x, z, rot };
}

/**
 * Læser de opmålte mål: bredde, dybde og hoejde.
 * Uafhængigt af placeringen — en maskine kan være målt op uden at være sat på plantegningen.
 */
function readFootprint(u: Attrs, name: string, issues: string[]): Footprint | undefined {
  const rawW = pickField(u, "bredde", "width");
  const rawD = pickField(u, "dybde", "depth");
  const rawH = pickField(u, "hoejde", "højde", "height");
  if (rawW === undefined && rawD === undefined && rawH === undefined) return undefined;

  const h = num(rawH);
  const badH = rawH !== undefined && (h === undefined || h <= 0);
  if (badH) issues.push(`"${name}": hoejde "${rawH}" er ikke et positivt tal – bruger standardhøjden.`);

  if (rawW === undefined && rawD === undefined) {
    if (!badH) issues.push(`"${name}": hoejde er udfyldt, men bredde og dybde mangler – målene bruges ikke.`);
    return undefined;
  }
  const w = num(rawW);
  const d = num(rawD);
  if (w === undefined || d === undefined || w <= 0 || d <= 0) {
    issues.push(`"${name}": bredde og dybde skal begge være positive tal i meter – bruger standardmålene.`);
    return undefined;
  }
  return h !== undefined && h > 0 ? { x: w, z: d, h } : { x: w, z: d };
}

/** Faner der starter med "Vejledning" eller "_" er ikke linjer. */
export const isGuidePage = (name: string) => /^(vejledning|_)/i.test(name.trim());

const KIND_FIELD: Record<string, MachineKind> = {
  indtag: "intake", intake: "intake",
  elevator: "elevator",
  fordeler: "distributor", distributor: "distributor",
  proces: "process", procesmaskine: "process", process: "process", maskine: "process",
  analyse: "analysis", analysis: "analysis", analyseudstyr: "analysis", maaleudstyr: "analysis",
  person: "person", medarbejder: "person",
};

/** Draw.io-placeholders: "%navn%" → værdien af feltet navn. */
function fillPlaceholders(label: string, data: Attrs) {
  return label.replace(/%([\w-]+)%/g, (_, k) => data[k] ?? "");
}

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(div|p)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function classify(name: string): MachineKind {
  if (/elevator/i.test(name)) return "elevator";
  if (/fordeler|splitter/i.test(name)) return "distributor";
  if (/påslag|vippestol|indtag|tipper/i.test(name)) return "intake";
  if (/videometer|ct[-\s]?scanner|scanner|analyse/i.test(name)) return "analysis";
  return "process";
}

function asArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

function b64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: false,
});

function readModel(diagram: any, opts: ParseOptions): any {
  if (diagram.mxGraphModel) return diagram.mxGraphModel;
  const text = typeof diagram === "string" ? diagram : diagram["#text"];
  if (!text) throw new Error("Tomt diagram");
  if (!opts.inflateRaw) throw new Error("Diagrammet er komprimeret – angiv inflateRaw");
  const inflated = new TextDecoder().decode(opts.inflateRaw(b64ToBytes(text.trim())));
  return parser.parse(decodeURIComponent(inflated)).mxGraphModel;
}

export function linePages(xml: string): { index: number; name: string }[] {
  const doc = parser.parse(xml);
  if (!doc.mxfile) return [{ index: 0, name: "" }];
  return asArray(doc.mxfile.diagram)
    .map((d: any, index: number) => ({ index, name: String(d.name ?? `Side ${index + 1}`) }))
    .filter((p) => !isGuidePage(p.name));
}

function collectCells(root: any, prefix: string): RawCell[] {
  const cells: RawCell[] = [];
  const push = (cell: any, id: string, userData: Attrs) => {
    const g = cell.mxGeometry;
    let geometry: RawCell["geometry"];
    if (g) {
      const tp = asArray(g.mxPoint).find((p: any) => p.as === "targetPoint");
      geometry = {
        x: Number(g.x ?? 0), y: Number(g.y ?? 0),
        w: Number(g.width ?? 0), h: Number(g.height ?? 0),
        targetPoint: tp ? { x: Number(tp.x ?? 0), y: Number(tp.y ?? 0) } : undefined,
      };
    }
    const { mxGeometry, ...attrs } = cell;
    cells.push({ id: prefix + id, attrs: attrs as Attrs, userData, geometry });
  };
  for (const c of asArray(root.mxCell)) push(c, c.id, {});
  for (const tag of ["object", "UserObject"]) {
    for (const o of asArray(root[tag])) {
      const { mxCell, id, ...rest } = o;
      const cell = { ...mxCell, value: rest.label ?? "" };
      push(cell, id, rest as Attrs);
    }
  }
  return cells;
}

export function parseDrawio(xml: string, opts: ParseOptions): LineData {
  const doc = parser.parse(xml);
  const diagrams: any[] = doc.mxfile ? asArray(doc.mxfile.diagram) : [{ mxGraphModel: doc.mxGraphModel }];
  const issues: string[] = [];

  const pages = linePages(xml);
  const page =
    opts.page === undefined ? pages[0]
    : typeof opts.page === "number" ? pages.find((p) => p.index === opts.page)
    : pages.find((p) => p.name === opts.page);
  if (!page) throw new Error(`Fandt ingen linjefane${opts.page !== undefined ? ` "${opts.page}"` : ""}.`);
  const raw = collectCells(readModel(diagrams[page.index], opts).root, "");

  // Absolutte koordinater (figurer i grupper/containere er relative til forælderen).
  const cellById = new Map(raw.map((c) => [c.id, c]));
  const absCache = new Map<string, { x: number; y: number }>();
  const absOrigin = (id: string | undefined, depth = 0): { x: number; y: number } => {
    const c = id ? cellById.get(id) : undefined;
    if (!c || !c.geometry || depth > 20) return { x: 0, y: 0 };
    if (absCache.has(c.id)) return absCache.get(c.id)!;
    const p = absOrigin(c.attrs.parent, depth + 1);
    const o = { x: p.x + c.geometry.x, y: p.y + c.geometry.y };
    absCache.set(c.id, o);
    return o;
  };
  const isShape = (c: RawCell) => {
    const style = String(c.attrs.style ?? "");
    const parent = cellById.get(c.attrs.parent ?? "");
    return (
      c.attrs.vertex === "1" && !!c.geometry &&
      c.attrs.connectable !== "0" &&
      !/^text;|(^|;)text;|swimlane|container=1|group/.test(style) &&
      parent?.attrs.edge !== "1"
    );
  };

  // --- Maskiner -------------------------------------------------------------
  const byDrawioId = new Map<string, Machine>();
  const usedIds = new Set<string>();
  for (const c of raw) {
    if (!isShape(c) || !c.geometry) continue;
    const u = c.userData;
    let rawLabel = String(c.attrs.value ?? "");
    if (u.placeholders === "1") rawLabel = fillPlaceholders(rawLabel, u);
    const label = htmlToText(rawLabel);
    if (!label && !u.navn) continue;

    const idSource = u.wid ?? label.match(/W-?ID\s*:?\s*([\d\s/,;-]+)/i)?.[1] ?? "";
    const wIds = idSource.split(/[\s/,;-]+/).filter(Boolean);
    const name =
      u.navn?.trim() ||
      label.split("\n").filter((l) => !/W-?ID/i.test(l)).join(" ").trim() || label;
    if (!name) { issues.push(`En figur uden navn (celle ${c.id}) er sprunget over.`); continue; }
    const isPerson = (u.maskintype ?? "").trim().toLowerCase() === "person";
    if (!wIds.length && !isPerson) issues.push(`"${name}" mangler W-ID.`);
    else if (wIds.some((w) => !/^\d+$/.test(w))) issues.push(`"${name}" har et W-ID der ikke er et tal: ${wIds.join("/")}.`);

    let kind = classify(name);
    if (u.maskintype) {
      const k = KIND_FIELD[u.maskintype.trim().toLowerCase()];
      if (k) kind = k;
      else issues.push(`"${name}": ukendt maskintype "${u.maskintype}" (brug Indtag, Elevator, Fordeler eller Proces).`);
    }

    let id = wIds.length ? `W-${wIds.join("-")}` : `X-${c.id}`;
    if (usedIds.has(id)) {
      issues.push(`W-ID ${wIds.join("/")} findes flere gange (${name}).`);
      id = `${id}#${c.id}`;
    }
    usedIds.add(id);

    const details: MachineDetails = {};
    for (const [k, v] of Object.entries(c.userData)) {
      if (IGNORED_USER_KEYS.has(k.toLowerCase()) || v === "") continue;
      details[DETAIL_ALIASES[k.toLowerCase()] ?? k] = String(v);
    }

    const placement = readPlacement(u, name, issues);
    const footprint = readFootprint(u, name, issues);

    byDrawioId.set(c.id, {
      id, drawioId: c.id, name, label, wIds,
      kind, lane: u.spor?.trim() || null, step: 0,
      drawio: { ...absOrigin(c.id), w: c.geometry.w, h: c.geometry.h },
      ...(placement ? { placement } : {}),
      ...(footprint ? { footprint } : {}),
      upstream: [], downstream: [], details,
    });
  }
  const machines = [...byDrawioId.values()];
  const center = (m: Machine) => ({ x: m.drawio.x + m.drawio.w / 2, y: m.drawio.y + m.drawio.h / 2 });

  // --- Forbindelser ---------------------------------------------------------
  const edges: FlowEdge[] = [];
  const addEdge = (from: Machine, to: Machine, inferred: boolean, id: string, note?: string) => {
    if (from === to || edges.some((e) => e.from === from.id && e.to === to.id)) return;
    edges.push({ id, from: from.id, to: to.id, inferred, note });
  };

  for (const c of raw) {
    if (c.attrs.edge !== "1") continue;
    const src = byDrawioId.get(c.attrs.source ?? "");
    let tgt = byDrawioId.get(c.attrs.target ?? "");
    if (!src) { issues.push(`Pil ${c.id} har ingen startmaskine.`); continue; }
    if (!tgt && c.geometry?.targetPoint) {
      // Løs pil: find den maskine der ligger tættest på pilespidsen.
      const p = c.geometry.targetPoint;
      let best: Machine | undefined; let bestD = Infinity;
      for (const m of machines) {
        if (m === src) continue;
        const dx = Math.max(m.drawio.x - p.x, 0, p.x - (m.drawio.x + m.drawio.w));
        const dy = Math.max(m.drawio.y - p.y, 0, p.y - (m.drawio.y + m.drawio.h));
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = m; }
      }
      if (best && bestD <= 60) {
        tgt = best;
        issues.push(`Pilen fra "${src.name}" rammer ikke "${best.name}" – forbindelsen er antaget.`);
        addEdge(src, tgt, true, c.id, "Pil ikke koblet til maskinen i tegningen");
        continue;
      }
    }
    if (!tgt) { issues.push(`Pilen fra "${src.name}" peger ikke på nogen maskine.`); continue; }
    addEdge(src, tgt, false, c.id);
  }

  // Maskiner uden indgang der står lige under en maskine uden udgang → antag flow.
  const hasIn = new Set(edges.map((e) => e.to));
  const hasOut = new Set(edges.map((e) => e.from));
  const machineById = new Map(machines.map((m) => [m.id, m]));
  const gaps = edges
    .map((e) => machineById.get(e.to)!.drawio.y - machineById.get(e.from)!.drawio.y)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  const typicalGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] * 1.5 : 120;
  // Er der ikke tegnet en eneste pil, beskriver tegningen et rum og ikke et flow.
  // Så skal der heller ikke gættes forbindelser frem.
  for (const orphan of edges.length ? machines : []) {
    if (hasIn.has(orphan.id)) continue;
    const above = machines
      .filter((m) => m !== orphan && !hasOut.has(m.id))
      .filter((m) => Math.abs(center(m).x - center(orphan).x) < 10)
      .filter((m) => orphan.drawio.y > m.drawio.y && orphan.drawio.y - m.drawio.y <= typicalGap)
      .sort((a, b) => b.drawio.y - a.drawio.y)[0];
    if (above) {
      addEdge(above, orphan, true, `inferred-${above.id}-${orphan.id}`, "Mangler pil i tegningen");
      hasOut.add(above.id); hasIn.add(orphan.id);
      issues.push(`Ingen pil mellem "${above.name}" (${above.wIds.join("/")}) og "${orphan.name}" (${orphan.wIds.join("/")}) – forbindelsen er antaget.`);
    }
  }

  const byId = new Map(machines.map((m) => [m.id, m]));
  for (const e of edges) {
    byId.get(e.from)!.downstream.push(e.to);
    byId.get(e.to)!.upstream.push(e.from);
  }

  // --- Trin (længste vej fra start) ------------------------------------------
  const roots = machines.filter((m) => m.upstream.length === 0);
  const queue = [...roots];
  const indeg = new Map(machines.map((m) => [m.id, m.upstream.length]));
  while (queue.length) {
    const m = queue.shift()!;
    for (const d of m.downstream) {
      const n = byId.get(d)!;
      n.step = Math.max(n.step, m.step + 1);
      indeg.set(d, indeg.get(d)! - 1);
      if (indeg.get(d) === 0) queue.push(n);
    }
  }
  if ([...indeg.values()].some((v) => v > 0)) issues.push("Flowet indeholder en løkke – trin kan være upræcise.");
  // En tegning helt uden pile er et rum, ikke et flow — så er løse maskiner normalt.
  if (edges.length && machines.length > 1) {
    for (const m of machines) {
      if (!m.upstream.length && !m.downstream.length) {
        issues.push(`"${m.name}"${m.wIds.length ? ` (${m.wIds.join("/")})` : ""} er ikke forbundet med pile.`);
      }
    }
  }
  const connectedRoots = roots.filter((r) => r.downstream.length);
  if (connectedRoots.length > 1) issues.push(`Flere startpunkter: ${connectedRoots.map((r) => r.name).join(", ")}.`);

  // --- Spor (S/N) -------------------------------------------------------------
  // Alt nedstrøms for en fordeler får spor efter den gren det tilhører.
  const lanes: string[] = [];
  for (const dist of machines.filter((m) => m.downstream.length > 1)) {
    const cx = center(dist).x;
    for (const startId of dist.downstream) {
      const branch: Machine[] = [];
      const stack = [byId.get(startId)!];
      while (stack.length) {
        const m = stack.pop()!;
        if (branch.includes(m) || m.upstream.length > 1) continue;
        branch.push(m);
        stack.push(...m.downstream.map((d) => byId.get(d)!));
      }
      const suffixes = branch.map((m) => m.name.match(/([A-ZÆØÅ])\1*$/)?.[1]).filter(Boolean) as string[];
      const tally = suffixes.reduce<Record<string, number>>((t, s) => ((t[s] = (t[s] ?? 0) + 1), t), {});
      const label =
        Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ??
        (center(branch[0]).x < cx ? "V" : "H");
      branch.forEach((m) => (m.lane = m.lane ?? label));
    }
  }

  for (const m of machines) if (m.lane && !lanes.includes(m.lane)) lanes.push(m.lane);

  machines.sort((a, b) => a.step - b.step || (a.lane ?? "").localeCompare(b.lane ?? ""));

  // --- Målfast placering ------------------------------------------------------
  const positionMode = opts.positionMode ?? "schematic";
  const missing = machines.filter((m) => !m.placement);
  if (positionMode === "floorplan" && missing.length) {
    const names = missing.slice(0, 5).map((m) => m.name).join(", ");
    issues.push(
      `${missing.length} af ${machines.length} maskiner mangler x/z fra plantegningen (${names}${missing.length > 5 ? " m.fl." : ""}) – de står skematisk og passer ikke med resten.`
    );
  }
  // To maskiner på samme koordinat betyder som regel en glemt indtastning.
  const atPoint = new Map<string, Machine>();
  for (const m of machines) {
    if (!m.placement) continue;
    const key = `${m.placement.x.toFixed(2)}, ${m.placement.z.toFixed(2)}`;
    const prev = atPoint.get(key);
    if (prev) issues.push(`"${m.name}" og "${prev.name}" står på samme koordinat (${key}).`);
    else atPoint.set(key, m);
  }

  return {
    line: {
      id: opts.lineId, name: opts.lineName, order: opts.order,
      sourceFile: opts.sourceFile, parsedAt: new Date().toISOString(),
      positionMode,
    },
    lanes,
    machines,
    edges,
    issues,
  };
}
