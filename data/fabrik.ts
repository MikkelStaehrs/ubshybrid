// Hele fabrikken: det, der ikke er tegnet endnu, og forbindelserne mellem
// linjerne og rummene.
//
// Håndholdt fil. Forbindelserne bindes til W-ID eller til en linje eller et
// rum som helhed — aldrig til tegningens celle-id eller et maskinnavn — så de
// overlever en ny parse.
//
// Data og netværk står ikke her. De udledes af OT-laget i src/lib/fabrik.ts:
// skrev vi dem i hånden, ville de lyve, så snart kæden blev rejst.
import type { FabrikDel, Forbindelse } from "../src/lib/fabrik";

/**
 * Afdelinger, linjer og rum, der ikke har en tegning endnu. De står som
 * stiplede blokke med deres navn, og forbindelser kan pege på dem allerede
 * nu. Får en en tegning, registreres den i src/lib/lines.ts med samme id —
 * så er den tegnet, og posten her kan slettes.
 */
export const UTEGNEDE: FabrikDel[] = [
  // Nummer 1 er ikke sagt endnu.
  { id: "pillering", navn: "Pillering", slags: "linje", nr: 3 },
  { id: "coating", navn: "Coating", slags: "linje", nr: 4 },
  { id: "steeping", navn: "Steeping", slags: "linje", nr: 5, valgfri: true },
  { id: "packing", navn: "Packing", slags: "linje", nr: 5 },
  { id: "shipping", navn: "Shipping", slags: "linje", nr: 7 },
  // Lageret er ikke et trin i rækken: trinnene leverer til det og henter fra det.
  { id: "warehouse", navn: "Warehouse", slags: "rum", overLinjerne: true },
];

/**
 * Materialeflowet går oftest over lageret: "En slibning bliver oftest leveret
 * til Warehouse, før den ryger i Pillering, osv." Det første er sagt; resten
 * er det samme mønster og står som antaget, til nogen har bekræftet det.
 */
const viaLageret = (fra: string, til: string, navn: string, note?: string): Forbindelse => ({
  id: `F-${fra.toUpperCase()}-${til.toUpperCase()}`,
  slags: "materiale", navn, fra: { del: fra }, til: { del: til }, findes: true, antaget: true,
  note: note ?? "Antaget ud fra mønstret: trinnene leverer til Warehouse og henter derfra. Ikke bekræftet for netop dette trin.",
});

/** Materialeflow, prøver og mennesker mellem delene. */
export const FORBINDELSER: Forbindelse[] = [
  {
    id: "F-SLIBERI-WAREHOUSE", slags: "materiale", navn: "Slibning til lager",
    fra: { del: "sliberi" }, til: { del: "warehouse" }, findes: true,
    note: "Sagt af driften: en slibning leveres oftest til Warehouse, før den går i Pillering.",
  },
  {
    id: "F-WAREHOUSE-PILLERING", slags: "materiale", navn: "Lager til pillering",
    fra: { del: "warehouse" }, til: { del: "pillering" }, findes: true,
    note: "Sagt af driften: fra Warehouse går slibningen i Pillering.",
  },
  viaLageret("pillering", "warehouse", "Pillering til lager"),
  viaLageret("warehouse", "coating", "Lager til coating"),
  viaLageret("coating", "warehouse", "Coating til lager"),
  viaLageret("warehouse", "steeping", "Lager til steeping", "Antaget ud fra mønstret. Steeping er ikke altid med — kun de partier, der skal steepes."),
  viaLageret("steeping", "warehouse", "Steeping til lager", "Antaget ud fra mønstret. Steeping er ikke altid med."),
  viaLageret("warehouse", "packing", "Lager til packing"),
  viaLageret("packing", "warehouse", "Packing til lager"),
  viaLageret("warehouse", "shipping", "Lager til shipping"),
  {
    id: "F-VIDEOMETER",
    slags: "proever",
    navn: "Prøve før fordeleren",
    fra: { del: "sliberi" },
    til: { del: "analytics" },
    findes: true,
    note: "500 g, før partiet fordeles på sporene. Videometeret finder foreign seeds efter art og slibeskader. Ca. 20 min.",
  },
  {
    id: "F-CT",
    slags: "proever",
    navn: "CT-prøver",
    // Jetpealer N og S, og de fire kasteborde.
    fra: { del: "sliberi", wIds: ["790", "789", "636", "746", "635", "745"] },
    til: { del: "analytics" },
    findes: true,
    note: "Efter jetpealerne og fra kastebordenes Heavy, Light og Mainline. Én CT-scanner, ca. 20 min pr. prøve.",
  },
];
