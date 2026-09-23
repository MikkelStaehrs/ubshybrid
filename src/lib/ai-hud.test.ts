import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AGENT_ENGINE_LABEL, agentsFor, lineOpsFor } from "./agents";
import { SMÅBELØB_UNDER } from "./agent-cost";
import { chainToneOf, hudAgentState, hudModel, hudState, tallyMedTelemetri, type HudLink } from "./ai-hud";

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
    // Udledt af dataene: idéer er "ide", sovende er besluttet, men ikke slået til.
    const agenter = agentsFor("sliberi");
    assert.equal(ideer.length, agenter.filter((a) => a.beslutning === "ide").length);
    assert.equal(sovende.length, agenter.filter((a) => a.beslutning === "besluttet").length);
    assert.ok(ideer.length > 0 && sovende.length > 0);
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
    ...m.agents.flatMap((a) => [
      a.name, a.statusLabel, a.til, a.scopeLabel, a.cadence,
      a.gratis ?? "", AGENT_ENGINE_LABEL[a.engine],
    ]),
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

describe("kompositionen har noget at vise i hver zone", () => {
  it("bruddet står midt i scenen og peger ét sted hen", () => {
    // Zonen er tom uden det her — bruddet er sidens blikfang.
    assert.ok(m.broken, "der skal være et brud at vise");
    assert.ok(m.broken.label.length > 0);
    assert.ok(m.broken.next);
  });

  it("loggen er tom, og det er sandheden", () => {
    // Der er ikke kaldt et API fra dette repo. En eksempelrække ville
    // kunne forveksles med en kørsel, der havde fundet sted.
    assert.deepEqual(m.runs, []);
  });

  it("modellen siger selv, om omkostningen er et småbeløb", () => {
    assert.ok(m.totalKr > 0, "de besluttede claude-agenter koster noget");
    assert.equal(m.smaabeloeb, m.totalKr < SMÅBELØB_UNDER);
  });

  it("kun besluttede agenter tæller med i totalen", () => {
    const ideer = m.agents.filter((a) => a.idea);
    assert.equal(ideer.length, m.ideas);
    const besluttet = m.agents.filter((a) => !a.idea).reduce((sum, a) => sum + a.kr, 0);
    assert.ok(Math.abs(besluttet - m.totalKr) < 1e-9, `${besluttet} mod ${m.totalKr}`);
    // Idéerne har et estimat, men det ligger uden for totalen.
    assert.ok(ideer.some((a) => a.kr > 0), "en idé har stadig et prisskøn");
  });

  it("kæden har led nok til et bånd", () => {
    assert.ok(m.links.length >= 4, "båndet ville se tomt ud med færre");
  });
});

describe("kædens samlede tone", () => {
  /** Et led med kun det, tonen afhænger af. */
  const led = (status: HudLink["status"], broken = false): HudLink => ({
    id: status, label: status, status,
    state: "afventer", statusLabel: "AFVENTER", tone: "moerk",
    delivers: !broken, broken, instrument: { readings: [] },
  });

  it("er bruddets, når kæden er brudt", () => {
    assert.equal(m.chainTone, "brud");
    assert.equal(chainToneOf([led("active"), led("missing", true)]), "brud");
  });

  it("en hel kæde af led i test er rav, ikke grøn", () => {
    // isDone() regner test som leverende, så kæden kan være "hel", uden at
    // ét eneste led er i drift. Grøn ville påstå en drift, der ikke findes.
    assert.equal(chainToneOf([led("test"), led("test")]), "test");
    assert.equal(chainToneOf([led("active"), led("test")]), "test");
  });

  it("grøn kræver, at hvert led er i drift", () => {
    assert.equal(chainToneOf([led("active"), led("active")]), "drift");
  });

  it("uden led er der ingen tone at vise", () => {
    assert.equal(chainToneOf([]), "moerk");
  });
});

describe("intet grønt før noget er i drift", () => {
  it("hverken kæden, agenterne eller tallet er grønt i dag", () => {
    // Hele farvedisciplinen på ét sted: grøn er forbeholdt drift, og
    // intet i anlægget er i drift endnu.
    assert.equal(m.tally.drift, 0);
    assert.ok(!m.links.some((l) => l.tone === "drift"));
    assert.ok(!m.agents.some((a) => a.state === "paa-plads"));
    assert.notEqual(m.chainTone, "drift");
  });
});

describe("kæden som instrumenter", () => {
  const led = (id: string) => {
    const l = m.links.find((x) => x.id === id);
    assert.ok(l, `leddet ${id} findes ikke`);
    return l;
  };

  it("måleren viser sine egne tal, ikke bare et ord", () => {
    const i = led("sensor").instrument;
    const par = new Map(i.readings.map((r) => [r.label, r.value]));
    assert.equal(par.get("Kanal"), "AI1");
    assert.equal(par.get("Register"), "30001–30002");
    assert.match(par.get("Måler") ?? "", /FS 550/);
    // Fladen skal kunne slå en aflæsning op på taget.
    assert.equal(i.signalId, "FT-743");
  });

  it("IO-kortet viser kanalpladser, og præcis én er optaget", () => {
    const i = led("io").instrument;
    assert.ok(i.slots && i.slots.length > 0, "der skal være pladser at vise");
    const optaget = i.slots!.filter((s) => s.used);
    assert.equal(optaget.length, 1, "kun flowsignalet fylder en plads i dag");
    assert.equal(optaget[0].name, "AI1");
    // Pladserne er talt af kanalregnskabet, ikke skrevet i hånden — og
    // analoge og digitale står hver for sig.
    const par = new Map(i.readings.map((r) => [r.label, r.value]));
    assert.equal(par.get("AI"), "1 / 8");
    assert.equal(par.get("DI"), "0 / 16");
    assert.ok(!par.has("Mangler"), "der mangler ingen kanaler i dag");
  });

  it("lægger ikke analoge og digitale pladser sammen", () => {
    // Den fejl, reglen kom af: "17 / 24" så ud som plads, mens 13
    // driftssignaler ingen kanal havde — de ledige pladser var analoge.
    const par = new Map(led("io").instrument.readings.map((r) => [r.label, r.value]));
    assert.ok(!par.has("Pladser"), "en sammenlagt pladstælling skjuler et underskud");
  });

  it("hvert led, der ikke leverer, siger hvad det venter på", () => {
    for (const l of m.links) {
      if (l.delivers) continue;
      // IO-kortet venter på skabet selv og bærer det som `next`.
      const venter = l.next ?? l.instrument.waits;
      assert.ok(venter && venter.length > 0, `${l.id} venter på noget unavngivet`);
    }
  });

  it("et led, der leverer, venter ikke på noget", () => {
    for (const l of m.links) {
      if (!l.delivers) continue;
      assert.equal(l.instrument.waits, undefined, `${l.id} leverer og venter samtidig`);
    }
  });

  it("kun måleren bærer en aflæsning", () => {
    const med = m.links.filter((l) => l.instrument.signalId);
    assert.equal(med.length, 1);
    assert.equal(med[0].id, "sensor");
  });

  it("der er præcis ét sted, en puls kan blive standset", () => {
    // Ringen ved bruddet kræver, at leddet før leverer. Ellers ville den
    // slå ud uden at noget var nået frem.
    const i = m.links.findIndex((l) => l.broken);
    assert.ok(i > 0, "bruddet ligger ikke som første led i dag");
    assert.equal(m.links[i - 1].delivers, true);
  });
});

describe("det store tal med telemetri", () => {
  it("er modellens eget tal, når intet er simuleret", () => {
    const tomt = { simuleret: false, maskiner: [] };
    assert.deepEqual(tallyMedTelemetri(m, tomt), m.tally);
  });

  it("tæller en maskine med kanaler som på plads — også når den står", () => {
    // Et stop er ikke "afventer": maskinen findes og melder, at den står.
    const frem = hudModel("sliberi", { fremskriv: true })!;
    const ids = Object.keys(frem.maskinTilstand);
    const stoppet = ids[3];
    const billede = {
      simuleret: true,
      maskiner: ids.map((id) => ({ id, kanaler: id === ids[0] ? [] : [{}], koerer: id !== stoppet })),
    };
    const t = tallyMedTelemetri(frem, billede);
    assert.equal(t.total, frem.tally.total, "totalen må ikke ændre sig");
    assert.equal(t.drift + t.test + t.afventer, t.total);
    // Kun maskinen uden kanaler kan stå tilbage som noget andet end på plads.
    assert.equal(t.drift, ids.length - 1 + (frem.maskinTilstand[ids[0]] === "paa-plads" ? 1 : 0));
  });

  it("den rigtige model bærer hver maskines tilstand, og den summer til tallet", () => {
    const tilstande = Object.values(m.maskinTilstand);
    assert.equal(tilstande.length, m.tally.total);
    assert.equal(tilstande.filter((s) => s === "test").length, m.tally.test);
  });
});

describe("W/HR — vægt pr. time", () => {
  it("står som 'ikke udfyldt' i den rigtige visning, indtil 100 %-punktet er aftalt", () => {
    // Demoens skøn må ikke snige sig ind i anlægget, som det står.
    assert.equal(m.flow.signal, "FT-743");
    assert.equal(m.flow.nominal, null);
    assert.equal(m.flow.kilde, null);
  });

  it("bruger demoens skøn i fremskrivningen — og siger, at det er et skøn", () => {
    const frem = hudModel("sliberi", { fremskriv: true })!;
    assert.equal(frem.flow.nominal, 1.0);
    assert.equal(frem.flow.kilde, "skoen");
    assert.equal(frem.flow.rateUnit, "t/hr");
  });

  it("et aftalt tal vinder over skønnet, begge steder", () => {
    const ops = lineOpsFor("sliberi")!;
    const foer = ops.flow;
    try {
      ops.flow = { nominal: { "FT-743": 1.2 } };
      for (const model of [hudModel("sliberi")!, hudModel("sliberi", { fremskriv: true })!]) {
        assert.equal(model.flow.nominal, 1.2);
        assert.equal(model.flow.kilde, "aftalt");
      }
    } finally {
      ops.flow = foer;
    }
  });
});
