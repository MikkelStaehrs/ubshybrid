import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeFault, isFaultMa, scaleFromMa,
  FAULT_HIGH_MA, FAULT_LOW_MA, NOMINAL_HIGH_MA, NOMINAL_LOW_MA,
} from "./live-source";

// FT-756 er skaleret 0-40 t/t i SCALE. Ændres måleområdet, skal tallene her
// med — det er netop pointen med at have grænserne under test.
const MIN = 0;
const MAX = 40;

describe("scaleFromMa: grænserne på strømsløjfen", () => {
  it("under 3,6 mA er sensorfejl uden værdi", () => {
    const r = scaleFromMa("FT-756", 3.59);
    assert.equal(r.value, null);
    assert.equal(isFaultMa(3.59), true);
  });

  it("3,6 mA er nederste tolerance og klemmes til nul", () => {
    const r = scaleFromMa("FT-756", FAULT_LOW_MA);
    assert.equal(r.value, MIN);
    assert.equal(r.clamped, true);
    assert.equal(isFaultMa(FAULT_LOW_MA), false);
  });

  it("3,99 mA klemmes stadig til nul", () => {
    const r = scaleFromMa("FT-756", 3.99);
    assert.equal(r.value, MIN);
    assert.equal(r.clamped, true);
  });

  it("4,0 mA er nulpunktet og klemmes ikke", () => {
    const r = scaleFromMa("FT-756", NOMINAL_LOW_MA);
    assert.equal(r.value, MIN);
    assert.equal(r.clamped, false);
  });

  it("20,0 mA er fuldt udslag og klemmes ikke", () => {
    const r = scaleFromMa("FT-756", NOMINAL_HIGH_MA);
    assert.equal(r.value, MAX);
    assert.equal(r.clamped, false);
  });

  it("21,0 mA er øverste tolerance og klemmes til maks", () => {
    const r = scaleFromMa("FT-756", FAULT_HIGH_MA);
    assert.equal(r.value, MAX);
    assert.equal(r.clamped, true);
    assert.equal(isFaultMa(FAULT_HIGH_MA), false);
  });

  it("21,01 mA er sensorfejl uden værdi", () => {
    const r = scaleFromMa("FT-756", 21.01);
    assert.equal(r.value, null);
    assert.equal(isFaultMa(21.01), true);
  });

  it("midt i området skaleres lineært", () => {
    assert.equal(scaleFromMa("FT-756", 12).value, (MIN + MAX) / 2);
  });

  it("intet råsignal er sensorfejl", () => {
    assert.equal(scaleFromMa("FT-756", NaN).value, null);
    assert.equal(isFaultMa(NaN), true);
  });

  it("skalaen bliver aldrig negativ", () => {
    // Den fejl, reglen kom af: før klemningen gav 3,7 mA en negativ
    // materialestrøm. Hele sløjfen gennemgås, så det ikke kan snige sig ind igen.
    for (let ma = 3; ma <= 22; ma += 0.01) {
      const v = scaleFromMa("FT-756", ma).value;
      if (v !== null) assert.ok(v >= 0, `${ma} mA gav ${v}`);
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
