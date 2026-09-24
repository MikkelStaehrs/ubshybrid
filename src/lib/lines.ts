import type { LineData } from "./types";
import analytics from "../../data/lines/analytics.json";
import sliberi from "../../data/lines/sliberi.json";

// Register nye linjer her efter `npm run parse -- <fil> <id> "<navn>" <nr>`.
// Linjerne er selvstændige procesafsnit — der er ikke materialeflow imellem dem.
export const LINES: Record<string, LineData> = {
  sliberi: sliberi as LineData,
  analytics: analytics as LineData,
};

/**
 * Rum der hører til hele fabrikken frem for ét procesafsnit. De er ikke
 * nummererede linjer, og de kan vælges uanset hvilken linje man står på.
 */
const ROOM_IDS = new Set(["analytics"]);

export interface LineOption {
  id: string;
  name: string;
  order: number;
}

const toOption = ([id, d]: [string, LineData]): LineOption => ({ id, name: d.line.name, order: d.line.order });
const byOrder = (a: LineOption, b: LineOption) => a.order - b.order || a.name.localeCompare(b.name, "da");
const entries = Object.entries(LINES);

/** De nummererede procesafsnit, i nummerorden. */
export const LINE_OPTIONS: LineOption[] = entries.filter(([id]) => !ROOM_IDS.has(id)).map(toOption).sort(byOrder);

/** Fælles rum, altid tilgængelige uanset valgt linje. */
export const ROOM_OPTIONS: LineOption[] = entries.filter(([id]) => ROOM_IDS.has(id)).map(toOption).sort(byOrder);

/** Visningen der åbnes først. */
export const DEFAULT_LINE = LINE_OPTIONS[0].id;

/** Hele fabrikken på én grund: alle linjer og rum, og forbindelserne mellem dem. */
export const FABRIK_ID = "fabrik";
