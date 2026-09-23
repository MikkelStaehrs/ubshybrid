// AI-overblik.
//
// To udtryk, samme data. HUD'en er standard — et kontrolrum til at se på en
// storskærm. Dokumentvisningen på ?visning=dokument er den, man læser og
// printer. Begge bygger på agents.ts, pathState() og signalDelivery(); der
// er ingen tredje kilde, og de kan ikke komme til at sige noget forskelligt.
//
// Bag samme login som resten; proxy.ts matcher /:path*.
import { agentsFor } from "../../lib/agents";
import { hudModel } from "../../lib/ai-hud";
import { fremskrivAgenter, fremskrivLayer } from "../../lib/fremskrivning";
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

  // ?visning=fremtid viser anlægget, som det ville se ud med signalerne
  // inde. Den er opdigtet og mærkes som sådan hele vejen — se
  // src/lib/fremskrivning.ts for hvad der præcis er ændret.
  const fremskriv = params.visning === "fremtid";
  const model = hudModel(DEFAULT_LINE, { fremskriv });
  // Uden en linje med agenter er der intet kontrolrum at vise — så er
  // dokumentvisningen det ærlige svar.
  if (!model) return <DocumentView />;

  // Hologrammet tegner fabrikken selv, så det skal have linjedata og
  // OT-laget med. Begge dele er rene objekter og kan sendes til klienten.
  const line = LINES[model.lineId];
  // Hologrammet skal vise den samme tilstand som resten af skærmen, så det
  // bygges på det samme lag. I fremskrivningen lyser fabrikken derfor med.
  const layout = layoutLine(line);
  const raa = otLayerFor(model.lineId);
  const otData = raa && fremskriv ? fremskrivLayer(raa, layout, fremskrivAgenter(agentsFor(model.lineId))) : raa;
  let ot = otData ? layoutOt(otData, layout, model.lineId) : null;
  if (ot && fremskriv) {
    ot = { ...ot, infrastructure: ot.infrastructure.map((n) => ({ ...n, status: "active" as const })) };
  }

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
