// Modellen bag HUD'en på /ai.
//
// Bygges på serveren og sendes videre som almindelige objekter, så
// klientdelen intet skal regne ud. Det er med vilje: alt, der lyser eller
// bevæger sig på skærmen, skal kunne peges tilbage på en tilstand her — og
// den kommer fra pathState(), signalDelivery() og agentstatus, ikke fra
// noget, komponenten fandt på.
import { agentStates, decidedAgents, describeScope, type AgentState } from "./agents";
import { costOf, totalPerMaaned, SMÅBELØB_UNDER } from "./agent-cost";
import { firstRunBlocker, pathToProduction, runsFor, type AgentRun } from "./agent-runs";
import { machineState } from "./hologram";
import { layoutLine } from "./layout";
import { LINES } from "./lines";
import {
  channelReport, isDone, layoutOt, otLayerFor, pathState, registerMap,
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

/**
 * Aflæsningerne på ét led.
 *
 * Et led er et instrument, ikke en kasse med et ord. Alt her findes i
 * forvejen i OT-laget — kanal, registeradresse, kanalpladser, hvad leddet
 * venter på. Der regnes ikke noget nyt ud, og der opfindes ingenting: har
 * et led ingen tal, står listen tom.
 */
export interface LinkInstrument {
  /** Korte par i mono: "KANAL · AI1", "REGISTER · 30001–30002". */
  readings: { label: string; value: string }[];
  /**
   * Kanalpladserne på IO-kortet. `used` er de optagede. Tom, når der ikke
   * er et kort at tælle pladser på endnu.
   */
  slots?: { name: string; used: boolean }[];
  /** Det ene, leddet venter på. Kun sat når leddet ikke leverer. */
  waits?: string;
  /** Sensorens tag, så fladen kan slå en aflæsning op. Kun på måleren. */
  signalId?: string;
}

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
  /** Leddets egne tal. */
  instrument: LinkInstrument;
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
  /** Maskinerne fordelt på de tre tilstande. Det store udlæste tal. */
  tally: { drift: number; test: number; afventer: number; total: number };
  links: HudLink[];
  /**
   * Kædens samlede tone. Grøn kræver, at hvert led er i drift — `isDone()`
   * regner også `test` som leverende, så en hel kæde kan bestå af led, der
   * bare er sat op. Den er rav, ikke grøn.
   */
  chainTone: LinkTone;
  /** Hvor mange led der leverer, ud af hvor mange. */
  reach: { delivers: number; total: number };
  /** Bruddet — sidens vigtigste oplysning lige nu. null når kæden er hel. */
  broken: HudLink | null;
  agents: HudAgent[];
  decided: number;
  ideas: number;
  totalKr: number;
  /** Under grænsen er selve tallet pointen — det koster nærmest ingenting. */
  smaabeloeb: boolean;
  /**
   * Kørsler, nyeste først. Tom indtil fase 4, og det er sandheden: der er
   * ikke kaldt et API fra dette repo. Loggen står tom frem for at vise et
   * eksempel, der kunne forveksles med en kørsel, der havde fundet sted.
   */
  runs: AgentRun[];
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

/**
 * Kæden som helhed.
 *
 * Er der et brud, er tonen bruddets. Er kæden hel, afgør det svageste led
 * farven: ét led i test gør hele kæden til test. Grøn er forbeholdt en kæde,
 * hvor hvert eneste led er i drift.
 */
/**
 * Leddets egne tal, hentet hvor de allerede står.
 *
 * Måleren kender sit tag, sin model, sin kanal og sin registeradresse.
 * IO-kortet kender sine pladser. De øvrige led kender kun det, de venter
 * på — og det er også en aflæsning værd at vise.
 */
function instrumentFor(
  stepId: string,
  ot: OtLayout,
  blockedBy: string[],
): LinkInstrument {
  const sensor = ot.sensors[0];
  const cabinet = ot.cabinets[0];
  const waits = blockedBy[0];

  if (stepId === "sensor" && sensor) {
    const report = cabinet ? channelReport(cabinet, ot.sensors, 1) : null;
    const reg = report ? registerMap(report, [sensor])[0] : undefined;
    const readings = [
      { label: "Måler", value: sensor.model },
      { label: "Signal", value: sensor.signal },
    ];
    const kanal = report?.channel.get(sensor.id);
    if (kanal) readings.push({ label: "Kanal", value: kanal });
    if (reg) readings.push({ label: "Register", value: reg.address });
    return { readings, signalId: sensor.id, waits };
  }

  if (stepId === "io" && cabinet) {
    const report = channelReport(cabinet, ot.sensors, 1);
    // Pladserne tegnes som de er: optagede først, resten tomme. Tallene
    // kommer fra kanalregnskabet, ikke fra en optælling her.
    const slots = report.uses.flatMap((u) =>
      Array.from({ length: u.total }, (_, i) => ({
        name: `${u.kind.toUpperCase()}${i + 1}`,
        used: i < u.used,
      })),
    );
    const brugt = report.uses.reduce((n, u) => n + u.used, 0);
    const ialt = report.uses.reduce((n, u) => n + u.total, 0);
    return {
      readings: [
        { label: "Skab", value: cabinet.id },
        { label: "Pladser", value: `${brugt} / ${ialt}` },
      ],
      slots,
      waits,
    };
  }

  return { readings: [], waits };
}

export function chainToneOf(links: HudLink[]): LinkTone {
  if (links.length === 0) return "moerk";
  if (links.some((l) => l.broken)) return "brud";
  return links.every((l) => l.status === "active") ? "drift" : "test";
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
        instrument: instrumentFor(
          s.id,
          ot,
          delivers ? [] : s.blockedBy.map((n) => n.name),
        ),
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

  // Samme udregning som hologrammet bruger til punkttætheden.
  const tally = { drift: 0, test: 0, afventer: 0, total: 0 };
  for (const m of layout.machines) {
    if (m.kind === "person") continue;
    tally.total++;
    const st = machineState(m, ot);
    if (st === "paa-plads") tally.drift++;
    else if (st === "test") tally.test++;
    else tally.afventer++;
  }

  return {
    lineId,
    lineName: data.line.name,
    tally,
    links,
    chainTone: chainToneOf(links),
    reach: { delivers: links.filter((l) => l.delivers).length, total: links.length },
    broken: links.find((l) => l.broken) ?? null,
    agents,
    decided: decidedAgents(states).length,
    ideas: states.length - decidedAgents(states).length,
    totalKr: totalPerMaaned(states.map((st) => st.agent)),
    smaabeloeb: totalPerMaaned(states.map((st) => st.agent)) < SMÅBELØB_UNDER,
    runs: runsFor(),
  };
}
