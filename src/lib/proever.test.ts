import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sliberi from "../../data/lines/sliberi.json";
import { FLOW_NOMINAL, FREMMEDE, KASTEBORDET, ORDRE, PROCES, PROEVER, type CtMaalt } from "../../data/fremskrivning";
import { layoutLine } from "./layout";
import {
  ctMulti, ctPlan, ctPris, ctProeve, efterCarter, efterJetpealer, efterTrioere, fremmedIalt, froeIalt, godt, iAlt, multi,
  nytParti, skil, sporetsBorde, tilKastebord, typiskKasse, VIDEOMETER, vurder,
  type CtSvar, type Stroem,
} from "./proever";
import type { Besked } from "./samspil";
import { kortNavn, rng, samlLog, samlSamtale, simulator, type Anbefaling, type Haendelse, type ProeveSvar, type TelemetriBillede } from "./telemetri";
import type { LineData } from "./types";

const layout = layoutLine(sliberi as LineData);
const T0 = new Date("2026-09-24T06:00:00").getTime();
const ordre = { ordreNr: ORDRE.ordreNr, estimeretKg: ORDRE.estimeretKg, kasser: ORDRE.kasser, nominalTPrT: FLOW_NOMINAL["FT-743"] };

/** I procent af frøene — som CT'en tæller. */
const andel = (s: Stroem, k: "godt" | "multi" | "frag" | "tom" | "fv2" | "bigf") => {
  const v = { godt: godt(s), multi: multi(s), frag: s.let, tom: s.tom, fv2: s.fv[2], bigf: s.bigf }[k];
  return (v / froeIalt(s)) * 100;
};
const typisk = () => tilKastebord(nytParti(rng(3), 1).kasser[0], "normal");
const maaltGodt = (c: CtMaalt) => c.fv.reduce((a, b) => a + b, 0) / (c.fv.reduce((a, b) => a + b, 0) + c.tom + c.bigf + c.bigh + c.twin) * 100;
const maaltMulti = (c: CtMaalt) => c.bigf + c.bigh + c.twin;

describe("strømmen gennem et kastebord", () => {
  it("intet forsvinder: Heavy, Light og Ready er det, bordet fik", () => {
    const ind = typisk();
    for (const bord of [0, 1]) {
      for (const [dT, dL] of [[0, 0], [1, 0], [0, 10], [-1, -10], [3, 25]]) {
        const s = skil(ind, dT, dL, bord);
        const ud = iAlt(s.heavy) + iAlt(s.light) + iAlt(s.ready);
        assert.ok(Math.abs(ud - iAlt(ind)) < 1e-9, `bord ${bord}, ${dT}°, ${dL} %: ${ud} ud af ${iAlt(ind)}`);
        assert.ok(Math.abs(godt(s.heavy) + godt(s.light) + godt(s.ready) - godt(ind)) < 1e-9);
        for (const f of [s.heavy, s.light, s.ready]) assert.ok([...f.fv, f.tom, f.bigf, f.bigh, f.twin, f.sten, f.ler, f.let].every((v) => v >= 0));
      }
    }
  });

  it("ved standardindstillingerne giver bordene det, CT'en har set", () => {
    // Kalibreret på 549 rigtige prøver. Et typisk parti gennem sporet skal
    // ende tæt på dem — ellers er modellen ikke den, der står i dataene.
    const b1 = skil(tilKastebord(typiskKasse(), "normal"), 0, 0, 0);
    const b2 = skil(b1.ready, 0, 0, 1);
    const m = KASTEBORDET.maalt;
    for (const [navn, s, c] of [
      ["første · Heavy", b1.heavy, m.foerste.heavy], ["første · Ready", b1.ready, m.foerste.ready], ["første · Light", b1.light, m.foerste.light],
      ["sidste · Heavy", b2.heavy, m.sidste.heavy], ["sidste · Ready", b2.ready, m.sidste.ready], ["sidste · Light", b2.light, m.sidste.light],
    ] as const) {
      assert.ok(Math.abs(andel(s, "godt") - maaltGodt(c)) < 0.8, `${navn}: godt frø ${andel(s, "godt").toFixed(2)} mod ${maaltGodt(c).toFixed(2)}`);
      assert.ok(Math.abs(andel(s, "multi") - maaltMulti(c)) < 0.8, `${navn}: multigerm ${andel(s, "multi").toFixed(2)} mod ${maaltMulti(c).toFixed(2)}`);
      assert.ok(Math.abs(andel(s, "fv2") - c.fv[2]) < 1, `${navn}: FV2 ${andel(s, "fv2").toFixed(2)} mod ${c.fv[2]}`);
    }
    // Det, dataene siger tydeligst: Light er næsten kun godt frø, og Heavy
    // samler multigerm — men mest godt frø.
    assert.ok(andel(b1.light, "godt") > 98.5 && andel(b2.light, "godt") > 99);
    assert.ok(andel(b1.heavy, "multi") > 2.5 * andel(b1.ready, "multi"));
    assert.ok(andel(b1.heavy, "godt") > 95);
  });

  it("ved standardindstillingerne går den skønnede del til siderne — og ikke mere", () => {
    const ind = typisk();
    const s = skil(ind, 0, 0, 0);
    assert.ok(Math.abs(iAlt(s.heavy) / iAlt(ind) - KASTEBORDET.masse.foerste.heavy) < 1e-6);
    assert.ok(Math.abs(iAlt(s.light) / iAlt(ind) - KASTEBORDET.masse.foerste.light) < 1e-6);
  });

  it("mere tværhældning sender mere til Heavy — og renser Ready for multigerm", () => {
    const ind = typisk();
    const a = skil(ind, 0, 0, 0);
    const b = skil(ind, 1, 0, 0);
    assert.ok(iAlt(b.heavy) > iAlt(a.heavy));
    assert.ok(andel(b.ready, "multi") < andel(a.ready, "multi"));
    assert.ok(godt(b.heavy) > godt(a.heavy), "flere gode frø ud");
  });

  it("mere luft sender mere til Light — og renser Ready for fragmenter", () => {
    const ind = typisk();
    const a = skil(ind, 0, 0, 0);
    const b = skil(ind, 0, 10, 0);
    assert.ok(iAlt(b.light) > iAlt(a.light));
    assert.ok(andel(b.ready, "frag") < andel(a.ready, "frag"));
    assert.ok(godt(b.light) > godt(a.light), "flere gode frø ud");
  });

  it("et normalt parti holder Ready inden for grænserne ved standardindstillingerne", () => {
    // Ellers ville en agent lukke et bord hver gang — også når intet er galt.
    const b1 = skil(typisk(), 0, 0, 0);
    const b2 = skil(b1.ready, 0, 0, 1);
    const [g1, g2] = KASTEBORDET.graenser;
    assert.ok(andel(b1.ready, "multi") < g1.readyMulti * KASTEBORDET.margen && andel(b2.ready, "multi") < g2.readyMulti * KASTEBORDET.margen);
    assert.ok(andel(b1.ready, "frag") < g1.readyFrag * KASTEBORDET.margen && andel(b2.ready, "frag") < g2.readyFrag * KASTEBORDET.margen);
  });

  it("sporets regnskab går op: Heavy og Light fra begge borde og Ready ud er det, der kom ind", () => {
    const ind = typisk();
    for (const saet of [[{ dT: 0, dL: 0 }, { dT: 0, dL: 0 }], [{ dT: -1, dL: -10 }, { dT: 1, dL: 5 }]]) {
      const r = sporetsBorde(ind, saet);
      const ialt = r.borde.reduce((n, b) => n + b.heavy + b.light, 0) + r.ready;
      assert.ok(Math.abs(ialt - 1) < 1e-9, `${ialt}`);
      const g = r.borde.reduce((n, b) => n + b.heavyGodt + b.lightGodt, 0) + r.readyGodt;
      assert.ok(Math.abs(g - godt(ind) / iAlt(ind)) < 1e-9);
    }
  });

  it("at åbne bordet sparer godt frø", () => {
    const ind = typisk();
    const tab = (dT: number, dL: number) => sporetsBorde(ind, [{ dT, dL }, { dT, dL }]).borde.reduce((n, b) => n + b.heavyGodt + b.lightGodt, 0);
    assert.ok(tab(-KASTEBORDET.trin.tvaers, 0) < tab(0, 0));
    assert.ok(tab(0, -KASTEBORDET.trin.luft) < tab(0, 0));
  });
});

describe("maskinerne før kastebordene", () => {
  it("Triøren tager foreign seeds: kraftig lader færre slippe igennem — og koster godt frø", () => {
    const ind = efterJetpealer(nytParti(rng(3), 1).kasser[0]);
    const normal = efterTrioere(ind, "normal");
    const kraftig = efterTrioere(ind, "kraftig");
    assert.ok(fremmedIalt(kraftig) < fremmedIalt(normal) * 0.5);
    assert.ok(godt(kraftig) < godt(normal));
    for (const x of [normal, kraftig]) assert.equal(multi(x), multi(ind), "Triøren tager foreign seeds, ikke multigerm");
  });

  it("Carter tager multigerm — ikke foreign seeds", () => {
    const ind = efterJetpealer(nytParti(rng(3), 1).kasser[0]);
    const ud = efterCarter(ind);
    assert.ok(Math.abs(multi(ud) - multi(ind) * (1 - PROCES.carter.multi)) < 1e-9);
    assert.equal(fremmedIalt(ud), fremmedIalt(ind));
  });

  it("det, der når det første bord, er det, CT'en har set dér", () => {
    // Tilløbet er summen af de tre strømme, som CT'en har målt dem.
    const ind = tilKastebord(typiskKasse(), "normal");
    const m = KASTEBORDET.maalt.foerste;
    const { heavy: h, light: l } = KASTEBORDET.masse.foerste;
    const foder = h * maaltMulti(m.heavy) + l * maaltMulti(m.light) + (1 - h - l) * maaltMulti(m.ready);
    assert.ok(Math.abs(andel(ind, "multi") - foder) < 0.15, `multigerm ${andel(ind, "multi").toFixed(2)} mod ${foder.toFixed(2)}`);
  });
});

describe("prøverne", () => {
  it("en CT-prøve svinger så meget, som en prøve af den størrelse gør — og ikke mere", () => {
    // Partiet ligger fast. Det, der svinger fra prøve til prøve, er prøven.
    const s = skil(typisk(), 0, 0, 0).ready;
    const r = rng(9);
    const v = Array.from({ length: 400 }, () => ctMulti(ctProeve(s, r)));
    const snit = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - snit) ** 2, 0) / v.length);
    const binomial = Math.sqrt((snit / 100) * (1 - snit / 100) / PROEVER.ct.froe) * 100;
    assert.ok(Math.abs(snit - andel(s, "multi")) < 0.1, `snit ${snit} mod ${andel(s, "multi")}`);
    assert.ok(sd < binomial * 1.3, `udsving ${sd} mod ${binomial}`);
  });

  it("en CT-prøve ser ud som den rigtige: frø i kategorier, fragmenter for sig, ingen sten og ler", () => {
    const c = ctProeve(skil(typisk(), 0, 0, 0).light, rng(4), PROCES.froeMg.N);
    assert.ok(Math.abs(c.godt + ctMulti(c) + c.tom + c.nots - 100) < 1e-9, "frøene summer til hundrede");
    assert.ok(Math.abs(c.fv.reduce((a, b) => a + b, 0) - 100) < 1e-9, "FV-klasserne summer til hundrede");
    assert.ok(c.fragStk > 0 && Math.abs(c.frag - (c.fragStk / c.froe) * 100) < 1e-9, "fragmenterne tælles for sig");
    assert.ok(!("sten" in c) && !("ler" in c), "sten og ler ser CT'en ikke");
    assert.ok(c.froe > PROEVER.ct.froe * 0.9 && c.froe < PROEVER.ct.froe * 1.1);
  });

  it("prisen kan læses af CT'en alene: gode frø pr. uønsket", () => {
    const c = ctProeve(skil(typisk(), 0, 0, 0).heavy, rng(5));
    assert.ok(Math.abs(ctPris(c) - c.godt / (100 - c.godt + c.frag)) < 1e-9);
  });

  it("simuleringens plan peger kun på prøvesteder, driften har registreret", () => {
    // Ét sted, et prøvested er defineret: data/proevesteder.ts. Planen er et
    // skøn over rækkefølgen — ikke et sted at opfinde nye prøver.
    for (const sted of ctPlan(layout, kortNavn)) assert.ok(sted.proevested, `${sted.navn} er ikke et prøvested`);
    assert.ok(VIDEOMETER.proevested, "videometerprøven er ikke et prøvested");
  });

  it("den faste plan har alle fire kasteborde med tre strømme og begge jetpealere", () => {
    const plan = ctPlan(layout, kortNavn);
    assert.equal(plan.length, PROEVER.ctPlan.length);
    assert.equal(plan.filter((p) => p.fraktion === null).length, 2);
    for (const f of ["heavy", "light", "ready"] as const) assert.equal(plan.filter((p) => p.fraktion === f).length, 4);
    // Første og andet bord i sporet kendes fra tegningen, ikke fra navnet.
    assert.equal(plan.find((p) => p.id === "636:ready")!.bord, 0);
    assert.equal(plan.find((p) => p.id === "746:ready")!.bord, 1);
  });
});

describe("vurderingen af et kastebord", () => {
  const ct = (x: Partial<CtSvar>): CtSvar => ({
    froe: 650, godt: 98.5, fv: [4, 90, 6, 0], bigf: 0.6, bigh: 0.2, twin: 0.2, tom: 0.2, nots: 0, notsStk: 0, fragStk: 4, frag: 0.6, mg: null, ...x,
  });
  const dyrHeavy = ct({ godt: 96.5, bigf: 2.8, bigh: 0.2, twin: 0.4, tom: 0.1, frag: 0.3 });
  it("for meget multigerm i Ready: hæv tværhældningen", () => {
    assert.equal(vurder(0, { ready: ct({ bigf: 2.2, bigh: 0.5, twin: 0.4 }) }).tvaers, "op");
  });
  it("Heavy smider mange gode frø ud, og Ready har luft: sænk den", () => {
    assert.ok(ctPris(dyrHeavy) > KASTEBORDET.graenser[0].pris);
    assert.equal(vurder(0, { ready: ct({}), heavy: dyrHeavy }).tvaers, "ned");
  });
  it("et bord åbnes ikke i blinde: uden et svar fra Ready sker intet", () => {
    assert.equal(vurder(0, { heavy: dyrHeavy }).tvaers, null);
  });
  it("et bord åbnes ikke, når Ready er tæt på sin grænse", () => {
    assert.equal(vurder(0, { ready: ct({ bigf: 1.5, bigh: 0.3, twin: 0.2 }), heavy: dyrHeavy }).tvaers, null);
  });
  it("for uren Ready og dyr Heavy på én gang er en afvejning, ikke et trin", () => {
    assert.equal(vurder(0, { ready: ct({ bigf: 2.2, bigh: 0.5, twin: 0.4 }), heavy: dyrHeavy }).tvaers, "begge");
  });
  it("for mange fragmenter i Ready: hæv luften", () => {
    assert.equal(vurder(0, { ready: ct({ frag: 2 }) }).luft, "op");
  });
  it("FV betyder intet: alt fra FV0 til FV3 er godt frø", () => {
    const v = vurder(0, { ready: ct({ fv: [10, 10, 30, 50] }) });
    assert.equal(v.tvaers, null);
    assert.equal(v.luft, null);
  });
});

/** En hel ordre med regler, og alt, der skete. `udfoer` siger, hvilke anbefalinger formanden udfører. */
function koerOrdre(valg: {
  seed?: number; udfoerAlt?: boolean; udfoer?: (a: Anbefaling) => boolean;
  planlagteStop?: { wid: string; fraS: number; varighedS: number }[];
} = {}) {
  const udfoer = valg.udfoer ?? (() => !!valg.udfoerAlt);
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
    for (const a of b.anbefalinger) if (!set.has(a.id) && udfoer(a)) { set.add(a.id); sim.udfoer(a.id, "Formand"); }
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
    for (const sted of ["636:ready", "746:ready", "636:heavy"]) {
      const v = ct.filter((p) => p.sted.id === sted && p.somSat).map((p) => (sted.endsWith("heavy") ? p.ct!.godt : ctMulti(p.ct!)));
      assert.ok(v.length >= 2, `${sted} har for få svar`);
      for (let i = 1; i < v.length; i++) assert.ok(Math.abs(v[i] - v[i - 1]) < (sted.endsWith("heavy") ? 4 : 2), `${sted}: ${v[i - 1]} → ${v[i]}`);
    }
  });

  it("fordeleren deler i to størrelser: frøene i spor S er de store", () => {
    const mg = (l: string) => ct.filter((p) => p.sted.fraktion === null && p.sted.lane === l).map((p) => p.ct!.mg!);
    assert.ok(mg("N").length > 0 && mg("S").length > 0);
    assert.ok(Math.max(...mg("N")) < Math.min(...mg("S")), `N ${mg("N")} mod S ${mg("S")}`);
  });

  it("et urent stykke findes af videometeret, og Operatøragenten anbefaler kraftig sortering på Triørerne", () => {
    const hoej = o.svar.find((p) => p.videometer && p.videometer.fremmedIalt > PROEVER.videometer.fremmedHoej);
    assert.ok(hoej, "partiet havde intet urent stykke at prøve reglen på");
    const forslag = o.samtale.find((b) => b.tekst === "Sortér kraftigere på Triørerne i begge spor.");
    assert.ok(forslag && forslag.t === hoej.svarT, "ingen anbefaling, da svaret kom");
    assert.equal(forslag.fra, "Operatøragent");
    // Den siger det, der er sandt: frøet fra kassen er allerede forbi.
    assert.match(forslag.grund ?? "", /allerede forbi/);
    assert.ok(PROEVER.videometer.minutter > PROCES.transitMin.jetpealer);
  });

  it("sorteringen går tilbage til normal, når partiet er rent igen", () => {
    const normal = o.samtale.find((b) => b.tekst === "Sortér normalt igen på Triørerne.");
    const kraftig = o.samtale.find((b) => b.tekst === "Sortér kraftigere på Triørerne i begge spor.");
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

  it("tabet regnes i kg — og intet kilo regnes to gange", () => {
    const t = o.slut.tab!;
    const ud = t.borde.reduce((n, b) => n + b.heavyKg + b.lightKg, 0) + t.readyKg;
    assert.ok(t.godtKg > 0, "intet tab regnet");
    assert.ok(ud <= o.slut.ordre!.kgInd + 1e-6, `${ud} kg ud af ${o.slut.ordre!.kgInd} ind`);
    assert.ok(t.godtKg < t.godtIndKg * 0.2, `${t.godtKg} af ${t.godtIndKg} kg godt frø tabt`);
    assert.equal(t.borde.length, 4);
    for (const b of t.borde) assert.ok(b.heavyGodtKg <= b.heavyKg && b.lightGodtKg <= b.lightKg);
    // Rapporten siger det — og at det er et skøn.
    const rapport = o.samtale.find((b) => b.type === "rapport" && b.tekst.startsWith(`Ordre ${ORDRE.ordreNr}`));
    assert.ok(rapport?.linjer?.some((l) => /^Godt frø tabt på kastebordene ca\. [\d.]+ kg .* skøn$/.test(l)), rapport?.linjer?.join("\n"));
  });
});

describe("agenterne åbner bordene", () => {
  it("med de samme kasser taber en ordre, hvor anbefalingerne udføres, mindre godt frø", () => {
    // Heavy og Light er næsten kun godt frø. Agenten åbner bordene, så længe
    // Ready har luft — og det skal kunne ses i kiloene. Sorteringen udføres
    // i begge: kraftig sortering koster godt frø før bordene, og det skal
    // ikke forveksles med det, bordene sparer.
    const med = koerOrdre({ udfoer: () => true }).slut.tab!;
    const uden = koerOrdre({ udfoer: (a) => a.parameter === "sortering" }).slut.tab!;
    const pct = (t: typeof med) => t.godtKg / t.godtIndKg;
    assert.ok(pct(med) < pct(uden), `med ${(100 * pct(med)).toFixed(2)} % mod uden ${(100 * pct(uden)).toFixed(2)} %`);
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
