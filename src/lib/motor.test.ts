import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sliberi from "../../data/lines/sliberi.json";
import { FLOW_NOMINAL, ORDRE } from "../../data/fremskrivning";
import { CLAUDE_AGENTER } from "./claude";
import { layoutLine } from "./layout";
import type { Besked } from "./samspil";
import {
  samlLog, samlSamtale, simulator,
  type Haendelse, type Opgave, type SimValg, type Svar, type TelemetriBillede,
} from "./telemetri";
import type { LineData } from "./types";

const layout = layoutLine(sliberi as LineData);
const T0 = new Date("2026-09-23T06:00:00").getTime();
const ordre = { ordreNr: ORDRE.ordreNr, estimeretKg: ORDRE.estimeretKg, kasser: ORDRE.kasser, nominalTPrT: FLOW_NOMINAL["FT-743"] };

/**
 * Kør en ordre med Claude som motor — men en falsk Claude, der svarer, som
 * testen siger. `svarer` får hver opgave, når den dukker op; undefined betyder
 * "svar ikke endnu".
 */
function koer(sekunder: number, svarer: (o: Opgave, nu: number) => Svar | null | undefined, valg: SimValg = {}) {
  const sim = simulator(layout, { ordre, motor: "claude", ...valg });
  let log: Haendelse[] = [];
  let samtale: Besked[] = [];
  const opgaver: Opgave[] = [];
  const set = new Set<number>();
  const billeder: TelemetriBillede[] = [];
  for (let i = 1; i <= sekunder; i++) {
    const nu = T0 + i * 1000;
    const b = sim.skridt(1000, nu);
    for (const o of b.opgaver) {
      if (!set.has(o.id)) { set.add(o.id); opgaver.push(o); }
      const sv = svarer(o, nu);
      if (sv !== undefined) sim.svar(o.id, sv);
    }
    log = samlLog(log, b.haendelser, 100_000);
    samtale = samlSamtale(samtale, b.samtale, 100_000);
    if (i % 5 === 0) billeder.push(b);
  }
  return { log: [...log].reverse(), samtale: [...samtale].reverse(), opgaver, billeder };
}

/** En Claude, der altid siger noget kort og vælger det, reglerne ville. */
const enig = (o: Opgave): Svar => ({
  beskeder: [{ til: o.modtagere[0], type: "iagttagelse", tekst: `Svar på: ${o.spoergsmaal.slice(0, 30)}`, grund: "Tallene." }],
  handling: o.standard,
  ms: 1200,
  model: "test",
});

// KB-3N går i stå ti minutter inde i ordren: sporet stoppes, og genstarten er
// Operatøragentens beslutning.
const stopKB = { planlagteStop: [{ wid: "636", fraS: 600, varighedS: 120 }], stopHverS: 1e9 };

describe("med Claude som motor", () => {
  it("spørges kun de agenter, der tænker med Claude", () => {
    const { opgaver } = koer(1800, enig, stopKB);
    assert.ok(opgaver.length > 0);
    for (const o of opgaver) assert.ok(CLAUDE_AGENTER.has(o.agent), `${o.agent} fik en opgave`);
  });

  it("står et spor, til Operatøragenten har besluttet, hvordan det startes", () => {
    // Ingen svar på genstarten: sporet bliver stående, også efter årsagen er væk.
    const { log } = koer(1200, (o) => (o.handlinger.includes("bagfra") ? undefined : null), stopKB);
    assert.ok(log.some((h) => h.tekst.startsWith("Stopper spor N")), "sporet blev aldrig stoppet");
    assert.ok(!log.some((h) => h.tekst.startsWith("Starter spor N")), "sporet startede uden en beslutning");
  });

  it("svarer Claude ikke, svarer reglerne — med deres skabelon", () => {
    const { samtale } = koer(1200, () => null, stopKB);
    assert.ok(samtale.length > 0);
    for (const b of samtale) assert.equal(b.kilde, "regel");
    assert.ok(samtale.some((b) => b.tekst === "Genstart spor N bagfra."));
  });

  it("Claude's beskeder står som Claude's, med svartid", () => {
    const { samtale } = koer(1200, enig, stopKB);
    const fra = samtale.filter((b) => b.kilde === "claude");
    assert.ok(fra.length > 0);
    for (const b of fra) {
      assert.ok(CLAUDE_AGENTER.has(b.fra), b.fra);
      assert.equal(b.ms, 1200);
    }
    // Driftsagent og Kædevagt taler stadig efter reglerne.
    assert.ok(samtale.some((b) => b.fra === "Driftsagent" && b.kilde === "regel"));
  });

  it("vælger Operatøragenten at vente, startes sporet først, når den har spurgt igen", () => {
    let foerste: number | null = null;
    const { log } = koer(1500, (o, nu) => {
      if (!o.handlinger.includes("vent")) return enig(o);
      if (foerste === null) { foerste = nu; return { ...enig(o), handling: "vent" }; }
      return { ...enig(o), handling: "bagfra" };
    }, stopKB);
    const start = log.find((h) => h.tekst.startsWith("Starter spor N"));
    assert.ok(foerste !== null && start, "ingen genstart");
    assert.ok(start.t - foerste! >= 60_000, `startede ${(start.t - foerste!) / 1000} s efter "vent"`);
    assert.match(start.tekst, /bagfra$/);
  });

  it("en handling, opgaven ikke tilbød, bliver reglernes", () => {
    const { log } = koer(1200, (o) => ({ ...enig(o), handling: "sprint" }), stopKB);
    const start = log.find((h) => h.tekst.startsWith("Starter spor N"));
    assert.ok(start);
    assert.match(start.tekst, /bagfra$/);
  });

  it("vælger den at skrue linjen ned for databasen, falder tons — og rækkerne gør ikke", () => {
    // Det er pointen: fødningen styrer tons, ikke rækker. Dataagenten bliver
    // spurgt igen, for køen vokser stadig.
    let skruet: number | null = null;
    const { billeder, opgaver } = koer(1500, (o, nu) => {
      // Svar først, når linjen kører — under opstarten løber der intet at skrue ned.
      if (o.handlinger.includes("skru_ned") && skruet === null) {
        if (nu < T0 + 600_000) return undefined;
        skruet = nu;
        return { ...enig(o), handling: "skru_ned" };
      }
      if (o.handlinger.includes("skru_ned")) return undefined;
      return enig(o);
    }, { tvungenFlaskehals: true, stopHverS: 1e9 });
    assert.ok(skruet !== null, "Operatøragenten blev aldrig spurgt");
    const foer = billeder.filter((b) => b.t < skruet! && b.ordre!.fase === "koerer").at(-1)!;
    const efter = billeder.filter((b) => b.t > skruet! + 120_000).at(-1)!;
    assert.ok(efter.flowPct! < foer.flowPct! * 0.75, `flow ${foer.flowPct} → ${efter.flowPct}`);
    assert.equal(efter.kaede!.raekkerPrS, foer.kaede!.raekkerPrS);
    const dataEfter = opgaver.filter((o) => o.agent === "Dataagent" && o.t > skruet!);
    assert.ok(dataEfter.length > 0, "Dataagenten blev ikke spurgt igen");
  });

  it("med reglerne som motor er der ingen opgaver", () => {
    const sim = simulator(layout, { ordre, ...stopKB });
    for (let i = 1; i <= 900; i++) assert.deepEqual(sim.skridt(1000, T0 + i * 1000).opgaver, []);
  });

  it("uden svar tænker agenten stadig — og det er noget, der sker", () => {
    const { billeder } = koer(900, () => undefined, stopKB);
    assert.ok(billeder.some((b) => b.uro.some((u) => u.tekst.endsWith("tænker"))));
  });
});
