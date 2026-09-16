// Fælles datamodel for fabrikskortet.
// Én LineData pr. produktionslinje. Genereres fra Draw.io via `npm run parse`
// og kan senere læses fra MSSQL i stedet for JSON.

export type MachineKind = "intake" | "elevator" | "distributor" | "process" | "analysis";

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

/**
 * Målfast placering fra plantegningen, i meter.
 *
 * Fabrikkens koordinatsystem: nulpunktet og akserne aftales én gang pr. fabrik
 * og står i README. x vokser mod øst, z vokser mod syd — samme retninger som
 * kortets x/z-akser, så tallene kan bruges direkte.
 */
export interface Placement {
  /** Maskinens midte, meter øst for nulpunktet. */
  x: number;
  /** Maskinens midte, meter syd for nulpunktet. */
  z: number;
  /** Rotation i grader med uret set oppefra. 0 = maskinens længdeakse peger mod øst. */
  rot: number;
}

/**
 * Opmålt fodaftryk i meter, i maskinens egne akser.
 * Uafhængigt af `placement`: man kan godt kende en maskines mål uden at vide,
 * hvor i fabrikken den står. Mangler det, bruges standardmålene for maskintypen.
 */
export interface Footprint {
  /** Bredde langs maskinens længdeakse. */
  x: number;
  /** Dybde på tværs. */
  z: number;
  /** Højde. Udelades den, bruges standardhøjden for maskintypen. */
  h?: number;
}

/** Plantegningen lagt ind under maskinerne, så koordinaterne kan kontrolleres visuelt. */
export interface FloorplanImage {
  /** Sti under `public/`, fx "/plantegninger/holeby.png". */
  src: string;
  /** Billedets nordvestlige hjørne i fabrikkens koordinatsystem (meter). */
  x: number;
  z: number;
  /** Billedets udstrækning i meter. */
  width: number;
  depth: number;
  /** Drejning i grader med uret om billedets midte, hvis tegningen ikke ligger akseparallelt. */
  rot?: number;
  /** 0–1. Standard 0.55. */
  opacity?: number;
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
  /** Placering i tegningen (Draw.io-pixels). Bruges til at udlede flow og spor. */
  drawio: { x: number; y: number; w: number; h: number };
  /** Målfast placering fra plantegningen. Mangler den, tegnes maskinen skematisk. */
  placement?: Placement;
  /** Opmålte mål. Bruges altid, også når placeringen er skematisk. */
  footprint?: Footprint;
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
    /** Plantegning under kortet. Vises kun i floorplan-tilstand. */
    floorplan?: FloorplanImage;
  };
  lanes: string[];
  machines: Machine[];
  edges: FlowEdge[];
  issues: string[];
}
