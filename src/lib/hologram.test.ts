import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sliberi from "../../data/lines/sliberi.json";
import { runsFor } from "./agent-runs";
import { buildHologram, machineState, PUNKT_BUDGET } from "./hologram";
import { layoutLine } from "./layout";
import { formFor } from "./machine-form";
import { channelReport, layoutOt, otLayerFor, registerMap, type OtLayout } from "./ot";
import type { LineData } from "./types";

const data = sliberi as LineData;
const layout = layoutLine(data);
const ot = layoutOt(otLayerFor("sliberi")!, layout, "sliberi");
const h = buildHologram(data, ot);

describe("punktskyen", () => {
  it("holder sig inden for punktbudgettet", () => {
    assert.ok(h.count > 0);
    assert.ok(h.count <= PUNKT_BUDGET * 1.05, `${h.count} punkter mod budget ${PUNKT_BUDGET}`);
  });

  it("er deterministisk — samme punkter ved hver bygning", () => {
    // Ellers ville skyen flimre ved hver reload, og ingen test kunne stole
    // på den. Seedet kommer fra W-ID, ikke fra Math.random.
    const igen = buildHologram(data, ot);
    assert.equal(igen.count, h.count);
    assert.deepEqual(Array.from(igen.positions.slice(0, 300)), Array.from(h.positions.slice(0, 300)));
    assert.deepEqual(Array.from(igen.tone), Array.from(h.tone));
  });

  it("holder punkterne inden for hallen og over gulvet", () => {
    const { minX, maxX, minZ, maxZ } = h.bounds;
    for (let i = 0; i < h.count; i++) {
      const x = h.positions[i * 3];
      const y = h.positions[i * 3 + 1];
      const z = h.positions[i * 3 + 2];
      assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z));
      assert.ok(y >= -0.6, `punkt under gulvet: ${y}`);
      assert.ok(x >= minX - 1 && x <= maxX + 1, `punkt uden for hallen: ${x}`);
      assert.ok(z >= minZ - 1 && z <= maxZ + 1, `punkt uden for hallen: ${z}`);
    }
  });

  it("tætheden følger tilstanden, ikke maskinens navn", () => {
    // Elevator 743 bærer FT-743 ved indgangen. Elevator 756 gør ikke —
    // samme maskintype, samme mål, forskellig viden.
    const med = h.machines.find((m) => m.wIds.includes("743"))!;
    const uden = h.machines.find((m) => m.wIds.includes("756"))!;
    assert.equal(med.state, "test");
    assert.equal(uden.state, "afventer");
    // Samme maskintype og samme mål — forskellen er, hvad vi ved om dem.
    assert.ok(med.points > uden.points, `${med.points} mod ${uden.points}`);
  });
});

describe("tilstand pr. maskine", () => {
  it("udledes af signalDelivery, ikke sat i hånden", () => {
    const m743 = layout.machines.find((m) => m.wIds.includes("743"))!;
    assert.equal(machineState(m743, ot), "test");
    // Uden OT-lag ved vi intet om nogen maskine.
    assert.equal(machineState(m743, null), "afventer");
  });

  it("bliver PÅ PLADS, når kæden står", () => {
    const hel: OtLayout = {
      ...ot,
      cabinets: ot.cabinets.map((c) => ({ ...c, status: "active" as const })),
      infrastructure: ot.infrastructure.map((n) => ({ ...n, status: "active" as const })),
    };
    const m743 = layout.machines.find((m) => m.wIds.includes("743"))!;
    assert.equal(machineState(m743, hel), "paa-plads");
  });

  it("tæller 0 i drift, 1 i test, 25 afventende", () => {
    assert.deepEqual(h.tally, { drift: 0, test: 1, afventer: 25, total: 26 });
  });
});

describe("materialestrøm", () => {
  it("bevæger sig kun på kanter, hvor flow er målt", () => {
    // FT-743 sidder ved indgangen til elevator 743: ind fra påslag 611,
    // ud til Nordmark.
    assert.equal(h.flowEdges.length, 2);
    const rørt = new Set(h.flowEdges.flatMap((e) => [e.from, e.to]));
    assert.ok(rørt.has("W-743"));
    assert.ok(!rørt.has("W-615"), "fordeleren ligger ikke længere ved måleren");
  });

  it("lader de øvrige kanter stå stille", () => {
    assert.ok(h.flowEdges.length < data.edges.length, "alle kanter må ikke bevæge sig");
  });
});

describe("scan-sweep", () => {
  it("udløses aldrig, når der ingen kørsler er", () => {
    // Sweepet er forbeholdt en AgentRun i gang. Loggen er tom, så der må
    // ikke være noget at sweepe — ellers viste skærmen aktivitet, der
    // ikke findes.
    assert.equal(runsFor().length, 0);
    for (const a of ["AG-SLIB-N", "AG-SLIB-S", "AG-SLIB-VAGT"]) {
      assert.equal(runsFor(a).length, 0, `${a} har en kørsel, sweepet ville køre`);
    }
  });
});

describe("delt form", () => {
  it("hologrammet og kortet måler maskinerne ens", () => {
    // Begge kalder formFor. Ændres en maskintype, flytter begge sig.
    const m = layout.machines.find((x) => x.kind === "elevator")!;
    const prims = formFor({ kind: m.kind, name: m.name, size: m.size, wIdCount: m.wIds.length });
    assert.ok(prims.length > 0);
    const højeste = Math.max(...prims.map((p) => p.at[1]));
    assert.ok(højeste >= m.size.h, "elevatorens afkast skal ligge i toppen");
  });
});

describe("sensorens placering", () => {
  it("kommer fra mount i dataene, ikke fra tegnekoden", () => {
    const s = ot.sensors.find((x) => x.id === "FT-743")!;
    const m = layout.machines.find((x) => x.wIds.includes("743"))!;
    assert.ok(s.pos, "sensoren skal have en plads");
    // Ved indløbet: lavt og opstrøms, ikke oppe i afkastet.
    assert.ok(s.pos[1] < m.size.h, `y=${s.pos[1]} burde være under toppen ${m.size.h}`);
    assert.ok(s.pos[0] < m.pos[0], "den sidder opstrøms for maskinens midte");
  });

  it("kanal og register er uændrede efter flytningen", () => {
    const rapport = channelReport(ot.cabinets[0], ot.sensors, 1);
    assert.equal(rapport.channel.get("FT-743"), "AI1");
    assert.equal(registerMap(rapport, ot.sensors)[0].address, "30001–30002");
  });
});
