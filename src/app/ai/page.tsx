// AI-overblik.
//
// To udtryk, samme data. HUD'en er standard — et kontrolrum til at se på en
// storskærm. Dokumentvisningen på ?visning=dokument er den, man læser og
// printer. Begge bygger på agents.ts, pathState() og signalDelivery(); der
// er ingen tredje kilde, og de kan ikke komme til at sige noget forskelligt.
//
// Bag samme login som resten; proxy.ts matcher /:path*.
import { hudModel } from "../../lib/ai-hud";
import { DEFAULT_LINE, LINES } from "../../lib/lines";
import { layoutOt, otLayerFor } from "../../lib/ot";
import { layoutLine } from "../../lib/layout";
import { DocumentView } from "./DocumentView";
import { HudView } from "./HudView";

export const dynamic = "force-dynamic";

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (params.visning === "dokument") return <DocumentView />;

  const model = hudModel(DEFAULT_LINE);
  // Uden en linje med agenter er der intet kontrolrum at vise — så er
  // dokumentvisningen det ærlige svar.
  if (!model) return <DocumentView />;

  // Hologrammet tegner fabrikken selv, så det skal have linjedata og
  // OT-laget med. Begge dele er rene objekter og kan sendes til klienten.
  const line = LINES[model.lineId];
  const otData = otLayerFor(model.lineId);
  const ot = otData ? layoutOt(otData, layoutLine(line), model.lineId) : null;

  // ?maal=1 tænder frametids-måling under udvikling. I produktion er den
  // slået fra uanset hvad — se useFrameProbe i HudView.
  const measure = params.maal === "1" && process.env.NODE_ENV !== "production";
  // Samme variabel som kortet læser. Måleren aflæses på HUD'en, så man kan
  // se, at den svarer — og at intet af det når frem til en database endnu.
  const liveSource = process.env.LIVE_SOURCE === "api" ? "api" : "mock";
  return (
    <HudView model={model} line={line} ot={ot} liveSource={liveSource} measure={measure} />
  );
}
