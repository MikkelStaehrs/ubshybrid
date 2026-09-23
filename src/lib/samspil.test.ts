import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sliberi from "../../data/lines/sliberi.json";
import { DRIFTSAGENT, FLASKEHALS, FLOW_NOMINAL, ORDRE, PROEVERATE, SIMULERING } from "../../data/fremskrivning";
import { layoutLine } from "./layout";
import {
  kildeTekst, ordreRapport, planMed, prognose, stopGrund, vaelgPlan, varighed,
  type Besked, type Gruppe,
} from "./samspil";
import { samlLog, samlSamtale, simulator, type Haendelse, type TelemetriBillede, type Uro } from "./telemetri";
import type { LineData } from "./types";

const layout = layoutLine(sliberi as LineData);
const T0 = new Date("2026-09-23T06:00:00").getTime();
const ordre = {
  ordreNr: ORDRE.ordreNr, estimeretKg: ORDRE.estimeretKg, kasser: ORDRE.kasser,
  nominalTPrT: FLOW_NOMINAL["FT-743"],
};

interface Kig {
  t: number;
  fase: NonNullable<TelemetriBillede["ordre"]>["fase"];
  uro: Uro[];
  forsinkelseS: number;
  tabt: number;
  proeveTrin: number;
  /** Maskinernes trin, og om de er slukket efter planen. */
  maskiner: { kort: string; step: number; koerer: boolean | null; styret: boolean; planlagt: boolean }[];
}

/**
 * Kør en hel ordre. Mellemskridtene tager intet billede; hvert tiende sekund
 * gør de — og under opstart og udløb hvert sekund, så rækkefølgen kan ses.
 */
function koerOrdre(valg: { seed?: number; tvungenFlaskehals?: boolean } = {}) {
  const sim = simulator(layout, { ...valg, ordre });
  const trin = new Map(layout.machines.map((m) => [m.id, m.step]));
  let t = T0;
  let log: Haendelse[] = [];
  let samtale: Besked[] = [];
  const kig: Kig[] = [];
  let sidst: TelemetriBillede | null = null;
  for (let i = 0; i < 20 * 3600; i++) {
    t += 1000;
    const tæt = !sidst || sidst.ordre!.fase === "opstart" || sidst.ordre!.fase === "udloeb";
    if (!tæt && i % 10 !== 0) { sim.frem(1000, t); continue; }
    const b = sim.skridt(1000, t);
    sidst = b;
    log = samlLog(log, b.haendelser, 100_000);
    samtale = samlSamtale(samtale, b.samtale, 100_000);
    kig.push({
      t, fase: b.ordre!.fase, uro: b.uro, forsinkelseS: b.kaede!.forsinkelseS, tabt: b.kaede!.tabt,
      proeveTrin: b.ordre!.proeveTrin,
      maskiner: b.maskiner.map((m) => ({ kort: m.kort, step: trin.get(m.id)!, koerer: m.koerer, styret: m.styret, planlagt: m.planlagt })),
    });
    if (b.ordre!.fase === "faerdig") break;
  }
  // Ældste først, så forløbet kan læses i rækkefølge.
  return { sidst: sidst!, log: [...log].reverse(), samtale: [...samtale].reverse(), kig };
}

const forloeb = koerOrdre();

describe("ordren fra start til slut", () => {
  it("bliver færdig: alle kasser tippet, alle kilo kørt, en rapport til operatøren", () => {
    const o = forloeb.sidst.ordre!;
    assert.equal(o.fase, "faerdig");
    assert.equal(o.kasserTippet, o.kasser);
    assert.ok(Math.abs(o.kgInd - o.estimeretKg) < 1e-6, `${o.kgInd} kg`);
    const rapport = forloeb.samtale.find((b) => b.type === "rapport" && b.linjer);
    assert.ok(rapport, "ingen rapport, da ordren var færdig");
    assert.equal(rapport.til, "Operatør");
    assert.ok(rapport.linjer!.some((l) => l.includes(`${o.kasser} kasser`)));
  });

  it("startes bagfra: kører en maskine, kører alle efter den også", () => {
    // Ellers fødes en buffer, før maskinen efter den kan tage imod.
    for (const k of forloeb.kig.filter((x) => x.fase === "opstart")) {
      for (const a of k.maskiner) {
        if (!a.koerer) continue;
        for (const b of k.maskiner) {
          if (b.step > a.step) assert.ok(b.koerer, `${a.kort} kører, men ${b.kort} efter den gør ikke`);
        }
      }
    }
  });

  it("stoppes forfra: står en maskine efter planen, står alle før den også", () => {
    // Kun det planlagte stop tæller. En maskine kan stå af en anden grund,
    // da udløbet begyndte — et spor, agenten havde stoppet.
    for (const k of forloeb.kig.filter((x) => x.fase === "udloeb")) {
      for (const b of k.maskiner) {
        if (!b.planlagt) continue;
        for (const a of k.maskiner) {
          if (a.step < b.step) assert.ok(a.planlagt, `${b.kort} er stoppet efter planen, men ${a.kort} før den er ikke`);
        }
      }
    }
  });

  it("en maskine, der er slukket efter planen, er ikke en fejl", () => {
    // Under opstart står de fleste — på planen, ikke på et stop.
    const start = forloeb.kig.find((x) => x.fase === "opstart")!;
    for (const m of start.maskiner) if (!m.koerer) assert.ok(m.styret, `${m.kort} står som en fejl`);
  });

  it("tiden går langsomt, når der sker noget — og kun da", () => {
    const koerer = forloeb.kig.filter((x) => x.fase === "koerer");
    const rolig = koerer.filter((x) => x.uro.length === 0).length / koerer.length;
    assert.ok(rolig > 0.7, `kun ${Math.round(rolig * 100)} % af tiden var rolig`);
    assert.ok(forloeb.kig.filter((x) => x.fase === "opstart").every((x) => x.uro.some((u) => u.tekst === "Opstart")));
  });

  it("en fejl skilles fra en beslutning: en maskine, der står, er en fejl — et spor, agenten stoppede, er ikke", () => {
    // Et styret stop er rav, en fejl er rød. Det gælder også listen over det, der sker.
    const alle = forloeb.kig.flatMap((x) => x.uro);
    assert.ok(alle.some((u) => u.fejl && / står$/.test(u.tekst) && !u.tekst.startsWith("Spor")));
    for (const u of alle) {
      if (u.tekst.startsWith("Spor ") || u.tekst === "Opstart" || u.tekst === "Udløb") assert.equal(u.fejl, false, u.tekst);
    }
  });
});

describe("agenterne imellem", () => {
  it("hver beslutning og hvert forslag har en begrundelse", () => {
    for (const b of forloeb.samtale) {
      if (b.type === "beslutning" || b.type === "forslag") {
        assert.ok(b.grund && b.grund.length > 0, `${b.fra}: "${b.tekst}" uden begrundelse`);
      }
    }
  });

  it("løbenummeret giver rækkefølgen, også når tiden er den samme", () => {
    const nr = forloeb.samtale.map((b) => b.nr);
    assert.deepEqual(nr, [...nr].sort((a, b) => a - b));
    assert.equal(new Set(nr).size, nr.length);
  });

  it("et varslet stop blev set komme — af linjeagenten, før det skete", () => {
    const varslede = forloeb.samtale.filter((b) => b.type === "iagttagelse" && /står\..*/.test(b.tekst) && b.grund?.startsWith("Varslet"));
    assert.ok(varslede.length > 0, "ordren havde intet varslet stop at prøve reglen på");
    for (const stop of varslede) {
      const kort = stop.tekst.split(" står")[0];
      const set = forloeb.samtale.find((b) => b.type === "forslag" && b.tekst === `Se på ${kort} nu, før den stopper.` && b.t < stop.t);
      assert.ok(set, `${kort} stoppede uden at være set komme`);
    }
  });

  it("varsler kun stop, der kommer", () => {
    // Et "se på den nu" uden et stop bagefter lærer operatøren at se bort fra det.
    for (const v of forloeb.samtale.filter((b) => b.type === "forslag" && b.tekst.startsWith("Se på "))) {
      const kort = v.tekst.slice("Se på ".length).split(" nu")[0];
      const stop = forloeb.log.find((h) => h.hvor === kort && h.tekst === "Stoppet" && h.t >= v.t && h.t - v.t <= (SIMULERING.varselS + 60) * 1000);
      assert.ok(stop, `${kort} blev meldt, men stoppede ikke`);
    }
  });

  it("friktion ses komme, før Driftsagent stopper sporet", () => {
    const stop = forloeb.samtale.filter((b) => b.type === "handling" && b.grund?.includes(`grænsen er ${DRIFTSAGENT.froeStopC} °C`));
    for (const s of stop) {
      const set = forloeb.samtale.find((b) => b.type === "iagttagelse" && b.tekst.startsWith("Frøet i") && b.t < s.t && s.t - b.t < 15 * 60_000);
      assert.ok(set, "et spor blev stoppet for varme, ingen havde set komme");
    }
  });

  it("en anbefaling til operatøren er konkret: én indstilling, ét trin, med det forventede", () => {
    const forslag = forloeb.samtale.filter((b) => b.type === "forslag" && /^(Hæv|Sænk) (tværhældningen|luften) på KB-/.test(b.tekst));
    assert.ok(forslag.length > 0, "ordren gav ingen anbefaling at prøve reglen på");
    for (const b of forslag) {
      assert.equal(b.til, "Operatør");
      assert.match(b.tekst, /fra [\d,]+ til [\d,]+/);
      assert.match(b.grund ?? "", /Venter/);
    }
  });
});

describe("når MSSQL ikke kan følge med", () => {
  it("holder Dataagenten data i tide — Driftsagent bliver aldrig blind", () => {
    assert.ok(forloeb.samtale.some((b) => b.fra === "Kædevagt" && b.tekst.startsWith("MSSQL skriver")), "ordren havde ingen episode at prøve reglen på");
    const maks = Math.max(...forloeb.kig.map((k) => k.forsinkelseS));
    assert.ok(maks < FLASKEHALS.forsinkelseAlarmS, `data var ${maks.toFixed(1)} s bagud`);
    assert.equal(forloeb.sidst.kaede!.tabt, 0);
  });

  it("vejer at skrue linjen ned — og afviser det med tallene", () => {
    const godkendt = forloeb.samtale.find((b) => b.fra === "Operatøragent" && b.til === "Dataagent" && b.type === "beslutning");
    assert.ok(godkendt);
    assert.match(godkendt.grund!, /afvist/);
    assert.match(godkendt.grund!, /0 færre rækker/);
    // Prisen er aldrig nul: at skrue ned koster tons, også under en opstart.
    const pris = Number(godkendt.grund!.match(/koste ([\d,]+) t\/hr/)![1].replace(",", "."));
    assert.ok(pris > 0, `at skrue ned så ud til at koste ${pris} t/hr`);
  });

  it("beslutter før den handler", () => {
    for (const h of forloeb.samtale.filter((b) => b.tekst.startsWith("Prøverate sænket"))) {
      const b = [...forloeb.samtale].reverse().find((x) => x.nr < h.nr && x.til === "Dataagent" && x.type === "beslutning");
      assert.ok(b && h.t - b.t < 5_000, "Dataagenten sænkede raten uden en beslutning");
    }
  });

  it("sætter raten op igen, når databasen kan", () => {
    assert.equal(forloeb.sidst.ordre!.proeveTrin, 0);
  });

  it("klarer også en database, der aldrig kommer sig", () => {
    const hele = koerOrdre({ tvungenFlaskehals: true });
    assert.equal(hele.sidst.ordre!.fase, "faerdig");
    assert.ok(Math.max(...hele.kig.map((k) => k.forsinkelseS)) < FLASKEHALS.forsinkelseAlarmS);
    assert.equal(hele.sidst.kaede!.tabt, 0);
  });
});

describe("Dataagentens regnestykke", () => {
  const antal: Record<Gruppe, number> = { hurtig: 17, middel: 21, langsom: 33, di: 29 };

  it("tager så få trin som muligt", () => {
    // 900 r/s kan tage fuld rate; der er intet at skrue på.
    assert.equal(planMed(antal, 0).raekkerPrS, 400);
    const { plan, nok } = vaelgPlan(antal, 400);
    assert.equal(plan.trin, 1);
    assert.ok(nok);
  });

  it("tager flere trin, jo mindre databasen kan", () => {
    const { plan, alle } = vaelgPlan(antal, 180);
    assert.equal(plan.trin, 3);
    assert.ok(plan.raekkerPrS <= 180 * PROEVERATE.luft);
    // Hvert trin giver færre rækker end det før.
    for (let i = 1; i < alle.length; i++) assert.ok(alle[i].raekkerPrS < alle[i - 1].raekkerPrS);
  });

  it("siger det, når selv alle trin ikke er nok", () => {
    const { nok } = vaelgPlan(antal, 50);
    assert.equal(nok, false);
  });

  it("rører aldrig de hurtige signaler", () => {
    for (let i = 0; i <= PROEVERATE.trin.length; i++) assert.equal(planMed(antal, i).rate.hurtig, PROEVERATE.normal);
  });
});

describe("tal og tider i beskederne", () => {
  it("skriver varigheder, som man siger dem", () => {
    assert.equal(varighed(35), "35 s");
    assert.equal(varighed(252), "4 min 12 s");
    assert.equal(varighed(4800), "1 t 20 min");
  });

  it("regner prognosen af gennemløbet indtil nu", () => {
    // 6.000 kg på 6 timer: 1.000 kg i timen, 6.000 kg tilbage — 6 timer til.
    const p = prognose({ kgInd: 6000, estimeretKg: 12000, koertFra: 0, nu: 6 * 3_600_000 });
    assert.equal(p, 12 * 3_600_000);
    assert.equal(prognose({ kgInd: 0, estimeretKg: 12000, koertFra: 0, nu: 1000 }), null);
  });

  it("rapporten er tallene, ikke ord", () => {
    const linjer = ordreRapport({
      ordreNr: "X", kg: 12000, kasser: 24, startT: 0, slutT: 12 * 3_600_000, oppetidPct: 97.5,
      sporStop: [{ lane: "N", fra: 0, til: 600_000, aarsag: "x" }], maskinstop: 2, mssqlEpisoder: 0,
      maksForsinkelseS: 0, tabt: 0, sensorfejl: 1, fv3: [{ kort: "KB-3N", snit: 8 }], beslutninger: 5, beskeder: 40,
    });
    assert.equal(linjer[0], "12.000 kg · 24 kasser · 12 t 0 min");
    assert.match(linjer[1], /^1,00 t\/hr i snit · oppetid 97,5 %$/);
    assert.match(linjer[2], /spor N stod 1 gang, 10 min 0 s · spor S stod ikke/);
    assert.equal(linjer[3], "MSSQL fulgte med hele vejen");
  });

  it("samtalen husker hver besked én gang, nyeste først", () => {
    const b = (nr: number): Besked => ({ nr, t: 0, fra: "a", til: "b", type: "iagttagelse", tekst: "x" });
    const s = samlSamtale(samlSamtale([], [b(2), b(1)]), [b(3), b(2)]);
    assert.deepEqual(s.map((x) => x.nr), [3, 2, 1]);
    assert.equal(samlSamtale(s, [b(3)]), s);
  });
});

describe("mærkerne på skærmen", () => {
  it("hvem der tænkte, står ens overalt", () => {
    assert.equal(kildeTekst({ kilde: "claude", ms: 3400 }), "Claude · 3,4 s");
    assert.equal(kildeTekst({ kilde: "claude", ms: 3400 }, false), "Claude");
    assert.equal(kildeTekst({ kilde: "regel" }), "Regel");
    assert.equal(kildeTekst({}), "Regel");
  });

  it("hvorfor reglerne tog over, i højst to ord — aldrig API'ets fejlbesked", () => {
    for (const [tekst, kort] of [
      ["Loftet for kørslen er nået", "Loft nået"],
      ["Loftet for i dag er nået", "Loft nået"],
      ["Ingen API-nøgle på serveren", "Ingen nøgle"],
      ["Kunne ikke nå serveren", "Ingen forbindelse"],
      ["Claude svarede 400: This API key is not scoped to a workspace …", "Claude svarer ikke"],
    ]) {
      assert.equal(stopGrund(tekst), kort);
      assert.ok(kort.split(" ").length <= 3);
    }
  });
});

describe("uden en ordre", () => {
  it("er simulatoren den samme som altid: ingen samtale, ingen ordre, ingen uro", () => {
    const sim = simulator(layout);
    let b: TelemetriBillede | null = null;
    for (let i = 0; i < 400; i++) b = sim.skridt(250, T0 + i * 250);
    assert.deepEqual(b!.samtale, []);
    assert.equal(b!.ordre, null);
    assert.deepEqual(b!.uro, []);
  });
});
