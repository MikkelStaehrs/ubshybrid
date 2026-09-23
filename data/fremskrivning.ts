// Fremskrivningens antagelser: hvad et menneske ville aflæse på hver maskine.
//
// Håndholdt fil, og hvert tal i den er et SKØN. Ingen af kanalerne findes i
// anlægget i dag — de beskriver, hvad fremskrivningen på /ai/demo
// simulerer, så skærmen kan vise tal, der ligner det, driften ville kigge
// efter. Ret dem frit: de er her, fordi driften kender dem bedre end koden.
//
// Kanalerne bindes til maskintype og navn, ikke til W-ID, fordi de beskriver
// hvad en slags maskine har — ikke en bestemt maskine. Skal én maskine afvige,
// så skriv det i `afvigelser` på W-ID.
//
// Åbne spørgsmål til driften, besvaret med et gæt indtil videre:
//   - FV0–FV3 er læst som fire kvalitetsklasser i en analyseprøve, der
//     summer til 100 %. Er de noget andet, skal `ANALYSE` laves om.
//   - BIGF, BIGH og NOTS er læst som andele af prøven fra den tunge side af
//     kastebordet. Er det mængder (kg/t), skal enheden skiftes.
//   - Der er ingen bånd som selvstændige maskiner på linjen. Transporten
//     ligger i kanterne mellem maskinerne og vises som materialestrøm.

export interface KanalSpec {
  /** Stabil nøgle, fx "hastighed". */
  id: string;
  /** Højst to ord. HUD-reglen gælder også her. */
  label: string;
  unit: string;
  /** Driftspunktet, værdien vandrer omkring. */
  nominal: number;
  /** Typisk udsving (én standardafvigelse). */
  spredning: number;
  /** Fysiske grænser. Værdien kommer aldrig uden for dem. */
  min: number;
  max: number;
  /** Over den her er det en alarm. */
  alarmHoej?: number;
  /** Under den her er det en alarm — kun mens maskinen kører. */
  alarmLav?: number;
  decimaler: number;
  /**
   * Hvor værdien falder hen, når maskinen står. Udeladt: den står stille,
   * hvor den var — en temperatur forsvinder ikke, fordi motoren stopper.
   */
  hvile?: number;
  /** Hvor hurtigt den søger mod sit mål. 0–1 pr. sekund. */
  traeghed?: number;
}

/** Hvilke maskiner en gruppe kanaler gælder for. */
export interface KanalGruppe {
  /** Maskintypen fra tegningen. */
  kind?: string;
  /** Regulært udtryk mod maskinens navn. */
  navn?: RegExp;
  kanaler: KanalSpec[];
}

const motortemperatur: KanalSpec = {
  id: "motortemp", label: "Motor", unit: "°C",
  nominal: 46, spredning: 2.5, min: 10, max: 95, alarmHoej: 70,
  decimaler: 1, hvile: 24, traeghed: 0.02,
};

const vibration: KanalSpec = {
  id: "vibration", label: "Vibration", unit: "mm/s",
  nominal: 2.2, spredning: 0.35, min: 0, max: 12, alarmHoej: 4.5,
  decimaler: 2, hvile: 0, traeghed: 0.4,
};

/**
 * Kanalerne pr. maskinslags. Den første gruppe, der passer, vinder — så de
 * mest specifikke står øverst.
 */
export const KANALER: KanalGruppe[] = [
  {
    navn: /kb[-\s]/i,
    kanaler: [
      // Tunge side af kastebordet: hvad ender der, som ikke burde.
      { id: "bigf", label: "BIGF", unit: "%", nominal: 68, spredning: 2.2, min: 0, max: 100, decimaler: 1, traeghed: 0.08 },
      { id: "bigh", label: "BIGH", unit: "%", nominal: 21, spredning: 1.6, min: 0, max: 100, decimaler: 1, traeghed: 0.08 },
      { id: "nots", label: "NOTS", unit: "%", nominal: 4.2, spredning: 0.9, min: 0, max: 100, alarmHoej: 8, decimaler: 1, traeghed: 0.06 },
      // Et rystebord ryster med vilje. Grænsen er ikke vibrationens.
      { ...vibration, id: "dæk", label: "Dæk", nominal: 5.8, spredning: 0.3, alarmHoej: 8.5 },
    ],
  },
  {
    navn: /jet\s?pe[ae]ler/i,
    kanaler: [
      { id: "rpm", label: "Omdrejninger", unit: "o/min", nominal: 1450, spredning: 12, min: 0, max: 1800, alarmLav: 1300, decimaler: 0, hvile: 0, traeghed: 0.35 },
      // Slibningen varmer frøet. Bliver det for varmt, tager spireevnen skade.
      { id: "froetemp", label: "Frø", unit: "°C", nominal: 31, spredning: 1.1, min: 10, max: 60, alarmHoej: 38, decimaler: 1, hvile: 22, traeghed: 0.03 },
      { id: "stroem", label: "Strøm", unit: "A", nominal: 18.5, spredning: 0.8, min: 0, max: 40, alarmHoej: 26, decimaler: 1, hvile: 0, traeghed: 0.3 },
    ],
  },
  {
    navn: /tri[øo]r/i,
    kanaler: [
      { id: "rpm", label: "Omdrejninger", unit: "o/min", nominal: 42, spredning: 0.6, min: 0, max: 60, alarmLav: 36, decimaler: 1, hvile: 0, traeghed: 0.3 },
      motortemperatur,
    ],
  },
  {
    navn: /alfa/i,
    kanaler: [
      { ...vibration, id: "dæk", label: "Dæk", nominal: 6.4, spredning: 0.4, alarmHoej: 9 },
      { id: "luft", label: "Luft", unit: "%", nominal: 72, spredning: 1.5, min: 0, max: 100, decimaler: 0, hvile: 0, traeghed: 0.25 },
    ],
  },
  {
    navn: /carter/i,
    kanaler: [
      { id: "rpm", label: "Omdrejninger", unit: "o/min", nominal: 38, spredning: 0.5, min: 0, max: 55, alarmLav: 32, decimaler: 1, hvile: 0, traeghed: 0.3 },
      motortemperatur,
    ],
  },
  {
    navn: /nordmark/i,
    kanaler: [vibration, motortemperatur],
  },
  {
    kind: "elevator",
    kanaler: [
      { id: "hastighed", label: "Hastighed", unit: "m/s", nominal: 2.4, spredning: 0.03, min: 0, max: 3.5, alarmLav: 2.0, decimaler: 2, hvile: 0, traeghed: 0.5 },
      motortemperatur,
      vibration,
    ],
  },
  {
    kind: "distributor",
    kanaler: [
      { id: "andelN", label: "Andel N", unit: "%", nominal: 50, spredning: 1.2, min: 0, max: 100, decimaler: 1, traeghed: 0.1 },
    ],
  },
  {
    navn: /påslag/i,
    kanaler: [
      { id: "niveau", label: "Niveau", unit: "%", nominal: 58, spredning: 9, min: 0, max: 100, alarmLav: 10, decimaler: 0, traeghed: 0.05 },
    ],
  },
];

/** Hallen selv. Ikke en maskine, men det første, en driftsleder spørger om. */
export const HAL: KanalSpec[] = [
  { id: "temp", label: "Temperatur", unit: "°C", nominal: 20.8, spredning: 0.5, min: -10, max: 45, alarmHoej: 28, decimaler: 1, traeghed: 0.01 },
  { id: "fugt", label: "Luftfugtighed", unit: "% RH", nominal: 52, spredning: 2.5, min: 0, max: 100, alarmHoej: 65, decimaler: 0, traeghed: 0.02 },
];

/**
 * Analyseprøven fra hvert spor. Fire klasser, der summer til 100 %.
 * Rækkefølgen er FV0 … FV3.
 */
export const ANALYSE = {
  klasser: ["FV0", "FV1", "FV2", "FV3"] as const,
  andele: [4, 11, 33, 52],
  spredning: 1.4,
  /** Over den her andel FV0 er prøven værd at se på. */
  alarmFV0: 8,
};

/** Maskiner, der afviger fra deres slags. Nøglet på W-ID. */
export const AFVIGELSER: Record<string, Partial<Record<string, Partial<KanalSpec>>>> = {};

// ---------------------------------------------------------------------------
// Kæden

/**
 * Kædens kapacitet pr. led. Skøn: kobleren, edge-maskinen og databasen er
 * ikke valgt endnu, og tallene her er, hvad den slags udstyr typisk kan.
 *
 * Kapaciteten er det, der afgør, hvor en flaskehals opstår. Det led, der
 * har plads til færrest signaler, er det, der rammer loftet først, når
 * anlægget vokser.
 */
export const KAEDE = {
  /** Kobleren skal nå alle registre i én cyklus. Samme 250 ms som polling. */
  cyklusMs: 250,
  /** Modbus TCP læser op til 125 registre pr. forespørgsel. */
  registreProForespoergsel: 120,
  msProForespoergsel: 9,
  /** Et flydende tal fylder to registre. */
  registreProSignal: 2,
  /** Hvor mange gange i sekundet hvert signal gemmes. */
  proeverPrS: 4,
  /** Rækker pr. sekund, edge kan tage imod og sende videre. */
  edgeKapacitet: 2000,
  /** Rækker pr. sekund, databasen kan skrive i normal drift. */
  dbKapacitet: 900,
  /** Rækker, edge kan holde på, mens databasen halter. Derefter tabes data. */
  buffer: 60_000,
};

/**
 * Flaskehalsen i demoen: databasen skriver langsommere en periode. Det er
 * den mest almindelige flaskehals i en kæde som den her — indeks, der
 * genopbygges, eller en backup, der tager diskens tid.
 */
export const FLASKEHALS = {
  /** Første episode så lang tid efter start. */
  foersteS: 90,
  /** Derefter én episode så ofte. */
  hverS: 180,
  varighedS: 55,
  /** Databasens kapacitet under episoden, som andel af normalt. */
  kapacitetAndel: 0.2,
  aarsag: "Indeks genopbygges",
  /** Over så mange sekunders forsinkelse melder Kædevagten. */
  forsinkelseAlarmS: 15,
};
