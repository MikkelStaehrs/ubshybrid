"use client";
import { FABRIK_ID, type LineOption } from "../lib/lines";

/**
 * Vælgeren i kortets top: hele fabrikken, linjerne og rummene. Ét sted, så
 * kortet og oversigten viser den samme liste.
 */
export function LinjeVaelger({ vaerdi, lines, rooms, onVaelg }: {
  vaerdi: string;
  lines: LineOption[];
  rooms: LineOption[];
  onVaelg: (id: string) => void;
}) {
  return (
    <select
      className="fm-linepick"
      aria-label="Vælg hele fabrikken, en linje eller et rum"
      value={vaerdi}
      onChange={(e) => onVaelg(e.target.value)}
    >
      <option value={FABRIK_ID}>Hele fabrikken</option>
      {lines.length > 0 && (
        <optgroup label="Linjer">
          {lines.map((l) => (
            <option key={l.id} value={l.id}>Linje {l.order} – {l.name}</option>
          ))}
        </optgroup>
      )}
      {rooms.length > 0 && (
        <optgroup label="Rum">
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
