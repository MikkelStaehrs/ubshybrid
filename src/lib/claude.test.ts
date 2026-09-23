import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  brugerBesked, Budget, estimatKr, gyldigForespoergsel, MODELLER, modelFor, prisKr, systemPrompt,
  validerSvar, vaerktoej, type Forespoergsel,
} from "./claude";

const f: Forespoergsel = {
  koersel: "k-1",
  opgave: {
    agent: "Operatøragent",
    t: new Date("2026-09-23T08:13:00").getTime(),
    spoergsmaal: "Dataagent foreslår at sænke prøveraten 3 trin. Hvad beslutter du?",
    situation: { mssqlKanRaekkerPrS: 180, viSenderNuRaekkerPrS: 400 },
    handlinger: ["godkend", "skru_ned", "afvis"],
    modtagere: ["Dataagent", "Alle"],
    standard: "godkend",
  },
  samtale: [{ fra: "Kædevagt", til: "Dataagent", type: "iagttagelse", tekst: "MSSQL skriver 180 rækker/s." }],
};

describe("forespørgslen fra browseren", () => {
  it("tages imod, når den er, hvad simuleringen sender", () => {
    assert.ok(gyldigForespoergsel(f));
  });

  it("afvises for agenter, der ikke tænker med Claude", () => {
    // Driftsagent stopper efter regler, Kædevagten er kode. De må ikke kunne
    // koste noget, heller ikke hvis nogen sender en opgave i deres navn.
    for (const agent of ["Driftsagent", "Kædevagt", "Nogen"]) {
      assert.equal(gyldigForespoergsel({ ...f, opgave: { ...f.opgave, agent } }), false, agent);
    }
  });

  it("afvises, når den vil skrive til nogen uden for holdet, eller standarden ikke er en mulighed", () => {
    assert.equal(gyldigForespoergsel({ ...f, opgave: { ...f.opgave, modtagere: ["Direktøren"] } }), false);
    assert.equal(gyldigForespoergsel({ ...f, opgave: { ...f.opgave, standard: "sluk_alt" } }), false);
    assert.equal(gyldigForespoergsel({ ...f, samtale: Array(20).fill(f.samtale[0]) }), false);
  });
});

describe("svaret fra Claude", () => {
  it("bruges, når det holder sig til opgaven", () => {
    const s = validerSvar({
      beskeder: [{ til: "Dataagent", type: "beslutning", tekst: "Godkendt.", grund: "Skru ned giver 0 færre rækker." }],
      handling: "godkend",
    }, f);
    assert.deepEqual(s, {
      beskeder: [{ til: "Dataagent", type: "beslutning", tekst: "Godkendt.", grund: "Skru ned giver 0 færre rækker." }],
      handling: "godkend",
    });
  });

  it("en handling, opgaven ikke tilbød, bliver reglernes", () => {
    const s = validerSvar({ beskeder: [{ til: "Alle", type: "beslutning", tekst: "Stop alt." }], handling: "stop_alt" }, f);
    assert.equal(s?.handling, "godkend");
  });

  it("en besked til en, opgaven ikke nævnte, falder væk — og uden beskeder er svaret ubrugeligt", () => {
    const s = validerSvar({
      beskeder: [
        { til: "Direktøren", type: "rapport", tekst: "Alt er fint." },
        { til: "Alle", type: "ukendt", tekst: "Prøveraten sænkes." },
      ],
      handling: "godkend",
    }, f);
    assert.equal(s?.beskeder.length, 1);
    assert.equal(s?.beskeder[0].type, "iagttagelse", "en ukendt type bliver en iagttagelse");
    assert.equal(validerSvar({ beskeder: [{ til: "Direktøren", tekst: "x" }], handling: "godkend" }, f), null);
    assert.equal(validerSvar("fri tekst", f), null);
  });

  it("højst to beskeder, og en lang tekst kortes", () => {
    const lang = "ord ".repeat(200);
    const s = validerSvar({
      beskeder: Array(5).fill({ til: "Alle", type: "rapport", tekst: lang, grund: lang }),
      handling: "afvis",
    }, f)!;
    assert.equal(s.beskeder.length, 2);
    assert.ok(s.beskeder[0].tekst.length <= 240);
    assert.ok(s.beskeder[0].grund!.length <= 400);
  });
});

describe("det, Claude får at vide", () => {
  it("rollen kommer fra data/agents.ts, og reglerne står der", () => {
    const p = systemPrompt("Operatøragent");
    assert.match(p, /Koordinerer agenterne/);
    assert.match(p, /Opfind ingen tal/);
    assert.match(p, /Driftsagent: stopper og starter spor efter faste regler/);
  });

  it("situationens tal, samtalen og de tilladte handlinger står i beskeden", () => {
    const b = brugerBesked(f);
    assert.match(b, /"mssqlKanRaekkerPrS": 180/);
    assert.match(b, /Kædevagt → Dataagent \[iagttagelse\]/);
    assert.match(b, /Tilladte handlinger: godkend, skru_ned, afvis\./);
  });

  it("værktøjet kan kun vælge opgavens handlinger og modtagere", () => {
    const v = vaerktoej(f);
    assert.deepEqual(v.input_schema.properties.handling.enum, f.opgave.handlinger);
    assert.deepEqual(v.input_schema.properties.beskeder.items.properties.til.enum, f.opgave.modtagere);
  });
});

describe("prisen og loftet", () => {
  it("de, der afvejer, bruger Sonnet; linjeagenterne Haiku", () => {
    assert.equal(modelFor("Operatøragent"), MODELLER.sonnet);
    assert.equal(modelFor("Dataagent"), MODELLER.sonnet);
    assert.equal(modelFor("Linjeagent Spor N"), MODELLER.haiku);
  });

  it("regner kroner af det, kaldet brugte — cache til sin egen pris", () => {
    // 1 mio. input og 1 mio. output på Sonnet: 3 + 15 USD.
    const kr = prisKr(MODELLER.sonnet, { input_tokens: 1_000_000, output_tokens: 1_000_000 });
    assert.ok(Math.abs(kr - 18 * 6.4) < 1e-9, `${kr}`);
    const cache = prisKr(MODELLER.sonnet, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 });
    assert.ok(Math.abs(cache - 0.3 * 6.4) < 1e-9, `${cache}`);
  });

  it("stopper en kørsel ved sit loft, og alle kørsler ved døgnets", () => {
    let dag = "2026-09-23";
    const b = new Budget(1, 1.5, () => dag);
    const et = estimatKr(MODELLER.sonnet);
    assert.ok(b.kan("a", et).ok);
    b.brug("a", 0.95);
    assert.equal(b.kan("a", et).ok, false, "kørslen er ved sit loft");
    assert.ok(b.kan("b", et).ok, "en anden kørsel har sit eget loft");
    b.brug("b", 0.5);
    assert.equal(b.kan("c", et).ok, false, "døgnet er ved sit loft");
    // Et nyt døgn starter forfra.
    dag = "2026-09-24";
    assert.ok(b.kan("c", et).ok);
  });
});
