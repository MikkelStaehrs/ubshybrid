import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lineOpsFor } from "./agents";
import {
  flowLimits, keyFigures, levelOf, nominalFor, rateFrom, runSegments, runStateFrom, stopsFrom,
  FLOW_HIGH_PCT, FLOW_LOW_PCT, HISTORIK_MIN_MS, KOERER_OVER_PCT, STAAR_UNDER_PCT,
  type FlowSample, type RunState,
} from "./flow";
import { scaleFromMa } from "./live-source";

const ops = lineOpsFor("sliberi");

describe("kalibrering", () => {
  it("er ikke udfyldt endnu, og så findes takten ikke", () => {
    // 100 %-punktet er en aftale med driften. Indtil den er lavet, må
    // kortet vise procent og intet andet — et gættet tons-tal ville se ud
    // som en måling.
    assert.equal(nominalFor(ops, "FT-743"), null);
    assert.equal(rateFrom(100, nominalFor(ops, "FT-743")), null);
  });

  it("giver en takt, så snart kapaciteten er sat", () => {
    const med = { ...ops!, flow: { nominal: { "FT-743": 32 } } };
    assert.equal(nominalFor(med, "FT-743"), 32);
    assert.equal(rateFrom(100, 32), 32);
    assert.equal(rateFrom(50, 32), 16);
    // Fuldt udslag er halvanden gang kapaciteten.
    assert.equal(rateFrom(150, 32), 48);
  });

  it("ingen måling giver ingen takt — heller ikke nul", () => {
    assert.equal(rateFrom(null, 32), null);
  });
});

describe("niveauer", () => {
  it("arver 70 og 100 procent, når linjen ikke siger andet", () => {
    assert.deepEqual(flowLimits(ops), { lowPct: FLOW_LOW_PCT, highPct: FLOW_HIGH_PCT });
  });

  it("deler skalaen i lavt, OK og højt", () => {
    const l = flowLimits(ops);
    assert.equal(levelOf(0, l), "lav");
    assert.equal(levelOf(69.9, l), "lav");
    assert.equal(levelOf(70, l), "ok");
    assert.equal(levelOf(100, l), "ok");
    assert.equal(levelOf(100.1, l), "hoej");
    assert.equal(levelOf(150, l), "hoej");
  });

  it("følger linjens egne grænser, når den har nogen", () => {
    const stram = flowLimits({ ...ops!, flow: { nominal: {}, lowPct: 90, highPct: 105 } });
    assert.equal(levelOf(85, stram), "lav");
    assert.equal(levelOf(102, stram), "ok");
  });
});

describe("kører eller kører ikke", () => {
  it("over den øvre grænse kører den", () => {
    assert.equal(runStateFrom(KOERER_OVER_PCT + 0.1, null), "koerer");
    assert.equal(runStateFrom(80, "staar"), "koerer");
  });

  it("under den nedre grænse står den", () => {
    assert.equal(runStateFrom(STAAR_UNDER_PCT - 0.1, null), "staar");
    assert.equal(runStateFrom(0, "koerer"), "staar");
  });

  it("holder tilstanden i båndet imellem — begge veje", () => {
    const midt = (STAAR_UNDER_PCT + KOERER_OVER_PCT) / 2;
    // På vej ned: den kørte, og båndet alene vælter den ikke.
    assert.equal(runStateFrom(midt, "koerer"), "koerer");
    // På vej op: den stod, og båndet alene starter den ikke.
    assert.equal(runStateFrom(midt, "staar"), "staar");
  });

  it("uden en forrige tilstand er båndet ikke drift", () => {
    // Under fem procent af kapaciteten løber der reelt ingenting. Båndet er
    // til for at holde tilstanden i ro, ikke for at skjule et flow.
    const midt = (STAAR_UNDER_PCT + KOERER_OVER_PCT) / 2;
    assert.equal(runStateFrom(midt, null), "staar");
    assert.equal(runStateFrom(midt, "fejl"), "staar");
  });

  it("et stop på 4,0 mA er en måling, ikke en fejl", () => {
    // Sløjfen lever, der løber bare ingenting.
    const pct = scaleFromMa(4).value;
    assert.equal(pct, 0);
    assert.equal(runStateFrom(pct, "koerer"), "staar");
  });

  it("sensorfejl er sin egen tilstand", () => {
    assert.equal(runStateFrom(null, "koerer"), "fejl");
    assert.equal(runStateFrom(scaleFromMa(3.2).value, "koerer"), "fejl");
  });

  it("vipper ikke, når signalet flakser omkring nul", () => {
    // Uden hysterese ville den her række give et stop i sekundet.
    const t0 = 1_700_000_000_000;
    const pcts = [80, 4, 3, 4.5, 3.2, 4.8, 80];
    const samples: FlowSample[] = pcts.map((v, i) => ({ t: t0 + i * 1000, value: v }));
    const states = runSegments(samples).map((s) => s.state);
    assert.deepEqual(states, ["koerer"], `flaksede: ${states.join(", ")}`);
  });
});

// ---------------------------------------------------------------------------

const t0 = 1_700_000_000_000;

/** Prøver ét sekund fra hinanden. null betyder sensorfejl. */
function serie(values: (number | null)[]): FlowSample[] {
  return values.map((value, i) => ({ t: t0 + i * 1000, value }));
}

describe("tidslinje og stop", () => {
  it("lægger prøverne sammen til sammenhængende stræk", () => {
    const segs = runSegments(serie([80, 80, 0, 0, 0, 80]));
    assert.deepEqual(segs.map((s) => s.state), ["koerer", "staar", "koerer"]);
    // Strækkene hænger sammen — ingen huller i tidslinjen.
    for (let i = 1; i < segs.length; i++) assert.equal(segs[i].from, segs[i - 1].to);
  });

  it("et stop er først et stop, når det har varet længe nok", () => {
    const stopAfter = 120;
    // 60 sekunder stilstand: for kort.
    const kort = runSegments(serie([80, ...Array(60).fill(0), 80]));
    assert.equal(stopsFrom(kort, stopAfter).length, 0);
    // 200 sekunder: langt nok.
    const langt = runSegments(serie([80, ...Array(200).fill(0), 80]));
    assert.equal(stopsFrom(langt, stopAfter).length, 1);
  });

  it("bruger linjens egen stopgrænse", () => {
    assert.equal(ops!.stopAfterSeconds, 120);
    const segs = runSegments(serie([80, ...Array(200).fill(0), 80]));
    assert.equal(stopsFrom(segs, ops!.stopAfterSeconds).length, 1);
  });

  it("en sensorfejl bliver aldrig til et stop", () => {
    // Måleren tav i fem minutter. Vi ved ikke, hvad der skete imens, og et
    // stop hentet ud af et dødt kabel ville være opfundet.
    const segs = runSegments(serie([80, ...Array(300).fill(null), 80]));
    assert.ok(segs.some((s) => s.state === "fejl"));
    assert.equal(stopsFrom(segs, 120).length, 0);
  });

  it("skelner en fejl fra et stop, selv om begge afbryder driften", () => {
    const segs = runSegments(serie([80, null, null, 0, 0, 80]));
    const states: RunState[] = segs.map((s) => s.state);
    assert.deepEqual(states, ["koerer", "fejl", "staar", "koerer"]);
  });
});

describe("nøgletal", () => {
  it("afventer historik, indtil perioden er lang nok", () => {
    assert.equal(keyFigures(serie([80, 80, 80]), 32), null);
    // Lige under grænsen tæller ikke.
    const nToKort = HISTORIK_MIN_MS / 1000;
    assert.equal(keyFigures(serie(Array(nToKort - 1).fill(80)), 32), null);
  });

  it("regner oppetid, når der er historik nok", () => {
    const n = HISTORIK_MIN_MS / 1000 + 1;
    // Første halvdel kører, anden halvdel står.
    const halv = Math.floor(n / 2);
    const k = keyFigures(serie([...Array(halv).fill(80), ...Array(n - halv).fill(0)]), 32);
    assert.ok(k, "der skulle være nøgletal");
    assert.ok(Math.abs(k!.uptimePct - 50) < 1, `oppetid ${k!.uptimePct}`);
  });

  it("lader en fejlperiode stå uden for regnestykket", () => {
    // En fejl er hverken oppetid eller nedetid. Den tælles for sig, så
    // oppetiden kan vejes mod, hvor meget måleren faktisk så.
    const n = HISTORIK_MIN_MS / 1000 + 1;
    const k = keyFigures(serie([...Array(n).fill(80), ...Array(120).fill(null)]), 32)!;
    assert.equal(Math.round(k.uptimePct), 100);
    assert.ok(k.faultMs > 0, "fejltiden skal kunne ses");
  });

  it("totalen er et integral, og den findes kun med en kalibrering", () => {
    const n = HISTORIK_MIN_MS / 1000 + 1;
    // Konstant 100 % af 32 t/t i n sekunder.
    const s = serie(Array(n).fill(100));
    const timer = ((n - 1) * 1000) / 3_600_000;
    const k = keyFigures(s, 32)!;
    assert.ok(Math.abs(k.total! - 32 * timer) < 1e-6, `${k.total} mod ${32 * timer}`);
    // Uden 100 %-punktet findes tallet ikke.
    assert.equal(keyFigures(s, null)!.total, null);
  });

  it("brolægger ikke hen over et hul i målingen", () => {
    const n = HISTORIK_MIN_MS / 1000 + 1;
    const helt = keyFigures(serie(Array(n).fill(100)), 32)!;
    // Samme periode, men måleren tav i midten: der kan ikke have løbet
    // materiale, vi ved noget om.
    const med = [...Array(n).fill(100)];
    for (let i = 100; i < 200; i++) med[i] = null;
    const hul = keyFigures(serie(med), 32)!;
    assert.ok(hul.total! < helt.total!, `${hul.total} skulle være mindre end ${helt.total}`);
  });
});
