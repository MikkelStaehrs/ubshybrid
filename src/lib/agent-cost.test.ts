import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentsFor } from "./agents";
import { costOf, totalPerMaaned, USD_PR_MIO_INPUT, USD_PR_MIO_OUTPUT, USD_TIL_DKK } from "./agent-cost";
import type { Agent } from "./types";

const agents = agentsFor("sliberi");
const byId = (id: string): Agent => {
  const a = agents.find((x) => x.id === id);
  assert.ok(a, `agenten ${id} findes ikke`);
  return a;
};

/** Tallene er skøn, men regnestykket må ikke skride. */
const forventet = (input: number, output: number, koersler: number) =>
  ((input * koersler) / 1e6 * USD_PR_MIO_INPUT + (output * koersler) / 1e6 * USD_PR_MIO_OUTPUT) * USD_TIL_DKK;

describe("omkostningsestimat", () => {
  it("linjeagenten regnes på 8.000 / 800 tokens, 30 kørsler", () => {
    const c = costOf(byId("AG-SLIB-N"));
    assert.equal(c.koerslerPrMaaned, 30);
    assert.ok(Math.abs(c.perMaaned - forventet(8000, 800, 30)) < 1e-9);
    // 6,9 kr. — det tal, der står i fladen.
    assert.equal(c.perMaaned.toFixed(1), "6.9");
  });

  it("den ugentlige agent regnes på 30/7 kørsler, ikke på 4", () => {
    const c = costOf(byId("AG-SLIB-VEDL"));
    assert.ok(Math.abs(c.koerslerPrMaaned - 30 / 7) < 1e-9);
    assert.equal(c.perMaaned.toFixed(1), "1.7");
  });

  it("en kode-agent koster ingenting og siger hvorfor", () => {
    const c = costOf(byId("AG-SLIB-VAGT"));
    assert.equal(c.perMaaned, 0);
    assert.equal(c.gratis, "ingen API-kald");
  });

  it("totalen udelader idéer", () => {
    // Idéerne har hver deres estimat, men ingen har sagt ja til dem endnu.
    const ideer = agents.filter((a) => a.beslutning === "ide");
    assert.ok(ideer.length > 0, "der burde være idéer at udelade");
    assert.ok(ideer.every((a) => costOf(a).perMaaned > 0), "idéerne burde have et estimat");

    const total = totalPerMaaned(agents);
    const alleInkl = agents.reduce((sum, a) => sum + costOf(a).perMaaned, 0);
    assert.ok(total < alleInkl, "idéer slap med i totalen");
    const besluttede = agents.filter((a) => a.beslutning !== "ide").reduce((sum, a) => sum + costOf(a).perMaaned, 0);
    assert.ok(Math.abs(total - besluttede) < 1e-9, `${total} mod ${besluttede}`);
  });

  it("regner prisen efter formlen", () => {
    // Et værn om selve regnestykket, på en agent hvis forbrug ligger fast:
    // 8.000 ind og 800 ud om dagen i en måned, til 3 og 15 dollar pr. million.
    const n = agents.find((a) => a.id === "AG-SLIB-N")!;
    assert.equal(costOf(n).perMaaned.toFixed(1), "6.9");
  });
});
