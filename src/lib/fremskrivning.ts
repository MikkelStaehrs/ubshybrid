// Fremskrivningen: anlægget, som det ville se ud med signalerne inde.
//
// Det her er den eneste opdigtede tilstand i repoet, og den skal være til at
// kende. Reglen er derfor snæver: **intet tal opfindes.** Fremskrivningen
// rører kun ved udgangstilstanden — hvilke signaler der findes, og hvor langt
// kæden rækker — og lader så præcis de samme funktioner regne resten.
// pathState(), signalDelivery() og agentstatus ved ikke, at de er i en
// fremskrivning, og de får ingen særbehandling.
//
// Signalerne gribes ikke ud af luften. De kommer fra agenternes egne inputs:
// beder en agent om et driftssignal pr. maskine i sit scope, så sætter
// fremskrivningen netop det på netop de maskiner. Den viser altså ikke en
// drøm, men det anlæg, de besluttede agenter allerede har bedt om.
import { machinesInScope } from "./agents";
import type { Layout } from "./layout";
import { channelReport, sensorType } from "./ot";
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

/** Katalogets signalart til den, OT-laget regner kanaler efter. */
function signalOf(kind: string | undefined): OtSignal {
  return kind === "DI" ? "digital" : "4-20 mA";
}

/**
 * Tag til et fremskrevet signal, fx "XI-743".
 *
 * Bogstaverne er ikke ISA-korrekte, og det er med vilje: et opdigtet tag
 * skal ikke kunne forveksles med et, nogen har tildelt. X står for, at det
 * ikke er aftalt.
 */
function tagFor(catalogType: string, wId: string): string {
  const kort = catalogType.slice(0, 1).toUpperCase();
  return `X${kort}-${wId}`;
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
  const cabinetId = layer.cabinets[0]?.id;
  if (!cabinetId) return [];

  const findes = new Set(layer.sensors.map((s) => `${s.catalogType}@${s.machineId}`));
  const ekstra: OtSensor[] = [];

  for (const agent of agents) {
    if (agent.beslutning === "ide") continue;
    for (const input of agent.inputs) {
      if (!input.type) continue;
      const kind = sensorType(input.type);
      for (const m of machinesInScope(agent, layout)) {
        for (const wId of m.wIds) {
          const nøgle = `${input.type}@${wId}`;
          if (findes.has(nøgle)) continue;
          findes.add(nøgle);
          ekstra.push({
            id: tagFor(input.type, wId),
            type: kind?.label ?? input.type,
            catalogType: input.type,
            // Ingen model er valgt. Det skal kunne ses, også her.
            model: "Ikke valgt",
            signal: signalOf(kind?.signal),
            machineId: wId,
            cabinetId,
            phase: 1,
            status: "active",
          });
        }
      }
    }
  }
  return ekstra;
}

/**
 * OT-laget som det ville være, hvis alt besluttet stod og virkede.
 *
 * Fire greb, og ikke flere:
 *   1. De signaler, agenterne beder om, findes.
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
