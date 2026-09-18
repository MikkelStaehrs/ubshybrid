// Hvor live-værdierne kommer fra.
//
// Kortet kender kun `LiveSource`. Om tallene er simuleret i browseren eller
// hentet fra MSSQL gennem /api/live, er et spørgsmål om hvilken implementering
// der er valgt — resten af koden mærker ingen forskel. Det er også derfor
// visningen kan bygges færdig, længe før der er et rack at hente data fra.

export type Quality = "good" | "stale" | "fault" | "no-source";

export interface SignalValue {
  /** Sensorens tag, fx "FT-756". */
  signalId: string;
  /** Råsignalet i mA, som det står på kanalen. */
  raw: number;
  /** Skaleret måleværdi. */
  value: number;
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

/** Uden for 3,6–21 mA er sløjfen i stykker, ikke bare i ro. */
export const FAULT_LOW_MA = 3.6;
export const FAULT_HIGH_MA = 21;

/**
 * Skalering pr. signal. Hører egentlig hjemme på sensoren i data/ot-layer.ts,
 * men måleområdet er ikke fastlagt endnu — tallene her er et pladsholder-
 * område, så visningen kan bygges. De skal rettes, før nogen aflæser dem.
 */
const SCALE: Record<string, { unit: string; min: number; max: number }> = {
  "FT-756": { unit: "t/t", min: 0, max: 40 },
};

const DEFAULT_SCALE = { unit: "%", min: 0, max: 100 };

/** 4–20 mA til måleenhed. Uden for området fortsætter linjen bare. */
export function scaleFromMa(signalId: string, ma: number) {
  const s = SCALE[signalId] ?? DEFAULT_SCALE;
  const value = s.min + ((ma - 4) / 16) * (s.max - s.min);
  return { value, unit: s.unit };
}

export function qualityOf(ma: number, timestamp: string, now = Date.now()): Quality {
  if (!Number.isFinite(ma) || ma < FAULT_LOW_MA || ma > FAULT_HIGH_MA) return "fault";
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
 * Simuleret FT-756.
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
    if (this.mode === "stop") return 4 + (Math.random() - 0.5) * 0.04;
    // Langsom drift plus lidt støj — ligner en materialestrøm mere end hvid støj.
    this.drift = Math.max(-1, Math.min(1, this.drift + (Math.random() - 0.5) * 0.12));
    return 13 + this.drift * 3.2 + (Math.random() - 0.5) * 0.5;
  }

  async getSnapshot(): Promise<SignalValue[]> {
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    return this.signalIds.map((signalId) => {
      // Kun piloten er simuleret. Resten har ingen kilde — det er sandheden.
      if (signalId !== "FT-756") {
        return { signalId, raw: NaN, value: NaN, unit: "", quality: "no-source", timestamp };
      }
      const raw = this.ma(now);
      const { value, unit } = scaleFromMa(signalId, raw);
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
        signalId, raw: NaN, value: NaN, unit: "", quality: "no-source", timestamp,
      }));

    try {
      const res = await fetch("/api/live", { cache: "no-store" });
      if (!res.ok) return blank();
      const body = (await res.json()) as ApiResult;
      if (!body.ok || !Array.isArray(body.signals) || body.signals.length === 0) return blank();

      const byId = new Map(body.signals.map((s) => [s.signalId, s]));
      return this.signalIds.map((signalId) => {
        const s = byId.get(signalId);
        if (!s) return { signalId, raw: NaN, value: NaN, unit: "", quality: "no-source", timestamp };
        // Kvaliteten regnes her, så den altid følger den samme regel.
        return { ...s, quality: qualityOf(s.raw, s.timestamp) };
      });
    } catch {
      return blank();
    }
  }
}

export function createLiveSource(kind: LiveSourceKind, signalIds: string[]): LiveSource {
  return kind === "api" ? new ApiSource(signalIds) : new MockSource(signalIds);
}
