// AI-overblik.
//
// To udtryk, samme data. HUD'en er standard — et kontrolrum til at se på en
// storskærm. Dokumentvisningen på ?visning=dokument er den, man læser og
// printer. Begge bygger på agents.ts, pathState() og signalDelivery(); der
// er ingen tredje kilde, og de kan ikke komme til at sige noget forskelligt.
//
// Anlægget med signalerne inde ligger på /ai/demo.
//
// Bag samme login som resten; proxy.ts matcher /:path*.
import { redirect } from "next/navigation";
import { DocumentView } from "./DocumentView";
import { hudSide, type SideParams } from "./hudSide";

export const dynamic = "force-dynamic";

export default async function AiPage({ searchParams }: { searchParams: Promise<SideParams> }) {
  const params = await searchParams;
  if (params.visning === "dokument") return <DocumentView />;

  // Den gamle adresse til fremskrivningen. Gemte links skal stadig virke, og
  // fokus og måling tages med.
  if (params.visning === "fremtid") {
    const videre = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k !== "visning" && typeof v === "string") videre.set(k, v);
    }
    const qs = videre.toString();
    redirect(`/ai/demo${qs ? `?${qs}` : ""}`);
  }

  return hudSide(params, false);
}
