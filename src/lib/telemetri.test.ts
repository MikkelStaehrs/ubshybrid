import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sliberi from "../../data/lines/sliberi.json";
import { layoutLine } from "./layout";
import { FAULT_LOW_MA } from "./live-source";
import { kanalerFor, maskinFart, simulator, tomtBillede, INDKOERING_S, SIM, type TelemetriBillede } from "./telemetri";
import type { LineData } from "./types";

const layout = layoutLine(sliberi as LineData);
const T0 = 1_750_000_000_000;
const DT = 250;

/** Kør simulatoren `n` skridt og saml alle billeder. */
function koer(n: number, seed = 743): TelemetriBillede[] {
  const sim = simulator(layout, { seed });
  const ud: TelemetriBillede[] = [];
  for (let i = 0; i < n; i++) ud.push(sim.skridt(DT, T0 + i * DT));
  return ud;
}

// Tyve minutter simuleret tid. Lang nok til stop, alarmer og en sensorfejl.
const forloeb = koer(4 * 60 * 20);

describe("simulatoren er til at stole på som simulator", () => {
  it("er deterministisk — samme seed, samme tal", () => {
    const a = koer(400);
    const b = koer(400);
    assert.deepEqual(a[399].maskiner.map((m) => m.kanaler.map((k) => k.value)),
      b[399].maskiner.map((m) => m.kanaler.map((k) => k.value)));
    assert.equal(a[399].flowPct, b[399].flowPct);
  });

  it("mærker alt, den laver, som simuleret", () => {
    for (const b of forloeb.slice(0, 50)) assert.equal(b.simuleret, true);
  });

  it("holder hver kanal inden for dens fysiske grænser", () => {
    for (const b of forloeb) {
      for (const m of b.maskiner) {
        for (const k of m.kanaler) {
          assert.ok(k.value !== null);
          assert.ok(k.value >= k.spec.min && k.value <= k.spec.max,
            `${m.kort} ${k.spec.label} = ${k.value} uden for ${k.spec.min}–${k.spec.max}`);
        }
      }
    }
  });

  it("flowet bliver aldrig negativt og aldrig over fuldt udslag", () => {
    for (const b of forloeb) {
      if (b.flowPct === null) continue;
      assert.ok(b.flowPct >= 0 && b.flowPct <= 150, `${b.flowPct}`);
    }
  });
});

describe("maskinerne opfører sig fysisk", () => {
  /** Alle stræk, hvor en elevator har stået i mere end 15 sekunder. */
  function langeStop() {
    const ud: { maskine: string; b: TelemetriBillede }[] = [];
    const stoppetFra = new Map<string, number>();
    for (const b of forloeb) {
      for (const m of b.maskiner) {
        if (m.koerer) { stoppetFra.delete(m.id); continue; }
        if (!stoppetFra.has(m.id)) stoppetFra.set(m.id, b.t);
        if (b.t - stoppetFra.get(m.id)! > 15_000) ud.push({ maskine: m.id, b });
      }
    }
    return ud;
  }

  it("der sker faktisk stop i løbet af tyve minutter", () => {
    assert.ok(forloeb.some((b) => b.koerende < b.maskiner.length), "ingen maskine stoppede");
    assert.ok(langeStop().length > 0, "ingen stop varede over 15 s");
  });

  it("en elevator, der står, har ingen hastighed", () => {
    for (const { maskine, b } of langeStop()) {
      const m = b.maskiner.find((x) => x.id === maskine)!;
      const v = m.kanaler.find((k) => k.spec.id === "hastighed");
      if (!v) continue;
      assert.ok(v.value! < 0.2, `${m.kort} står, men kører ${v.value} m/s`);
    }
  });

  it("en elevator, der står, er ikke 'for langsom'", () => {
    // Under alarmgrænsen er kun en fejl, mens maskinen kører. Står den, er
    // den stoppet — det er en anden besked, og den skal ikke dobbeltmeldes.
    for (const { maskine, b } of langeStop()) {
      const m = b.maskiner.find((x) => x.id === maskine)!;
      const v = m.kanaler.find((k) => k.spec.id === "hastighed");
      if (v) assert.equal(v.alarm, false, `${m.kort} melder for lav fart, mens den står`);
    }
  });

  it("en motor køler af mod hallen, ikke under den", () => {
    for (const { maskine, b } of langeStop()) {
      const m = b.maskiner.find((x) => x.id === maskine)!;
      const t = m.kanaler.find((k) => k.spec.id === "motortemp");
      if (!t) continue;
      assert.ok(t.value! > b.hal[0].value! - 1, `${m.kort} er koldere end hallen: ${t.value}`);
    }
  });

  it("står indgangen, løber der ingenting ind", () => {
    // Påslaget og elevator 743 fodrer måleren. Stopper en af dem, skal
    // flowet falde — ellers måler vi noget, der ikke kan være der.
    const sim = simulator(layout, { planlagteStop: [{ wid: "743", fraS: 30, varighedS: 60 }], stopHverS: 1e9 });
    const b: TelemetriBillede[] = [];
    for (let n = 0; n < 4 * 80; n++) b.push(sim.skridt(DT, T0 + n * DT));
    const foer = b[4 * 25];
    const under = b[4 * 50];
    assert.ok(foer.flowPct! > 60, `flowet var ${foer.flowPct} før stoppet`);
    assert.ok(under.flowPct !== null && under.flowPct < 10, `flowet var ${under.flowPct} under stoppet`);
  });
});

describe("regler, der går igen fra resten af kortet", () => {
  it("en sensorfejl er en fejl, ikke et tal", () => {
    const fejl = forloeb.filter((b) => b.flowPct === null);
    assert.ok(fejl.length > 0, "der kom ingen sensorfejl i forløbet");
    for (const b of fejl) {
      assert.ok(b.flowMa! < FAULT_LOW_MA, "råsignalet skal ligge uden for sløjfen");
    }
  });

  it("et stop tæller først over stopgrænsen", () => {
    // Samme regel som flow.ts: kortere stilstand står i loggen, men tælles ikke.
    const slut = forloeb[forloeb.length - 1];
    const genstart = slut.haendelser.filter((h) => h.tekst.startsWith("Kører igen"));
    const registreret = genstart.filter((h) => h.tekst.includes("stop registreret"));
    for (const h of registreret) {
      const s = Number(h.tekst.match(/(\d+) s/)![1]);
      assert.ok(s >= SIM.stopEfterS, `${h.tekst} blev registreret under grænsen`);
    }
  });

  it("analysens fire klasser summer til hundrede", () => {
    for (const b of forloeb.filter((_, i) => i % 200 === 0)) {
      for (const a of b.analyse) {
        if (!a.andele) continue;
        const sum = a.andele.reduce((x, y) => x + y, 0);
        assert.ok(Math.abs(sum - 100) < 1e-9, `${a.kort}: ${sum}`);
      }
    }
  });

  it("oppetiden er en andel, ikke et gæt", () => {
    const slut = forloeb[forloeb.length - 1];
    assert.ok(slut.oppetidPct !== null);
    assert.ok(slut.oppetidPct! > 0 && slut.oppetidPct! <= 100);
  });
});

describe("analysen og kastebordene", () => {
  /** Gennemsnittet af en størrelse over hele forløbet, pr. maskine. */
  const snit = (kort: string, hent: (b: TelemetriBillede) => number | null | undefined) => {
    const v = forloeb.map(hent).filter((x): x is number => typeof x === "number");
    assert.ok(v.length > 0, `${kort} har ingen tal`);
    return v.reduce((a, b) => a + b, 0) / v.length;
  };
  const fv = (kort: string, i: number) => snit(kort, (b) => b.analyse.find((a) => a.kort === kort)?.andele?.[i]);
  const kanal = (kort: string, id: string) =>
    snit(kort, (b) => b.maskiner.find((m) => m.kort === kort)?.kanaler.find((k) => k.spec.id === id)?.value);

  it("tager prøve fra hvert kastebord, ikke fra sporet", () => {
    const kb = layout.machines.filter((m) => /^kb[-\s]/i.test(m.name)).map((m) => m.name).sort();
    assert.deepEqual(forloeb[0].analyse.map((a) => a.kort).sort(), kb);
  });

  it("FV0 og FV1 dominerer", () => {
    for (const a of forloeb[0].analyse) {
      const [f0, f1, f2, f3] = [0, 1, 2, 3].map((i) => fv(a.kort, i));
      assert.ok(f0 + f1 > 70, `${a.kort}: FV0+FV1 er ${f0 + f1}`);
      assert.ok(Math.min(f0, f1) > Math.max(f2, f3), `${a.kort}: ${[f0, f1, f2, f3]}`);
    }
  });

  it("andet bord i sporet har markant mindre FV3, BIGF og BIGH — og nærmest ingen NOTS", () => {
    for (const [foerste, andet] of [["KB-3N", "KB-3NN"], ["KB-2S", "KB-2SS"]]) {
      assert.ok(fv(andet, 3) < fv(foerste, 3) * 0.5, `FV3 ${andet} mod ${foerste}`);
      assert.ok(kanal(andet, "bigf") < kanal(foerste, "bigf") * 0.75, `BIGF ${andet}`);
      assert.ok(kanal(andet, "bigh") < kanal(foerste, "bigh") * 0.6, `BIGH ${andet}`);
      assert.ok(kanal(andet, "nots") < 1, `NOTS ${andet} er ${kanal(andet, "nots")}`);
      assert.ok(kanal(andet, "nots") < kanal(foerste, "nots") * 0.2, `NOTS ${andet}`);
    }
  });

  it("et bord, der står, tager ingen ny prøve", () => {
    // Der løber intet frø forbi analysen. En ny prøve ville være opdigtet.
    const sim = simulator(layout, { planlagteStop: [{ wid: "636", fraS: 100, varighedS: 150 }], stopHverS: 1e9 });
    const t: (number | null)[] = [];
    for (let i = 0; i < 4 * 260; i++) {
      const b = sim.skridt(DT, T0 + i * DT);
      const m = b.maskiner.find((x) => x.wIds.includes("636"))!;
      if (m.koerer === false) t.push(b.analyse.find((a) => a.id === m.id)!.proeveT);
    }
    assert.ok(t.length > 4 * 60, "bordet stod ikke længe nok til at prøve reglen");
    assert.equal(new Set(t).size, 1, "der kom en prøve, mens bordet stod");
  });

  it("kun FV3 melder — det er den, bordene renser ud", () => {
    const alarmer = forloeb.flatMap((b) => b.haendelser).filter((h) => h.tekst.startsWith("FV"));
    for (const h of alarmer) assert.match(h.tekst, /^FV3 /);
  });
});

describe("kæden tæller hvert signal", () => {
  it("kanalerne, hallen, flowet og ét driftssignal pr. maskine", () => {
    const b = forloeb[forloeb.length - 1];
    const forventet = b.maskiner.reduce((n, m) => n + m.kanaler.length + m.wIds.length, 0) + b.hal.length + 1;
    assert.equal(b.kaede!.signaler, forventet);
  });
});

describe("anlægget som det står", () => {
  const b = tomtBillede(layout, T0, null);

  it("er ikke simuleret, og ingen maskine har et tal", () => {
    assert.equal(b.simuleret, false);
    for (const m of b.maskiner) {
      assert.equal(m.koerer, null, `${m.kort} påstår at vide, om den kører`);
      for (const k of m.kanaler) assert.equal(k.value, null);
    }
    for (const k of b.hal) assert.equal(k.value, null);
  });

  it("har ingen kæde-tal og ingen analyse", () => {
    assert.equal(b.kaede, null);
    for (const a of b.analyse) assert.equal(a.andele, null);
    assert.equal(b.oppetidPct, null);
  });
});

describe("kanalerne passer til maskinerne", () => {
  it("kastebordene har BIGF, BIGH og NOTS", () => {
    const kb = layout.machines.filter((m) => /^kb[-\s]/i.test(m.name));
    assert.equal(kb.length, 4);
    for (const m of kb) {
      const ids = kanalerFor(m).map((k) => k.id);
      for (const id of ["bigf", "bigh", "nots"]) assert.ok(ids.includes(id), `${m.name} mangler ${id}`);
    }
  });

  it("elevatorerne har hastighed", () => {
    for (const m of layout.machines.filter((x) => x.kind === "elevator")) {
      assert.ok(kanalerFor(m).some((k) => k.id === "hastighed"), `${m.name} ${m.wIds[0]}`);
    }
  });

  it("labels holder sig til to ord", () => {
    for (const m of layout.machines) {
      for (const k of kanalerFor(m)) {
        assert.ok(k.label.split(/\s+/).length <= 2, `"${k.label}" er for lang`);
      }
    }
  });
});

describe("alarmerne er værd at lytte til", () => {
  it("ingen kanal står i alarm, når alt kører normalt", () => {
    // Et alarmsystem, der altid melder, lærer folk at se bort fra det. De
    // første sekunder, før noget er stoppet, må intet være i alarm.
    const rolig = forloeb.slice(0, 40).filter((b) => b.koerende === b.maskiner.length);
    assert.ok(rolig.length > 0);
    for (const b of rolig) {
      for (const m of b.maskiner) {
        for (const k of m.kanaler) {
          assert.equal(k.alarm, false, `${m.kort} ${k.spec.label} ${k.value} ${k.spec.unit} alarmerer i ro`);
        }
      }
    }
  });

  it("en maskine på vej op i fart melder ikke 'for langsom'", () => {
    const slut = forloeb[forloeb.length - 1];
    const lav = slut.haendelser.filter((h) => h.niveau === "alarm" && /Omdrejninger|Hastighed/.test(h.tekst));
    for (const h of lav) {
      // Hver lav-alarm skal ligge mindst en indkøringstid efter en genstart
      // af samme maskine — ellers er det indkøringen, der alarmerer.
      const start = slut.haendelser.find((g) => g.hvor === h.hvor && g.tekst.startsWith("Kører igen") && g.t <= h.t);
      if (start) assert.ok(h.t - start.t >= INDKOERING_S * 1000, `${h.hvor}: ${h.tekst} under indkøring`);
    }
  });
});

// ---------------------------------------------------------------------------
// Kæden og flaskehalsen

describe("kædens regnskab", () => {
  it("ingen række forsvinder: modtaget = skrevet + i kø + tabt", () => {
    for (const b of forloeb.filter((_, i) => i % 400 === 0)) {
      const k = b.kaede!;
      const rest = k.modtaget - k.skrevetIalt - k.koe - k.tabt;
      assert.ok(Math.abs(rest) < 1.5, `regnskabet mangler ${rest} rækker ved ${b.t - T0} ms`);
    }
  });

  it("i normal drift kan alle led følge med, og der er ingen kø", () => {
    // Første episode kommer efter FLASKEHALS.foersteS. Før den er alt roligt.
    const roligt = forloeb.slice(0, 4 * 80);
    for (const b of roligt) {
      const k = b.kaede!;
      assert.equal(k.flaskehals, null);
      assert.equal(k.koe, 0);
      for (const l of k.led) assert.ok(l.udnyttelse < 1, `${l.id} er over loftet i ro`);
    }
  });

  it("databasen er det led, der rammer loftet først, når anlægget vokser", () => {
    // Det tal viser, hvor en flaskehals ville opstå: det led med plads til
    // færrest signaler.
    const k = forloeb[10].kaede!;
    const faerrest = [...k.led].sort((a, b) => a.pladsTil - b.pladsTil)[0];
    assert.equal(faerrest.id, "mssql");
    assert.ok(k.signaler < faerrest.pladsTil, "anlægget er ikke over loftet i dag");
  });
});

describe("flaskehalsen i demoen", () => {
  const i = forloeb.findIndex((b) => b.kaede!.flaskehals !== null);

  it("opstår, når databasen skriver langsommere, end rækkerne kommer", () => {
    assert.ok(i > 0, "der kom ingen flaskehals");
    const k = forloeb[i].kaede!;
    assert.equal(k.flaskehals, "mssql");
    assert.ok(k.dbKapacitet < k.raekkerPrS, "kapaciteten skal være under det, der kommer ind");
    assert.ok(k.aarsag, "en flaskehals i demoen har en årsag");
  });

  it("køen og forsinkelsen vokser, så længe den står", () => {
    const senere = forloeb[i + 4 * 30].kaede!;
    assert.ok(senere.koe > forloeb[i].kaede!.koe);
    assert.ok(senere.forsinkelseS > forloeb[i].kaede!.forsinkelseS);
  });

  it("Kædevagten melder, når data er forsinket", () => {
    const slut = forloeb[forloeb.length - 1];
    assert.ok(
      slut.haendelser.some((h) => h.hvor === "Kædevagt" && h.niveau === "alarm" && /forsinket/.test(h.tekst)),
      "Kædevagten sagde intet",
    );
  });

  it("kæden indhenter køen bagefter", () => {
    const efter = forloeb.slice(i).findIndex((b) => b.kaede!.flaskehals === null);
    assert.ok(efter > 0, "køen blev aldrig indhentet");
    assert.equal(forloeb[i + efter].kaede!.koe, 0);
  });

  it("siger aldrig 'kæden svarer' uden at nævne, at data halter", () => {
    // Den fejl, reglen kom af: kvartersrunden sagde "Kæden svarer", mens
    // data var 38 sekunder bagud. Teknisk sandt, og vildledende.
    for (const b of forloeb) {
      const h = b.haendelser[0];
      if (!h || h.t !== b.t || h.tekst !== "Kæden svarer") continue;
      assert.ok(b.kaede!.forsinkelseS < 1, `"Kæden svarer" med ${b.kaede!.forsinkelseS} s forsinkelse`);
    }
  });
});

describe("en flaskehals, der ikke går over", () => {
  const sim = simulator(layout, { tvungenFlaskehals: true });
  const tvunget: TelemetriBillede[] = [];
  for (let n = 0; n < 4 * 60 * 15; n++) tvunget.push(sim.skridt(DT, T0 + n * DT));

  it("fylder bufferen, og først da tabes data", () => {
    const slut = tvunget[tvunget.length - 1].kaede!;
    assert.ok(slut.tabt > 0, "bufferen blev aldrig fuld på et kvarter");
    for (const b of tvunget) {
      const k = b.kaede!;
      assert.ok(k.koe <= k.buffer, "køen voksede ud over bufferen");
      if (k.koe < k.buffer) assert.equal(k.tabt, 0, "data tabt, før bufferen var fuld");
      else break;
    }
  });

  it("melder, når data begynder at gå tabt", () => {
    const slut = tvunget[tvunget.length - 1];
    assert.ok(slut.haendelser.some((h) => /Buffer fuld/.test(h.tekst) && h.niveau === "alarm"));
  });

  it("loggen siger Server og DIN-skab — ikke edge og kobler", () => {
    // Kæden på skærmen har de navne. En log, der siger noget andet, ville
    // tale om led, man ikke kan finde.
    for (const h of [...tvunget, ...forloeb].flatMap((b) => b.haendelser)) {
      assert.doesNotMatch(`${h.hvor} ${h.tekst}`, /kobler|edge/i, `${h.hvor}: ${h.tekst}`);
    }
  });

  it("holder regnskabet også, når data tabes", () => {
    const k = tvunget[tvunget.length - 1].kaede!;
    assert.ok(Math.abs(k.modtaget - k.skrevetIalt - k.koe - k.tabt) < 1.5);
  });
});

// ---------------------------------------------------------------------------
// Driftsagenten

/** Kør en simulation og saml hver hændelse én gang, på det skridt den opstod. */
function koerMed(valg: Parameters<typeof simulator>[1], sekunder: number) {
  const sim = simulator(layout, valg);
  const billeder: TelemetriBillede[] = [];
  for (let n = 0; n < 4 * sekunder; n++) billeder.push(sim.skridt(DT, T0 + n * DT));
  const haendelser = billeder.flatMap((b) => b.haendelser.filter((h) => h.t === b.t));
  return { billeder, haendelser: haendelser.sort((a, b) => a.t - b.t) };
}

// KB-3N går i stå efter et minut og står i to et halvt. Bufferen foran den
// fyldes af Carter N — og løber over efter omkring et minut, hvis ingen gør
// noget. Tilfældige stop er slået fra, så intet andet forstyrrer.
const STOP_KB3N = { wid: "636", fraS: 60, varighedS: 150 };
const scenarie = { planlagteStop: [STOP_KB3N], stopHverS: 1e9 };
const sek = (t: number) => (t - T0) / 1000;

describe("Driftsagenten", () => {
  const med = koerMed({ ...scenarie }, 300);
  const uden = koerMed({ ...scenarie, ai: false }, 300);
  const stopN = med.haendelser.find((h) => h.ai && h.tekst.startsWith("Stopper spor N"));
  const startN = med.haendelser.find((h) => h.ai && h.tekst.startsWith("Starter spor N"));

  it("uden den løber bufferen foran den stoppede maskine over", () => {
    assert.ok(uden.haendelser.some((h) => /Overløb/.test(h.tekst) && h.hvor === "KB-3N"),
      "ingen overløb — så beviser testen intet om agenten");
  });

  it("med den stopper sporet, før bufferen løber over", () => {
    assert.ok(stopN, "agenten stoppede ikke spor N");
    assert.match(stopN.tekst, /KB-3N står · buffer \d+ %/);
    assert.ok(!med.haendelser.some((h) => /Overløb/.test(h.tekst)), "der var overløb alligevel");
  });

  it("handler ikke på én prøve, men heller ikke for sent", () => {
    // Fundet skal holde i overvejelsestiden, og det skal ske i god tid før
    // de hundrede procent: ved omkring 55, ikke ved 99.
    const pct = Number(stopN!.tekst.match(/buffer (\d+) %/)![1]);
    assert.ok(pct >= 55 && pct < 70, `stoppede ved ${pct} %`);
  });

  it("starter sporet igen, når årsagen er væk", () => {
    assert.ok(startN, "sporet blev aldrig startet igen");
    assert.match(startN.tekst, /KB-3N kører igen/);
    assert.ok(sek(startN.t) >= STOP_KB3N.fraS + STOP_KB3N.varighedS, "startede, før KB-3N kørte");
  });

  it("et stoppet spor koster gennemløb — det halve", () => {
    const under = med.billeder.filter((b) => b.t > stopN!.t + 20_000 && b.t < startN!.t && b.flowPct !== null);
    const gns = under.reduce((n, b) => n + b.flowPct!, 0) / under.length;
    assert.ok(gns > 30 && gns < 62, `gennemløbet var ${gns.toFixed(1)} % med ét spor`);
  });

  it("fordeleren sender alt til det spor, der kører", () => {
    const b = med.billeder.find((x) => x.t > stopN!.t + 20_000)!;
    const andelN = b.maskiner.find((m) => m.navn === "Fordeler")!.kanaler.find((k) => k.spec.id === "andelN")!;
    assert.ok(andelN.value! < 10, `fordeleren sender stadig ${andelN.value} % til spor N`);
  });

  it("skelner sit eget stop fra en fejl", () => {
    // KB-3N er fejlen. Resten af sporet står på agentens beslutning.
    const b = med.billeder.find((x) => x.t > stopN!.t + 5_000)!;
    const kb = b.maskiner.find((m) => m.wIds.includes("636"))!;
    const jet = b.maskiner.find((m) => m.navn === "Jetpealer N")!;
    assert.equal(kb.koerer, false);
    assert.equal(kb.styret, false, "fejlen må ikke se ud som en beslutning");
    assert.equal(jet.koerer, false);
    assert.equal(jet.styret, true);
  });

  it("siger, hvad den gør og hvorfor", () => {
    for (const h of med.haendelser.filter((x) => x.ai && /^(Stopper|Starter)/.test(x.tekst))) {
      assert.match(h.tekst, / · ./, `"${h.tekst}" har ingen årsag`);
    }
    assert.ok(med.billeder[med.billeder.length - 1].ai!.beslutninger >= 2);
  });
});

describe("Driftsagenten, når den ikke kan se", () => {
  // Kæden halter fra start, så data er bagud, før KB-3N går i stå.
  const blind = koerMed({ ...scenarie, tvungenFlaskehals: true }, 240);

  it("holder sine beslutninger, når data er forsinket", () => {
    assert.ok(blind.haendelser.some((h) => h.ai && h.tekst.startsWith("Holder")), "agenten sagde ikke, at den holdt");
    assert.ok(!blind.haendelser.some((h) => h.ai && /^(Stopper|Starter) spor/.test(h.tekst)),
      "agenten handlede på data, den ikke kunne stole på");
  });

  it("stopper ikke linjen, fordi databasen halter", () => {
    const b = blind.billeder[4 * 50];
    assert.ok(b.kaede!.forsinkelseS > 15);
    assert.ok(b.ai!.spor.every((x) => !x.stoppet), "et spor blev stoppet for en langsom database");
  });

  it("og så løber bufferen over — det er prisen, og den skal kunne ses", () => {
    assert.ok(blind.haendelser.some((h) => /Overløb/.test(h.tekst)));
  });
});

describe("partiklernes fart", () => {
  const spec = (id: string, nominal: number) =>
    ({ id, label: id, unit: "", maaler: "speed", nominal, spredning: 0, min: 0, max: 99, decimaler: 0 });

  it("står stille, når vi ikke ved, om maskinen kører", () => {
    // Den rigtige visning i dag: ingen driftssignaler, ingen bevægelse.
    for (const m of tomtBillede(layout, T0, null).maskiner) assert.equal(maskinFart(m), 0, m.kort);
  });

  it("følger elevatorens hastighed — og bremser ned, når den stopper", () => {
    const k = (v: number) => [{ spec: spec("hastighed", 2.4), value: v, alarm: false }];
    assert.ok(Math.abs(maskinFart({ koerer: true, kanaler: k(2.4) }) - 1) < 1e-9);
    // Lige efter et stop er farten på vej ned, ikke væk.
    const bremser = maskinFart({ koerer: false, kanaler: k(1.2) });
    assert.ok(bremser > 0 && bremser < 1, `${bremser}`);
    assert.equal(maskinFart({ koerer: false, kanaler: k(0) }), 0);
  });

  it("uden en hastighed er det kører eller står", () => {
    assert.equal(maskinFart({ koerer: true, kanaler: [] }), 1);
    assert.equal(maskinFart({ koerer: false, kanaler: [] }), 0);
  });

  it("i demoen bevæger en maskine, der står, sig aldrig hurtigere, end den kørte", () => {
    for (const b of forloeb.filter((_, i) => i % 40 === 0)) {
      for (const m of b.maskiner) {
        const f = maskinFart(m);
        assert.ok(f >= 0 && f <= 1.5, `${m.kort}: ${f}`);
        if (m.koerer === false && !m.kanaler.some((k) => k.spec.id === "hastighed" || k.spec.id === "rpm")) {
          assert.equal(f, 0, `${m.kort} står, men bevæger sig`);
        }
      }
    }
  });
});
