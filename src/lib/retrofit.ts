// Retrofit = hvornår en maskine sidst er totalrenoveret.
// Feltet udfyldes i Draw.io og kan være upræcist, så teksten vises råt,
// når den ikke kan læses som en dato.

const MONTHS = ["januar", "februar", "marts", "april", "maj", "juni",
  "juli", "august", "september", "oktober", "november", "december"];

export interface RetrofitDate {
  date: Date;
  precision: "day" | "month" | "year";
}

/** "2024", "2024-06" og "2024-06-15" → dato. Alt andet giver null. */
export function parseRetrofit(v: string): RetrofitDate | null {
  const m = v.trim().match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : 1;
  const d = m[3] ? Number(m[3]) : 1;
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d);
  // Fanger fx 31-02, som Date ellers ruller videre til marts.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return { date, precision: m[3] ? "day" : m[2] ? "month" : "year" };
}

export function formatRetrofit({ date, precision }: RetrofitDate): string {
  if (precision === "year") return String(date.getFullYear());
  const my = `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  return precision === "month" ? my : `${date.getDate()}. ${my}`;
}

/** "for 3 år siden". Tom streng når datoen ligger i fremtiden. */
export function timeSince({ date }: RetrofitDate, now: Date = new Date()): string {
  const months = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  if (months < 0) return "";
  if (months < 1) return "inden for den seneste måned";
  if (months < 24) return `for ${months} måned${months === 1 ? "" : "er"} siden`;
  return `for ${Math.floor(months / 12)} år siden`;
}
