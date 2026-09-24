// Fremskrivningen: anlægget, som det ville se ud med signalerne inde.
//
// Det her er den eneste opdigtede tilstand i repoet, og den skal være til at
// kende. Reglen er derfor snæver: **intet tal opfindes.** Fremskrivningen
// rører kun ved udgangstilstanden — hvilke signaler der findes, og hvor langt
// kæden rækker — og lader så præcis de samme funktioner regne resten.
// pathState(), signalDelivery() og agentstatus ved ikke, at de er i en
// fremskrivning, og de får ingen særbehandling.
//
// Signalerne gribes ikke ud af luften. De kommer to steder fra:
//   - Agenternes egne inputs. Beder en agent om et driftssignal pr. maskine
//     i sit scope, sætter fremskrivningen netop det på netop de maskiner.
//   - Demoens kanaler i data/fremskrivning.ts. Viser demoen en temperatur på
//     en elevator, skal der sidde en måler, der kan levere den — ellers stod
//     der et tal på skærmen, ingen kanal kunne bære.
// Den viser altså ikke en drøm, men det anlæg, de besluttede agenter og
// demoens egne tal allerede forudsætter.
import { HAL } from "../../data/fremskrivning";
import { machinesInScope } from "./agents";
import type { Layout } from "./layout";
import { channelReport, sensorType } from "./ot";
import { kanalerFor } from "./telemetri";
import type { Agent, OtCabinet, OtHardware, OtLayer, OtSensor, OtSignal } from "./types";

/** Kanaler pr. IO-kort, som de kort, styklisten allerede har. */
const PR_KORT = { ai: 8, di: 16 } as const;

/**
 * De IO-kort, de fremskrevne signaler kræver ud over skabets egne.
 *
 * Fremskrivningen antager, at alt besluttet står — og beder de besluttede
 * agenter om flere signaler, end skabet har kanaler til, må den også antage
 * de kort, der skal til. Ellers ville den vise signaler som "på plads", der
 * aldrig kunne læses. Kortene hedder X…, som de opdigtede tags, og står med
 * modellen "Ikke valgt": de er en forudsætning, ikke et indkøb.
 */
function ekstraKort(cabinet: OtCabinet, sensorer: OtSensor[]): OtHardware[] {
  const rapport = channelReport(cabinet, sensorer, 1);
  const kort: OtHardware[] = [];
  for (const brug of rapport.uses) {
    const kind = brug.kind as "ai" | "di";
    const mangler = brug.needed - brug.total;
    if (mangler <= 0) continue;
    const antal = Math.ceil(mangler / PR_KORT[kind]);
    kort.push({
      id: `X-IO-${kind.toUpperCase()}`,
      category: "io",
      name: `${kind.toUpperCase()}-kort (forudsat)`,
      model: "Ikke valgt",
      qty: antal,
      status: "active",
      note: `Forudsat af fremskrivningen: ${mangler} ${kind.toUpperCase()}-signaler mere, end skabet har kanaler til.`,
      provides: { [kind]: PR_KORT[kind] },
    });
  }
  return kort;
}

/**
 * Katalogets signalart til den, OT-laget regner kanaler efter. IO-Link og
 * Modbus går på feltbussen og fylder ingen kanal.
 */
function signalOf(kind: string | undefined): OtSignal {
  if (kind === "DI") return "digital";
  if (kind === "Modbus" || kind === "IO-Link") return "feltbus";
  return "4-20 mA";
}

/**
 * Tag til et fremskrevet signal, fx "XI-743".
 *
 * Bogstaverne er ikke ISA-korrekte, og det er med vilje: et opdigtet tag
 * skal ikke kunne forveksles med et, nogen har tildelt. X står for, at det
 * ikke er aftalt.
 */
function tagFor(catalogType: string, wId: string, brugt: Set<string>): string {
  const kort = catalogType.slice(0, 1).toUpperCase();
  // To typer kan dele forbogstav. Så får den anden et nummer, frem for at
  // to målere får samme tag.
  let tag = `X${kort}-${wId}`;
  for (let n = 2; brugt.has(tag); n++) tag = `X${kort}${n}-${wId}`;
  brugt.add(tag);
  return tag;
}

/** Én fremskrevet måler. Samme form, hvor den end kommer fra. */
function fremskrevetSensor(catalogType: string, id: string, machineId: string, cabinetId: string): OtSensor {
  const kind = sensorType(catalogType);
  return {
    id,
    type: kind?.label ?? catalogType,
    catalogType,
    // Ingen model er valgt. Det skal kunne ses, også her.
    model: "Ikke valgt",
    signal: signalOf(kind?.signal),
    machineId,
    cabinetId,
    phase: 1,
    status: "active",
  };
}

/**
 * De signaler, de besluttede agenter beder om, sat på de maskiner de gælder.
 *
 * Kun `type`-inputs kan fremskrives: de siger "den slags signal, på hver
 * maskine i mit scope". Et `signalId` peger på en bestemt måler, der enten
 * findes eller ikke gør — den kan ikke opfindes. Et `dataset` er historik,
 * ikke et signal. Et `chainStep` er kæden, som rejses for sig.
 */
function ekstraSensorer(layer: OtLayer, layout: Layout, agents: Agent[]): OtSensor[] {
  const cabinet = layer.cabinets[0];
  if (!cabinet) return [];

  const findes = new Set(layer.sensors.map((s) => `${s.catalogType}@${s.machineId}`));
  const brugt = new Set(layer.sensors.map((s) => s.id));
  const ekstra: OtSensor[] = [];
  const saet = (catalogType: string, wId: string) => {
    const nøgle = `${catalogType}@${wId}`;
    if (findes.has(nøgle)) return;
    findes.add(nøgle);
    ekstra.push(fremskrevetSensor(catalogType, tagFor(catalogType, wId, brugt), wId, cabinet.id));
  };

  // Det, agenterne beder om.
  for (const agent of agents) {
    if (agent.beslutning === "ide") continue;
    for (const input of agent.inputs) {
      if (!input.type) continue;
      for (const m of machinesInScope(agent, layout)) {
        for (const wId of m.wIds) saet(input.type, wId);
      }
    }
  }

  // Målerne bag demoens tal. Én måler pr. slags pr. maskine: en
  // hældningsmåler, der melder både langs og tværs, er ét udstyr. Og målere,
  // hvis tal ikke er drift — analyseudstyret på kastebordene — er med, selv
  // om deres tal ikke står på maskinen.
  for (const m of layout.machines) {
    if (m.kind === "person" || m.wIds.length === 0) continue;
    for (const k of kanalerFor(m)) saet(k.maaler, m.wIds[0]);
  }

  // Hallen er ikke en maskine. Dens målere hænger ved skabet, og de får
  // deres eget tag, så de ikke forveksles med maskinen, skabet står ved.
  for (const k of HAL) {
    const id = `X${k.maaler.slice(0, 1).toUpperCase()}-HAL`;
    if (brugt.has(id)) continue;
    brugt.add(id);
    ekstra.push(fremskrevetSensor(k.maaler, id, cabinet.nearMachine, cabinet.id));
  }
  return ekstra;
}

/**
 * OT-laget som det ville være, hvis alt besluttet stod og virkede.
 *
 * Fire greb, og ikke flere:
 *   1. De signaler, agenterne beder om og demoens tal forudsætter, findes.
 *   2. Alle signaler er i drift frem for i test eller på tegnebrættet.
 *   3. Skabet står, og kæden ud af hallen er rejst.
 *   4. Skabet har de IO-kort, signalerne kræver — mærket som forudsat.
 *
 * Alt andet — kanaler, registre, kabellængder, hvem der leverer, hvad en
 * agent kan — udledes bagefter af de samme funktioner som altid.
 */
export function fremskrivLayer(layer: OtLayer, layout: Layout, agents: Agent[]): OtLayer {
  const sensors = [
    ...layer.sensors.map((s) => ({ ...s, status: "active" as const })),
    ...ekstraSensorer(layer, layout, agents),
  ];
  return {
    ...layer,
    // Skabet står, og det har de kort, signalerne kræver. De forudsatte kort
    // kommer oven i styklisten — den rigtige stykliste røres ikke.
    cabinets: layer.cabinets.map((c) => ({
      ...c,
      status: "active" as const,
      hardware: [...c.hardware, ...ekstraKort(c, sensors)],
    })),
    sensors,
  };
}

/**
 * En besluttet agent er slået til i fremskrivningen.
 *
 * En idé er stadig en idé: ingen har sagt ja til den, og en fremskrivning
 * af det besluttede må ikke smugle uafklarede agenter med ind.
 */
export function fremskrivAgenter(agents: Agent[]): Agent[] {
  return agents.map((a) =>
    a.beslutning === "besluttet" ? { ...a, beslutning: "aktiveret" as const } : a,
  );
}
