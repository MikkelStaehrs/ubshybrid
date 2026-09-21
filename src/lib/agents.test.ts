import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sliberi from "../../data/lines/sliberi.json";
import { agentState, agentsFor, decidedAgents, agentStates, sharedInlet } from "./agents";
import { layoutLine } from "./layout";
import { layoutOt, otLayerFor, type OtLayout } from "./ot";
import type { Agent, LineData } from "./types";

const layout = layoutLine(sliberi as LineData);
const real = layoutOt(otLayerFor("sliberi")!, layout, "sliberi");

/** Samme anlæg med hele kæden rejst, så inputs kan komme til at levere. */
const whole: OtLayout = {
  ...real,
  cabinets: real.cabinets.map((c) => ({ ...c, status: "active" as const })),
  infrastructure: real.infrastructure.map((n) => ({ ...n, status: "active" as const })),
};

const byId = (id: string): Agent => {
  const a = agentsFor("sliberi").find((x) => x.id === id);
  assert.ok(a, `agenten ${id} findes ikke`);
  return a;
};

describe("beslutning styrer status", () => {
  it("en idé er idé uanset inputs", () => {
    const idea = byId("AG-SLIB-SKIFT");
    assert.equal(idea.beslutning, "ide");
    // Selv med hele kæden rejst forbliver den en idé — den er ikke besluttet.
    assert.equal(agentState(idea, layout, whole).status, "idea");
    assert.equal(agentState(idea, layout, real).status, "idea");
  });

  it("besluttet uden data står som Mangler", () => {
    assert.equal(agentState(byId("AG-SLIB-VAGT"), layout, real).status, "missing");
  });

  it("besluttet med alle inputs står som Klar, ikke I drift", () => {
    assert.equal(agentState(byId("AG-SLIB-VAGT"), layout, whole).status, "ready");
  });

  it("aktiveret med alle inputs står som I drift", () => {
    const a: Agent = { ...byId("AG-SLIB-VAGT"), beslutning: "aktiveret" };
    assert.equal(agentState(a, layout, whole).status, "running");
  });

  it("aktiveret uden data falder tilbage — aldrig I drift på ingenting", () => {
    // Det er hele pointen med tilbagefaldet: en agent må ikke kunne se ud
    // som om den kører, fordi nogen huskede at slå den til.
    const a: Agent = { ...byId("AG-SLIB-VAGT"), beslutning: "aktiveret" };
    const st = agentState(a, layout, real);
    assert.equal(st.status, "missing");
    assert.notEqual(st.status, "running");
  });
});

describe("idéer tæller ikke med", () => {
  const states = agentStates("sliberi", layout, real);

  it("der er både besluttede og idéer i linjen", () => {
    assert.equal(states.length, 5);
    assert.equal(decidedAgents(states).length, 3);
  });

  it("decidedAgents lader ingen idé slippe igennem", () => {
    for (const st of decidedAgents(states)) assert.notEqual(st.agent.beslutning, "ide");
  });

  it("en idé former ikke fælleszonen", () => {
    const inlet = sharedInlet(states);
    assert.ok(inlet);
    for (const st of inlet.agents) assert.notEqual(st.agent.beslutning, "ide");
  });
});

describe("dataset-input måler dækning", () => {
  it("vedligeholdshistorik tælles mod agentens scope", () => {
    const st = agentState(byId("AG-SLIB-VEDL"), layout, real);
    const input = st.inputs.find((i) => i.input.dataset === "maintenance");
    assert.ok(input, "vedligeholdsagenten mangler sit dataset-input");
    assert.equal(input.total, 26);
    assert.match(input.detail, /af 26 maskiner har vedligeholdshistorik/);
  });

  it("under tærsklen leverer inputtet ikke", () => {
    // Tre af seksogtyve maskiner har historik i dag — langt under tærsklen.
    const st = agentState(byId("AG-SLIB-VEDL"), layout, real);
    const input = st.inputs.find((i) => i.input.dataset === "maintenance")!;
    assert.ok(input.have < input.total, "dækningen burde være under tærsklen");
    assert.match(input.detail, /kræver \d+ %/);
  });
});
