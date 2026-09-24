import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sliberi from "../../data/lines/sliberi.json";
import { FLOW_NOMINAL, ORDRE, PROEVER } from "../../data/fremskrivning";
import { layoutLine } from "./layout";
import { proeveOverblik, tabPct } from "./proeveoverblik";
import { simulator, type TelemetriBillede } from "./telemetri";
import type { LineData } from "./types";

const layout = layoutLine(sliberi as LineData);
const T0 = new Date("2026-09-24T06:00:00").getTime();
const ordre = { ordreNr: ORDRE.ordreNr, estimeretKg: ORDRE.estimeretKg, kasser: ORDRE.kasser, nominalTPrT: FLOW_NOMINAL["FT-743"] };

function efter(sekunder: number): TelemetriBillede {
  const sim = simulator(layout, { ordre, seed: 743 });
  let b = sim.skridt(1000, T0 + 1000);
  for (let i = 2; i <= sekunder; i++) b = sim.skridt(1000, T0 + i * 1000);
  return b;
}

describe("prøveboksen på kontoret", () => {
  const b = efter(6 * 3600);
  const o = proeveOverblik(b)!;

  it("har de fire kasteborde, to i hvert spor, i den rækkefølge frøet når dem", () => {
    assert.deepEqual(o.borde.map((x) => `${x.lane}${x.bord}`), ["N0", "N1", "S0", "S1"]);
    // Pladsen kommer fra simulatoren, ikke fra navnet — men den passer med det.
    assert.deepEqual(o.borde.map((x) => x.kort), ["KB-3N", "KB-3NN", "KB-2S", "KB-2SS"]);
  });

  it("viser kun det, laboratoriet har svaret — et svar står med, hvornår prøven blev taget", () => {
    for (const r of o.borde) {
      for (const s of [r.ready, r.heavy, r.light]) {
        if (!s) continue;
        const p = b.laboratorie.seneste.find((x) => x.sted.maskine === r.maskine && x.taget === s.taget);
        assert.ok(p?.ct, `${r.kort}: et svar, laboratoriet ikke har givet`);
      }
    }
    assert.ok(o.borde.some((r) => r.ready && r.heavy && r.light), "efter seks timer burde et bord have alle tre");
  });

  it("tabet er simuleringens eget regnskab — og en andel af det gode frø, der kom ind", () => {
    assert.ok(o.tab && o.tab.godtKg > 0);
    const sum = o.borde.reduce((n, r) => n + (r.tabKg ?? 0), 0);
    assert.ok(Math.abs(sum - o.tab!.godtKg) < 1e-6);
    const pct = tabPct(o.tab!)!;
    assert.ok(pct > 0 && pct < 20, `${pct} %`);
  });

  it("CT-køen: det, der er i gang, de næste, og hvor lang en runde er", () => {
    assert.equal(o.ct.rundeMin, PROEVER.ctPlan.length * PROEVER.ct.minutter);
    assert.equal(o.ct.naeste.length, 3);
    assert.equal(o.ct.taget, b.laboratorie.ct.taget);
  });

  it("uden ordre er der ingen boks", () => {
    const uden = simulator(layout, { seed: 743 }).skridt(1000, T0 + 1000);
    assert.equal(proeveOverblik(uden), null);
  });
});
