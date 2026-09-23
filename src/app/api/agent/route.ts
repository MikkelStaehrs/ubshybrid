// En Claude-agent tænker: simuleringen sender en opgave, Claude svarer.
//
//   POST /api/agent   { koersel, opgave, samtale }  →  { svar, kr, budget }
//   GET  /api/agent?koersel=…                       →  { klar, budget }
//
// Ligger bag det samme Basic Auth som resten. Nøglen læses fra
// ANTHROPIC_API_KEY og forlader aldrig serveren. Hører nøglen ikke til et
// workspace, skal ANTHROPIC_WORKSPACE_ID også være sat. Loftet håndhæves her:
// AGENT_LOFT_KR_KOERSEL pr. kørsel og AGENT_LOFT_KR_DOEGN pr. døgn.
import { Budget, estimatKr, gyldigForespoergsel, kaldClaude, modelFor } from "../../../lib/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tal = (v: string | undefined, standard: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : standard;
};

// Ét budget pr. server. Nulstilles ved genstart; kontoens eget loft er det sidste værn.
const BUDGET = new Budget(tal(process.env.AGENT_LOFT_KR_KOERSEL, 10), tal(process.env.AGENT_LOFT_KR_DOEGN, 50));

const svar = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

export async function GET(req: Request) {
  const koersel = new URL(req.url).searchParams.get("koersel") ?? "";
  return svar({ klar: !!process.env.ANTHROPIC_API_KEY, budget: BUDGET.status(koersel) });
}

export async function POST(req: Request) {
  const noegle = process.env.ANTHROPIC_API_KEY;
  if (!noegle) return svar({ fejl: "Ingen API-nøgle på serveren" }, 503);

  const tekst = await req.text();
  if (tekst.length > 30_000) return svar({ fejl: "Opgaven er for stor" }, 413);
  let f: unknown;
  try { f = JSON.parse(tekst); } catch { return svar({ fejl: "Ikke JSON" }, 400); }
  if (!gyldigForespoergsel(f)) return svar({ fejl: "Ugyldig opgave" }, 400);

  const kan = BUDGET.kan(f.koersel, estimatKr(modelFor(f.opgave.agent)));
  if (!kan.ok) return svar({ fejl: kan.grund, budget: BUDGET.status(f.koersel) }, 402);

  const k = await kaldClaude(f, noegle, { workspace: process.env.ANTHROPIC_WORKSPACE_ID || undefined });
  // Også et ubrugeligt svar koster. Det tæller med.
  if (k.kr > 0) BUDGET.brug(f.koersel, k.kr);
  if (!k.ok) return svar({ fejl: k.fejl, kr: k.kr, budget: BUDGET.status(f.koersel) }, 502);
  return svar({ svar: { ...k.svar, ms: k.ms, model: k.model }, kr: k.kr, budget: BUDGET.status(f.koersel) });
}
