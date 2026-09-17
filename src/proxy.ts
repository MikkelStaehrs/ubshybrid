// Hele kortet ligger bag ét delt login (HTTP Basic). Brugernavn og kode kommer
// fra miljøvariabler, så de aldrig ligger i repoet. Mangler de, lukkes der ikke
// nogen ind — et glemt miljø må hellere give en fejl end en åben fabrik.
import { NextResponse, type NextRequest } from "next/server";

const REALM = 'Basic realm="UBS Fabrikskort", charset="UTF-8"';

/** Sammenligner uden at afsløre gennem svartiden hvor langt man kom. */
function sameSecret(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const av = enc.encode(a);
  const bv = enc.encode(b);
  let diff = av.length ^ bv.length;
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    diff |= (av[i] ?? 0) ^ (bv[i] ?? 0);
  }
  return diff === 0;
}

/** "Basic <base64>" → brugernavn og kode. Utydeligt input giver null. */
function readCredentials(header: string | null): { user: string; pass: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    const bytes = Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0));
    // TextDecoder frem for atob alene, så æ, ø og å i koden overlever.
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return null;
  // Kun første kolon deler — koden må selv indeholde kolon.
  return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
}

export default function proxy(request: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;

  if (!user || !pass) {
    return new NextResponse("Login er ikke sat op på dette miljø.", { status: 503 });
  }

  const given = readCredentials(request.headers.get("authorization"));
  if (given && sameSecret(given.user, user) && sameSecret(given.pass, pass)) {
    return NextResponse.next();
  }

  return new NextResponse("Adgang kræver login.", {
    status: 401,
    headers: { "WWW-Authenticate": REALM },
  });
}

export const config = {
  // Alt er bag login — også JS-bundterne, så selve kortet ikke kan læses udefra.
  matcher: "/:path*",
};
