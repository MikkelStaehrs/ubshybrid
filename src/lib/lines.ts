import type { LineData } from "./types";
import sliberi from "../../data/lines/sliberi.json";

// Register nye linjer her efter `npm run parse -- <fil> <id> "<navn>" <nr>`.
// Linjerne er selvstændige procesafsnit — der er ikke materialeflow imellem dem.
export const LINES: Record<string, LineData> = {
  sliberi: sliberi as LineData,
};

export interface LineOption {
  id: string;
  name: string;
  order: number;
}

/** Linjerne i nummerorden. Styrer rækkefølgen i linjevælgeren. */
export const LINE_OPTIONS: LineOption[] = Object.entries(LINES)
  .map(([id, d]) => ({ id, name: d.line.name, order: d.line.order }))
  .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "da"));

/** Linjen der vises, når ingen er valgt. */
export const DEFAULT_LINE = LINE_OPTIONS[0].id;
