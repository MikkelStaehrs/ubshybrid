// Formandens kontor: styringen af simuleringen, anbefalingerne, agenterne
// imellem og hændelserne.
//
// Siden kører ingen simulering selv. Linjeskærmen på /ai/demo kører ordren —
// gerne på en anden maskine — og kontoret læser og styrer den gennem serveren.
import type { Metadata } from "next";
import { KontorSide } from "../../KontorSide";

export const metadata: Metadata = { title: "Kontoret · simulering" };

export default function KontorPage() {
  return <KontorSide />;
}
