// Kontrolrummet, bygget på serveren. Fælles for /ai og /ai/demo.
//
// De to adresser viser den samme side med de samme funktioner. Det eneste,
// der skiller dem, er udgangstilstanden: /ai er anlægget, som det står;
// /ai/demo er fremskrivningen, hvor signalerne er inde og tallene er
// simulerede. Se src/lib/fremskrivning.ts og src/lib/telemetri.ts.
import { agentsFor } from "../../lib/agents";
import { hudModel } from "../../lib/ai-hud";
import { fremskrivAgenter, fremskrivLayer } from "../../lib/fremskrivning";
import { layoutLine } from "../../lib/layout";
import { DEFAULT_LINE, LINES } from "../../lib/lines";
import { layoutOt, otLayerFor } from "../../lib/ot";
import { DocumentView } from "./DocumentView";
import { HudView } from "./HudView";

export type SideParams = Record<string, string | string[] | undefined>;

export function hudSide(params: SideParams, fremskriv: boolean) {
  const model = hudModel(DEFAULT_LINE, { fremskriv });
  // Uden en linje med agenter er der intet kontrolrum at vise — så er
  // dokumentvisningen det ærlige svar.
  if (!model) return <DocumentView />;

  // Hologrammet tegner fabrikken selv, så det skal have linjedata og
  // OT-laget med. Det bygges på det samme lag som resten af skærmen, så
  // fabrikken i fremskrivningen lyser med.
  const line = LINES[model.lineId];
  const layout = layoutLine(line);
  const raa = otLayerFor(model.lineId);
  const otData = raa && fremskriv
    ? fremskrivLayer(raa, layout, fremskrivAgenter(agentsFor(model.lineId)))
    : raa;
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
  // ?fokus=<W-ID> låser kameraet på én maskine — "lad os se på 743" i et møde.
  const fokusWid = typeof params.fokus === "string" ? params.fokus.replace(/^w-?/i, "") : undefined;
  // ?flaskehals=1 holder en flaskehals i kæden fremme — til at vise, hvordan
  // en ser ud, uden at vente på den næste. Kun i fremskrivningen.
  const flaskehals = fremskriv && params.flaskehals === "1";
  // ?ophobning=1 lader KB-3N gå i stå kort efter, siden er åbnet — så man kan
  // se Driftsagenten gribe ind, uden at vente på et tilfældigt stop.
  const ophobning = fremskriv && params.ophobning === "1";
  // ?seed=12 giver en anden dag: andre stop, andre episoder, samme regler.
  const seed = fremskriv && typeof params.seed === "string" && /^\d+$/.test(params.seed) ? Number(params.seed) : undefined;

  return (
    <HudView
      model={model}
      line={line}
      ot={ot}
      liveSource={liveSource}
      measure={measure}
      fokusWid={fokusWid}
      flaskehals={flaskehals}
      ophobning={ophobning}
      seed={seed}
    />
  );
}
