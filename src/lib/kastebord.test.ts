import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sliberi from "../../data/lines/sliberi.json";
import { FLOW_NOMINAL, KASTEBORDET, ORDRE } from "../../data/fremskrivning";
import { layoutLine } from "./layout";
import type { Besked } from "./samspil";
import {
  kanalerFor, samlLog, samlSamtale, simulator, virkning,
  type Anbefaling, type Haendelse, type Simulator, type TelemetriBillede,
} from "./telemetri";
import type { LineData } from "./types";

const layout = layoutLine(sliberi as LineData);
const T0 = new Date("2026-09-23T06:00:00").getTime();
const ordre = { ordreNr: ORDRE.ordreNr, estimeretKg: ORDRE.estimeretKg, kasser: ORDRE.kasser, nominalTPrT: FLOW_NOMINAL["FT-743"] };

/**
 * Kør en ordre og lad `hver` se hvert billede. Svarer den true, stopper
 * kørslen. Operatøren er testen: den udfører eller afviser, som den vil.
 */
function koer(hver: (b: TelemetriBillede, sim: Simulator) => boolean | void, sekunder = 14 * 3600) {
  const sim = simulator(layout, { ordre, stopHverS: 1e9 });
  let log: Haendelse[] = [];
  let samtale: Besked[] = [];
  let b: TelemetriBillede | null = null;
  for (let i = 1; i <= sekunder; i++) {
    b = sim.skridt(1000, T0 + i * 1000);
    log = samlLog(log, b.haendelser, 100_000);
    samtale = samlSamtale(samtale, b.samtale, 100_000);
    if (hver(b, sim)) break;
  }
  return { b: b!, sim, log, samtale };
}

/** Kør, til den første anbefaling af en bestemt slags står åben. */
function tilFoersteAnbefaling(passer: (a: Anbefaling) => boolean = () => true) {
  let fundet: Anbefaling | null = null;
  const r = koer((b) => {
    fundet = b.anbefalinger.find((a) => a.status === "aaben" && passer(a)) ?? null;
    return fundet !== null;
  });
  assert.ok(fundet, "ordren gav ingen anbefaling");
  return { ...r, anbefaling: fundet as Anbefaling };
}

describe("kastebordets indstillinger", () => {
  it("mere hældning eller luft skiller skarpere: mindre FV3, mere udskud", () => {
    // Det er afvejningen, en agent anbefaler efter.
    assert.ok(virkning(1, 0).fv3 < 0 && virkning(1, 0).udskud > 0);
    assert.ok(virkning(0, 10).fv3 < 0 && virkning(0, 10).udskud > 0);
    const ingen = virkning(0, 0);
    assert.ok(ingen.fv3 === 0 && ingen.udskud === 0);
  });

  it("står i billedet for hvert kastebord, ved standardindstillingerne", () => {
    const { b } = koer((_, __) => true, 5);
    const kb = layout.machines.filter((m) => /^kb[-\s]/i.test(m.name));
    for (const m of kb) {
      const ind = b.indstillinger[m.id];
      assert.ok(ind, m.name);
      assert.equal(ind.tvaers, kanalerFor(m).find((k) => k.id === "tvaers")!.nominal);
    }
  });
});

describe("analysen", () => {
  it("melder ikke alarm fra et bord, der ikke står, hvor det er sat", () => {
    // Under en start er luften på vej op, og frøet skilles dårligt af den
    // grund. Det er ikke en fejl på bordet — som en maskine i indkøring,
    // der ikke melder "for langsom".
    let alarmer = 0;
    let koertS = 0;
    koer((b) => {
      for (const h of b.haendelser) {
        if (h.niveau !== "alarm" || !/^(FV3|NOTS) /.test(h.tekst) || h.t !== b.t) continue;
        const m = b.maskiner.find((x) => x.kort === h.hvor)!;
        alarmer++;
        for (const id of ["tvaers", "luft"] as const) {
          const maalt = m.kanaler.find((k) => k.spec.id === id)!.value!;
          const sat = b.indstillinger[m.id][id];
          assert.ok(Math.abs(maalt - sat) <= KASTEBORDET.trin[id], `${h.hvor} ${h.tekst} ${id}: målt ${maalt}, sat ${sat}`);
        }
      }
      if (b.ordre?.fase === "koerer") koertS++;
      return koertS > 3 * 3600;
    });
    assert.ok(alarmer > 0, "ingen alarm at prøve reglen på");
  });
});

describe("en anbefaling", () => {
  it("holder sig ét trin fra, hvor indstillingen står, og inden for kanalens grænser", () => {
    const { anbefaling: a } = tilFoersteAnbefaling();
    assert.ok(Math.abs(Math.abs(a.tilVaerdi - a.fraVaerdi) - KASTEBORDET.trin[a.parameter]) < 1e-9);
    const spec = kanalerFor(layout.machines.find((m) => m.id === a.maskine)!).find((k) => k.id === a.parameter)!;
    assert.ok(a.tilVaerdi > spec.alarmLav! && a.tilVaerdi < spec.alarmHoej!);
  });

  it("bygger ikke på et bord, der ikke står, hvor det er sat", () => {
    // Lige efter en start er luften på vej op, og bordet skiller dårligt af
    // den grund. En anbefaling om at hæve hældningen dér retter det forkerte.
    const set = new Set<number>();
    koer((b) => {
      for (const a of b.anbefalinger) {
        if (set.has(a.id)) continue;
        set.add(a.id);
        const m = b.maskiner.find((x) => x.id === a.maskine)!;
        for (const id of ["tvaers", "luft"] as const) {
          const maalt = m.kanaler.find((k) => k.spec.id === id)!.value!;
          const sat = b.indstillinger[a.maskine][id];
          assert.ok(Math.abs(maalt - sat) <= KASTEBORDET.trin[id], `${a.kort} ${id}: målt ${maalt}, sat ${sat}`);
        }
      }
      return set.size >= 3;
    });
    assert.ok(set.size > 0, "ordren gav ingen anbefaling");
  });

  it("udføres af operatøren: indstillingen flyttes, og målingen følger efter", () => {
    const { sim, anbefaling: a, b } = tilFoersteAnbefaling();
    sim.udfoer(a.id);
    let efter = b;
    for (let i = 1; i <= 40; i++) efter = sim.skridt(1000, b.t + i * 1000);
    assert.equal(efter.indstillinger[a.maskine][a.parameter], a.tilVaerdi);
    assert.equal(efter.anbefalinger.find((x) => x.id === a.id)!.status, "udfoert");
    const maalt = efter.maskiner.find((m) => m.id === a.maskine)!.kanaler.find((k) => k.spec.id === a.parameter)!.value!;
    assert.ok(Math.abs(maalt - a.tilVaerdi) < (a.parameter === "tvaers" ? 0.1 : 3), `målt ${maalt}, sat ${a.tilVaerdi}`);
    // Det er et menneske, der har gjort det — og det står sådan.
    const b2 = efter.samtale.find((x) => x.fra === "Operatør" && x.type === "handling");
    assert.ok(b2 && b2.kilde === "menneske");
    assert.ok(efter.haendelser.some((h) => h.hvor === a.kort && h.tekst.includes("→")));
  });

  it("gøres op: efter nogle prøver står virkningen, og hæves hældningen, falder FV3", () => {
    const { sim, anbefaling: a, b } = tilFoersteAnbefaling((x) => x.parameter === "tvaers" && x.tilVaerdi > x.fraVaerdi);
    sim.udfoer(a.id);
    let efter = b;
    for (let i = 1; i <= (KASTEBORDET.proeverFoerVurdering + 3) * 30; i++) efter = sim.skridt(1000, b.t + i * 1000);
    const x = efter.anbefalinger.find((y) => y.id === a.id)!;
    assert.ok(x.efter, "virkningen blev ikke gjort op");
    assert.ok(x.efter!.fv3 < x.foer.fv3, `FV3 ${x.foer.fv3} → ${x.efter!.fv3}`);
    assert.ok(efter.samtale.some((m) => m.type === "rapport" && m.tekst.startsWith(`Efter ændringen på ${a.kort}`)));
  });

  it("afvises af operatøren: intet flyttes, og det står, hvem der sagde nej", () => {
    const { sim, anbefaling: a, b } = tilFoersteAnbefaling();
    sim.afvis(a.id);
    const efter = sim.skridt(1000, b.t + 1000);
    assert.equal(efter.indstillinger[a.maskine][a.parameter], a.fraVaerdi);
    assert.equal(efter.anbefalinger.find((x) => x.id === a.id)!.status, "afvist");
    const nej = efter.samtale.find((x) => x.fra === "Operatør" && x.tekst.startsWith("Afvist"));
    assert.ok(nej && nej.kilde === "menneske");
  });

  it("kan også afgøres fra kontoret — den, der trykker først, bestemmer", () => {
    const { sim, anbefaling: a, b } = tilFoersteAnbefaling();
    sim.udfoer(a.id, "Formand");
    // Operatøren ved linjen trykker et øjeblik efter. Det er for sent.
    sim.afvis(a.id, "Operatør");
    const efter = sim.skridt(1000, b.t + 1000);
    const x = efter.anbefalinger.find((y) => y.id === a.id)!;
    assert.equal(x.status, "udfoert");
    assert.equal(x.af, "Formand");
    assert.equal(efter.indstillinger[a.maskine][a.parameter], a.tilVaerdi);
    const ja = efter.samtale.find((m) => m.type === "handling" && m.kilde === "menneske");
    assert.equal(ja?.fra, "Formand");
    assert.ok(!efter.samtale.some((m) => m.tekst.startsWith("Afvist")), "et nej efter et ja må ikke stå i samtalen");
    assert.ok(efter.haendelser.some((h) => h.hvor === a.kort && h.tekst.endsWith("· Formand")));
  });

  it("gentages ikke: efter et nej får bordet ro", () => {
    const { sim, anbefaling: a, b } = tilFoersteAnbefaling();
    sim.afvis(a.id);
    let efter = b;
    for (let i = 1; i < KASTEBORDET.roEfterNejS; i++) {
      efter = sim.skridt(1000, b.t + i * 1000);
      const ny = efter.anbefalinger.find((x) => x.maskine === a.maskine && x.id !== a.id);
      if (ny) assert.fail(`${a.kort} fik en ny anbefaling ${Math.round((ny.t - b.t) / 1000)} s efter et nej`);
    }
  });

  it("ét skridt ad gangen: ingen ny anbefaling, før den sidste ændring er gjort op", () => {
    // Operatøren udfører alt, hele ordren igennem — men tænker sig om i tre
    // minutter først. Så er agentens egen pause forbi, når hældningen flytter
    // sig, og kun reglen holder den tilbage.
    const set = new Set<number>();
    let proevet = 0;
    koer((b, sim) => {
      for (const a of b.anbefalinger) {
        if (!set.has(a.id)) {
          set.add(a.id);
          const tidligere = b.anbefalinger.filter((x) => x.maskine === a.maskine && x.id < a.id && x.status === "udfoert");
          for (const x of tidligere) assert.ok(x.efter, `${a.kort}: ny anbefaling, før virkningen af #${x.id} var gjort op`);
          proevet += tidligere.length;
        }
        if (a.status === "aaben" && b.t - a.t >= 180_000) sim.udfoer(a.id);
      }
    });
    assert.ok(proevet > 0, "ingen anbefaling fulgte en udført");
  });

  it("bortfalder, hvis ingen tager stilling — og bremser kun tiden det første minut", () => {
    const { sim, anbefaling: a, b } = tilFoersteAnbefaling();
    let efter = b;
    let bremsede = 0;
    for (let i = 1; i <= KASTEBORDET.anbefalingGyldigS + 30; i++) {
      efter = sim.skridt(1000, b.t + i * 1000);
      if (efter.uro.some((u) => u.tekst === `Anbefaling ${a.kort}`)) bremsede++;
    }
    assert.equal(efter.anbefalinger.find((x) => x.id === a.id)!.status, "udloebet");
    assert.ok(bremsede <= 60, `bremsede i ${bremsede} s`);
  });
});
