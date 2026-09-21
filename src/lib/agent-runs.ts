// Kørselsloggen.
//
// Typen defineres nu, så den ligger fast, før den første agent kører. Der er
// ingen kørsler og ingen eksempelrækker — en opdigtet række i en log er værre
// end en tom log, for den ser ud som om noget har virket.
//
// Når fase 4 kommer, skriver Python-scriptet rækkerne, og de havner samme
// sted som resten af driftsdata. Indtil da er `runsFor()` tom med vilje.
import type { AgentInputState, AgentState } from "./agents";
import { isDone, pathState, type OtLayout } from "./ot";

export interface AgentRun {
  id: string;
  /** ISO-tid for kørslen. */
  tidspunkt: string;
  agentId: string;
  /**
   * Hvilken udgave af konteksten agenten arbejdede på. Uden den kan en
   * rapport ikke læses om et år — man ved ikke, hvad den så på.
   */
  contextVersion: string;
  inputTokens: number;
  outputTokens: number;
  /** Kroner, regnet på prisen den dag. Ikke et estimat. */
  prisDkk: number;
  /**
   * Blev rapporten godkendt? En afvist kørsel er stadig en kørsel og koster
   * stadig penge — den skal med i loggen, ikke skjules.
   */
  validering: "ok" | "afvist";
  /** Hvorfor den blev afvist. Tom når den blev godkendt. */
  afvistFordi?: string;
  /** Selve rapporten, som den blev skrevet. */
  rapport: string;
}

/**
 * Ingen kørsler endnu. Funktionen findes, så kaldstedet er på plads, og
 * fase 4 kun skal fylde den ud.
 */
export function runsFor(_agentId?: string): AgentRun[] {
  void _agentId;
  return [];
}

/**
 * Hvad der skal være på plads, før agenten kan køre første gang.
 *
 * Udledt af agentens egne inputs og af beslutningen — ikke en hardcodet
 * liste. Det er den sætning, den tomme log skal slutte med.
 */
export function firstRunBlocker(st: AgentState): string {
  if (st.agent.beslutning === "ide") return "at nogen beslutter, om agenten skal bygges";

  const unmet: AgentInputState[] = st.inputs.filter((i) => i.input.required && i.have < i.total);
  if (unmet.length > 0) {
    // Den fælles blokering, hvis der er en — ellers det første, der mangler.
    if (st.shared.length > 0) return st.shared.join(" → ");
    return unmet[0].input.need.toLowerCase();
  }
  if (st.agent.beslutning === "besluttet") return "at agenten bliver slået til";
  return "at fase 4 kører scriptet";
}

// ---------------------------------------------------------------------------

export interface ReadinessStep {
  label: string;
  done: boolean;
  detail: string;
}

/**
 * Vejen fra idé til kørende agent, trin for trin.
 *
 * Udledt af agentens egne inputs, af kæden og af beslutningen — ikke en
 * hardcodet liste. Ændrer infrastrukturen sig, flytter tjeklisten sig med.
 */
export function pathToProduction(st: AgentState, ot: OtLayout | null): ReadinessStep[] {
  const a = st.agent;
  const steps: ReadinessStep[] = [
    {
      label: "Besluttet",
      done: a.beslutning !== "ide",
      detail: a.beslutning === "ide"
        ? "Nogen skal sige ja til, at agenten skal bygges."
        : "Der er sagt ja til agenten.",
    },
  ];

  // Kædevagtens inputs *er* kæden — så ville trinnet stå to gange.
  const gaarGennemKaeden =
    a.scope.kind !== "chain" && a.inputs.some((i) => i.signalId || i.type);
  if (gaarGennemKaeden && ot) {
    const cabinet = ot.cabinets[0];
    const chain = cabinet
      ? pathState(ot.infrastructure, cabinet, ot.sensors[0]).filter((s) => s.id !== "dashboard")
      : [];
    const broken = chain.find((s) => !isDone(s.status));
    steps.push({
      label: "Kæden står til databasen",
      done: chain.length > 0 && !broken,
      detail: broken ? `Knækker ved ${broken.label}.` : "Måling når hele vejen til MSSQL.",
    });
  }

  for (const i of st.inputs) {
    if (!i.input.required) continue;
    steps.push({ label: i.label, done: i.have === i.total, detail: i.detail });
  }

  steps.push({
    label: "Slået til",
    done: a.beslutning === "aktiveret",
    detail: a.beslutning === "aktiveret"
      ? "Agenten er slået til på serveren."
      : "Ingen agent kører endnu.",
  });
  return steps;
}
