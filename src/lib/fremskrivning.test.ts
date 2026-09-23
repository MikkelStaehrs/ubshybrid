import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sliberi from "../../data/lines/sliberi.json";
import { agentsFor, machinesInScope } from "./agents";
import { hudModel } from "./ai-hud";
import { fremskrivAgenter, fremskrivLayer } from "./fremskrivning";
import { layoutLine } from "./layout";
import { channelReport, otLayerFor } from "./ot";
import type { LineData } from "./types";

const layout = layoutLine(sliberi as LineData);
const raa = otLayerFor("sliberi")!;
const agenter = agentsFor("sliberi");

const som_det_staar = hudModel("sliberi")!;
const fremskrevet = hudModel("sliberi", { fremskriv: true })!;

describe("fremskrivningen smitter ikke af på virkeligheden", () => {
  it("den rigtige model er uændret, efter en fremskrivning er bygget", () => {
    // Det farligste, der kunne ske: at fremskrivningen ændrede de delte
    // dataarrays, så anlægget bagefter så bedre ud, end det er.
    const igen = hudModel("sliberi")!;
    assert.deepEqual(igen.tally, { drift: 0, test: 1, afventer: 25, total: 26 });
    assert.deepEqual(igen.tally, som_det_staar.tally);
    assert.equal(igen.chainTone, "brud");
    assert.equal(igen.broken?.label, "IO-kort");
  });

  it("rørerne ikke det rå OT-lag", () => {
    const før = raa.sensors.length;
    fremskrivLayer(raa, layout, agenter);
    assert.equal(raa.sensors.length, før, "der blev lagt sensorer i det rigtige lag");
    assert.equal(raa.sensors[0].status, "test", "den rigtige sensor skiftede status");
    assert.equal(raa.cabinets[0].status !== "active", true, "skabet blev sat i drift");
  });

  it("modellen bærer selv, at den er opdigtet", () => {
    // Fladen må ikke kunne vise fremskrevne tal uden mærkatet.
    assert.equal(som_det_staar.fremskrevet, false);
    assert.equal(fremskrevet.fremskrevet, true);
  });
});

describe("fremskrivningen opfinder ikke tal", () => {
  it("de ekstra signaler er dem, agenterne selv har bedt om", () => {
    const lag = fremskrivLayer(raa, layout, agenter);
    const ekstra = lag.sensors.filter((s) => !raa.sensors.some((r) => r.id === s.id));
    assert.ok(ekstra.length > 0, "der skulle komme signaler til");

    // Hver eneste af dem svarer til et type-input på en besluttet agent.
    const ønsket = new Set(
      agenter
        .filter((a) => a.beslutning !== "ide")
        .flatMap((a) => a.inputs.map((i) => i.type).filter(Boolean)),
    );
    for (const s of ekstra) {
      assert.ok(ønsket.has(s.catalogType), `${s.id} er ikke bedt om af nogen agent`);
    }
  });

  it("et opdigtet tag kan kendes fra et tildelt", () => {
    const lag = fremskrivLayer(raa, layout, agenter);
    for (const s of lag.sensors) {
      if (raa.sensors.some((r) => r.id === s.id)) continue;
      assert.match(s.id, /^X/, `${s.id} ligner et rigtigt ISA-tag`);
      assert.equal(s.model, "Ikke valgt", "der er ikke valgt en model, og det skal stå");
    }
  });

  it("en idé bliver ikke slået til, fordi vi fremskriver", () => {
    // Fremskrivningen viser det besluttede, ikke alt vi kunne finde på.
    const efter = fremskrivAgenter(agenter);
    for (const a of efter) {
      if (agenter.find((x) => x.id === a.id)!.beslutning === "ide") {
        assert.equal(a.beslutning, "ide", `${a.id} blev smuglet med`);
      }
    }
    const ideer = fremskrevet.agents.filter((a) => a.idea);
    assert.equal(ideer.length, 2);
    for (const a of ideer) assert.equal(a.statusLabel, "AFVENTER");
  });

  it("omkostningen er den samme — kæden ændrer ikke prisen", () => {
    // Det koster det samme at køre en agent, uanset om dens data er der.
    assert.equal(fremskrevet.totalKr, som_det_staar.totalKr);
  });
});

describe("fremskrivningen udleder resten som altid", () => {
  it("kæden bliver hel og grøn, fordi hvert led er i drift", () => {
    assert.equal(fremskrevet.broken, null);
    assert.equal(fremskrevet.chainTone, "drift");
    assert.equal(fremskrevet.reach.delivers, fremskrevet.reach.total);
  });

  it("de besluttede agenter kommer i drift, og buen er fuld", () => {
    for (const a of fremskrevet.agents.filter((x) => !x.idea)) {
      assert.equal(a.statusLabel, "PÅ PLADS", a.name);
      assert.equal(a.done, a.total, `${a.name}: ${a.done} af ${a.total}`);
    }
  });

  it("præcis de maskiner, en besluttet agent dækker, bliver målt", () => {
    // Tallet er udledt, ikke valgt. Sporagenterne ejer ikke det fælles
    // indløb — men Driftsagenten dækker hele linjen, så med den besluttet
    // er indløbet ikke længere umålt. Slås den tilbage til idé, står
    // indløbet igen som afventende, og testen følger med.
    const daekket = new Set<string>();
    for (const a of agenter.filter((x) => x.beslutning !== "ide")) {
      if (!a.inputs.some((i) => i.type)) continue;
      for (const m of machinesInScope(a, layout)) daekket.add(m.id);
    }
    // Maskiner med en rigtig sensor er målt i forvejen.
    for (const m of layout.machines) {
      if (raa.sensors.some((s) => m.wIds.includes(s.machineId))) daekket.add(m.id);
    }
    const maalte = Object.entries(fremskrevet.maskinTilstand).filter(([, s]) => s === "paa-plads").map(([id]) => id);
    assert.deepEqual(new Set(maalte), new Set([...daekket].filter((id) => id in fremskrevet.maskinTilstand)));
    assert.ok(fremskrevet.tally.drift > som_det_staar.tally.drift);
    assert.equal(fremskrevet.tally.drift + fremskrevet.tally.test + fremskrevet.tally.afventer, fremskrevet.tally.total);
  });

  it("kanalpladserne tælles af det samme regnskab", () => {
    const io = fremskrevet.links.find((l) => l.id === "io")!.instrument;
    const optaget = io.slots!.filter((s) => s.used).length;
    const par = new Map(io.readings.map((r) => [r.label, r.value]));
    const brugt = ["AI", "DI"].reduce((n, k) => n + Number((par.get(k) ?? "0 / 0").split(" / ")[0]), 0);
    assert.equal(brugt, optaget);
    // Flere signaler fylder flere pladser. Ellers var regnskabet ikke koblet på.
    const nu = som_det_staar.links.find((l) => l.id === "io")!.instrument;
    assert.ok(optaget > nu.slots!.filter((s) => s.used).length);
  });

  it("hvert fremskrevet signal får en kanal — på kort, fremskrivningen forudsætter", () => {
    // Beder agenterne om flere signaler, end skabet har kanaler til, skal
    // fremskrivningen antage de kort, der skal til. Ellers stod der signaler
    // som "på plads", der aldrig kunne læses.
    const lag = fremskrivLayer(raa, layout, fremskrivAgenter(agenter));
    const rapport = channelReport(lag.cabinets[0], lag.sensors, 1);
    for (const u of rapport.uses) {
      assert.ok(u.needed <= u.total, `${u.kind}: ${u.needed} signaler, ${u.total} kanaler`);
    }
    assert.ok([...rapport.channel.values()].every((c) => c !== null), "et signal fik ingen kanal");
  });

  it("forudsætter ikke flere kort end nødvendigt, og siger, at de er forudsat", () => {
    const lag = fremskrivLayer(raa, layout, fremskrivAgenter(agenter));
    const forudsat = lag.cabinets[0].hardware.filter((h) => h.id.startsWith("X-"));
    const uden = channelReport({ ...lag.cabinets[0], hardware: raa.cabinets[0].hardware }, lag.sensors, 1);
    for (const h of forudsat) {
      assert.equal(h.model, "Ikke valgt");
      const kind = h.provides!.ai ? "ai" : "di";
      const u = uden.uses.find((x) => x.kind === kind)!;
      const pr = h.provides![kind]!;
      assert.equal(h.qty, Math.ceil((u.needed - u.total) / pr), `${h.id}: ${h.qty} kort`);
    }
    // Den rigtige stykliste er urørt.
    assert.ok(!raa.cabinets[0].hardware.some((h) => h.id.startsWith("X-")));
    // Og instrumentet siger det.
    const par = new Map(fremskrevet.links.find((l) => l.id === "io")!.instrument.readings.map((r) => [r.label, r.value]));
    if (forudsat.length > 0) assert.ok(par.has("Forudsat"), "de forudsatte kort står ikke på instrumentet");
  });
});
