import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  gyldigKommando, gyldigLinje, haandterKommando, haandterLinje, hukommelse, laesKontor, upstash,
  TAVS_MS, type KanalLager, type LinjePost, type LinjeSvar, type SimStatus,
} from "./kanal";
import type { Besked } from "./samspil";
import type { Haendelse } from "./telemetri";

/**
 * Et lille Redis bag Upstash' REST-format: de kommandoer, kanalen bruger, og
 * ikke flere. Så kører de samme regler mod begge lagre.
 */
function falskUpstash() {
  const data = new Map<string, string | string[]>();
  const hent = async (url: string, init: RequestInit) => {
    assert.ok(url.endsWith("/pipeline"), url);
    assert.equal((init.headers as Record<string, string>).authorization, "Bearer hemmelig");
    const kommandoer = JSON.parse(String(init.body)) as string[][];
    const svar = kommandoer.map(([navn, ...a]) => {
      for (const x of a) assert.equal(typeof x, "string", `${navn}: alt skal være tekst`);
      switch (navn) {
        case "GET": return { result: (data.get(a[0]) as string | undefined) ?? null };
        case "SET": data.set(a[0], a[1]); return { result: "OK" };
        case "DEL": for (const k of a) data.delete(k); return { result: a.length };
        case "EXPIRE": return { result: 1 };
        case "RPUSH": {
          const l = (data.get(a[0]) as string[] | undefined) ?? [];
          l.push(...a.slice(1));
          data.set(a[0], l);
          return { result: l.length };
        }
        case "LRANGE": {
          const l = (data.get(a[0]) as string[] | undefined) ?? [];
          return { result: l.slice(Number(a[1])) };
        }
        default: return { error: `ukendt ${navn}` };
      }
    });
    return new Response(JSON.stringify(svar), { status: 200 });
  };
  return upstash("https://falsk.upstash.io/", "hemmelig", hent);
}

const status = (t: number): SimStatus => ({
  t, valgt: "auto", gang: 90, ordre: null, uro: [],
  agenter: { motor: "regler", kald: 0, brugtKr: 0, loftKr: 0, venter: [], stoppet: null, fejl: null, seed: 743 },
  anbefalinger: [],
  proever: null,
});
const h = (t: number, tekst = `h${t}`): Haendelse => ({ t, hvor: null, tekst, niveau: "info" });
const b = (nr: number): Besked => ({ nr, t: nr, fra: "Driftsagent", til: "Alle", type: "iagttagelse", tekst: `b${nr}` });
const linje = (koersel: string, mere: Partial<LinjePost> = {}): LinjePost => ({
  type: "linje", koersel, status: status(0), log: [], samtale: [], kommandoFra: 0, ...mere,
});
const ejer = (s: LinjeSvar) => { assert.ok(s.ejer, "linjeskærmen fik ikke rummet"); return s; };

for (const [navn, nyt] of [["hukommelse", () => hukommelse(new Map())], ["upstash", falskUpstash]] as const) {
  describe(`kanalen (${navn})`, () => {
    const R = "sliberiet";
    let lager: KanalLager;
    const T = 1_000_000;

    it("den første linjeskærm får rummet, og kontoret læser det, den sendte", async () => {
      lager = nyt();
      ejer(await haandterLinje(lager, R, linje("k1", { overtag: true, log: [h(1), h(2)], samtale: [b(1)] }), T));
      const k = await laesKontor(lager, R, 0, 0, T + 100, false);
      assert.equal(k.ejer?.koersel, "k1");
      assert.equal(k.alderMs, 100);
      assert.deepEqual(k.log.map((x) => x.tekst), ["h1", "h2"]);
      assert.equal(k.logTil, 2);
      assert.equal(k.samtaleTil, 1);
      assert.equal(k.lager, navn);
    });

    it("kontoret får kun det nye, siden det sidst spurgte", async () => {
      lager = nyt();
      ejer(await haandterLinje(lager, R, linje("k1", { overtag: true, log: [h(1), h(2)] }), T));
      ejer(await haandterLinje(lager, R, linje("k1", { log: [h(3)], samtale: [b(1), b(2)] }), T + 500));
      const k = await laesKontor(lager, R, 2, 0, T + 600, false);
      assert.deepEqual(k.log.map((x) => x.tekst), ["h3"]);
      assert.equal(k.logTil, 3);
      assert.deepEqual(k.samtale.map((x) => x.nr), [1, 2]);
      assert.equal(k.status?.gang, 90);
    });

    it("den nyeste linjeskærm vinder — den gamle kører videre, men tier", async () => {
      lager = nyt();
      ejer(await haandterLinje(lager, R, linje("gammel", { overtag: true, log: [h(1)] }), T));
      const ny = ejer(await haandterLinje(lager, R, linje("ny", { overtag: true, log: [h(9)] }), T + 1000));
      assert.equal(ny.ejer && ny.nulstillet, true);
      assert.deepEqual(await haandterLinje(lager, R, linje("gammel", { log: [h(2)] }), T + 1500), { ejer: false });
      const k = await laesKontor(lager, R, 0, 0, T + 1600, false);
      assert.equal(k.ejer?.koersel, "ny");
      assert.deepEqual(k.log.map((x) => x.tekst), ["h9"], "den gamle kørsels hændelser er ryddet");
    });

    it("en ejer, der har tiet, mister rummet — og den nye skal sende alt forfra", async () => {
      lager = nyt();
      const foer = ejer(await haandterLinje(lager, R, linje("a", { overtag: true }), T));
      const udgave = (await laesKontor(lager, R, 0, 0, T, false)).ejer!.udgave;
      assert.deepEqual(await haandterLinje(lager, R, linje("b"), T + TAVS_MS - 1), { ejer: false });
      const s = ejer(await haandterLinje(lager, R, linje("b"), T + TAVS_MS + 1));
      assert.ok(foer.ejer && s.ejer && s.nulstillet);
      assert.notEqual((await laesKontor(lager, R, 0, 0, T, false)).ejer!.udgave, udgave, "kontoret skal kunne se, at det skal læse forfra");
    });

    it("en kommando når linjeskærmen én gang, og kun den kørsel, den var til", async () => {
      lager = nyt();
      ejer(await haandterLinje(lager, R, linje("k1", { overtag: true }), T));
      assert.deepEqual(await haandterKommando(lager, R, { type: "kommando", kommando: { id: "c1", koersel: "k1", k: { type: "fart", h: "pause" } } }), { ok: true });
      const r1 = ejer(await haandterLinje(lager, R, linje("k1"), T + 500));
      assert.ok(r1.ejer);
      assert.deepEqual(r1.kommandoer.map((k) => k.id), ["c1"]);
      const r2 = ejer(await haandterLinje(lager, R, linje("k1", { kommandoFra: r1.kommandoTil }), T + 1000));
      assert.ok(r2.ejer);
      assert.equal(r2.kommandoer.length, 0, "en kommando udføres ikke to gange");
      // En anbefaling i en gammel kørsel er ikke den samme som i den nye.
      const forsent = await haandterKommando(lager, R, { type: "kommando", kommando: { id: "c2", koersel: "k0", k: { type: "udfoer", id: 3 } } });
      assert.equal(forsent.ok, false);
    });
  });
}

describe("hvad serveren tager imod", () => {
  it("en linjeskærm med sine lister", () => {
    assert.ok(gyldigLinje(linje("k-1", { log: [h(1)], samtale: [b(1)] })));
    assert.ok(!gyldigLinje({ ...linje("k1"), log: [{ tekst: 1 }] }));
    assert.ok(!gyldigLinje({ ...linje("k1"), koersel: "ikke gyldig!" }));
    assert.ok(!gyldigLinje({ ...linje("k1"), kommandoFra: -1 }));
  });

  it("kun de kommandoer, der findes", () => {
    const k = (indhold: unknown) => ({ type: "kommando", kommando: { id: "c", koersel: "k1", k: indhold } });
    assert.ok(gyldigKommando(k({ type: "fart", h: 90 })));
    assert.ok(gyldigKommando(k({ type: "fart", h: "auto" })));
    assert.ok(gyldigKommando(k({ type: "motor", motor: "claude" })));
    assert.ok(gyldigKommando(k({ type: "afvis", id: 4 })));
    assert.ok(!gyldigKommando(k({ type: "fart", h: "hurtigt" })));
    assert.ok(!gyldigKommando(k({ type: "motor", motor: "gpt" })));
    assert.ok(!gyldigKommando(k({ type: "slet" })));
  });
});
