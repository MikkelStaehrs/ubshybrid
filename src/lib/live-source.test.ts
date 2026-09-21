import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeFault, isFaultMa, maFromPercent, scaleFromMa,
  FAULT_HIGH_MA, FAULT_LOW_MA, FULL_SCALE_PCT, NOMINAL_HIGH_MA, NOMINAL_LOW_MA,
} from "./live-source";

// Sløjfen giver procent af nominel kapacitet og ikke andet. 4 mA er nul,
// 20 mA er fuldt udslag, og fuldt udslag er halvanden gang kapaciteten —
// overhøjden er der, for at en overfødning kan ses.
const nær = (v: number | null, want: number, slæk = 0.05) => {
  assert.notEqual(v, null, "der skulle være en måling");
  assert.ok(Math.abs(v! - want) <= slæk, `${v} mod ${want}`);
};

describe("scaleFromMa: grænserne på strømsløjfen", () => {
  it("under 3,6 mA er sensorfejl uden værdi", () => {
    const r = scaleFromMa(3.59);
    assert.equal(r.value, null);
    assert.equal(isFaultMa(3.59), true);
  });

  it("3,6 mA er nederste tolerance og klemmes til nul procent", () => {
    const r = scaleFromMa(FAULT_LOW_MA);
    assert.equal(r.value, 0);
    assert.equal(r.clamped, true);
    assert.equal(isFaultMa(FAULT_LOW_MA), false);
  });

  it("3,99 mA klemmes stadig til nul", () => {
    const r = scaleFromMa(3.99);
    assert.equal(r.value, 0);
    assert.equal(r.clamped, true);
  });

  it("4,0 mA er nulpunktet og klemmes ikke", () => {
    const r = scaleFromMa(NOMINAL_LOW_MA);
    assert.equal(r.value, 0);
    assert.equal(r.clamped, false);
    assert.equal(r.unit, "%");
  });

  it("14,67 mA er nominel kapacitet — hundrede procent", () => {
    nær(scaleFromMa(14.67).value, 100);
    // Præcist: det punkt, hvor procenten er hundrede.
    assert.equal(scaleFromMa(maFromPercent(100)).value, 100);
  });

  it("20,0 mA er fuldt udslag: 150 procent, ikke klemt", () => {
    const r = scaleFromMa(NOMINAL_HIGH_MA);
    assert.equal(r.value, FULL_SCALE_PCT);
    assert.equal(r.clamped, false);
  });

  it("21,0 mA er øverste tolerance og klemmes til fuldt udslag", () => {
    const r = scaleFromMa(FAULT_HIGH_MA);
    assert.equal(r.value, FULL_SCALE_PCT);
    assert.equal(r.clamped, true);
    assert.equal(isFaultMa(FAULT_HIGH_MA), false);
  });

  it("21,01 mA er sensorfejl uden værdi", () => {
    const r = scaleFromMa(21.01);
    assert.equal(r.value, null);
    assert.equal(isFaultMa(21.01), true);
  });

  it("midt i området skaleres lineært", () => {
    assert.equal(scaleFromMa(12).value, FULL_SCALE_PCT / 2);
  });

  it("intet råsignal er sensorfejl", () => {
    assert.equal(scaleFromMa(NaN).value, null);
    assert.equal(isFaultMa(NaN), true);
  });

  it("skalaen bliver aldrig negativ og går aldrig over fuldt udslag", () => {
    // Den fejl, reglen kom af: før klemningen gav 3,7 mA en negativ
    // materialestrøm. Hele sløjfen gennemgås, så det ikke kan snige sig ind igen.
    for (let ma = 3; ma <= 22; ma += 0.01) {
      const v = scaleFromMa(ma).value;
      if (v === null) continue;
      assert.ok(v >= 0, `${ma} mA gav ${v} %`);
      assert.ok(v <= FULL_SCALE_PCT, `${ma} mA gav ${v} %`);
    }
  });

  it("maFromPercent er vejen tilbage", () => {
    for (const pct of [0, 25, 70, 100, 150]) {
      nær(scaleFromMa(maFromPercent(pct)).value, pct, 1e-9);
    }
  });
});

describe("describeFault", () => {
  it("nævner måleområdet, ikke grænsen der blev overskredet", () => {
    assert.equal(describeFault(3.29), "Sensorfejl (3,29 mA, uden for 4–20 mA)");
    assert.equal(describeFault(21.01), "Sensorfejl (21,01 mA, uden for 4–20 mA)");
  });

  it("er tavs når signalet er i orden", () => {
    // 20,5 mA er over 20, men inden for tolerancen — og altså ikke en fejl.
    assert.equal(describeFault(20.5), null);
    assert.equal(describeFault(12), null);
  });
});
