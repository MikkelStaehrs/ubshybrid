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
// Hver kanal siger, hvilken slags måler der leverer den (`maaler`, en nøgle i
// sensorkataloget). Fremskrivningen sætter netop de målere i OT-laget, så et
// tal på skærmen altid har en måler bag sig, en kanal i skabet og en plads i
// kæden. Står der en kanal her uden måler, kan den ikke komme igennem.
//
// Åbne spørgsmål til driften, besvaret med et gæt indtil videre:
//   - FV0–FV3 er læst som fire klasser i en analyseprøve fra hvert kastebord,
//     der summer til 100 %. FV0 og FV1 dominerer; FV3 er det, kastebordene
//     renser ud. Er de noget andet, skal `ANALYSE` laves om.
//   - BIGF, BIGH og NOTS er læst som andele af prøven fra den tunge side af
//     kastebordet. Er det mængder (kg/t), skal enheden skiftes.
//   - Andet kastebord i hvert spor (KB-3NN, KB-2SS) får det, første har
//     renset: markant mindre FV3, BIGF og BIGH, og nærmest ingen NOTS.
//   - Der er ingen bånd som selvstændige maskiner på linjen. Transporten
//     ligger i kanterne mellem maskinerne og vises som materialestrøm.

export interface KanalSpec {
  /** Stabil nøgle, fx "hastighed". */
  id: string;
  /** Måleren, der leverer tallet — en nøgle i data/ot-sensor-types.ts. */
  maaler: string;
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
  /**
   * Hvorfor kanalen ingen grænse har. Hver kanal på en maskine har en
   * grænse eller en grund — en kanal uden nogen af delene er ikke
   * færdigtænkt. Mangler kun den ene side, er det, fordi den anden ikke er
   * en fejl: en kold motor er ikke et problem.
   */
  ingenGraense?: string;
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
  id: "motortemp", label: "Motor", unit: "°C", maaler: "temperature",
  nominal: 46, spredning: 2.5, min: 10, max: 95, alarmHoej: 70,
  decimaler: 1, hvile: 24, traeghed: 0.02,
};

const vibration: KanalSpec = {
  id: "vibration", label: "Vibration", unit: "mm/s", maaler: "vibration",
  nominal: 2.2, spredning: 0.35, min: 0, max: 12, alarmHoej: 4.5,
  decimaler: 2, hvile: 0, traeghed: 0.4,
};

/** Kastebordene, på navn. Ét sted, så panelet og simulatoren er enige. */
export const KASTEBORD = /^kb[-\s]/i;

/**
 * Kanalerne pr. maskinslags. Den første gruppe, der passer, vinder — så de
 * mest specifikke står øverst.
 */
export const KANALER: KanalGruppe[] = [
  {
    navn: KASTEBORD,
    kanaler: [
      // Tunge side af kastebordet: hvad ender der, som ikke burde. Tallene
      // er første bord i sporet; det andet står i AFVIGELSER.
      { id: "bigf", label: "BIGF", unit: "%", maaler: "analyzer", nominal: 68, spredning: 2.2, min: 0, max: 100, alarmHoej: 76, decimaler: 1, traeghed: 0.08 },
      { id: "bigh", label: "BIGH", unit: "%", maaler: "analyzer", nominal: 21, spredning: 1.6, min: 0, max: 100, alarmHoej: 27, decimaler: 1, traeghed: 0.08 },
      { id: "nots", label: "NOTS", unit: "%", maaler: "analyzer", nominal: 4.2, spredning: 0.9, min: 0, max: 100, alarmHoej: 8, decimaler: 1, traeghed: 0.06 },
      // Et rystebord ryster med vilje. Grænsen er ikke vibrationens — og
      // ryster dækket for lidt, sorterer bordet ikke.
      { ...vibration, id: "dæk", label: "Dæk", nominal: 5.8, spredning: 0.3, alarmHoej: 8.5, alarmLav: 4.5 },
    ],
  },
  {
    navn: /jet\s?pe[ae]ler/i,
    kanaler: [
      { id: "rpm", label: "Omdrejninger", unit: "o/min", maaler: "speed", nominal: 1450, spredning: 12, min: 0, max: 1800, alarmLav: 1300, alarmHoej: 1600, decimaler: 0, hvile: 0, traeghed: 0.35 },
      // Slibningen varmer frøet. Bliver det for varmt, tager spireevnen skade.
      { id: "froetemp", label: "Frø", unit: "°C", maaler: "temperature", nominal: 31, spredning: 1.1, min: 10, max: 60, alarmHoej: 38, decimaler: 1, hvile: 22, traeghed: 0.03 },
      // Strømmen kommer fra frekvensomformeren, ikke fra en måler i skabet.
      // For lidt strøm, mens den kører, er en jetpealer, der ikke sliber:
      // remmen er af, eller der kommer intet frø.
      { id: "stroem", label: "Strøm", unit: "A", maaler: "drive", nominal: 18.5, spredning: 0.8, min: 0, max: 40, alarmLav: 12, alarmHoej: 26, decimaler: 1, hvile: 0, traeghed: 0.3 },
    ],
  },
  {
    navn: /tri[øo]r/i,
    kanaler: [
      { id: "rpm", label: "Omdrejninger", unit: "o/min", maaler: "speed", nominal: 42, spredning: 0.6, min: 0, max: 60, alarmLav: 36, alarmHoej: 48, decimaler: 1, hvile: 0, traeghed: 0.3 },
      motortemperatur,
    ],
  },
  {
    navn: /alfa/i,
    kanaler: [
      { ...vibration, id: "dæk", label: "Dæk", nominal: 6.4, spredning: 0.4, alarmHoej: 9, alarmLav: 4.5 },
      // Blæserens ydelse, som omformeren melder den. For lidt luft skiller
      // ikke; for meget blæser godt frø med ud.
      { id: "luft", label: "Luft", unit: "%", maaler: "drive", nominal: 72, spredning: 1.5, min: 0, max: 100, alarmLav: 60, alarmHoej: 85, decimaler: 0, hvile: 0, traeghed: 0.25 },
    ],
  },
  {
    navn: /carter/i,
    kanaler: [
      { id: "rpm", label: "Omdrejninger", unit: "o/min", maaler: "speed", nominal: 38, spredning: 0.5, min: 0, max: 55, alarmLav: 32, alarmHoej: 44, decimaler: 1, hvile: 0, traeghed: 0.3 },
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
      { id: "hastighed", label: "Hastighed", unit: "m/s", maaler: "speed", nominal: 2.4, spredning: 0.03, min: 0, max: 3.5, alarmLav: 2.0, alarmHoej: 2.8, decimaler: 2, hvile: 0, traeghed: 0.5 },
      motortemperatur,
      vibration,
    ],
  },
  {
    kind: "distributor",
    kanaler: [
      {
        id: "andelN", label: "Andel N", unit: "%", maaler: "position", nominal: 50, spredning: 1.2, min: 0, max: 100, decimaler: 1, traeghed: 0.1,
        ingenGraense: "Følger sporene. Står et spor, skal den stå på 0 eller 100 — et fast bånd ville melde hver gang.",
      },
    ],
  },
  {
    navn: /påslag/i,
    kanaler: [
      // Tomt løber elevatoren tør; fuldt løber påslaget over.
      { id: "niveau", label: "Niveau", unit: "%", maaler: "level-radar", nominal: 58, spredning: 9, min: 0, max: 100, alarmLav: 10, alarmHoej: 92, decimaler: 0, traeghed: 0.05 },
    ],
  },
];

/** Hallen selv. Ikke en maskine, men det første, en driftsleder spørger om. */
export const HAL: KanalSpec[] = [
  { id: "temp", label: "Temperatur", unit: "°C", maaler: "temperature", nominal: 20.8, spredning: 0.5, min: -10, max: 45, alarmHoej: 28, decimaler: 1, traeghed: 0.01 },
  { id: "fugt", label: "Luftfugtighed", unit: "% RH", maaler: "humidity", nominal: 52, spredning: 2.5, min: 0, max: 100, alarmHoej: 65, decimaler: 0, traeghed: 0.02 },
];

/**
 * Analyseprøven fra hvert kastebord. Fire klasser, der summer til 100 %.
 * Rækkefølgen er FV0 … FV3.
 *
 * FV0 og FV1 dominerer. FV3 er det, kastebordene skal rense ud — derfor er
 * det FV3, der melder, og derfor har andet bord i sporet langt mindre af den.
 */
export const ANALYSE = {
  klasser: ["FV0", "FV1", "FV2", "FV3"] as const,
  /** Første kastebord i sporet. */
  andele: [46, 33, 13, 8],
  /** Andet kastebord i sporet: det har fået, hvad det første har renset. */
  afvigelser: {
    "746": [53, 37, 7.5, 2.5], // KB-3NN
    "745": [52, 38, 7.5, 2.5], // KB-2SS
  } as Record<string, number[]>,
  /**
   * Frø i én prøve. Udsvinget fra prøve til prøve er det, en prøve af den
   * størrelse giver — en klasse på 2 % svinger mindre end en på 46 %.
   */
  froePrProeve: 400,
  /** Over den her andel FV3 er prøven værd at se på. */
  alarmFV3: 12,
};

/** Maskiner, der afviger fra deres slags. Nøglet på W-ID. */
export const AFVIGELSER: Record<string, Partial<Record<string, Partial<KanalSpec>>>> = {
  // Andet kastebord i hvert spor. Der er markant mindre at fange, og NOTS er
  // næsten væk — ses den her, har første bord ikke gjort sit arbejde.
  "746": {
    bigf: { nominal: 38, spredning: 1.6, alarmHoej: 45 },
    bigh: { nominal: 8, spredning: 0.8, alarmHoej: 12 },
    nots: { nominal: 0.3, spredning: 0.12, alarmHoej: 1.5 },
  },
  "745": {
    bigf: { nominal: 39, spredning: 1.6, alarmHoej: 45 },
    bigh: { nominal: 8.5, spredning: 0.8, alarmHoej: 12 },
    nots: { nominal: 0.3, spredning: 0.12, alarmHoej: 1.5 },
  },
};

// ---------------------------------------------------------------------------
// Ordren

/**
 * Hvad linjen kører lige nu, i demoen. I virkeligheden kommer det fra
 * ordresystemet, og det findes der ingen forbindelse til endnu — så i den
 * rigtige visning står felterne "Ikke udfyldt".
 *
 * Værdierne er opdigtede og hedder X…, som de opdigtede tags: et ordrenummer,
 * der lignede et rigtigt, kunne blive slået op. Ret dem til driftens format.
 */
export const ORDRE = {
  ordreNr: "X-24-0917",
  genetik: "X-G12",
  varietet: "X-V03",
  /** Ordrens estimerede vægt. */
  estimeretKg: 12_000,
  /**
   * Kasser i ordren. Læst som kasserne, der tippes i vippestolene — så de
   * tælles af strømmen ind i linjen, og de vejer i snit det samme.
   */
  kasser: 24,
  /** Så meget af ordren er kørt, når siden åbnes. Resten følger strømmen. */
  koertKgVedStart: 4_300,
};

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
  /**
   * Første episode så lang tid efter start. Simulatoren forvarmes et minut,
   * så det er halvandet minut efter, siden er åbnet — efter ophobnings-
   * scenariet (?ophobning=1), så de to kan ses hver for sig.
   */
  foersteS: 150,
  /** Derefter én episode så ofte. */
  hverS: 180,
  varighedS: 55,
  /** Databasens kapacitet under episoden, som andel af normalt. */
  kapacitetAndel: 0.2,
  aarsag: "Indeks genopbygges",
  /** Over så mange sekunders forsinkelse melder Kædevagten. */
  forsinkelseAlarmS: 15,
};

// ---------------------------------------------------------------------------
// Gennemløbet

/**
 * Demoens 100 %-punkt pr. flowsignal, i t/hr: hvad linjen normalt skubber
 * igennem. "Normalt omkring 1 ton i timen" er sagt af driften, men ikke
 * aftalt som kalibrering efter test. Derfor står det her — i demoens
 * antagelser — og ikke i line-config.ts, hvor det rigtige tal skal stå, når
 * det er aftalt. Står der et tal dér, vinder det over det her.
 */
export const FLOW_NOMINAL: Record<string, number> = {
  "FT-743": 1.0,
};

// ---------------------------------------------------------------------------
// Driftsagenten

/**
 * Hvornår Driftsagenten stopper og starter et spor. Skøn — de skal forbi
 * driften, før nogen lader en agent stoppe noget som helst.
 */
export const DRIFTSAGENT = {
  /** Stop sporet, når bufferen foran en stoppet maskine er så fuld. */
  bufferStopPct: 55,
  /** Frøtemperaturen, hvor spireevnen er i fare. Samme som alarmgrænsen. */
  froeStopC: 38,
  /** Start igen, når frøet er kølet så langt ned. */
  froeStartC: 34,
  /** Et fund skal holde så længe, før agenten handler — ikke på én prøve. */
  overvejS: 2,
  /** Mindste tid, et spor står, før agenten starter det igen. */
  mindsteStopS: 20,
};

/** Bufferen foran hver maskine i sporene. */
export const TILLOEB = {
  /**
   * Et overløb er ikke bare en linje i loggen: frø på gulvet, og sporet står,
   * mens nogen fejer op. Uden den pris ville en simulation uden agent se
   * bedre ud end en med.
   */
  rengoeringS: 240,
  normalPct: 25,
  /** Så hurtigt fyldes den, når maskinen står og stadig fødes. */
  fyldPrS: 1.3,
  /** Så hurtigt tømmes den ned mod normal, når maskinen kører igen. */
  toemPrS: 3,
};

/** Friktion i jetpealerne: frøet bliver varmere, til nogen retter årsagen. */
export const VARME = {
  foersteS: 150,
  hverS: 480,
  varighedS: 75,
  maalC: 42,
};
