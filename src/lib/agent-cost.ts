// Hvad ville det koste at lade agenterne køre?
//
// Alle antagelser står her og kun her. Ingen af dem er målt — der er ikke
// kørt en eneste agent endnu, så der er intet forbrug at regne på. Tallene
// er skøn, de vises sammen med estimatet i fladen, og de skal revideres,
// når der foreligger en faktisk kørsel.
//
// Sidst gennemgået: 21. september 2026.
import { AGENTS } from "../../data/agents";
import type { Agent } from "./types";

/**
 * Listepris for Sonnet, USD pr. million tokens.
 *
 * Kilderne er uenige om 2/10 eller 3/15. Vi regner med den dyre: et estimat,
 * der er for lavt, er værre end et, der er for højt — det første overrasker
 * på regningen, det andet gør ikke.
 *
 * Listepris pr. 21. september 2026. Tjek anthropic.com/pricing.
 */
export const USD_PR_MIO_INPUT = 3;
export const USD_PR_MIO_OUTPUT = 15;

/**
 * Fast kurs, ikke en live-kurs. Et estimat skal give det samme tal i dag og
 * i morgen, ellers kan to mennesker ikke tale om det samme beløb.
 *
 * Kurs pr. 21. september 2026.
 */
export const USD_TIL_DKK = 6.4;

/**
 * Antal skift i døgnet. **Ubekræftet** — tallet er gættet, ikke oplyst, og
 * det ganger direkte op i Skifteagentens estimat. Bekræft det med driften.
 */
export const SKIFT_PR_DOEGN = 2;
export const SKIFT_PR_DOEGN_UBEKRAEFTET = true;

/** En måned regnes som 30 døgn. */
const DOEGN_PR_MAANED = 30;

export interface CostAssumption {
  label: string;
  value: string;
  /** Tallet er gættet og skal bekræftes, før nogen regner videre på det. */
  ubekraeftet?: boolean;
}

/** Antagelserne, som de skal stå ved siden af beløbet. */
export const COST_ASSUMPTIONS: CostAssumption[] = [
  { label: "Model", value: "Sonnet, listepris 3 / 15 USD pr. mio. tokens (input / output)" },
  { label: "Prissæt", value: "Kilderne er uenige om 2/10 eller 3/15 — vi regner med den dyre" },
  { label: "Valuta", value: `Fast kurs ${USD_TIL_DKK.toFixed(2).replace(".", ",")} kr. pr. USD, 21. september 2026` },
  { label: "Måned", value: `${DOEGN_PR_MAANED} døgn` },
  { label: "Skift pr. døgn", value: String(SKIFT_PR_DOEGN), ubekraeftet: SKIFT_PR_DOEGN_UBEKRAEFTET },
];

/** Tokenforbrug og kadence pr. agent. Skøn, ikke målinger. */
interface Usage {
  input: number;
  output: number;
  /** Kørsler pr. døgn. En ugentlig kørsel er 1/7. */
  perDoegn: number;
}

const USAGE: Record<string, Usage> = {
  "AG-SLIB-N": { input: 8000, output: 800, perDoegn: 1 },
  "AG-SLIB-S": { input: 8000, output: 800, perDoegn: 1 },
  "AG-SLIB-SKIFT": { input: 6000, output: 600, perDoegn: SKIFT_PR_DOEGN },
  "AG-SLIB-VEDL": { input: 15000, output: 1200, perDoegn: 1 / 7 },
  // Kaldes ved hændelser, ikke løbende: en ophobning, frø der bliver varmt.
  // Tyve om døgnet er et skøn — tallet er det, der styrer prisen.
  "AG-SLIB-DRIFT": { input: 5000, output: 300, perDoegn: 20 },
  // Kun når kæden halter eller en måler falder ud. Få gange om døgnet.
  "AG-SLIB-DATA": { input: 4000, output: 300, perDoegn: 6 },
  // Ved hver hændelse, de andre melder, og ved ordrens start, kvarte og
  // slut. Den læser mest — alle de andres beskeder — og skriver mest.
  "AG-SLIB-OPERATOER": { input: 12000, output: 800, perDoegn: 30 },
};

export interface AgentCost {
  agentId: string;
  /** Kroner pr. måned. 0 for kode-agenter. */
  perMaaned: number;
  /** Kørsler pr. måned, afrundet til visning. */
  koerslerPrMaaned: number;
  input: number;
  output: number;
  /** Sat når agenten ikke koster noget, og hvorfor. */
  gratis: string | null;
  /** Vi har ikke et skøn for den her agent. */
  ukendt: boolean;
}

export function costOf(agent: Agent): AgentCost {
  // Et kædetjek er en sammenligning, ikke en vurdering. Ingen API-kald.
  if (agent.engine === "kode") {
    return {
      agentId: agent.id, perMaaned: 0, koerslerPrMaaned: 0,
      input: 0, output: 0, gratis: "ingen API-kald", ukendt: false,
    };
  }
  const u = USAGE[agent.id];
  if (!u) {
    return {
      agentId: agent.id, perMaaned: 0, koerslerPrMaaned: 0,
      input: 0, output: 0, gratis: null, ukendt: true,
    };
  }
  const koersler = u.perDoegn * DOEGN_PR_MAANED;
  const usd =
    (u.input * koersler / 1_000_000) * USD_PR_MIO_INPUT +
    (u.output * koersler / 1_000_000) * USD_PR_MIO_OUTPUT;
  return {
    agentId: agent.id,
    perMaaned: usd * USD_TIL_DKK,
    koerslerPrMaaned: koersler,
    input: u.input,
    output: u.output,
    gratis: null,
    ukendt: false,
  };
}

export function costsFor(lineId: string): Map<string, AgentCost> {
  return new Map((AGENTS[lineId] ?? []).map((a) => [a.id, costOf(a)]));
}

/**
 * Totalen er kun det, nogen har sagt ja til. En idé koster ingenting, før
 * den bliver besluttet — den vises med sit estimat, men tælles ikke med.
 */
export function totalPerMaaned(agents: Agent[]): number {
  return agents
    .filter((a) => a.beslutning !== "ide")
    .reduce((sum, a) => sum + costOf(a).perMaaned, 0);
}

/** "12,4 kr." — én decimal, dansk komma. */
export const kr = (v: number) => `${v.toFixed(1).replace(".", ",")} kr.`;

/** Under halvtreds kroner om måneden er tallet i sig selv pointen. */
export const SMÅBELØB_UNDER = 50;
