import type { LineData } from "./types";
import sliberi from "../../data/lines/sliberi.json";

// Register nye linjer her efter `npm run parse -- <fil> <id> "<navn>" <nr>`.
export const LINES: Record<string, LineData> = {
  sliberi: sliberi as LineData,
};
