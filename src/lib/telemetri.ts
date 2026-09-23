// Telemetri: hvad skærmen aflæser pr. maskine.
//
// To kilder, samme form:
//
//   simulator()   Fremskrivningen. Alle kanaler fra data/fremskrivning.ts
//                 simuleres, og alt er mærket `simuleret: true`.
//   tomtBillede() Anlægget som det står. Ingen maskine har en kanal, så
//                 alt er null — bortset fra flowet, der kommer fra den
//                 samme LiveSource som kortet.
//
// Komponenterne kender kun `TelemetriBillede`. Om tallene er simuleret eller
// ej, står i billedet selv, så fladen ikke kan vise et opdigtet tal uden at
// vide det.
//
// Simulatoren er ren: ingen React, ingen Date.now() inde i regnestykket,
// seedet tilfældighed. Samme seed og samme skridt giver de samme tal, og
// det er det, der gør den testbar.
import { AFVIGELSER, ANALYSE, FLASKEHALS, HAL, KAEDE, KANALER, type KanalSpec } from "../../data/fremskrivning";
import { maFromPercent } from "./live-source";
import type { Layout, PlacedMachine } from "./layout";

export type Niveau = "info" | "advarsel" | "alarm";

export interface Haendelse {
  /** Millisekunder siden epoch. */
  t: number;
  /** Maskinens korte navn. null for linjen som helhed. */
  hvor: string | null;
  tekst: string;
  niveau: Niveau;
}

export interface KanalLaesning {
  spec: KanalSpec;
  /** null: ingen måling. Aldrig et gæt. */
  value: number | null;
  alarm: boolean;
}

export interface MaskinLaesning {
  id: string;
  wIds: string[];
  navn: string;
  /** Kort nok til et mærkat i 3D: "E-743", "KB-3N". */
  kort: string;
  lane: string | null;
  /** null: vi ved ikke, om den kører. Det er sandheden for hele anlægget i dag. */
  koerer: boolean | null;
  kanaler: KanalLaesning[];
  alarm: boolean;
}

export type KaedeLedId = "kobler" | "edge" | "mssql";

/** Ét led i kæden, målt mod sin egen kapacitet. */
export interface KaedeLed {
  id: KaedeLedId;
  /** Efterspørgsel over kapacitet. Over 1 er leddet en flaskehals. */
  udnyttelse: number;
  /** Hvor mange signaler leddet kan bære ved sin nuværende kapacitet. */
  pladsTil: number;
}

/** Kædens egne tal. Kun når kæden står — altså kun i fremskrivningen i dag. */
export interface KaedeTal {
  signaler: number;
  pollMs: number;
  cyklusMs: number;
  raekkerPrS: number;
  /** Databasens kapacitet lige nu, og i normal drift. */
  dbKapacitet: number;
  dbNormal: number;
  /** Rækker, der venter i edge's buffer på at blive skrevet. */
  koe: number;
  buffer: number;
  /** Hvor langt databasen er bagud. */
  forsinkelseS: number;
  /** Rækker tabt, fordi bufferen var fuld. */
  tabt: number;
  /** Samlet siden start. Til regnskabet: modtaget = skrevet + kø + tabt. */
  modtaget: number;
  skrevetIalt: number;
  /** Tæller til visning. */
  skrevet: number;
  senesteMs: number;
  /** Leddet, der ikke kan følge med. null når alle kan. */
  flaskehals: KaedeLedId | null;
  /** Hvorfor, når der er en grund. */
  aarsag: string | null;
  led: KaedeLed[];
}

export interface TelemetriBillede {
  t: number;
  /** Alt her er opdigtet, når den er true. Fladen skal mærke det. */
  simuleret: boolean;
  maskiner: MaskinLaesning[];
  hal: KanalLaesning[];
  /** Materialestrømmen ved indgangen, i procent af nominel kapacitet. */
  flowPct: number | null;
  /** Det rå signal bag procenten. Oscilloskopet tegner det. */
  flowMa: number | null;
  analyse: { lane: string; andele: number[] | null; alarm: boolean; proeveT: number | null }[];
  /** Kædens egne tal. null når kæden ikke står. */
  kaede: KaedeTal | null;
  /** Nyeste først. */
  haendelser: Haendelse[];
  /** Andel af maskintiden, maskinerne har kørt. null uden driftssignaler. */
  oppetidPct: number | null;
  /** Stop, der har varet længere end stopgrænsen. */
  stop: number;
  koerende: number;
}

// ---------------------------------------------------------------------------

/** Kanalerne til én maskine: den første gruppe, der passer, plus afvigelser. */
export function kanalerFor(m: Pick<PlacedMachine, "kind" | "name" | "wIds">): KanalSpec[] {
  const gruppe = KANALER.find((g) =>
    (!g.kind || g.kind === m.kind) && (!g.navn || g.navn.test(m.name)),
  );
  const base = gruppe?.kanaler ?? [];
  const egne = m.wIds.map((w) => AFVIGELSER[w]).find(Boolean);
  if (!egne) return base;
  return base.map((k) => ({ ...k, ...(egne[k.id] ?? {}) }));
}

/** "E-743" for elevatorer, navnet for resten. Vippestolene er én gruppe. */
export function kortNavn(m: Pick<PlacedMachine, "kind" | "name" | "wIds">): string {
  if (m.kind === "elevator") return `E-${m.wIds[0]}`;
  if (m.wIds.length > 1) return `${m.name}e`;
  return m.name;
}

/**
 * Indkøringstid: så længe efter en start meldes en lav værdi ikke.
 *
 * En maskine på vej op i omdrejninger er ikke for langsom — den er ved at
 * starte. Uden den her ville hver genstart udløse en alarm, og et
 * alarmsystem, der altid melder, lærer folk at se bort fra det.
 */
export const INDKOERING_S = 20;

const erAlarm = (
  k: KanalSpec,
  v: number | null,
  koerer: boolean | null,
  indkoerer = false,
): boolean => {
  if (v === null) return false;
  if (k.alarmHoej !== undefined && v > k.alarmHoej) return true;
  // En elevator, der står, er ikke for langsom. Den er stoppet — det er
  // noget andet. Og en, der lige er startet, er ved at komme op i fart.
  if (koerer && !indkoerer && k.alarmLav !== undefined && v < k.alarmLav) return true;
  return false;
};

/**
 * Anlægget som det står: ingen kanaler, ingen driftssignaler.
 *
 * Maskinerne er med, så 3D-scenen kan vise dem — men de har ingen tal, og
 * `koerer` er null, fordi ingen ved det. Flowet sættes udefra, når
 * LiveSource har noget.
 */
export function tomtBillede(layout: Layout, t: number, flowPct: number | null): TelemetriBillede {
  const maskiner = layout.machines
    .filter((m) => m.kind !== "person")
    .map((m) => ({
      id: m.id,
      wIds: m.wIds,
      navn: m.name,
      kort: kortNavn(m),
      lane: m.lane,
      koerer: null,
      kanaler: kanalerFor(m).map((spec) => ({ spec, value: null, alarm: false })),
      alarm: false,
    }));
  return {
    t,
    simuleret: false,
    maskiner,
    hal: HAL.map((spec) => ({ spec, value: null, alarm: false })),
    flowPct,
    flowMa: flowPct === null ? null : maFromPercent(flowPct),
    analyse: ["N", "S"].map((lane) => ({ lane, andele: null, alarm: false, proeveT: null })),
    kaede: null,
    haendelser: [],
    oppetidPct: null,
    stop: 0,
    koerende: 0,
  };
}

// ---------------------------------------------------------------------------
// Simulatoren

/** mulberry32 — samme lille generator som hologrammet bruger. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normalfordelt støj af to jævne tal (Box–Muller). */
function gauss(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

const klem = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Hvor ofte der sker noget. Skruet op, så der sker noget på en skærm, man
 * kigger på i fem minutter — tallene siger ingenting om anlægget.
 */
export const SIM = {
  /** Middeltid mellem to stop et sted på linjen. */
  stopHverS: 75,
  stopVarighedS: [25, 170] as const,
  /** Middeltid mellem to udfald på flowmåleren. */
  sensorfejlHverS: 420,
  sensorfejlVarighedS: 9,
  /** En ny analyseprøve pr. spor. */
  analyseHverS: 30,
  flowNominal: 92,
  flowSpredning: 5,
  /** Stopgrænsen. Samme 120 s som line-config — ikke et nyt tal. */
  stopEfterS: 120,
  /** Hvor mange hændelser loggen husker. */
  logLaengde: 40,
};

interface KanalTilstand { spec: KanalSpec; x: number; alarm: boolean }
interface MaskinTilstand {
  m: PlacedMachine;
  kort: string;
  kanaler: KanalTilstand[];
  stopTil: number | null;
  stoppetFra: number | null;
  /** Hvornår den sidst startede. Bruges til indkøringstiden. */
  startet: number | null;
  koertMs: number;
  totalMs: number;
}

export interface Simulator {
  /** Ét skridt frem. `dtMs` er tiden siden sidst, `nu` er uret. */
  skridt(dtMs: number, nu: number): TelemetriBillede;
}

/**
 * Anlægget, som det ville se ud med kanalerne inde.
 *
 * Hver kanal er en Ornstein–Uhlenbeck-proces: den søger mod sit driftspunkt
 * og har et udsving omkring det, så den vandrer som en rigtig måling i
 * stedet for at flimre. Når maskinen står, søger den mod sin hvileværdi —
 * hastigheden mod nul, motortemperaturen langsomt mod hallens.
 */
export function simulator(
  layout: Layout,
  seed = 743,
  stopEfterS = SIM.stopEfterS,
  /** Hold flaskehalsen fremme hele tiden — til at vise den i et møde. */
  tvungenFlaskehals = false,
): Simulator {
  const r = rng(seed);
  const maskiner: MaskinTilstand[] = layout.machines
    .filter((m) => m.kind !== "person")
    .map((m) => ({
      m,
      kort: kortNavn(m),
      kanaler: kanalerFor(m).map((spec) => ({
        spec,
        // Start et tilfældigt sted i det normale udsving, ikke på stregen.
        x: klem(spec.nominal + gauss(r) * spec.spredning, spec.min, spec.max),
        alarm: false,
      })),
      stopTil: null,
      stoppetFra: null,
      startet: null,
      koertMs: 0,
      totalMs: 0,
    }));
  const hal: KanalTilstand[] = HAL.map((spec) => ({ spec, x: spec.nominal, alarm: false }));

  let flow = SIM.flowNominal;
  let sensorfejlTil: number | null = null;
  let analyse = ["N", "S"].map((lane) => ({ lane, andele: [...ANALYSE.andele], alarm: false, proeveT: null as number | null }));
  let naesteAnalyse = 0;
  // Kæden. Tælleren til visning starter et sted, regnskabet starter i nul.
  const skrevetStart = 1_184_000;
  let modtaget = 0;
  let skrevetIalt = 0;
  let koe = 0;
  let tabt = 0;
  let foersteT: number | null = null;
  let iEpisode = false;
  let alarmeret = false;
  let indhentFra: number | null = null;
  let stop = 0;
  let sidsteVagt = -1;
  const log: Haendelse[] = [];

  const skriv = (h: Haendelse) => {
    log.unshift(h);
    if (log.length > SIM.logLaengde) log.length = SIM.logLaengde;
  };
  const fmt = (v: number, k: KanalSpec) => v.toFixed(k.decimaler).replace(".", ",");

  function opdater(k: KanalTilstand, maal: number, dt: number, stoej: boolean) {
    const theta = k.spec.traeghed ?? 0.1;
    // Udsvinget er valgt, så processen i ro har spredningen fra specifikationen.
    const sigma = k.spec.spredning * Math.sqrt(2 * theta);
    k.x += theta * (maal - k.x) * dt + (stoej ? sigma * Math.sqrt(dt) * gauss(r) : 0);
    k.x = klem(k.x, k.spec.min, k.spec.max);
  }

  function skridt(dtMs: number, nu: number): TelemetriBillede {
    const dt = Math.min(dtMs, 2000) / 1000;

    // --- Stop og start ------------------------------------------------------
    if (r() < dt / SIM.stopHverS) {
      const kandidater = maskiner.filter((s) => s.stopTil === null && s.m.kind !== "intake");
      const s = kandidater[Math.floor(r() * kandidater.length)];
      if (s) {
        const [lo, hi] = SIM.stopVarighedS;
        s.stopTil = nu + (lo + r() * (hi - lo)) * 1000;
        s.stoppetFra = nu;
        skriv({ t: nu, hvor: s.kort, tekst: "Stoppet", niveau: "advarsel" });
      }
    }
    for (const s of maskiner) {
      if (s.stopTil !== null && nu >= s.stopTil) {
        const varighed = (nu - (s.stoppetFra ?? nu)) / 1000;
        // Samme regel som flow.ts: først over stopgrænsen er det et stop.
        if (varighed >= stopEfterS) stop++;
        skriv({
          t: nu, hvor: s.kort,
          tekst: `Kører igen · ${Math.round(varighed)} s${varighed >= stopEfterS ? " · stop registreret" : ""}`,
          niveau: "info",
        });
        s.stopTil = null;
        s.stoppetFra = null;
        s.startet = nu;
      }
    }

    // --- Kanalerne ----------------------------------------------------------
    const hallensTemp = hal[0].x;
    for (const s of maskiner) {
      const koerer = s.stopTil === null;
      const indkoerer = s.startet !== null && nu - s.startet < INDKOERING_S * 1000;
      s.totalMs += dtMs;
      if (koerer) s.koertMs += dtMs;
      for (const k of s.kanaler) {
        // Står maskinen, søger kanalen mod sin hvileværdi. Motortemperaturen
        // falder mod hallens, ikke mod et fast tal.
        const hvile = k.spec.id === "motortemp" || k.spec.id === "froetemp" ? hallensTemp + 3 : k.spec.hvile;
        if (koerer) opdater(k, k.spec.nominal, dt, true);
        else if (hvile !== undefined) opdater(k, hvile, dt, false);
        const alarm = erAlarm(k.spec, k.x, koerer, indkoerer);
        if (alarm && !k.alarm) {
          skriv({ t: nu, hvor: s.kort, tekst: `${k.spec.label} ${fmt(k.x, k.spec)} ${k.spec.unit}`, niveau: "alarm" });
        }
        k.alarm = alarm;
      }
    }
    for (const k of hal) {
      opdater(k, k.spec.nominal, dt, true);
      const alarm = erAlarm(k.spec, k.x, true);
      if (alarm && !k.alarm) skriv({ t: nu, hvor: "Hal", tekst: `${k.spec.label} ${fmt(k.x, k.spec)} ${k.spec.unit}`, niveau: "alarm" });
      k.alarm = alarm;
    }

    // --- Flowet ved indgangen -----------------------------------------------
    // Står påslaget eller elevator 743, løber der ingenting ind.
    const indgang = maskiner.filter((s) => /påslag/i.test(s.m.name) || s.m.wIds.includes("743"));
    const indgangStaar = indgang.some((s) => s.stopTil !== null);
    const maal = indgangStaar ? 0 : SIM.flowNominal;
    const theta = indgangStaar ? 0.6 : 0.15;
    flow += theta * (maal - flow) * dt + (indgangStaar ? 0 : SIM.flowSpredning * Math.sqrt(2 * theta) * Math.sqrt(dt) * gauss(r));
    flow = klem(flow, 0, 150);

    if (sensorfejlTil === null && r() < dt / SIM.sensorfejlHverS) {
      sensorfejlTil = nu + SIM.sensorfejlVarighedS * 1000;
      skriv({ t: nu, hvor: "FT-743", tekst: "Sensorfejl · uden for 4–20 mA", niveau: "alarm" });
    }
    if (sensorfejlTil !== null && nu >= sensorfejlTil) {
      sensorfejlTil = null;
      skriv({ t: nu, hvor: "FT-743", tekst: "Signal tilbage", niveau: "info" });
    }
    const fejl = sensorfejlTil !== null;

    // --- Analysen: en ny prøve ad gangen, ikke en glidende kurve -----------
    if (nu >= naesteAnalyse) {
      naesteAnalyse = nu + SIM.analyseHverS * 1000;
      analyse = analyse.map((a) => {
        const raa = ANALYSE.andele.map((p) => Math.max(0.2, p + gauss(r) * ANALYSE.spredning));
        const sum = raa.reduce((x, y) => x + y, 0);
        const andele = raa.map((p) => (p / sum) * 100);
        const alarm = andele[0] > ANALYSE.alarmFV0;
        if (alarm && !a.alarm) skriv({ t: nu, hvor: `Spor ${a.lane}`, tekst: `FV0 ${andele[0].toFixed(1).replace(".", ",")} %`, niveau: "alarm" });
        return { lane: a.lane, andele, alarm, proeveT: nu };
      });
    }

    // --- Kæden --------------------------------------------------------------
    // Hvert signal gemmes fire gange i sekundet. Rækkerne går gennem
    // kobleren og edge og skal skrives i databasen. Kan databasen ikke
    // følge med, hober de sig op i edge's buffer; er bufferen fuld, tabes de.
    const signaler = maskiner.reduce((n, s) => n + s.kanaler.length, 0) + hal.length + 1;
    const raekkerPrS = signaler * KAEDE.proeverPrS;
    const forespoergsler = Math.ceil((signaler * KAEDE.registreProSignal) / KAEDE.registreProForespoergsel);
    const pollMs = forespoergsler * KAEDE.msProForespoergsel + Math.round(Math.abs(gauss(r)) * 2);

    // Episoden: databasen skriver langsommere en periode.
    if (foersteT === null) foersteT = nu;
    const siden = (nu - foersteT) / 1000 - FLASKEHALS.foersteS;
    const episode = tvungenFlaskehals || (siden >= 0 && siden % FLASKEHALS.hverS < FLASKEHALS.varighedS);
    const dbKapacitet = KAEDE.dbKapacitet * (episode ? FLASKEHALS.kapacitetAndel : 1);

    if (episode && !iEpisode) {
      skriv({ t: nu, hvor: "MSSQL", tekst: `Skriver langsommere · ${FLASKEHALS.aarsag}`, niveau: "advarsel" });
    }
    if (!episode && iEpisode) {
      skriv({ t: nu, hvor: "MSSQL", tekst: "Kapacitet tilbage", niveau: "info" });
      indhentFra = nu;
    }
    iEpisode = episode;

    const ind = raekkerPrS * dt;
    modtaget += ind;
    // Databasen skriver det, der kommer, plus det, der venter — op til loftet.
    const skrives = Math.min(koe + ind, dbKapacitet * dt);
    skrevetIalt += skrives;
    koe += ind - skrives;
    if (koe > KAEDE.buffer) {
      if (tabt === 0) skriv({ t: nu, hvor: "Edge", tekst: "Buffer fuld · data tabes", niveau: "alarm" });
      tabt += koe - KAEDE.buffer;
      koe = KAEDE.buffer;
    }
    // Hvor langt bagud: den ældste række i køen, ved den fart databasen skriver.
    const forsinkelseS = koe > 0.5 ? koe / dbKapacitet : 0;

    // Kædevagten: kan jeg stole på data lige nu? Ikke hvis de er forsinkede.
    if (forsinkelseS > FLASKEHALS.forsinkelseAlarmS && !alarmeret) {
      alarmeret = true;
      skriv({ t: nu, hvor: "Kædevagt", tekst: `Data ${Math.round(forsinkelseS)} s forsinket`, niveau: "alarm" });
    }
    if (koe <= 0.5 && indhentFra !== null) {
      skriv({ t: nu, hvor: "MSSQL", tekst: `Indhentet · ${Math.round((nu - indhentFra) / 1000)} s`, niveau: "info" });
      indhentFra = null;
      alarmeret = false;
    }

    // Kædevagten kører hvert kvarter på uret — samme kadence som i agents.ts.
    // Den melder det, den ser: svarer leddene, men halter data, er det ikke
    // "kæden svarer" — så kan man ikke stole på tallene lige nu.
    const kvarter = Math.floor(nu / 900_000);
    if (kvarter !== sidsteVagt) {
      if (sidsteVagt !== -1) {
        skriv(forsinkelseS >= 1
          ? { t: nu, hvor: "Kædevagt", tekst: `Kæden svarer · ${Math.round(forsinkelseS)} s bagud`, niveau: "advarsel" }
          : { t: nu, hvor: "Kædevagt", tekst: "Kæden svarer", niveau: "info" });
      }
      sidsteVagt = kvarter;
    }

    const led: KaedeLed[] = [
      {
        id: "kobler",
        udnyttelse: pollMs / KAEDE.cyklusMs,
        pladsTil: Math.floor(
          (KAEDE.cyklusMs / KAEDE.msProForespoergsel) * KAEDE.registreProForespoergsel / KAEDE.registreProSignal,
        ),
      },
      {
        id: "edge",
        udnyttelse: raekkerPrS / KAEDE.edgeKapacitet,
        pladsTil: Math.floor(KAEDE.edgeKapacitet / KAEDE.proeverPrS),
      },
      {
        id: "mssql",
        // Efterspørgslen er det, der kommer ind — ikke det, der når at blive
        // skrevet. Ellers ville en flaskehals aldrig kunne ses som en.
        udnyttelse: raekkerPrS / dbKapacitet,
        pladsTil: Math.floor(dbKapacitet / KAEDE.proeverPrS),
      },
    ];
    // Flaskehalsen er det led, der ikke kan følge med — og står der en kø,
    // er det den, selv om kapaciteten lige er kommet tilbage.
    const overbelastet = led.filter((l) => l.udnyttelse >= 1).sort((a, b) => b.udnyttelse - a.udnyttelse)[0];
    const flaskehals = overbelastet?.id ?? (koe > 0.5 ? "mssql" : null);


    const koerende = maskiner.filter((s) => s.stopTil === null).length;
    const tid = maskiner.reduce((n, s) => n + s.totalMs, 0);
    const koert = maskiner.reduce((n, s) => n + s.koertMs, 0);

    return {
      t: nu,
      simuleret: true,
      maskiner: maskiner.map((s) => {
        const koerer = s.stopTil === null;
        const kanaler = s.kanaler.map((k) => ({ spec: k.spec, value: k.x, alarm: k.alarm }));
        return {
          id: s.m.id,
          wIds: s.m.wIds,
          navn: s.m.name,
          kort: s.kort,
          lane: s.m.lane,
          koerer,
          kanaler,
          alarm: kanaler.some((k) => k.alarm),
        };
      }),
      hal: hal.map((k) => ({ spec: k.spec, value: k.x, alarm: k.alarm })),
      flowPct: fejl ? null : flow,
      // Ved sensorfejl er det rå signal uden for sløjfen — det er fejlen.
      flowMa: fejl ? 3.2 + r() * 0.2 : maFromPercent(flow),
      analyse,
      kaede: {
        signaler,
        pollMs,
        cyklusMs: KAEDE.cyklusMs,
        raekkerPrS,
        dbKapacitet,
        dbNormal: KAEDE.dbKapacitet,
        koe: Math.round(koe),
        buffer: KAEDE.buffer,
        forsinkelseS,
        tabt: Math.round(tabt),
        modtaget,
        skrevetIalt,
        skrevet: Math.floor(skrevetStart + skrevetIalt),
        senesteMs: Math.round(forsinkelseS * 1000 + r() * 250),
        flaskehals,
        aarsag: episode ? FLASKEHALS.aarsag : null,
        led,
      },
      haendelser: [...log],
      oppetidPct: tid > 0 ? (koert / tid) * 100 : null,
      stop,
      koerende,
    };
  }

  return { skridt };
}
