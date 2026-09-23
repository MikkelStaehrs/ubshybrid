// Demo: anlægget, som det ville se ud med signalerne inde.
//
// Samme kontrolrum som /ai, bygget af de samme funktioner. Forskellen er
// udgangstilstanden — kæden står, og tallene er simulerede. Siden mærker
// det selv, øverst og på hvert instrument.
import { hudSide, type SideParams } from "../hudSide";

export const dynamic = "force-dynamic";

export default async function DemoPage({ searchParams }: { searchParams: Promise<SideParams> }) {
  return hudSide(await searchParams, true);
}
