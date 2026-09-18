// Sensorkatalog — hvad man kan sætte på en maskine i et sliberi.
//
// Ikke projektdata: her står intet om hvad der ER besluttet, kun hvad der
// findes at vælge imellem. Kortet bruger listen til "Tilføj sensoridé", hvor
// man kan stikke en type på en maskine og se, hvad det ville koste i kanaler.
//
// `signal` afgør kanalregnskabet: AI og DI optager hver sin slags kanal i
// IO-skabet, mens IO-Link og Modbus går på feltbussen og ingen bruger.
import type { OtSensorType } from "../src/lib/types";

export const OT_SENSOR_TYPES: OtSensorType[] = [
  {
    type: "flow",
    label: "Flow",
    signal: "AI",
    typicalPlacement: "Elevatorafkast, sliske",
    purpose: "Materialestrøm gennem punktet. Viser stop og fald i ydelse med det samme.",
  },
  {
    type: "motor-run",
    label: "Driftssignal motor",
    signal: "DI",
    typicalPlacement: "Alle maskiner",
    purpose: "Kører eller stoppet, fra motorværn eller frekvensomformer. Grundlaget for oppetid.",
  },
  {
    type: "speed",
    label: "Omdrejningsvagt",
    signal: "DI",
    typicalPlacement: "Elevatorer",
    purpose: "Pulstæller på akslen. Fanger remslip og blokering, før elevatoren løber varm.",
  },
  {
    type: "vibration",
    label: "Vibration",
    signal: "AI",
    altSignal: "IO-Link",
    typicalPlacement: "Lejer på elevatorer, Jetpealer og Triøre",
    purpose: "Tidlig varsling om lejeskader og ubalance, længe før det kan høres.",
  },
  {
    type: "bearing-temp",
    label: "Lejetemperatur",
    signal: "AI",
    typicalPlacement: "Roterende maskiner",
    purpose: "Pt100 på lejehuset. Stigende temperatur er det andet tegn efter vibration.",
  },
  {
    type: "level",
    label: "Niveau høj/lav",
    signal: "DI",
    typicalPlacement: "Fordeler, siloer, buffer",
    purpose: "Vibrationsgaffel eller roterende vinge. Forhindrer overløb og tørkørsel.",
  },
  {
    type: "diff-pressure",
    label: "Differenstryk",
    signal: "AI",
    typicalPlacement: "Filter og aspiration",
    purpose: "Trykfald over filteret. Viser hvornår posen skal renses eller skiftes.",
  },
  {
    type: "energy",
    label: "Energimåler",
    signal: "Modbus",
    typicalPlacement: "Pr. maskine eller pr. spor",
    purpose: "Effekt og forbrug. Kobler energi sammen med tons gennem linjen.",
  },
];

export const SENSOR_TYPE_BY_KEY: Record<string, OtSensorType> = Object.fromEntries(
  OT_SENSOR_TYPES.map((t) => [t.type, t]),
);
