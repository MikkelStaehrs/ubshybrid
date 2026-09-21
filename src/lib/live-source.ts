// Hvor live-værdierne kommer fra.
//
// Kortet kender kun `LiveSource`. Om tallene er simuleret i browseren eller
// hentet fra MSSQL gennem /api/live, er et spørgsmål om hvilken implementering
// der er valgt — resten af koden mærker ingen forskel. Det er også derfor
// visningen kan bygges færdig, længe før der er et rack at hente data fra.

export type Quality = "good" | "stale" | "fault" | "no-source";

export interface SignalValue {
  /** Sensorens tag, fx "FT-743". */
  signalId: string;
  /** Råsignalet i mA, som det står på kanalen. */
  raw: number;
  /**
   * Skaleret måleværdi — null når råsignalet er uden for sløjfen. En sensor
   * i fejl har ingen måling, og et tal her ville være opdigtet.
   */
  value: number | null;
  unit: string;
  quality: Quality;
  /** ISO-tid for målingen. */
  timestamp: string;
}

export interface LiveSource {
  getSnapshot(): Promise<SignalValue[]>;
}

export type LiveSourceKind = "mock" | "api";

/** En værdi tæller som gammel, når den er ældre end det her. */
export const STALE_AFTER_MS = 10_000;

/**
 * Strømsløjfens fire grænser. De ligger her og kun her — både Live-visningen,
 * agentstatussen og /api/context regner efter dem.
 *
 *   < 3,6 mA          sløjfen er brudt. Ingen måling.
 *   3,6 – 4,0 mA      under nulpunktet, men inden for tolerancen. Klemmes til 0.
 *   4,0 – 20,0 mA     måleområdet: 0 til 150 % af nominel kapacitet.
 *   20,0 – 21,0 mA    over fuldt udslag, inden for tolerancen. Klemmes til maks.
 *   > 21,0 mA         kortslutning eller forkert kobling. Ingen måling.
 */
export const FAULT_LOW_MA = 3.6;
export const NOMINAL_LOW_MA = 4;
export const NOMINAL_HIGH_MA = 20;
export const FAULT_HIGH_MA = 21;

/** Uden for sløjfen er der ikke en dårlig måling — der er ingen måling. */
export function isFaultMa(ma: number): boolean {
  return !Number.isFinite(ma) || ma < FAULT_LOW_MA || ma > FAULT_HIGH_MA;
}

/**
 * "Sensorfejl (3,29 mA, uden for 4–20 mA)". null når signalet er i orden.
 *
 * Teksten nævner måleområdet, ikke den grænse der blev overskredet: 20,5 mA
 * er også over 20, men er inden for tolerancen og ikke en fejl. "Uden for
 * 4–20 mA" er sandt i begge retninger uden at love noget forkert.
 */
export function describeFault(ma: number): string | null {
  if (!isFaultMa(ma)) return null;
  if (!Number.isFinite(ma)) return "Sensorfejl (intet råsignal)";
  const n = ma.toFixed(2).replace(".", ",");
  return `Sensorfejl (${n} mA, uden for ${NOMINAL_LOW_MA}–${NOMINAL_HIGH_MA} mA)`;
}

/**
 * Transmitterens spænd: 4 mA er intet, 20 mA er 150 % af nominel kapacitet.
 *
 * Halvtreds procents overhøjde er der, fordi en måler, der topper ved 100 %,
 * ikke kan vise en overfødning — og en overfødning er netop det, man vil
 * kunne se. Hvad de 100 % *er* i tons, står ikke her: det er en aftale med
 * driften og ligger i data/line-config.ts.
 */
export const FULL_SCALE_PCT = 150;

export const PERCENT_UNIT = "%";

export interface Scaled {
  /** Procent af nominel kapacitet. null ved sensorfejl — ingen måling. */
  value: number | null;
  unit: string;
  /** true når værdien er klemt til en ende af skalaen. */
  clamped: boolean;
}

/**
 * Råsignal til procent af nominel kapacitet.
 *
 * Sløjfen kender ikke tons. Den kender en strøm mellem to grænser, og det
 * eneste ærlige, der kan læses ud af den alene, er hvor stor en del af
 * fuldt udslag den ligger på. Omregningen til en takt kræver en kalibrering
 * og sker i flow.ts — der, hvor kapaciteten er kendt.
 *
 * Skalaen ekstrapoleres aldrig: tolerancebåndene i hver ende klemmes til
 * skalaens ender, og uden for sløjfen er der ingen værdi. Ellers ville
 * 3,7 mA give en negativ materialestrøm, og det findes ikke.
 */
export function scaleFromMa(ma: number): Scaled {
  if (isFaultMa(ma)) return { value: null, unit: PERCENT_UNIT, clamped: false };
  if (ma <= NOMINAL_LOW_MA) return { value: 0, unit: PERCENT_UNIT, clamped: ma < NOMINAL_LOW_MA };
  if (ma >= NOMINAL_HIGH_MA) {
    return { value: FULL_SCALE_PCT, unit: PERCENT_UNIT, clamped: ma > NOMINAL_HIGH_MA };
  }
  const span = NOMINAL_HIGH_MA - NOMINAL_LOW_MA;
  return {
    value: ((ma - NOMINAL_LOW_MA) / span) * FULL_SCALE_PCT,
    unit: PERCENT_UNIT,
    clamped: false,
  };
}

/** Den strøm, der svarer til en given procent. Bruges af simulatoren og tests. */
export function maFromPercent(pct: number): number {
  return NOMINAL_LOW_MA + (pct / FULL_SCALE_PCT) * (NOMINAL_HIGH_MA - NOMINAL_LOW_MA);
}

export function qualityOf(ma: number, timestamp: string, now = Date.now()): Quality {
  if (isFaultMa(ma)) return "fault";
  return now - new Date(timestamp).getTime() > STALE_AFTER_MS ? "stale" : "good";
}

export const QUALITY_LABEL: Record<Quality, string> = {
  good: "OK",
  stale: "Gammel",
  fault: "Fejl",
  "no-source": "Ingen kilde",
};

// ---------------------------------------------------------------------------

/**
 * Simuleret FT-743.
 *
 * Kører i tre tilstande med ophold, så billedet ikke flimrer: normal drift med
 * støj, stop (4 mA — sløjfen lever, men der løber ingenting), og kabelbrud
 * (under 3,6 mA). Stop er almindeligt, kabelbrud sjældent.
 */
class MockSource implements LiveSource {
  private mode: "run" | "stop" | "break" = "run";
  private until = Date.now() + 25_000;
  private drift = 0;

  constructor(private readonly signalIds: string[]) {}

  private roll(now: number) {
    if (now < this.until) return;
    const r = Math.random();
    if (r < 0.04) {
      // Kabelbrud: sjældent, og det bliver stående til nogen kigger på det.
      this.mode = "break";
      this.until = now + 20_000;
    } else if (r < 0.3) {
      this.mode = "stop";
      this.until = now + 8_000 + Math.random() * 12_000;
    } else {
      this.mode = "run";
      this.until = now + 20_000 + Math.random() * 40_000;
    }
  }

  private ma(now: number): number {
    this.roll(now);
    if (this.mode === "break") return 3.1 + Math.random() * 0.3;
    // Stop: sløjfen lever, der løber bare ingenting. Nul procent, ikke en fejl.
    if (this.mode === "stop") return NOMINAL_LOW_MA + (Math.random() - 0.5) * 0.04;
    // Langsom drift plus lidt støj — ligner en materialestrøm mere end hvid
    // støj. Den vandrer omkring nominel kapacitet og krydser både den lave
    // grænse og hundrede procent, så visningen viser alle tre niveauer.
    this.drift = Math.max(-1, Math.min(1, this.drift + (Math.random() - 0.5) * 0.12));
    return maFromPercent(92 + this.drift * 20 + (Math.random() - 0.5) * 4);
  }

  async getSnapshot(): Promise<SignalValue[]> {
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    return this.signalIds.map((signalId) => {
      // Kun piloten er simuleret. Resten har ingen kilde — det er sandheden.
      if (signalId !== "FT-743") {
        return { signalId, raw: NaN, value: null, unit: "", quality: "no-source", timestamp };
      }
      const raw = this.ma(now);
      const { value, unit } = scaleFromMa(raw);
      return { signalId, raw, value, unit, quality: qualityOf(raw, timestamp, now), timestamp };
    });
  }
}

// ---------------------------------------------------------------------------

export interface ApiResult {
  ok: boolean;
  reason?: string;
  signals: SignalValue[];
}

/**
 * Henter fra /api/live, der læser de seneste værdier i MSSQL. Endpointet er
 * en stub indtil databasen findes — den svarer med ok:false og en grund, så
 * kortet kan vise hvilket led der er dødt frem for bare at gå i stå.
 */
class ApiSource implements LiveSource {
  constructor(private readonly signalIds: string[]) {}

  async getSnapshot(): Promise<SignalValue[]> {
    const timestamp = new Date().toISOString();
    const blank = (): SignalValue[] =>
      this.signalIds.map((signalId) => ({
        signalId, raw: NaN, value: null, unit: "", quality: "no-source", timestamp,
      }));

    try {
      const res = await fetch("/api/live", { cache: "no-store" });
      if (!res.ok) return blank();
      const body = (await res.json()) as ApiResult;
      if (!body.ok || !Array.isArray(body.signals) || body.signals.length === 0) return blank();

      const byId = new Map(body.signals.map((s) => [s.signalId, s]));
      return this.signalIds.map((signalId) => {
        const s = byId.get(signalId);
        if (!s) return { signalId, raw: NaN, value: null, unit: "", quality: "no-source", timestamp };
        // Råsignalet er kilden. Skalering og kvalitet regnes her, så de altid
        // følger den samme regel — også hvis databasen har gemt noget andet.
        const { value, unit } = scaleFromMa(s.raw);
        return { ...s, value, unit: s.unit || unit, quality: qualityOf(s.raw, s.timestamp) };
      });
    } catch {
      return blank();
    }
  }
}

export function createLiveSource(kind: LiveSourceKind, signalIds: string[]): LiveSource {
  return kind === "api" ? new ApiSource(signalIds) : new MockSource(signalIds);
}
