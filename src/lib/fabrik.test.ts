import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FORBINDELSER, UTEGNEDE } from "../../data/fabrik";
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
  fabrikModel({ linjer: LINES, rum: RUM, utegnede: UTEGNEDE, forbindelser: FORBINDELSER, ot: otRigtig, ...over });

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

  it("CT-prøverne går fra de maskiner, prøverne tages ved", () => {
    const m = model();
    const s = m.blokke.find((b) => b.id === "sliberi")!;
    const ct = m.buer.filter((b) => b.id.startsWith("F-CT:"));
    assert.equal(ct.length, 6);
    for (const b of ct) {
      const w = b.id.split(":")[1];
      const mk = s.layout!.machines.find((x) => x.wIds.includes(w))!;
      assert.deepEqual(b.fra, [mk.pos[0] + s.forskyd[0], mk.pos[2] + s.forskyd[1]]);
    }
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
