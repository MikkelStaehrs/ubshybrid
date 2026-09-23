// Modellen bag HUD'en på /ai.
//
// Bygges på serveren og sendes videre som almindelige objekter, så
// klientdelen intet skal regne ud. Det er med vilje: alt, der lyser eller
// bevæger sig på skærmen, skal kunne peges tilbage på en tilstand her — og
// den kommer fra pathState(), signalDelivery() og agentstatus, ikke fra
// noget, komponenten fandt på.
import { FLOW_NOMINAL } from "../../data/fremskrivning";
import { agentState, agentsFor, decidedAgents, describeScope, lineOpsFor, type AgentState } from "./agents";
import { nominalFor } from "./flow";
import { costOf, totalPerMaaned, SMÅBELØB_UNDER } from "./agent-cost";
import { firstRunBlocker, pathToProduction, runsFor, type AgentRun } from "./agent-runs";
import { fremskrivAgenter, fremskrivLayer } from "./fremskrivning";
import { machineState } from "./hologram";
import { layoutLine } from "./layout";
import { LINES } from "./lines";
import {
  channelReport, isDone, layoutOt, otLayerFor, pathState, registerMap, sensorType, weakest,
  type OtLayout, type PathStepState,
} from "./ot";
import type { AgentEngine, OtPathStep, OtStatus } from "./types";

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
  /**
   * Korte par i mono: "KANAL · AI1", "REGISTER · 30001–30002". `tone`
   * farver tallet, når det er noget at lægge mærke til — et underskud, et
   * forudsat kort.
   */
  readings: { label: string; value: string; tone?: "test" | "brud" }[];
  /**
   * Kanalpladserne på IO-kortet. `used` er de optagede. Tom, når der ikke
   * er et kort at tælle pladser på endnu.
   */
  slots?: { name: string; used: boolean }[];
  /** Det ene, leddet venter på. Kun sat når leddet ikke leverer. */
  waits?: string;
  /** Sensorens tag, så fladen kan slå en aflæsning op. Kun på måleren. */
  signalId?: string;
  /**
   * Målerne efter slags, flest først: "Temperatur 17". Sat, når der er mere
   * end én måler — så er leddet ikke én måler, men alle.
   */
  maalere?: { label: string; antal: number }[];
}

export interface HudLink {
  /** HUD'ens eget id. "din" er IO-kort og kobler. */
  id: string;
  /** Trinnene i OT-laget, leddet dækker. Ét, bortset fra DIN-skabet. */
  trin: OtPathStep[];
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
  /**
   * Hvad der løber ud af leddet, når det afhænger af målerne. Kun på
   * sensoren: én flowmåler sender 4–20 mA, et helt anlæg sender flere slags.
   */
  bane?: string;
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
  /** Agenten griber ind i driften i stedet for at skrive en rapport. */
  styring: boolean;
  /** Hvad første kørsel kræver. Udledt. */
  blocker: string;
  /** Kroner pr. måned. 0 for kode-agenter. */
  kr: number;
  gratis: string | null;
}

/**
 * Gennemløbet: vægt pr. time (W/HR). Procenten fra måleren bliver først til
 * tons, når nogen har sagt, hvad 100 % er — og modellen ved, hvem der har.
 */
export interface HudFlow {
  signal: string | null;
  /** 100 %-punktet i `rateUnit`. null når ingen har sagt det. */
  nominal: number | null;
  /**
   * Hvor tallet kommer fra. "aftalt" står i line-config.ts; "skoen" er
   * demoens antagelse i data/fremskrivning.ts og skal mærkes som sådan.
   */
  kilde: "aftalt" | "skoen" | null;
  rateUnit: string;
}

export interface HudModel {
  lineId: string;
  lineName: string;
  /** Maskinerne fordelt på de tre tilstande. Det store udlæste tal. */
  tally: { drift: number; test: number; afventer: number; total: number };
  /** Hver maskines HUD-tilstand, nøglet på maskinens id. Grundlaget for `tally`. */
  maskinTilstand: Record<string, HudState>;
  flow: HudFlow;
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
  /**
   * Er det her en fremskrivning frem for anlægget, som det står?
   *
   * Modellen bærer det selv, så fladen ikke kan komme til at vise opdigtede
   * tal uden mærkatet. Se src/lib/fremskrivning.ts.
   */
  fremskrevet: boolean;
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
 * Kæden, som den står på skærmen.
 *
 * OT-laget har seks trin, og de er uændrede — de bærer indkøb og
 * afhængigheder, og dokumentvisningen viser dem. På en skærm i et
 * mødelokale er "kobler" og "edge" ord, man skal have forklaret. IO-kortet og
 * kobleren sidder på den samme DIN-skinne i det samme skab, så de er ét led:
 * DIN-skabet. Edge er et program på en server i racket — det hedder Server.
 * Det er det eneste sted, trinnene bliver til led.
 */
const HUD_LED: { id: string; label: string; trin: OtPathStep[] }[] = [
  { id: "sensor", label: "Sensor", trin: ["sensor"] },
  { id: "din", label: "DIN-skab", trin: ["io", "kobler"] },
  { id: "edge", label: "Server", trin: ["edge"] },
  { id: "mssql", label: "MSSQL", trin: ["mssql"] },
];

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

  // Mange målere: leddet er dem alle, talt efter slags. Én: leddet er den,
  // med model, kanal og registeradresse.
  if (stepId === "sensor" && sensor && ot.sensors.length > 1) {
    const antal = new Map<string, number>();
    for (const s of ot.sensors) {
      const label = sensorType(s.catalogType ?? "")?.kort ?? s.type;
      antal.set(label, (antal.get(label) ?? 0) + 1);
    }
    const maalere = [...antal]
      .map(([label, n]) => ({ label, antal: n }))
      .sort((a, b) => b.antal - a.antal || a.label.localeCompare(b.label, "da"));
    // Ingen aflæsning øverst: leddet er ikke én måler længere, og flowet
    // har sit eget panel.
    return {
      readings: [{ label: "Målere", value: String(ot.sensors.length) }],
      maalere,
      waits,
    };
  }

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
    // Analoge og digitale kanaler hver for sig. Lagt sammen skjulte de et
    // underskud: "17 / 24" så ud som plads, mens 13 driftssignaler ingen
    // kanal havde, fordi de analoge pladser var ledige.
    // Skabet står i leddets navn, og pladserne skal have luften.
    const readings: LinkInstrument["readings"] = [];
    for (const u of report.uses) {
      if (u.total === 0 && u.needed === 0) continue;
      readings.push({ label: u.kind.toUpperCase(), value: `${u.used} / ${u.total}` });
    }
    const mangler = report.uses.reduce((n, u) => n + Math.max(0, u.needed - u.total), 0);
    if (mangler > 0) readings.push({ label: "Mangler", value: `${mangler} kanaler`, tone: "brud" });
    const forudsat = cabinet.hardware.filter((h) => h.id.startsWith("X-"));
    if (forudsat.length > 0) {
      readings.push({
        label: "Forudsat",
        value: forudsat.map((h) => `+${h.qty} ${h.id.replace("X-IO-", "")}`).join(" · "),
        tone: "test",
      });
    }
    return { readings, slots, waits };
  }

  return { readings: [], waits };
}

/** Signalarterne, målerne sender ind i skabet, i få ord. */
const SIGNAL_ORD: Record<string, string> = {
  "4-20 mA": "4–20 mA", "0-10 V": "0–10 V", digital: "Digital", feltbus: "Feltbus",
};
function baneFra(ot: OtLayout): string | undefined {
  const arter = [...new Set(ot.sensors.map((s) => SIGNAL_ORD[s.signal] ?? s.signal))];
  return arter.length > 0 ? arter.join(" · ") : undefined;
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

function taelTilstande(tilstande: HudState[]): HudModel["tally"] {
  return {
    drift: tilstande.filter((s) => s === "paa-plads").length,
    test: tilstande.filter((s) => s === "test").length,
    afventer: tilstande.filter((s) => s === "afventer").length,
    total: tilstande.length,
  };
}

/**
 * Det store tal, når fremskrivningens telemetri er inde.
 *
 * En maskine, simulatoren giver kanaler, har sine signaler på plads — også
 * når den står. Et stop er ikke "afventer": maskinen findes og melder, at
 * den står. Stoppet vises for sig, i overskriften og i driftspanelet.
 *
 * Uden simuleret telemetri er det modellens eget tal, uændret. Oversættelsen
 * sker her og ikke i komponenten, så der stadig kun er ét sted.
 */
export function tallyMedTelemetri(
  model: Pick<HudModel, "tally" | "maskinTilstand">,
  billede: { simuleret: boolean; maskiner: { id: string; kanaler: unknown[] }[] },
): HudModel["tally"] {
  if (!billede.simuleret) return model.tally;
  const medKanaler = new Set(billede.maskiner.filter((m) => m.kanaler.length > 0).map((m) => m.id));
  return taelTilstande(
    Object.entries(model.maskinTilstand).map(([id, s]) => (medKanaler.has(id) ? "paa-plads" : s)),
  );
}

/**
 * Kalibreringen til W/HR. Et aftalt tal i line-config.ts vinder altid. Kun
 * i fremskrivningen falder vi tilbage på demoens skøn — i den rigtige
 * visning står der "Ikke udfyldt", indtil tallet er aftalt.
 */
function flowFor(lineId: string, ot: OtLayout | null, fremskrevet: boolean): HudFlow {
  const ops = lineOpsFor(lineId);
  const signal = ot?.sensors.find((s) => s.catalogType === "flow")?.id ?? null;
  const rateUnit = ops?.rateUnit ?? "t/hr";
  const aftalt = signal ? nominalFor(ops, signal) : null;
  if (aftalt !== null) return { signal, nominal: aftalt, kilde: "aftalt", rateUnit };
  const skoen = fremskrevet && signal ? FLOW_NOMINAL[signal] ?? null : null;
  return { signal, nominal: skoen, kilde: skoen !== null ? "skoen" : null, rateUnit };
}

/**
 * Navnet på skærmen for et trin eller et af kædens egne led — "kobler"
 * bliver "DIN-skab". Alt, der skal nævne et led, spørger her, så de ord,
 * HUD_LED oversætter væk, ikke smutter ind ad en anden dør.
 */
export function ledNavn(links: Pick<HudLink, "trin" | "label">[], id: string): string {
  return links.find((l) => (l.trin as string[]).includes(id))?.label ?? "Kæden";
}

/**
 * Kædens led, udledt af OT-laget. Eksporteret for testens skyld: reglen om,
 * at DIN-skabet ikke er stærkere end sit svageste trin, skal kunne prøves på
 * et lag, hvor netop det er tilfældet.
 */
export function hudLinks(ot: OtLayout): HudLink[] {
  const links: HudLink[] = [];
  if (!ot.cabinets[0]) return links;
  const sensor = ot.sensors[0];
  // Dashboardet er for mennesker. Kæden, agenterne venter på, ender i MSSQL.
  const chain = new Map<OtPathStep, PathStepState>(
    pathState(ot.infrastructure, ot.cabinets[0], sensor).map((s) => [s.id, s]),
  );
  let alreadyBroken = false;
  for (const led of HUD_LED) {
    const trin = led.trin.map((id) => chain.get(id)!);
    // Et led, der dækker flere trin, er ikke stærkere end det svageste —
    // og det venter på det, det første trin, der ikke leverer, venter på.
    const status = weakest(trin.map((s) => s.status));
    const delivers = trin.every((s) => isDone(s.status));
    const broken = !delivers && !alreadyBroken;
    if (broken) alreadyBroken = true;
    const hager = trin.find((s) => !isDone(s.status));
    const venter = trin.flatMap((s) => s.blockedBy.map((n) => n.name));
    links.push({
      id: led.id,
      trin: led.trin,
      label: led.label,
      status,
      state: hudState(status),
      statusLabel: HUD_STATE_LABEL[hudState(status)],
      tone: toneOf(status, delivers, broken),
      delivers,
      broken,
      next: broken && hager ? nextStepAt(ot, hager.id) : undefined,
      // DIN-skabets tal er IO-kortets. Kobleren har ingen ud over sin
      // ydelse, og den kommer fra telemetrien.
      instrument: instrumentFor(led.trin[0], ot, delivers ? [] : [...new Set(venter)]),
      bane: led.id === "sensor" ? baneFra(ot) : undefined,
    });
  }
  return links;
}

export function hudModel(lineId: string, opts?: { fremskriv?: boolean }): HudModel | null {
  const data = LINES[lineId];
  if (!data) return null;
  const fremskrevet = opts?.fremskriv === true;
  const layout = layoutLine(data);
  const raa = otLayerFor(lineId);
  const agenter = fremskrevet ? fremskrivAgenter(agentsFor(lineId)) : agentsFor(lineId);

  // Fremskrivningen rører kun udgangstilstanden. Alt herefter er de samme
  // funktioner som altid — de ved ikke, at de er i en fremskrivning.
  const otData = raa && fremskrevet ? fremskrivLayer(raa, layout, agenter) : raa;
  let ot = otData ? layoutOt(otData, layout, lineId) : null;
  if (ot && fremskrevet) {
    ot = { ...ot, infrastructure: ot.infrastructure.map((n) => ({ ...n, status: "active" })) };
  }
  const states = agenter.map((a) => agentState(a, layout, ot));

  const links = ot ? hudLinks(ot) : [];

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
      styring: st.agent.role === "styring",
      blocker: firstRunBlocker(st),
      kr: c.perMaaned,
      gratis: c.gratis,
    };
  });

  // Samme udregning som hologrammet bruger til punkttætheden.
  const maskinTilstand: Record<string, HudState> = {};
  for (const m of layout.machines) {
    if (m.kind === "person") continue;
    maskinTilstand[m.id] = machineState(m, ot);
  }
  const tally = taelTilstande(Object.values(maskinTilstand));

  return {
    lineId,
    lineName: data.line.name,
    tally,
    maskinTilstand,
    flow: flowFor(lineId, ot, fremskrevet),
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
    fremskrevet,
  };
}
