// Seneste måleværdier, læst fra MSSQL. Kun læsning — kortet skriver aldrig.
//
// Stub indtil databasen findes. Den svarer bevidst 200 med ok:false frem for
// en fejlkode: så kan kortet skelne mellem "endpointet svarer ikke" og
// "endpointet lever, men der er ingen database bag" — og det er præcis den
// slags forskel, fanen Forbindelser er til for at vise.
import { NextResponse } from "next/server";
import type { ApiResult } from "../../../lib/live-source";

// Værdierne skal være friske, ikke cachede.
export const dynamic = "force-dynamic";

export async function GET() {
  // Når OT Test Center og edge-collectoren står, bliver det til noget i retning af:
  //
  //   SELECT tag, wid, vaerdi, enhed, tidspunkt
  //   FROM ot_maaling m
  //   WHERE tidspunkt = (SELECT MAX(tidspunkt) FROM ot_maaling WHERE tag = m.tag)
  //
  // og rækkerne mappes til SignalValue. Råsignalet i mA skal med som egen
  // kolonne, ellers kan kabelbrud ikke kendes fra et stop.
  const body: ApiResult = {
    ok: false,
    reason: "MSSQL er ikke koblet til endnu — se Forudsætninger i IO-skabet.",
    signals: [],
  };
  return NextResponse.json(body);
}
