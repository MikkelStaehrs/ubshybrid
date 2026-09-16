// Fælles datamodel for fabrikskortet.
// Én LineData pr. produktionslinje. Genereres fra Draw.io via `npm run parse`
// og kan senere læses fra MSSQL i stedet for JSON.

export type MachineKind = "intake" | "elevator" | "distributor" | "process";

/** Felter line managers kan udfylde via "Edit Data" (Ctrl+M) i Draw.io. */
export interface MachineDetails {
  producent?: string;
  model?: string;
  aar?: string;
  proces?: string;
  kapacitet?: string;
  dimSkab?: string;
  otNet?: string;
  noter?: string;
  /** Alle øvrige felter fra Draw.io bevares her. */
  [key: string]: string | undefined;
}

export interface Machine {
  /** Stabilt id, afledt af W-ID (fx "W-611"). */
  id: string;
  drawioId: string;
  name: string;
  /** Rå label fra tegningen (renset for HTML). */
  label: string;
  wIds: string[];
  kind: MachineKind;
  /** Spor efter fordeling, fx "S" / "N". null = fælles stræk. */
  lane: string | null;
  /** Trin i flowet (0 = første maskine). */
  step: number;
  /** Placering i tegningen (Draw.io-pixels). */
  drawio: { x: number; y: number; w: number; h: number };
  upstream: string[];
  downstream: string[];
  details: MachineDetails;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  /** true = forbindelsen er gættet af parseren (mangler i tegningen). */
  inferred: boolean;
  note?: string;
}

export interface LineData {
  line: {
    id: string;
    name: string;
    order: number;
    sourceFile: string;
    parsedAt: string;
    /** "schematic" = placering fra flowdiagram, ikke målfast. */
    positionMode: "schematic" | "floorplan";
  };
  lanes: string[];
  machines: Machine[];
  edges: FlowEdge[];
  issues: string[];
}
