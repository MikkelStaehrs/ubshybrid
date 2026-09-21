// Modellen bag HUD'en på /ai.
//
// Bygges på serveren og sendes videre som almindelige objekter, så
// klientdelen intet skal regne ud. Det er med vilje: alt, der lyser eller
// bevæger sig på skærmen, skal kunne peges tilbage på en tilstand her — og
// den kommer fra pathState(), signalDelivery() og agentstatus, ikke fra
// noget, komponenten fandt på.
import { agentStates, decidedAgents, describeScope, type AgentState } from "./agents";
import { costOf, totalPerMaaned } from "./agent-cost";
import { firstRunBlocker, pathToProduction } from "./agent-runs";
import { layoutLine } from "./layout";
import { LINES } from "./lines";
import {
  isDone, layoutOt, otLayerFor, pathState,
  type OtLayout,
} from "./ot";
import type { AgentEngine, OtStatus } from "./types";

/**
 * HUD'en kender tre tilstande og ikke flere.
 *
 * Under motorhjelmen har OT-laget seks (`active` … `idea`) og agenterne
 * fem, og de er uændrede — de bærer beslutninger og indkøb, som hører til
 * i dokumentvisningen. På en skærm i et mødelokale er det spørgsmål kun
 * ét: virker det, prøver vi det af, eller venter vi stadig?
 *
 * Det her er det eneste sted, de mange bliver til de tre.
 */
export type HudState = "paa-plads" | "test" | "afventer";

export const HUD_STATE_LABEL: Record<HudState, string> = {
  "paa-plads": "PÅ PLADS",
  test: "TEST",
  afventer: "AFVENTER",
};

/** OT-status til HUD-tilstand. Alt der ikke står færdigt, afventer. */
export function hudState(status: OtStatus): HudState {
  if (status === "active") return "paa-plads";
  if (status === "test") return "test";
  return "afventer";
}

/**
 * Agentstatus til samme tre ord. "Klar" er en agent, der kunne køre, men
 * ikke er slået til — den prøves af, ikke mere. Resten afventer.
 */
export function hudAgentState(status: AgentState["status"]): HudState {
  if (status === "running") return "paa-plads";
  if (status === "ready") return "test";
  return "afventer";
}

/**
 * Hvordan et led tegnes. "drift" er grøn og forbeholdt led, der leverer i
 * drift. "test" er rav: signalet kommer, men anlægget er ikke i drift endnu.
 * Samme skel som i OT Layer, hvor `active` og `test` heller ikke er den
 * samme farve.
 */
export type LinkTone = "drift" | "test" | "brud" | "moerk";

export interface HudLink {
  id: string;
  label: string;
  status: OtStatus;
  /** Ét af de tre HUD-ord. */
  state: HudState;
  statusLabel: string;
  tone: LinkTone;
  /** Leverer leddet? Det er det, der afgør, om pulsen når frem. */
  delivers: boolean;
  /** Sat på præcis ét led: det første, der ikke leverer. */
  broken: boolean;
  /** Det ene, leddet afventer. Kun på bruddet. Et navn, ikke en sætning. */
  next?: string;
}

export interface HudAgent {
  id: string;
  name: string;
  til: string;
  svarerPaa: string;
  status: AgentState["status"];
  /** Ét af de tre HUD-ord. Den fulde status står i dokumentvisningen. */
  state: HudState;
  statusLabel: string;
  engine: AgentEngine;
  cadence: string;
  scopeLabel: string;
  /** Vejen til drift. `done` af `total` — buen på ringen. */
  done: number;
  total: number;
  /** Tænkt, ikke besluttet: stiplet omrids uden lys. */
  idea: boolean;
  /** Besluttet, men kører ikke: ånder svagt. */
  sovende: boolean;
  /** Hvad første kørsel kræver. Udledt. */
  blocker: string;
  /** Kroner pr. måned. 0 for kode-agenter. */
  kr: number;
  gratis: string | null;
}

export interface HudModel {
  lineId: string;
  lineName: string;
  links: HudLink[];
  /** Hvor mange led der leverer, ud af hvor mange. */
  reach: { delivers: number; total: number };
  /** Bruddet — sidens vigtigste oplysning lige nu. null når kæden er hel. */
  broken: HudLink | null;
  agents: HudAgent[];
  decided: number;
  ideas: number;
  totalKr: number;
}

/**
 * Det ene næste skridt ved bruddet.
 *
 * Udledt af de infrastrukturnoder, der blokerer leddet — den første, der
 * ikke er på plads. Er der ingen node, siger vi det leddet venter på, frem
 * for at finde på et skridt.
 */
function nextStepAt(ot: OtLayout, stepId: string): string | undefined {
  const cabinet = ot.cabinets[0];
  if (!cabinet) return undefined;
  const st = pathState(ot.infrastructure, cabinet, ot.sensors[0]).find((s) => s.id === stepId);
  if (!st) return undefined;

  // Først: den infrastruktur, der står i vejen for netop dette led.
  const first = st.blockedBy[0];
  if (first) return first.name;

  // Ellers er det skabet selv, der ikke står endnu. Navn og mærkning — hvad
  // der skal ske med det, hører til i dokumentvisningen.
  if (!isDone(cabinet.status)) return `${cabinet.name} · ${cabinet.id}`;
  return undefined;
}

function toneOf(status: OtStatus, delivers: boolean, broken: boolean): LinkTone {
  if (broken) return "brud";
  if (!delivers) return "moerk";
  // Grøn er kun for det, der kører i drift. Test er rav.
  return status === "active" ? "drift" : "test";
}

export function hudModel(lineId: string): HudModel | null {
  const data = LINES[lineId];
  if (!data) return null;
  const layout = layoutLine(data);
  const otData = otLayerFor(lineId);
  const ot = otData ? layoutOt(otData, layout, lineId) : null;
  const states = agentStates(lineId, layout, ot);

  const links: HudLink[] = [];
  if (ot && ot.cabinets[0]) {
    const sensor = ot.sensors[0];
    // Dashboardet er for mennesker. Kæden, agenterne venter på, ender i MSSQL.
    const chain = pathState(ot.infrastructure, ot.cabinets[0], sensor)
      .filter((s) => s.id !== "dashboard");
    let alreadyBroken = false;
    for (const s of chain) {
      const delivers = isDone(s.status);
      const broken = !delivers && !alreadyBroken;
      if (broken) alreadyBroken = true;
      links.push({
        id: s.id,
        label: s.label,
        status: s.status,
        state: hudState(s.status),
        statusLabel: HUD_STATE_LABEL[hudState(s.status)],
        tone: toneOf(s.status, delivers, broken),
        delivers,
        broken,
        next: broken ? nextStepAt(ot, s.id) : undefined,
      });
    }
  }

  const agents: HudAgent[] = states.map((st) => {
    const steps = pathToProduction(st, ot);
    const c = costOf(st.agent);
    const idea = st.agent.beslutning === "ide";
    return {
      id: st.agent.id,
      name: st.agent.name,
      til: st.agent.til,
      svarerPaa: st.agent.svarerPaa,
      status: st.status,
      state: hudAgentState(st.status),
      statusLabel: HUD_STATE_LABEL[hudAgentState(st.status)],
      engine: st.agent.engine,
      cadence: st.agent.cadence,
      scopeLabel: describeScope(st.agent),
      done: steps.filter((s) => s.done).length,
      total: steps.length,
      idea,
      // Besluttet, men kører ikke. Den ånder — den er ikke død.
      sovende: !idea && st.agent.beslutning !== "aktiveret",
      blocker: firstRunBlocker(st),
      kr: c.perMaaned,
      gratis: c.gratis,
    };
  });

  return {
    lineId,
    lineName: data.line.name,
    links,
    reach: { delivers: links.filter((l) => l.delivers).length, total: links.length },
    broken: links.find((l) => l.broken) ?? null,
    agents,
    decided: decidedAgents(states).length,
    ideas: states.length - decidedAgents(states).length,
    totalKr: totalPerMaaned(states.map((st) => st.agent)),
  };
}
