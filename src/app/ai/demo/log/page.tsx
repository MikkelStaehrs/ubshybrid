// Loggen til en anden skærm: hændelserne og agenterne imellem, side om side.
//
// Siden kører ingen simulering selv. Den lytter på kontrolrummet på
// /ai/demo, som kører ordren, og viser, hvad der sker, mens det sker.
import type { Metadata } from "next";
import { SimLogSide } from "../../SimLogSide";

export const metadata: Metadata = { title: "Log · simulering" };

export default function LogPage() {
  return <SimLogSide />;
}
