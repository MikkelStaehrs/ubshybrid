import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sliberi from "../../data/lines/sliberi.json";
import { FLOW_NOMINAL, FREMMEDE, KASTEBORDET, ORDRE, PROCES, PROEVER } from "../../data/fremskrivning";
import { layoutLine } from "./layout";
import {
  ctPlan, ctProeve, efterJetpealer, efterSortering, fremmedIalt, iAlt, nytParti, skil, vurder,
  type CtSvar, type Stroem,
} from "./proever";
import type { Besked } from "./samspil";
import { kortNavn, rng, samlLog, samlSamtale, simulator, type Haendelse, type ProeveSvar, type TelemetriBillede } from "./telemetri";
import type { LineData } from "./types";

const layout = layoutLine(sliberi as LineData);
const T0 = new Date("2026-09-24T06:00:00").getTime();
const ordre = { ordreNr: ORDRE.ordreNr, estimeretKg: ORDRE.estimeretKg, kasser: ORDRE.kasser, nominalTPrT: FLOW_NOMINAL["FT-743"] };

const andel = (s: Stroem, k: "godt" | "multi" | "let") => (s[k] / iAlt(s)) * 100;
const typisk = () => efterSortering(efterJetpealer(nytParti(rng(3), 1).kasser[0]), "normal");

describe("strømmen gennem et kastebord", () => {
  it("intet forsvinder: Heavy, Light og Mainline er det, bordet fik", () => {
    const ind = typisk();
    for (const [dT, dL] of [[0, 0], [1, 0], [0, 10], [-1, -10], [3, 25]]) {
      const s = skil(ind, dT, dL);
      const ud = iAlt(s.heavy) + iAlt(s.light) + iAlt(s.mainline);
      assert.ok(Math.abs(ud - iAlt(ind)) < 1e-9, `${dT}°, ${dL} %: ${ud} ud af ${iAlt(ind)}`);
      for (const f of [s.heavy, s.light, s.mainline]) assert.ok(Object.values(f).every((v) => typeof v !== "number" || v >= 0));
    }
  });

  it("mere tværhældning renser Mainline for multigerm — og sender mere godt frø til Heavy", () => {
    const ind = typisk();
    const a = skil(ind, 0, 0);
    const b = skil(ind, 1, 0);
    assert.ok(andel(b.mainline, "multi") < andel(a.mainline, "multi"));
    assert.ok(andel(b.heavy, "godt") > andel(a.heavy, "godt"));
  });

  it("mere luft renser Mainline for let materiale — og sender mere godt frø til Light", () => {
    const ind = typisk();
    const a = skil(ind, 0, 0);
    const b = skil(ind, 0, 10);
    assert.ok(andel(b.mainline, "let") < andel(a.mainline, "let"));
    assert.ok(andel(b.light, "godt") > andel(a.light, "godt"));
  });

  it("andet bord får renere frø: markant mindre multigerm i sin Mainline", () => {
    const b1 = skil(typisk(), 0, 0);
    const b2 = skil(b1.mainline, 0, 0);
    assert.ok(andel(b2.mainline, "multi") < andel(b1.mainline, "multi") / 2);
  });

  it("et normalt parti holder sig inden for grænserne ved standardindstillingerne", () => {
    // Ellers ville en agent anbefale noget hver gang — også når intet er galt.
    const b1 = skil(typisk(), 0, 0);
    const b2 = skil(b1.mainline, 0, 0);
    const [g1, g2] = KASTEBORDET.graenser;
    assert.ok(andel(b1.mainline, "multi") < g1.multi && andel(b2.mainline, "multi") < g2.multi);
    assert.ok(andel(b1.heavy, "godt") < g1.heavyGodt && andel(b1.light, "godt") < g1.lightGodt);
  });
});

describe("sorteringen på Carter og Alfa", () => {
  it("kraftig lader færre foreign seeds slippe igennem — og koster godt frø", () => {
    const ind = efterJetpealer(nytParti(rng(3), 1).kasser[0]);
    const normal = efterSortering(ind, "normal");
    const kraftig = efterSortering(ind, "kraftig");
    assert.ok(fremmedIalt(kraftig) < fremmedIalt(normal) * 0.5);
    assert.ok(kraftig.godt < normal.godt);
    assert.equal(kraftig.multi, normal.multi, "sorteringen tager foreign seeds, ikke multigerm");
  });
});

describe("prøverne", () => {
  it("en CT-prøve svinger så meget, som en prøve af den størrelse gør — og ikke mere", () => {
    // Partiet ligger fast. Det, der svinger fra prøve til prøve, er prøven.
    const s = skil(typisk(), 0, 0).mainline;
    const r = rng(9);
    const parti = nytParti(rng(3), 1);
    const v = Array.from({ length: 400 }, () => { const c = ctProeve(s, parti, r); return c.bigf + c.bigh; });
    const snit = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - snit) ** 2, 0) / v.length);
    const binomial = Math.sqrt((snit / 100) * (1 - snit / 100) / PROEVER.ct.froe) * 100;
    assert.ok(Math.abs(snit - andel(s, "multi")) < 0.1, `snit ${snit} mod ${andel(s, "multi")}`);
    assert.ok(sd < binomial * 1.3, `udsving ${sd} mod ${binomial}`);
  });

  it("en CT-prøves FV-klasser summer til hundrede", () => {
    const parti = nytParti(rng(3), 1);
    const c = ctProeve(skil(typisk(), 0, 0).mainline, parti, rng(4));
    assert.ok(Math.abs(c.fv.reduce((a, b) => a + b, 0) - 100) < 1e-9);
  });

  it("den faste plan har alle fire kasteborde med tre strømme og begge jetpealere", () => {
    const plan = ctPlan(layout, kortNavn);
    assert.equal(plan.length, PROEVER.ctPlan.length);
    assert.equal(plan.filter((p) => p.fraktion === null).length, 2);
    for (const f of ["heavy", "light", "mainline"] as const) assert.equal(plan.filter((p) => p.fraktion === f).length, 4);
    // Første og andet bord i sporet kendes fra tegningen, ikke fra navnet.
    assert.equal(plan.find((p) => p.id === "636:mainline")!.bord, 0);
    assert.equal(plan.find((p) => p.id === "746:mainline")!.bord, 1);
  });
});

describe("vurderingen af et kastebord", () => {
  const ct = (x: Partial<CtSvar>): CtSvar => ({ froe: 1000, godt: 97, bigf: 1, bigh: 0.5, nots: 0, notsStk: 0, sten: 0, ler: 0, let: 0.5, fv: [46, 33, 13, 8], ...x });
  it("for meget multigerm i Mainline: hæv tværhældningen", () => {
    assert.equal(vurder(0, { mainline: ct({ bigf: 2.2, bigh: 0.8 }) }).tvaers, "op");
  });
  it("for meget godt frø i Heavy: sænk den", () => {
    assert.equal(vurder(0, { heavy: ct({ godt: 70 }) }).tvaers, "ned");
  });
  it("begge dele på én gang er en afvejning, ikke et trin", () => {
    assert.equal(vurder(0, { mainline: ct({ bigf: 2.2, bigh: 0.8 }), heavy: ct({ godt: 70 }) }).tvaers, "begge");
  });
  it("FV betyder intet: alt fra FV0 til FV3 er godt frø", () => {
    const v = vurder(0, { mainline: ct({ fv: [10, 10, 30, 50] }) });
    assert.equal(v.tvaers, null);
    assert.equal(v.luft, null);
  });
});

/** En hel ordre med regler, og alt, der skete. */
function koerOrdre(valg: { seed?: number; udfoerAlt?: boolean; planlagteStop?: { wid: string; fraS: number; varighedS: number }[] } = {}) {
  const sim = simulator(layout, { ordre, seed: valg.seed ?? 743, planlagteStop: valg.planlagteStop });
  const billeder: TelemetriBillede[] = [];
  let log: Haendelse[] = [];
  let samtale: Besked[] = [];
  const svar = new Map<number, ProeveSvar>();
  const set = new Set<number>();
  let b: TelemetriBillede;
  for (let i = 1; i <= 15 * 3600; i++) {
    b = sim.skridt(1000, T0 + i * 1000);
    if (i % 60 === 0) billeder.push(b);
    log = samlLog(log, b.haendelser, 100_000);
    samtale = samlSamtale(samtale, b.samtale, 100_000);
    for (const p of b.laboratorie.seneste) svar.set(p.nr, p);
    if (valg.udfoerAlt) for (const a of b.anbefalinger) if (!set.has(a.id)) { set.add(a.id); sim.udfoer(a.id, "Formand"); }
    if (b.ordre?.fase === "faerdig") break;
  }
  return { billeder, log, samtale: [...samtale].sort((a, c) => a.nr - c.nr), svar: [...svar.values()].sort((a, c) => a.nr - c.nr), slut: b! };
}

describe("laboratoriet i en ordre", () => {
  const o = koerOrdre({ udfoerAlt: true });
  const ct = o.svar.filter((p) => p.ct);

  it("CT-scanneren tager én prøve ad gangen, og svaret kommer tyve minutter efter", () => {
    for (const p of ct) assert.equal(p.svarT - p.taget, PROEVER.ct.minutter * 60_000);
    for (let i = 1; i < ct.length; i++) assert.ok(ct[i].taget >= ct[i - 1].svarT, `${ct[i].sted.navn} blev taget, før ${ct[i - 1].sted.navn} var færdig`);
  });

  it("den kan ikke tage mere end tre i timen", () => {
    const timer = (o.slut.t - T0) / 3_600_000;
    assert.ok(o.slut.laboratorie.ct.taget <= Math.ceil(timer * 3), `${o.slut.laboratorie.ct.taget} på ${timer.toFixed(1)} t`);
    assert.ok(o.slut.laboratorie.ct.taget >= 30, "scanneren stod stille");
  });

  it("videometeret tager hver anden kasse, før den fordeles", () => {
    const kasser = o.svar.filter((p) => p.videometer).map((p) => p.kasse);
    assert.deepEqual(kasser, Array.from({ length: kasser.length }, (_, i) => i * PROEVER.videometer.hverKasse));
    assert.equal(kasser.length, ORDRE.kasser / PROEVER.videometer.hverKasse);
  });

  it("partiet ligger fast: to svar fra samme sted springer ikke", () => {
    // Det var sådan, analysen så ud før: tal, der fløj op og ned fra minut
    // til minut. Et parti gør ikke det.
    for (const sted of ["636:mainline", "746:mainline", "636:heavy"]) {
      const v = ct.filter((p) => p.sted.id === sted && p.somSat).map((p) => (sted.endsWith("heavy") ? p.ct!.godt : p.ct!.bigf + p.ct!.bigh));
      assert.ok(v.length >= 2, `${sted} har for få svar`);
      for (let i = 1; i < v.length; i++) assert.ok(Math.abs(v[i] - v[i - 1]) < (sted.endsWith("heavy") ? 12 : 1.6), `${sted}: ${v[i - 1]} → ${v[i]}`);
    }
  });

  it("et urent stykke findes af videometeret, og Operatøragenten anbefaler kraftig sortering", () => {
    const hoej = o.svar.find((p) => p.videometer && p.videometer.fremmedIalt > PROEVER.videometer.fremmedHoej);
    assert.ok(hoej, "partiet havde intet urent stykke at prøve reglen på");
    const forslag = o.samtale.find((b) => b.tekst === "Sortér kraftigere på Carter og Alfa i begge spor.");
    assert.ok(forslag && forslag.t === hoej.svarT, "ingen anbefaling, da svaret kom");
    assert.equal(forslag.fra, "Operatøragent");
    // Den siger det, der er sandt: frøet fra kassen er allerede forbi.
    assert.match(forslag.grund ?? "", /allerede forbi/);
    assert.ok(PROEVER.videometer.minutter > PROCES.transitMin.jetpealer);
  });

  it("sorteringen går tilbage til normal, når partiet er rent igen", () => {
    const normal = o.samtale.find((b) => b.tekst === "Sortér normalt igen på Carter og Alfa.");
    const kraftig = o.samtale.find((b) => b.tekst === "Sortér kraftigere på Carter og Alfa i begge spor.");
    assert.ok(kraftig && normal && normal.t > kraftig.t);
    assert.ok(Object.values(o.slut.sortering).every((x) => x === "normal"));
  });

  it("Prøvetagningsagenten melder hvert svar — og hvem der skal have det", () => {
    const meldt = o.samtale.filter((b) => b.fra === "Prøvetagningsagent");
    assert.equal(meldt.length, o.svar.length);
    for (const b of meldt) {
      if (b.tekst.startsWith("Videometer")) assert.equal(b.til, "Operatøragent");
      else assert.match(b.til, /^Linjeagent Spor [NS]$/);
      assert.match(b.grund ?? "", /Taget \d\d\.\d\d, svar \d\d\.\d\d/);
    }
  });

  it("FV styrer ingenting, og ingen FV-alarm melder", () => {
    assert.ok(!o.log.some((h) => /^FV\d/.test(h.tekst)));
    for (const b of o.samtale.filter((x) => x.type === "forslag")) assert.doesNotMatch(`${b.tekst} ${b.grund ?? ""}`, /FV\d/);
  });

  it("alle foreign seeds har en art, videometeret kender", () => {
    for (const p of o.svar.filter((x) => x.videometer)) {
      assert.deepEqual(Object.keys(p.videometer!.fremmed).sort(), [...FREMMEDE].sort());
    }
  });
});

describe("en maskine, der står", () => {
  it("springes over i planen — der tages ingen prøve af ingenting", () => {
    // KB-3N står i fem timer. Imens tages ingen prøve fra den.
    const fraS = 3600;
    const o = koerOrdre({ planlagteStop: [{ wid: "636", fraS, varighedS: 5 * 3600 }] });
    const inde = o.svar.filter((p) => p.sted.maskine && p.taget > T0 + (fraS + 60) * 1000 && p.taget < T0 + (fraS + 5 * 3600 - 60) * 1000);
    const kb3n = layout.machines.find((m) => m.wIds.includes("636"))!;
    assert.ok(inde.length > 5, "ingen prøver i perioden at prøve reglen på");
    assert.ok(!inde.some((p) => p.sted.maskine === kb3n.id), "der blev taget en prøve fra et bord, der stod");
    assert.ok(o.slut.laboratorie.sprunget > 0);
  });
});
