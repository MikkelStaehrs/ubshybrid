// Kanalen mellem linjeskærmen og kontoret. Se src/lib/kanal.ts.
//
//   POST /api/kanal  { type: "linje", … }     →  kommandoer siden sidst
//   POST /api/kanal  { type: "kommando", … }  →  { ok }
//   GET  /api/kanal?log=N&samtale=M           →  status og det nye
//
// Ligger bag det samme Basic Auth som resten. Lageret er Upstash, hvis
// UPSTASH_REDIS_REST_URL og UPSTASH_REDIS_REST_TOKEN (eller Vercels
// KV_REST_API_URL og KV_REST_API_TOKEN) er sat, og ellers serverens hukommelse.
import {
  gyldigKommando, gyldigLinje, haandterKommando, haandterLinje, lagerFraMiljoe, laesKontor, RUM,
} from "../../../lib/kanal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LAGER = lagerFraMiljoe(process.env);
/** Én linje, ét rum. Et andet navn i adressen giver et andet. */
const STANDARD_RUM = "sliberiet";

const svar = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

const rumFra = (url: URL) => {
  const r = url.searchParams.get("rum") ?? STANDARD_RUM;
  return RUM.test(r) ? r : null;
};
const indeks = (v: string | null) => {
  const n = Number(v ?? 0);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rum = rumFra(url);
  if (!rum) return svar({ fejl: "Ugyldigt rum" }, 400);
  try {
    return svar(await laesKontor(LAGER, rum, indeks(url.searchParams.get("log")), indeks(url.searchParams.get("samtale")), Date.now(), !!process.env.VERCEL));
  } catch (e) {
    return svar({ fejl: e instanceof Error ? e.message : "Lageret svarede ikke" }, 502);
  }
}

export async function POST(req: Request) {
  const rum = rumFra(new URL(req.url));
  if (!rum) return svar({ fejl: "Ugyldigt rum" }, 400);
  const tekst = await req.text();
  // En linjeskærm, der sender alt forfra, sender højst et par hundrede kB.
  if (tekst.length > 1_000_000) return svar({ fejl: "For stor" }, 413);
  let f: unknown;
  try { f = JSON.parse(tekst); } catch { return svar({ fejl: "Ikke JSON" }, 400); }
  try {
    if (gyldigLinje(f)) return svar(await haandterLinje(LAGER, rum, f, Date.now()));
    if (gyldigKommando(f)) {
      const r = await haandterKommando(LAGER, rum, f);
      return svar(r, r.ok ? 200 : 409);
    }
  } catch (e) {
    return svar({ fejl: e instanceof Error ? e.message : "Lageret svarede ikke" }, 502);
  }
  return svar({ fejl: "Ugyldig besked" }, 400);
}
