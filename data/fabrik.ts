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
export const UTEGNEDE: FabrikDel[] = [];

/** Materialeflow, prøver og mennesker mellem delene. */
export const FORBINDELSER: Forbindelse[] = [
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
