import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FORBINDELSER, UTEGNEDE } from "../../data/fabrik";
import { PROEVESTEDER, type Proevested } from "../../data/proevesteder";
import { fabrikModel, overlapper, type Forbindelse } from "./fabrik";
import type { Layout } from "./layout";
import { LINES } from "./lines";
import { layoutOt, otLayerFor, type OtLayout } from "./ot";
import type { LineData } from "./types";

const RUM = new Set(["analytics"]);
const otRigtig = (id: string, layout: Layout): OtLayout | null => {
  const layer = otLayerFor(id);
  return layer ? layoutOt(layer, layout, id) : null;
};
/** Samme anlæg med hele kæden og laboratoriet rejst. */
const otRejst = (id: string, layout: Layout): OtLayout | null => {
  const ot = otRigtig(id, layout);
  return ot && {
    ...ot,
    cabinets: ot.cabinets.map((c) => ({ ...c, status: "active" as const })),
    sensors: ot.sensors.map((s) => ({ ...s, status: "active" as const })),
    infrastructure: ot.infrastructure.map((n) => ({ ...n, status: "active" as const })),
  };
};
const model = (over: Partial<Parameters<typeof fabrikModel>[0]> = {}) =>
  fabrikModel({ linjer: LINES, rum: RUM, utegnede: UTEGNEDE, forbindelser: FORBINDELSER, proevesteder: PROEVESTEDER, ot: otRigtig, ...over });

describe("hele fabrikken", () => {
  it("har en blok for hver tegnet linje og hvert rum — og ingen ligger oven i en anden", () => {
    const m = model({ utegnede: [{ id: "rens", navn: "Renseriet", slags: "linje", nr: 1 }, { id: "lager", navn: "Lageret", slags: "rum" }] });
    for (const id of Object.keys(LINES)) assert.ok(m.blokke.some((b) => b.id === id && b.tegnet), id);
    assert.ok(m.blokke.some((b) => b.id === "rens" && !b.tegnet), "en utegnet linje står som blok");
    for (let i = 0; i < m.blokke.length; i++) {
      for (let j = i + 1; j < m.blokke.length; j++) {
        assert.ok(!overlapper(m.blokke[i], m.blokke[j]), `${m.blokke[i].navn} og ${m.blokke[j].navn} overlapper`);
      }
    }
  });

  it("linjerne står i nummerorden — også de utegnede", () => {
    const m = model({ utegnede: [{ id: "rens", navn: "Renseriet", slags: "linje", nr: 1 }, { id: "pak", navn: "Pakkeriet", slags: "linje", nr: 3 }] });
    const linjer = m.blokke.filter((b) => b.slags === "linje").sort((a, b) => a.x0 - b.x0).map((b) => b.nr);
    assert.deepEqual(linjer, [...linjer].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  it("maskinerne står inde i deres egen blok", () => {
    for (const b of model().blokke.filter((x) => x.layout)) {
      for (const mk of b.layout!.machines) {
        const x = mk.pos[0] + b.forskyd[0];
        const z = mk.pos[2] + b.forskyd[1];
        assert.ok(x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1, `${mk.name} står uden for ${b.navn}`);
      }
    }
  });

  it("en målfast linje står, hvor den står — de skematiske stilles ved siden af", () => {
    const maalt: LineData = { ...LINES.sliberi, line: { ...LINES.sliberi.line, positionMode: "floorplan" } };
    const m = model({ linjer: { ...LINES, sliberi: maalt } });
    const s = m.blokke.find((b) => b.id === "sliberi")!;
    assert.ok(s.maalfast);
    assert.deepEqual(s.forskyd, [0, 0]);
    for (const b of m.blokke.filter((x) => x.id !== "sliberi")) assert.ok(!overlapper(s, b), `${b.navn} ligger oven i Sliberiet`);
  });
});

describe("lageret over linjerne", () => {
  const m = model();
  const lager = m.blokke.find((b) => b.id === "warehouse")!;
  const linjer = m.blokke.filter((b) => b.slags === "linje");

  it("står som et bånd over hele rækken af linjer", () => {
    assert.ok(lager.overLinjerne);
    assert.ok(lager.x0 <= Math.min(...linjer.map((b) => b.x0)) && lager.x1 >= Math.max(...linjer.map((b) => b.x1)));
    assert.ok(lager.z1 < Math.min(...linjer.map((b) => b.z0)), "lageret står ikke over linjerne");
  });

  it("en forbindelse til lageret går lodret op fra sit trin — ikke til midten af båndet", () => {
    for (const b of m.buer.filter((x) => x.fraDel === "warehouse" || x.tilDel === "warehouse")) {
      const anden = m.blokke.find((x) => x.id === (b.fraDel === "warehouse" ? b.tilDel : b.fraDel))!;
      const paaLager = b.fraDel === "warehouse" ? b.fra : b.til;
      assert.ok(paaLager[0] >= anden.x0 && paaLager[0] <= anden.x1, `${b.navn} rammer ikke lageret over ${anden.navn}`);
    }
  });

  it("ens numre står i den rækkefølge, de er skrevet — Steeping før Packing", () => {
    const x = (id: string) => m.blokke.find((b) => b.id === id)!.x0;
    assert.ok(x("steeping") < x("packing"));
    assert.ok(m.blokke.find((b) => b.id === "steeping")!.valgfri);
  });

  it("det sagte står som fundet, det udledte af mønstret som antaget", () => {
    const sagt = m.buer.find((b) => b.id === "F-SLIBERI-WAREHOUSE")!;
    const antaget = m.buer.find((b) => b.id === "F-COATING-WAREHOUSE")!;
    assert.equal(sagt.antaget, false);
    assert.equal(antaget.antaget, true);
  });
});

describe("forbindelserne", () => {
  it("de håndholdte peger alle på noget, der findes", () => {
    assert.deepEqual(model().fejl, []);
  });

  it("en forbindelse til en maskine eller en del, der ikke findes, siges — den forsvinder ikke i stilhed", () => {
    const forkert: Forbindelse[] = [
      { id: "X1", slags: "materiale", navn: "x", fra: { del: "sliberi", wIds: ["000"] }, til: { del: "analytics" }, findes: true },
      { id: "X2", slags: "materiale", navn: "x", fra: { del: "findes-ikke" }, til: { del: "analytics" }, findes: true },
    ];
    const m = model({ forbindelser: forkert });
    assert.equal(m.fejl.length, 2);
    assert.match(m.fejl[0], /W-000/);
    assert.match(m.fejl[1], /findes-ikke/);
  });

  it("prøvestederne står som ét mærkat pr. maskine — på maskinen", () => {
    const m = model();
    const s = m.blokke.find((b) => b.id === "sliberi")!;
    assert.equal(m.proever.reduce((n, x) => n + x.steder.length, 0), PROEVESTEDER.length);
    for (const mk of m.proever) {
      const maskine = s.layout!.machines.find((x) => x.wIds.includes(mk.wId))!;
      assert.deepEqual(mk.p, [maskine.pos[0] + s.forskyd[0], maskine.pos[2] + s.forskyd[1]]);
    }
    // Et kastebord har tre: Heavy, Light og Mainline.
    assert.equal(m.proever.find((x) => x.wId === "636")!.steder.length, 3);
  });

  it("én bue pr. instrument — ikke én pr. prøvested", () => {
    const m = model();
    const proeve = m.buer.filter((b) => b.slags === "proever");
    const instrumenter = new Set(PROEVESTEDER.map((st) => `${st.hvor.del}:${st.analyse.instrument}:${st.slags}`));
    assert.equal(proeve.length, instrumenter.size);
    for (const b of proeve) assert.ok(b.steder && b.steder.length > 0);
    assert.equal(proeve.reduce((n, b) => n + b.steder!.length, 0), PROEVESTEDER.length);
  });

  it("et prøvested på en maskine, der ikke findes, siges", () => {
    const forkert: Proevested = { ...PROEVESTEDER[0], id: "x", hvor: { del: "sliberi", wId: "000" } };
    assert.match(model({ proevesteder: [forkert] }).fejl.join(), /W-000/);
  });

  it("et operationsnummer gættes ikke — står det tomt, er det tomt", () => {
    for (const st of PROEVESTEDER) assert.ok(st.operationsnr === null || /\S/.test(st.operationsnr), st.id);
  });

  it("data og netværk udledes: stiplet i dag, fuld streg, når kæden står", () => {
    const i_dag = model().buer.filter((b) => b.slags === "data");
    assert.ok(i_dag.length >= 2, "ingen dataforbindelser");
    assert.ok(i_dag.every((b) => b.udledt && !b.findes), "en dataforbindelse påstår at findes i dag");
    assert.ok(i_dag.find((b) => b.fraDel === "sliberi")!.note!.startsWith("Kæden stopper"));
    const rejst = model({ ot: otRejst }).buer.filter((b) => b.slags === "data");
    assert.ok(rejst.every((b) => b.findes), "kæden står, men en dataforbindelse er stadig stiplet");
  });

  it("laboratoriets svar går fra det rum, analyseudstyret står i", () => {
    const lab = model().buer.find((b) => b.id === "data:lab")!;
    assert.equal(lab.fraDel, "analytics");
  });
});
