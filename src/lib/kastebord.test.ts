import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sliberi from "../../data/lines/sliberi.json";
import { FLOW_NOMINAL, KASTEBORDET, ORDRE } from "../../data/fremskrivning";
import { layoutLine } from "./layout";
import { nytParti, type Parti } from "./proever";
import type { Besked } from "./samspil";
import {
  kanalerFor, rng, samlLog, samlSamtale, simulator,
  type Anbefaling, type Haendelse, type Simulator, type TelemetriBillede,
} from "./telemetri";
import type { LineData } from "./types";

const layout = layoutLine(sliberi as LineData);
const T0 = new Date("2026-09-23T06:00:00").getTime();
const ordre = { ordreNr: ORDRE.ordreNr, estimeretKg: ORDRE.estimeretKg, kasser: ORDRE.kasser, nominalTPrT: FLOW_NOMINAL["FT-743"] };

/**
 * Et parti med langt mere multigerm end normalt. Det første bord i hvert
 * spor kan ikke holde sin Mainline ren ved standardindstillingerne — så en
 * test ved, at der kommer en anbefaling, i stedet for at håbe på det.
 */
function multigermParti(faktor = 1.8, seed = 11): Parti {
  const p = nytParti(rng(seed), ORDRE.kasser);
  for (const k of p.kasser) {
    const ekstra = k.multi * (faktor - 1);
    k.multi += ekstra;
    k.godt -= ekstra;
  }
  return p;
}

/**
 * Kør en ordre og lad `hver` se hvert billede. Svarer den true, stopper
 * kørslen. Operatøren er testen: den udfører eller afviser, som den vil.
 */
function koer(hver: (b: TelemetriBillede, sim: Simulator) => boolean | void, parti = multigermParti(), sekunder = 15 * 3600) {
  const sim = simulator(layout, { ordre, stopHverS: 1e9, parti });
  let log: Haendelse[] = [];
  let samtale: Besked[] = [];
  let b: TelemetriBillede | null = null;
  for (let i = 1; i <= sekunder; i++) {
    b = sim.skridt(1000, T0 + i * 1000);
    log = samlLog(log, b.haendelser, 100_000);
    samtale = samlSamtale(samtale, b.samtale, 100_000);
    if (hver(b, sim)) break;
    if (b.ordre?.fase === "faerdig") break;
  }
  return { b: b!, sim, log, samtale };
}

const bordAnbefaling = (a: Anbefaling) => a.parameter === "tvaers" || a.parameter === "luft";

/** Kør, til den første anbefaling til et kastebord står åben. */
function tilFoersteAnbefaling(passer: (a: Anbefaling) => boolean = () => true) {
  let fundet: Anbefaling | null = null;
  const r = koer((b) => {
    fundet = b.anbefalinger.find((a) => a.status === "aaben" && bordAnbefaling(a) && passer(a)) ?? null;
    return fundet !== null;
  });
  assert.ok(fundet, "ordren gav ingen anbefaling til et kastebord");
  return { ...r, anbefaling: fundet as Anbefaling };
}

describe("et kastebord vurderes", () => {
  it("på renhed og tab — ikke på FV", () => {
    const { anbefaling: a, samtale } = tilFoersteAnbefaling();
    // For meget multigerm i Mainline: bordet skal sende mere til Heavy.
    assert.equal(a.parameter, "tvaers");
    assert.ok(a.tilVaerdi > a.fraVaerdi);
    assert.equal(a.virkning[0].navn, "Multigerm i Mainline");
    assert.ok(a.virkning[0].foer! > KASTEBORDET.graenser[0].multi, `multigerm ${a.virkning[0].foer}`);
    // Hvad der ventes: mindre multigerm, mere godt frø i Heavy.
    assert.ok(a.virkning[0].forventet < 0 && a.virkning[1].forventet > 0);
    const forslag = samtale.find((b) => b.type === "forslag" && /^(Hæv|Sænk) /.test(b.tekst) && b.tekst.includes(a.kort))!;
    assert.match(forslag.grund ?? "", /multigerm i Mainline/i);
    assert.doesNotMatch(`${forslag.tekst} ${forslag.grund}`, /FV\d/);
  });

  it("på et svar fra laboratoriet, der lige er kommet", () => {
    const { anbefaling: a, b } = tilFoersteAnbefaling();
    const nyeste = Math.max(...b.laboratorie.seneste.map((p) => p.svarT));
    const svar = b.laboratorie.seneste.find((p) => p.sted.maskine === a.maskine && p.svarT === nyeste);
    assert.ok(svar, "anbefalingen kom ikke af et svar fra bordet");
  });
});

describe("et svar uden for grænsen", () => {
  it("er en advarsel på det første bord og en alarm på det sidste — produktet", () => {
    // Det første bord kan en agent rette. Det sidste bords Mainline er det,
    // der forlader linjen: uden for grænsen er det en fejl.
    const { log } = koer(() => false, multigermParti(2.6), 8 * 3600);
    const ct = log.filter((h) => h.tekst.startsWith("CT · Mainline · multigerm"));
    const kb = (navn: string) => layout.machines.find((m) => m.name === navn)!;
    const bord = (h: Haendelse) => ["KB-3NN", "KB-2SS"].includes(h.hvor ?? "") ? 1 : 0;
    const over = (h: Haendelse) => Number(h.tekst.match(/multigerm ([\d,]+)/)![1].replace(",", ".")) > KASTEBORDET.graenser[bord(h)].multi;
    const foerste = ct.filter((h) => bord(h) === 0 && over(h));
    const sidste = ct.filter((h) => bord(h) === 1 && over(h));
    assert.ok(foerste.length > 0 && sidste.length > 0, `for få svar uden for: ${foerste.length} og ${sidste.length}`);
    for (const h of foerste) assert.equal(h.niveau, "advarsel", `${h.hvor} ${h.tekst}`);
    for (const h of sidste) assert.equal(h.niveau, "alarm", `${h.hvor} ${h.tekst}`);
    assert.ok(kb("KB-3NN") && kb("KB-2SS"));
  });
});

describe("en anbefaling til et kastebord", () => {
  it("holder sig ét trin fra, hvor indstillingen står, og inden for kanalens grænser", () => {
    const { anbefaling: a } = tilFoersteAnbefaling();
    const par = a.parameter as "tvaers" | "luft";
    assert.ok(Math.abs(Math.abs(a.tilVaerdi - a.fraVaerdi) - KASTEBORDET.trin[par]) < 1e-9);
    const spec = kanalerFor(layout.machines.find((m) => m.id === a.maskine)!).find((k) => k.id === par)!;
    assert.ok(a.tilVaerdi > spec.alarmLav! && a.tilVaerdi < spec.alarmHoej!);
  });

  it("udføres af operatøren: indstillingen flyttes, og målingen følger efter", () => {
    const { sim, anbefaling: a, b } = tilFoersteAnbefaling();
    const par = a.parameter as "tvaers" | "luft";
    sim.udfoer(a.id);
    let efter = b;
    for (let i = 1; i <= 40; i++) efter = sim.skridt(1000, b.t + i * 1000);
    assert.equal(efter.indstillinger[a.maskine][par], a.tilVaerdi);
    assert.equal(efter.anbefalinger.find((x) => x.id === a.id)!.status, "udfoert");
    const maalt = efter.maskiner.find((m) => m.id === a.maskine)!.kanaler.find((k) => k.spec.id === par)!.value!;
    assert.ok(Math.abs(maalt - a.tilVaerdi) < (par === "tvaers" ? 0.1 : 3), `målt ${maalt}, sat ${a.tilVaerdi}`);
    // Det er et menneske, der har gjort det — og det står sådan.
    const b2 = efter.samtale.find((x) => x.fra === "Operatør" && x.type === "handling");
    assert.ok(b2 && b2.kilde === "menneske");
    assert.ok(efter.haendelser.some((h) => h.hvor === a.kort && h.tekst.includes("→")));
  });

  it("gøres op på det første svar, der er taget efter ændringen", () => {
    // Svaret kommer, når CT-scanneren når til bordet i planen — det kan
    // tage timer. Et svar fra før ændringen siger intet om den.
    const { sim, anbefaling: a, b } = tilFoersteAnbefaling();
    sim.udfoer(a.id);
    let efter = b;
    let x: Anbefaling | undefined;
    for (let i = 1; i <= 8 * 3600; i++) {
      efter = sim.skridt(1000, b.t + i * 1000);
      x = efter.anbefalinger.find((y) => y.id === a.id);
      if (x?.gjortOp) break;
    }
    assert.ok(x?.gjortOp, "virkningen blev ikke gjort op");
    assert.notEqual(x!.virkning[0].efter, undefined);
    const main = efter.laboratorie.seneste.find((p) => p.sted.maskine === a.maskine && p.sted.fraktion === "mainline")!;
    assert.ok(main.taget >= x!.udfoertT!, "opgjort på et svar fra før ændringen");
    assert.ok(efter.samtale.some((m) => m.type === "rapport" && m.tekst.startsWith(`Efter ændringen på ${a.kort}`)));
  });

  it("afvises af operatøren: intet flyttes, og det står, hvem der sagde nej", () => {
    const { sim, anbefaling: a, b } = tilFoersteAnbefaling();
    const par = a.parameter as "tvaers" | "luft";
    sim.afvis(a.id);
    const efter = sim.skridt(1000, b.t + 1000);
    assert.equal(efter.indstillinger[a.maskine][par], a.fraVaerdi);
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
    assert.equal(efter.indstillinger[a.maskine][a.parameter as "tvaers" | "luft"], a.tilVaerdi);
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
    // minutter først.
    const set = new Set<number>();
    let proevet = 0;
    koer((b, sim) => {
      for (const a of b.anbefalinger.filter(bordAnbefaling)) {
        if (!set.has(a.id)) {
          set.add(a.id);
          const tidligere = b.anbefalinger.filter((x) => x.maskine === a.maskine && x.id < a.id && x.status === "udfoert");
          for (const x of tidligere) assert.ok(x.gjortOp, `${a.kort}: ny anbefaling, før virkningen af #${x.id} var gjort op`);
          proevet += tidligere.length;
        }
        if (a.status === "aaben" && b.t - a.t >= 180_000) sim.udfoer(a.id);
      }
    }, multigermParti(2.4));
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
