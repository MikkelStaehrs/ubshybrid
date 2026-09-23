// Claude som tænkende agent i ordresimuleringen.
//
// Her, og kun her, kaldes Anthropics API — og kun fra serveren. Nøglen
// (ANTHROPIC_API_KEY) forlader aldrig serveren og skrives aldrig ud, heller
// ikke i en fejlbesked. Hver agent får sin rolle fra data/agents.ts og
// tallene fra simuleringen; intet andet. Svaret kommer gennem ét værktøj, så
// det altid har samme form, og det valideres, før simuleringen ser det: en
// agent kan kun vælge mellem de handlinger, opgaven tilbød, og kun skrive
// til dem, opgaven nævnte.
import { AGENTS } from "../../data/agents";
import { USD_TIL_DKK } from "./agent-cost";
import { klokke, MENNESKER, type Besked, type BeskedType } from "./samspil";

/**
 * Modellerne og deres listepris i USD pr. million tokens. Skøn fra
 * prislisten — tjek anthropic.com/pricing, før tallene bruges til andet end
 * et loft. Operatøragenten og Dataagenten afvejer og skal være gode;
 * linjeagenterne melder og skal være hurtige.
 */
export const MODELLER = {
  sonnet: { id: "claude-sonnet-5", input: 3, output: 15 },
  haiku: { id: "claude-haiku-4-5-20251001", input: 1, output: 5 },
} as const;

export type Model = (typeof MODELLER)[keyof typeof MODELLER];

/** De agenter, der tænker med Claude. Kædevagten er kode; Driftsagent stopper efter regler. */
export const CLAUDE_AGENTER = new Set(["Operatøragent", "Dataagent", "Linjeagent Spor N", "Linjeagent Spor S"]);

export function modelFor(agent: string): Model {
  return agent === "Operatøragent" || agent === "Dataagent" ? MODELLER.sonnet : MODELLER.haiku;
}

/** Hvem en agent kan skrive til: holdet, alle, og menneskerne. */
const MODTAGERE = new Set(["Operatøragent", "Driftsagent", "Dataagent", "Kædevagt", "Linjeagent Spor N", "Linjeagent Spor S", "Alle", ...MENNESKER]);

const TYPER: BeskedType[] = ["iagttagelse", "forslag", "beslutning", "handling", "rapport"];

/** Svaret er kort. Det er et loft, ikke et mål. */
export const MAKS_TOKENS = 600;

export interface Forespoergsel {
  /** Kørslen — budgettet regnes pr. kørsel. */
  koersel: string;
  opgave: {
    agent: string;
    t: number;
    spoergsmaal: string;
    situation: Record<string, unknown>;
    handlinger: string[];
    modtagere: string[];
    standard: string;
  };
  /** De seneste beskeder, ældste først. */
  samtale: Pick<Besked, "fra" | "til" | "type" | "tekst">[];
}

export interface GyldigtSvar {
  beskeder: { til: string; type: BeskedType; tekst: string; grund?: string }[];
  handling: string;
}

const kort = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Er forespørgslen til at stole på? Browseren sender den; serveren tjekker den. */
export function gyldigForespoergsel(f: unknown): f is Forespoergsel {
  if (!f || typeof f !== "object") return false;
  const x = f as Forespoergsel;
  const o = x.opgave;
  const strenge = (a: unknown, maks: number, len: number) =>
    Array.isArray(a) && a.length > 0 && a.length <= maks && a.every((v) => typeof v === "string" && v.length <= len);
  return typeof x.koersel === "string" && x.koersel.length > 0 && x.koersel.length <= 64
    && !!o && typeof o === "object"
    && typeof o.agent === "string" && CLAUDE_AGENTER.has(o.agent)
    && typeof o.t === "number"
    && typeof o.spoergsmaal === "string" && o.spoergsmaal.length <= 400
    && !!o.situation && typeof o.situation === "object" && !Array.isArray(o.situation)
    && strenge(o.handlinger, 6, 40)
    && strenge(o.modtagere, 8, 40) && o.modtagere.every((m) => MODTAGERE.has(m))
    && typeof o.standard === "string" && o.handlinger.includes(o.standard)
    && Array.isArray(x.samtale) && x.samtale.length <= 12;
}

export function systemPrompt(agentNavn: string): string {
  const a = Object.values(AGENTS).flat().find((x) => x.name === agentNavn);
  return [
    `Du er ${agentNavn} i en simuleret frøfabrik: sliberiet ved UBS Holeby, hvor sukkerroefrø slibes, renses og sorteres i to spor (N og S).`,
    a ? `Dit job: ${a.job}` : "",
    a ? `Du svarer ${a.til}. Det ene spørgsmål, du er til for: ${a.svarerPaa}` : "",
    "",
    "Holdet:",
    "- Operatøragent: koordinerer, afvejer og beslutter. Taler med operatøren.",
    "- Driftsagent: stopper og starter spor efter faste regler inden for sekunder. Den tænker ikke; den udfører.",
    "- Dataagent: holder data flydende — prøverate, huller, målere der falder ud.",
    "- Kædevagt: melder, når data ikke når frem til databasen.",
    "- Linjeagent Spor N og Linjeagent Spor S: hver sit spor. Ser stop komme, friktion og kvalitet.",
    "- Operatør: mennesket i kontrolrummet.",
    "",
    "Sådan svarer du:",
    "- Kun med værktøjet svar. Vælg præcis én af de tilladte handlinger.",
    "- Brug kun tallene i situationen. Opfind ingen tal, maskiner eller årsager. Ved du det ikke, så sig det.",
    "- Dansk, kort og konkret, som en erfaren driftsleder. Tekst højst 20 ord. Grund højst 35 ord, med tallene bag.",
    "- Til mennesker i almindeligt sprog; til agenter kort.",
    "- Højst to beskeder.",
  ].filter((l, i, alle) => l !== "" || alle[i - 1] !== "").join("\n");
}

export function brugerBesked(f: Forespoergsel): string {
  const o = f.opgave;
  const samtale = f.samtale.length === 0
    ? "(ingen endnu)"
    : f.samtale.map((b) => `- ${b.fra} → ${b.til} [${b.type}]: ${b.tekst}`).join("\n");
  return [
    `Simuleret klokke ${klokke(o.t)}.`,
    o.spoergsmaal,
    "",
    "Situationen, som simuleringen måler den:",
    JSON.stringify(o.situation, null, 1),
    "",
    "Seneste beskeder mellem agenterne, ældste først:",
    samtale,
    "",
    `Tilladte handlinger: ${o.handlinger.join(", ")}.`,
    `Du kan skrive til: ${o.modtagere.join(", ")}.`,
  ].join("\n");
}

/** Værktøjet, svaret skal komme igennem. Formen er den samme hver gang. */
export function vaerktoej(f: Forespoergsel) {
  return {
    name: "svar",
    description: "Dit svar i situationen: de beskeder, du sender, og den handling, du vælger.",
    input_schema: {
      type: "object",
      properties: {
        beskeder: {
          type: "array",
          description: "Én eller to beskeder.",
          items: {
            type: "object",
            properties: {
              til: { type: "string", enum: f.opgave.modtagere },
              type: { type: "string", enum: TYPER },
              tekst: { type: "string", description: "Højst 20 ord." },
              grund: { type: "string", description: "Tallene bag. Højst 35 ord." },
            },
            required: ["til", "type", "tekst", "grund"],
          },
        },
        handling: { type: "string", enum: f.opgave.handlinger },
      },
      required: ["beskeder", "handling"],
    },
  };
}

/**
 * Er svaret til at bruge? En besked til en, opgaven ikke nævnte, falder
 * væk; en handling, den ikke tilbød, bliver reglernes. Er der ingen
 * brugbar besked tilbage, er svaret ubrugeligt — så tager reglerne over.
 */
export function validerSvar(input: unknown, f: Forespoergsel): GyldigtSvar | null {
  if (!input || typeof input !== "object") return null;
  const i = input as { beskeder?: unknown; handling?: unknown };
  const handling = typeof i.handling === "string" && f.opgave.handlinger.includes(i.handling) ? i.handling : f.opgave.standard;
  const beskeder = (Array.isArray(i.beskeder) ? i.beskeder : []).slice(0, 2).flatMap((b) => {
    if (!b || typeof b !== "object") return [];
    const x = b as Record<string, unknown>;
    const til = typeof x.til === "string" ? x.til : "";
    if (!f.opgave.modtagere.includes(til)) return [];
    const type = TYPER.includes(x.type as BeskedType) ? (x.type as BeskedType) : "iagttagelse";
    const tekst = typeof x.tekst === "string" ? kort(x.tekst, 240) : "";
    if (!tekst) return [];
    const grund = typeof x.grund === "string" && x.grund.trim() ? kort(x.grund, 400) : undefined;
    return [{ til, type, tekst, grund }];
  });
  return beskeder.length > 0 ? { beskeder, handling } : null;
}

export interface Forbrug {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Hvad et kald kostede, i kroner. Cache skrives til 1,25 × og læses til 0,1 × prisen. */
export function prisKr(model: Model, u: Forbrug): number {
  const usd = (u.input_tokens * model.input
    + (u.cache_creation_input_tokens ?? 0) * model.input * 1.25
    + (u.cache_read_input_tokens ?? 0) * model.input * 0.1
    + u.output_tokens * model.output) / 1_000_000;
  return usd * USD_TIL_DKK;
}

/** Det højeste, et kald kan koste: et rundt input og det fulde svar. */
export function estimatKr(model: Model): number {
  return prisKr(model, { input_tokens: 4000, output_tokens: MAKS_TOKENS });
}

/**
 * Loftet. Et pr. kørsel og et pr. døgn, og begge holdes på serveren, så en
 * browser, der hænger, ikke kan bruge kreditten op. Tallene nulstilles, når
 * serveren genstarter — loftet på kontoen hos Anthropic er det sidste værn.
 */
export class Budget {
  private koersler = new Map<string, number>();
  private dag = { dato: "", kr: 0 };
  constructor(readonly loftKoersel: number, readonly loftDoegn: number, private idag = () => new Date().toISOString().slice(0, 10)) {}

  private doegn(): number {
    const d = this.idag();
    if (this.dag.dato !== d) this.dag = { dato: d, kr: 0 };
    return this.dag.kr;
  }

  kan(koersel: string, estimat: number): { ok: true } | { ok: false; grund: string } {
    if ((this.koersler.get(koersel) ?? 0) + estimat > this.loftKoersel) return { ok: false, grund: "Loftet for kørslen er nået" };
    if (this.doegn() + estimat > this.loftDoegn) return { ok: false, grund: "Loftet for i dag er nået" };
    return { ok: true };
  }

  brug(koersel: string, kr: number) {
    this.doegn();
    this.koersler.set(koersel, (this.koersler.get(koersel) ?? 0) + kr);
    this.dag.kr += kr;
  }

  status(koersel: string) {
    return { brugtKr: this.koersler.get(koersel) ?? 0, loftKr: this.loftKoersel, doegnKr: this.doegn(), loftDoegnKr: this.loftDoegn };
  }
}

export type Kald =
  | { ok: true; svar: GyldigtSvar; kr: number; ms: number; model: string }
  | { ok: false; fejl: string; kr: number };

/**
 * Ét kald til Claude. Nøglen står kun i headeren til Anthropic; en fejl
 * gengiver Anthropics besked og statuskode, aldrig forespørgslen.
 */
export async function kaldClaude(
  f: Forespoergsel,
  noegle: string,
  { workspace, timeoutMs = 25_000 }: { workspace?: string; timeoutMs?: number } = {},
): Promise<Kald> {
  const model = modelFor(f.opgave.agent);
  const start = Date.now();
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": noegle,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        // En nøgle, der ikke hører til et workspace, skal have det med i hvert kald.
        ...(workspace ? { "anthropic-workspace-id": workspace } : {}),
      },
      body: JSON.stringify({
        model: model.id,
        max_tokens: MAKS_TOKENS,
        system: [{ type: "text", text: systemPrompt(f.opgave.agent), cache_control: { type: "ephemeral" } }],
        tools: [vaerktoej(f)],
        tool_choice: { type: "tool", name: "svar" },
        messages: [{ role: "user", content: brugerBesked(f) }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, fejl: e instanceof Error && e.name === "TimeoutError" ? "Claude svarede ikke i tide" : "Kunne ikke nå Claude", kr: 0 };
  }
  const ms = Date.now() - start;
  const tekst = await res.text();
  if (!res.ok) {
    let besked = "";
    try { besked = JSON.parse(tekst)?.error?.message ?? ""; } catch { /* ikke JSON */ }
    return { ok: false, fejl: `Claude svarede ${res.status}${besked ? `: ${kort(besked, 160)}` : ""}`, kr: 0 };
  }
  const data = JSON.parse(tekst) as { content?: { type: string; name?: string; input?: unknown }[]; usage?: Forbrug };
  const kr = data.usage ? prisKr(model, data.usage) : estimatKr(model);
  const brug = data.content?.find((c) => c.type === "tool_use" && c.name === "svar");
  const svar = validerSvar(brug?.input, f);
  if (!svar) return { ok: false, fejl: "Svaret kunne ikke bruges", kr };
  return { ok: true, svar, kr, ms, model: model.id };
}
