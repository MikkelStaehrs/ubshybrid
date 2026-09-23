// Sensorkatalog — hvad man kan sætte på en maskine i et sliberi.
//
// Ikke projektdata: her står intet om hvad der ER besluttet, kun hvad der
// findes at vælge imellem. Kortet bruger listen til "Tilføj sensoridé", hvor
// man kan stikke en type på en maskine og se, hvad det ville koste i kanaler.
//
// `signal` afgør kanalregnskabet: AI og DI optager hver sin slags kanal i
// IO-skabet, mens IO-Link og Modbus går på feltbussen og ingen bruger.
//
// `kort` er ordet på skærmen i mødelokalet: ét ord, det en driftsleder selv
// ville bruge. To typer kan dele det — en lejetemperatur er en temperatur.
import type { OtSensorType } from "../src/lib/types";

export const OT_SENSOR_TYPES: OtSensorType[] = [
  {
    type: "flow",
    label: "Flow",
    kort: "Flow",
    signal: "AI",
    typicalPlacement: "Elevatorafkast, sliske",
    purpose: "Materialestrøm gennem punktet. Viser stop og fald i ydelse med det samme.",
  },
  {
    type: "motor-run",
    label: "Driftssignal motor",
    kort: "Kører/står",
    signal: "DI",
    typicalPlacement: "Alle maskiner",
    purpose: "Kører eller stoppet, fra motorværn eller frekvensomformer. Grundlaget for oppetid.",
  },
  {
    type: "speed",
    label: "Omdrejningsvagt",
    kort: "Hastighed",
    signal: "DI",
    typicalPlacement: "Elevatorer",
    purpose: "Pulstæller på akslen. Fanger remslip og blokering, før elevatoren løber varm.",
  },
  {
    type: "vibration",
    label: "Vibration",
    kort: "Vibration",
    signal: "AI",
    altSignal: "IO-Link",
    typicalPlacement: "Lejer på elevatorer, Jetpealer og Triøre",
    purpose: "Tidlig varsling om lejeskader og ubalance, længe før det kan høres.",
  },
  {
    type: "bearing-temp",
    label: "Lejetemperatur",
    kort: "Temperatur",
    signal: "AI",
    typicalPlacement: "Roterende maskiner",
    purpose: "Pt100 på lejehuset. Stigende temperatur er det andet tegn efter vibration.",
  },
  {
    type: "level",
    label: "Niveau høj/lav",
    kort: "Niveau",
    signal: "DI",
    typicalPlacement: "Fordeler, siloer, buffer",
    purpose: "Vibrationsgaffel eller roterende vinge. Forhindrer overløb og tørkørsel.",
  },
  {
    type: "diff-pressure",
    label: "Differenstryk",
    kort: "Tryk",
    signal: "AI",
    typicalPlacement: "Filter og aspiration",
    purpose: "Trykfald over filteret. Viser hvornår posen skal renses eller skiftes.",
  },
  {
    type: "energy",
    label: "Energimåler",
    kort: "Energi",
    signal: "Modbus",
    typicalPlacement: "Pr. maskine eller pr. spor",
    purpose: "Effekt og forbrug. Kobler energi sammen med tons gennem linjen.",
  },
  {
    type: "temperature",
    label: "Temperatur",
    kort: "Temperatur",
    signal: "AI",
    typicalPlacement: "Motorer, Jetpealer, hallen",
    purpose: "Pt100 eller IR. Motoren, frøet eller rummet — det, der bliver varmt, før noget går galt.",
  },
  {
    type: "humidity",
    label: "Luftfugtighed",
    kort: "Fugt",
    signal: "AI",
    typicalPlacement: "Hallen",
    purpose: "Luftens fugt. Frø tager fugt til sig, og det ændrer, hvordan det løber.",
  },
  {
    type: "level-radar",
    label: "Niveau, kontinuerligt",
    kort: "Niveau",
    signal: "AI",
    typicalPlacement: "Påslag, siloer",
    purpose: "Radar eller ultralyd. Hvor fuldt, ikke kun fuldt eller tomt.",
  },
  {
    type: "position",
    label: "Spjældstilling",
    kort: "Spjæld",
    signal: "AI",
    typicalPlacement: "Fordeler",
    purpose: "Hvor spjældet står — og dermed, hvordan strømmen deles mellem sporene.",
  },
  {
    type: "drive",
    label: "Frekvensomformer",
    kort: "Drev",
    signal: "Modbus",
    typicalPlacement: "Motorer med omformer",
    purpose: "Strøm, frekvens og effekt direkte fra drevet. Går på feltbussen og fylder ingen kanal.",
  },
  {
    type: "inclinometer",
    label: "Hældningsmåler",
    kort: "Hældning",
    signal: "IO-Link",
    typicalPlacement: "Kastebordenes dæk",
    purpose: "Dækkets vinkel langs og på tværs. Den ændres under kørslen; måleren viser, hvor den står.",
  },
  {
    type: "analyzer",
    label: "Analyseudstyr",
    kort: "Analyse",
    signal: "Modbus",
    typicalPlacement: "Tunge side af kastebordene",
    purpose: "Klasser og urenheder i frøet, prøve for prøve. Sender tal over netværket, ikke gennem en kanal.",
  },
];

export const SENSOR_TYPE_BY_KEY: Record<string, OtSensorType> = Object.fromEntries(
  OT_SENSOR_TYPES.map((t) => [t.type, t]),
);
