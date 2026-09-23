import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sliberi from "../../data/lines/sliberi.json";
import { layoutLine } from "./layout";
import { FAULT_LOW_MA } from "./live-source";
import { kanalerFor, simulator, tomtBillede, INDKOERING_S, SIM, type TelemetriBillede } from "./telemetri";
import type { LineData } from "./types";

const layout = layoutLine(sliberi as LineData);
const T0 = 1_750_000_000_000;
const DT = 250;

/** Kør simulatoren `n` skridt og saml alle billeder. */
function koer(n: number, seed = 743): TelemetriBillede[] {
  const sim = simulator(layout, seed);
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
    const indgang = forloeb.filter((b) =>
      b.maskiner.some((m) => (m.wIds.includes("743") || /påslag/i.test(m.navn)) && m.koerer === false));
    assert.ok(indgang.length > 0, "indgangen stoppede ikke i forløbet");
    const efter = indgang.slice(40);
    assert.ok(efter.some((b) => b.flowPct !== null && b.flowPct < 10), "flowet faldt ikke");
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
        const sum = a.andele!.reduce((x, y) => x + y, 0);
        assert.ok(Math.abs(sum - 100) < 1e-9, `spor ${a.lane}: ${sum}`);
      }
    }
  });

  it("oppetiden er en andel, ikke et gæt", () => {
    const slut = forloeb[forloeb.length - 1];
    assert.ok(slut.oppetidPct !== null);
    assert.ok(slut.oppetidPct! > 0 && slut.oppetidPct! <= 100);
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
  const sim = simulator(layout, 743, undefined, true);
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

  it("holder regnskabet også, når data tabes", () => {
    const k = tvunget[tvunget.length - 1].kaede!;
    assert.ok(Math.abs(k.modtaget - k.skrevetIalt - k.koe - k.tabt) < 1.5);
  });
});
