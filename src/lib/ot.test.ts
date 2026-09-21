import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sliberi from "../../data/lines/sliberi.json";
import { layoutLine } from "./layout";
import { layoutOt, otLayerFor, signalDelivery, type OtLayout } from "./ot";
import type { LineData } from "./types";

const layout = layoutLine(sliberi as LineData);
const real = layoutOt(otLayerFor("sliberi")!, layout, "sliberi");

/**
 * Samme anlæg, men med hele kæden rejst. Uden den kan sensorfejlen ikke
 * testes: i dag knækker kæden ved IO-kortet, længe før måleren bliver spurgt.
 */
const whole: OtLayout = {
  ...real,
  cabinets: real.cabinets.map((c) => ({ ...c, status: "active" as const })),
  infrastructure: real.infrastructure.map((n) => ({ ...n, status: "active" as const })),
};
const pilot = whole.sensors[0];

describe("signalDelivery", () => {
  it("hel kæde og kabelbrud leverer ikke, og årsagen hedder sensorfejl", () => {
    const d = signalDelivery(pilot, whole, { raw: 3.29 });
    assert.equal(d.delivers, false);
    assert.equal(d.reason, "sensorfejl");
    assert.equal(d.basis, "kæde+aflæsning");
  });

  it("hel kæde og stop på 4,0 mA leverer stadig", () => {
    // Sløjfen lever, der løber bare ingenting. Et stop er en måling.
    const d = signalDelivery(pilot, whole, { raw: 4 });
    assert.equal(d.delivers, true);
    assert.equal(d.reason, null);
  });

  it("uden aflæsning afgør kæden alene, og basis siger det", () => {
    const d = signalDelivery(pilot, whole, null);
    assert.equal(d.delivers, true);
    assert.equal(d.basis, "kæde");
  });

  it("anlægget som det står i dag: kæden knækker før måleren spørges", () => {
    const d = signalDelivery(pilot, real, { raw: 3.29 });
    assert.equal(d.delivers, false);
    assert.equal(d.breaksAt, "IO-kort");
    assert.match(d.reason ?? "", /^kæden knækker ved/);
  });
});
