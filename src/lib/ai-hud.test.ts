import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hudAgentState, hudModel, hudState } from "./ai-hud";

const m = hudModel("sliberi");
assert.ok(m, "sliberi burde have en HUD-model");

describe("kæden i HUD'en", () => {
  it("går fra måler til database, uden dashboardet", () => {
    // Dashboardet er for mennesker. Agenterne læser fra databasen.
    assert.deepEqual(m.links.map((l) => l.id), ["sensor", "io", "kobler", "edge", "mssql"]);
  });

  it("markerer præcis ét brud, og det er det første led der svigter", () => {
    const brud = m.links.filter((l) => l.broken);
    assert.equal(brud.length, 1, "der må kun være ét brud");
    const first = m.links.findIndex((l) => !l.delivers);
    assert.equal(m.links[first].broken, true);
    assert.equal(m.broken?.id, m.links[first].id);
  });

  it("pulsen løber ikke forbi bruddet", () => {
    // Alt efter bruddet er mørkt. Ellers ville skærmen vise aktivitet,
    // der ikke findes — netop det, reglen skal forhindre.
    const i = m.links.findIndex((l) => l.broken);
    for (const l of m.links.slice(i + 1)) {
      assert.equal(l.delivers, false);
      assert.equal(l.tone, "moerk");
    }
  });

  it("et led i test er rav, ikke grønt", () => {
    // Grøn er forbeholdt drift. Sensoren står som test.
    const sensor = m.links.find((l) => l.id === "sensor")!;
    assert.equal(sensor.status, "test");
    assert.equal(sensor.tone, "test");
    assert.ok(!m.links.some((l) => l.tone === "drift"), "intet led er i drift endnu");
  });

  it("bruddet peger på ét navn, udledt", () => {
    assert.ok(m.broken, "der er et brud i dag");
    assert.ok(m.broken.next && m.broken.next.length > 0, "der skal være noget at afvente");
    // I dag venter IO-kortet på skabet — ikke på et uplink.
    assert.match(m.broken.next, /RIO-SLIB-01/);
  });

  it("rækkevidden tæller de led, der leverer", () => {
    assert.equal(m.reach.total, m.links.length);
    assert.equal(m.reach.delivers, m.links.filter((l) => l.delivers).length);
  });
});

describe("agenterne i HUD'en", () => {
  it("skelner idéer fra sovende agenter", () => {
    const ideer = m.agents.filter((a) => a.idea);
    const sovende = m.agents.filter((a) => a.sovende);
    assert.equal(ideer.length, 2);
    assert.equal(sovende.length, 3);
    // En idé ånder ikke — den er ikke besluttet.
    for (const a of ideer) assert.equal(a.sovende, false);
  });

  it("buen kan ikke vise mere end der er opfyldt", () => {
    for (const a of m.agents) {
      assert.ok(a.total > 0);
      assert.ok(a.done <= a.total, `${a.name}: ${a.done} af ${a.total}`);
    }
  });
});

describe("HUD'ens sprog", () => {
  /** Alle strenge, brugeren kan komme til at se i HUD'en. */
  const visibleStrings = (): string[] => [
    ...m.links.flatMap((l) => [l.label, l.statusLabel, l.next ?? ""]),
    ...m.agents.flatMap((a) => [a.name, a.statusLabel, a.til, a.scopeLabel, a.cadence, a.gratis ?? ""]),
    m.lineName,
  ].filter(Boolean);

  it("kender kun tre tilstande", () => {
    const brugte = new Set([
      ...m.links.map((l) => l.statusLabel),
      ...m.agents.map((a) => a.statusLabel),
    ]);
    for (const ord of brugte) {
      assert.ok(
        ["PÅ PLADS", "TEST", "AFVENTER"].includes(ord),
        `"${ord}" er ikke et af de tre HUD-ord`,
      );
    }
  });

  it("mapper OT-status og agentstatus til de tre", () => {
    assert.equal(hudState("active"), "paa-plads");
    assert.equal(hudState("test"), "test");
    // Alt der ikke står færdigt, afventer — uanset hvor i indkøbet det er.
    for (const s of ["ordered", "planned", "missing", "idea"] as const) {
      assert.equal(hudState(s), "afventer");
    }
    assert.equal(hudAgentState("running"), "paa-plads");
    assert.equal(hudAgentState("ready"), "test");
    for (const s of ["partial", "missing", "idea"] as const) {
      assert.equal(hudAgentState(s), "afventer");
    }
  });

  it("bruger ingen indkøbs- eller prioritetsord", () => {
    // De ord hører til i dokumentvisningen. Her skal der kun stå, om noget
    // virker, prøves af, eller mangler.
    const forbudt = /købes|planlagt|bestilt|nødvendig|mulig udvidelse|skal etableres/i;
    for (const t of visibleStrings()) {
      assert.ok(!forbudt.test(t), `"${t}" indeholder et forbudt ord`);
    }
  });

  it("holder labels korte", () => {
    // Højst fire ord. Skal noget forklares, hører det til i dokumentvisningen.
    for (const l of m.links) {
      assert.ok(l.label.split(/\s+/).length <= 4, `"${l.label}" er for lang`);
      assert.ok(l.statusLabel.split(/\s+/).length <= 4, `"${l.statusLabel}" er for lang`);
    }
  });
});
