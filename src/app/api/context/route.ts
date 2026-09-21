// Konteksten for én linje — eller den gren én agent har i scope.
//
//   GET /api/context?line=sliberi
//   GET /api/context?line=sliberi&agent=AG-SLIB-N
//
// Kun læsning. Bag samme login som resten af kortet (proxy.ts tager alt).
// Selve objektet bygges i src/lib/context.ts af de moduler, kortet tegner
// efter; ruten er kun en skal om det.
import { NextResponse, type NextRequest } from "next/server";
import { buildContext, isContextError } from "../../../lib/context";

// Tidsstemplet skal være friskt, og agenter må ikke få et cachet svar.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const result = buildContext(searchParams.get("line"), searchParams.get("agent"));
  if (isContextError(result)) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
