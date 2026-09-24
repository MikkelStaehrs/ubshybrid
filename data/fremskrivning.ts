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
// Sagt af driften:
//   - Prøverne tages i hånden og analyseres i Analytics-rummet: et videometer
//     før fordeleren (500 g, ca. 20 min) og én CT-scanner, som alle
//     CT-prøver deler (ca. 20 min pr. prøve). CT tages lige efter
//     jetpealerne i hvert spor og på alle fire kasteborde: Heavy, Light og
//     Ready. Planen er fast.
//   - Maskinerne i sporet, i rækkefølge: fordeleren deler frøet i to
//     størrelser, jetpealeren sliber, Triøren tager pinde, korn og andre
//     uønskede emner, Alfa sorterer i størrelse, Carter tager bigerm og
//     tvillinger, og to kasteborde — det første forbedrer kvaliteten, det
//     sidste sikrer den.
//   - Heavy og Light ryger ud. Kun Ready går videre og bliver færdigvare.
//   - FV0–FV3 er kvaliteten af det gode frø. Alt fra FV0 til FV3 er godt;
//     der styres ikke efter FV. Det, der ikke skal med, er multigerm
//     (BIGF/BIGH/TWIN), foreign seeds (NOTS), sten og ler.
//   - Finder videometeret foreign seeds tidligt, sorteres der kraftigere på
//     Triørerne.
//
// Målt: kastebordenes tre strømme er kalibreret på 549 rigtige CT-prøver fra
// juni til december 2025 (se KASTEBORDET.maalt).
//
// Åbne spørgsmål, besvaret med et gæt indtil videre:
//   - Hvor meget der går til Heavy og Light. CT'en ser, hvad strømmene
//     består af, ikke hvor meget der løber i dem. Det skal vejes.
//   - Resten af tallene for partiet og processen i PARTI og PROCES, og
//     grænserne i KASTEBORDET.
//   - At CT-scanneren er optaget de fulde 20 minutter af hver prøve.
//   - Hvor meget tværhældning og luft flytter.
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
    // Det, et kastebord stilles efter, og som driften ser på under kørslen.
    // Hældningen, slagtallet og luften kan ændres undervejs; nominal er
    // udgangspunktet. Hvad der kommer ud, måles i laboratoriet — ikke her.
    kanaler: [
      // Et rystebord ryster med vilje. Grænsen er ikke vibrationens — og
      // ryster dækket for lidt, sorterer bordet ikke.
      { ...vibration, id: "dæk", label: "Dæk", nominal: 5.8, spredning: 0.3, alarmHoej: 8.5, alarmLav: 4.5 },
      { id: "slag", label: "Slag", unit: "/min", maaler: "drive", nominal: 420, spredning: 2, min: 0, max: 700, alarmLav: 360, alarmHoej: 520, decimaler: 0, hvile: 0, traeghed: 0.5 },
      // Hældningen falder ikke, fordi bordet står. Den står, hvor den er sat.
      { id: "tvaers", label: "Tværs", unit: "°", maaler: "inclinometer", nominal: 4.0, spredning: 0.02, min: 0, max: 10, alarmLav: 2, alarmHoej: 7, decimaler: 1, traeghed: 0.15 },
      { id: "langs", label: "Langs", unit: "°", maaler: "inclinometer", nominal: 1.5, spredning: 0.02, min: 0, max: 6, alarmLav: 0.3, alarmHoej: 4, decimaler: 1, traeghed: 0.15 },
      { id: "luft", label: "Luft", unit: "%", maaler: "drive", nominal: 65, spredning: 1, min: 0, max: 100, alarmLav: 40, alarmHoej: 90, decimaler: 0, hvile: 0, traeghed: 0.25 },
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

/** Maskiner, der afviger fra deres slags. Nøglet på W-ID. */
export const AFVIGELSER: Record<string, Partial<Record<string, Partial<KanalSpec>>>> = {};

// ---------------------------------------------------------------------------
// Partiet, processen og prøverne

/** Arterne, videometeret kender. "Unknown" er det, det ikke kan bestemme. */
export const FREMMEDE = [
  "Unknown", "Natskygge", "Koriander", "Katost", "Håret knopskulpe", "Agersnerle", "Pileurt", "Burresnerre",
] as const;
export type Fremmed = (typeof FREMMEDE)[number];

/**
 * Partiet: det, der ligger i kasserne. Et parti ligger fast — det er det
 * samme frø hele ordren. Kasserne afviger lidt fra hinanden, og et stykke af
 * ordren kan være urent. Andele i procent af partiet, talt i frø og partikler.
 *
 * FV-fordelingen, de tomme frø og fordelingen af multigerm er læst af
 * CT-prøverne: det, der når det første kastebord. Multigerm i kasserne er
 * regnet tilbage gennem Carter (PROCES.carter).
 */
export const PARTI = {
  fvKlasser: ["FV0", "FV1", "FV2", "FV3"] as const,
  /** Det gode frø fordelt på kvalitet, i procent af det gode frø. Målt. */
  fv: [3.7, 90.0, 5.9, 0.4],
  /** Multigerm i procent af partiet — før Carter har taget sit. */
  multigerm: 4.1,
  /** Hvad multigerm er, målt: BIGF, BIGH og tvillinger (TWIN; TRIP er regnet med). */
  multiArter: { bigf: 0.6, bigh: 0.18, twin: 0.22 },
  /** Tomme frø (EMP), i procent af partiet. Målt. */
  tom: 0.19,
  /** Foreign seeds i alt, i procent af partiet, og fordelingen på arter. */
  fremmed: 0.05,
  fremmedArter: {
    Unknown: 0.08, Natskygge: 0.22, Koriander: 0.04, Katost: 0.14,
    "Håret knopskulpe": 0.08, Agersnerle: 0.12, Pileurt: 0.2, Burresnerre: 0.12,
  } as Record<Fremmed, number>,
  sten: 0.25,
  ler: 0.4,
  /** Frø med slibeskader, i procent af det gode frø. */
  slibeskader: 1.8,
  /** Fra ordre til ordre: én standardafvigelse, som andel af niveauet. */
  ordreVariation: 0.2,
  /** Fra kasse til kasse i samme ordre. */
  kasseVariation: 0.06,
  /**
   * Et urent stykke: nogle kasser i træk med langt flere foreign seeds —
   * oftest tidligt. Chancen pr. ordre, hvor mange kasser, og hvor mange
   * gange så mange.
   */
  urent: { chance: 0.7, kasser: [3, 5] as [number, number], gange: [4, 7] as [number, number], foersteKasse: [2, 9] as [number, number] },
  /** Frø pr. gram — til at gøre en andel om til et antal i en prøve. */
  froePrGram: 70,
};

/** Det, maskinerne mellem vippestolene og kastebordene gør ved strømmen. */
export const PROCES = {
  /**
   * Fordeleren deler frøet i to størrelser — de små til spor N, de store til
   * spor S. Frøvægten pr. spor er målt: median mg pr. frø i CT-prøverne.
   * Ellers er sporene kalibreret ens.
   */
  froeMg: { N: 8.7, S: 10.2 } as Record<string, number>,
  /**
   * Jetpealeren sliber låg og kim løs. CT'en tæller det som små fragmenter;
   * i procent af frøene, som det når det første kastebord. Målt.
   */
  jetpealerLet: 0.7,
  /**
   * Triøren tager foreign seeds — med pinde, korn og andre uønskede emner.
   * Andelen, der fjernes, og det gode frø, det koster, i procent af det gode
   * frø. Kraftig sortering er det, Operatøragenten anbefaler, når
   * videometeret finder mange.
   */
  sortering: {
    normal: { fremmed: 0.8, godtTab: 0.8 },
    kraftig: { fremmed: 0.95, godtTab: 2.5 },
  },
  /**
   * Carter tager bigerm og tvillinger: andelen af multigerm, og det gode frø,
   * det koster. Andelen er sat, så det, der når kastebordet, er det, CT'en
   * har set dér.
   */
  carter: { multi: 0.7, godtTab: 0.5 },
  /** Minutter fra en kasse tippes, til frøet er nået hertil. */
  transitMin: { jetpealer: 8, kastebord: [18, 21] as [number, number] },
};

/** Det, CT'en har set i én strøm, i procent af frøene. */
export interface CtMaalt {
  fv: [number, number, number, number];
  tom: number;
  bigf: number;
  bigh: number;
  twin: number;
  /** Små fragmenter — løse låg og kim. Ikke frø; i procent af frøene. */
  frag: number;
}

/**
 * Kastebordet: tre strømme ud. Heavy tager multigerm og sten; Light tager
 * løse låg og kim, ler og de svageste frø; resten er Ready, der går videre.
 * Heavy og Light ryger ud.
 *
 * Tværhældningen styrer, hvor meget der går til Heavy, luften, hvor meget
 * der går til Light. Hvad der går med, følger af det, CT'en har set.
 */
export const KASTEBORDET = {
  /**
   * MÅLT: de tre strømme fra hvert bord, samlet over 549 CT-prøver fra juni
   * til december 2025. Det første bord i sporene er KB4 og KB5 i dataene
   * (KB-3N og KB-2S nu), det sidste KB4A og KB5A (KB-3NN og KB-2SS). NOTS er
   * for sjældne i prøverne til at kalibrere på — 75 i 300.000 frø.
   */
  maalt: {
    foerste: {
      heavy: { fv: [3.131, 90.489, 3.006, 0.046], tom: 0.033, bigf: 2.642, bigh: 0.187, twin: 0.459, frag: 0.272 },
      ready: { fv: [3.685, 88.876, 5.789, 0.273], tom: 0.168, bigf: 0.699, bigh: 0.233, twin: 0.267, frag: 0.684 },
      light: { fv: [3.48, 83.371, 10.849, 1.295], tom: 0.998, bigf: 0.003, bigh: 0.003, twin: 0, frag: 1.272 },
    },
    sidste: {
      heavy: { fv: [3.139, 88.653, 3.305, 0.029], tom: 0.024, bigf: 4.275, bigh: 0.091, twin: 0.455, frag: 0.225 },
      ready: { fv: [3.587, 89.428, 5.452, 0.22], tom: 0.095, bigf: 0.903, bigh: 0.111, twin: 0.201, frag: 0.442 },
      light: { fv: [3.304, 86.256, 9.419, 0.754], tom: 0.267, bigf: 0, bigh: 0, twin: 0, frag: 0.944 },
    },
  } satisfies Record<"foerste" | "sidste", Record<"heavy" | "ready" | "light", CtMaalt>>,
  /**
   * SKØN, IKKE MÅLT: hvor stor en del af tilløbet, der går til Heavy og til
   * Light ved standardindstillingerne. CT'en ser, hvad strømmene består af,
   * ikke hvor meget der løber i dem — og hvert kilo, simuleringen regner
   * tabt, hviler på det her tal. Vej sidestrømmene, og skriv det målte her.
   */
  masse: {
    foerste: { heavy: 0.03, light: 0.03 },
    sidste: { heavy: 0.03, light: 0.03 },
  },
  /**
   * Det, CT'en ikke ser: hvor mange gange tættere sten, ler og foreign seeds
   * står i Heavy og i Light end i tilløbet. Skøn.
   */
  beriget: {
    sten: { heavy: 30, light: 0 },
    ler: { heavy: 0.5, light: 25 },
    fremmed: { heavy: 5, light: 0 },
  },
  /** Pr. grad tværhældning væk fra udgangspunktet: så meget mere til Heavy, relativt. Skøn. */
  heavyPrGrad: 0.3,
  /** Pr. 10 procentpoint luft: så meget mere til Light, relativt. Skøn. */
  lightPrTiLuft: 0.35,
  /**
   * Grænserne, en linjeagent anbefaler efter, pr. bord i sporet: det første
   * og det sidste. Skøn.
   *
   * Ready: højst så meget multigerm og så mange små fragmenter — ellers
   * lukkes bordet et trin. Heavy og Light: prisen, i gode frø smidt ud pr.
   * uønsket frø eller fragment fjernet. Er den over grænsen, og har Ready
   * luft (`margen`), åbnes bordet et trin: så går færre gode frø ud.
   */
  graenser: [
    { readyMulti: 2.5, readyFrag: 1.5, pris: 20 },
    { readyMulti: 2.0, readyFrag: 1.2, pris: 20 },
  ],
  /** Ready har luft, når den er under så stor en del af sin grænse. */
  margen: 0.7,
  /** Et trin, en anbefaling flytter en indstilling. */
  trin: { tvaers: 0.3, luft: 5 },
  /** En anbefaling, ingen har taget stilling til, bortfalder efter så lang tid. */
  anbefalingGyldigS: 600,
  /**
   * Har operatøren sagt nej — eller ikke taget stilling — får bordet ro så
   * længe. En agent, der gentager sig hvert andet minut, bliver ikke hørt.
   */
  roEfterNejS: 1800,
};

/**
 * Prøverne. Videometeret og CT-scanneren står i Analytics-rummet; prøverne
 * tages i hånden. CT-scanneren er én, og alle CT-prøver står i kø til den.
 */
export const PROEVER = {
  videometer: {
    minutter: 20,
    gram: 500,
    /** En prøve af hver anden kasse, fra den første. */
    hverKasse: 2,
    /** Over så mange foreign seeds pr. prøve sorteres der kraftigere… */
    fremmedHoej: 35,
    /** …og under så mange i to prøver i træk kan der sorteres normalt igen. */
    fremmedLav: 28,
    /** Over så mange procent slibeskader er det værd at se på. */
    slibeskaderHoej: 4,
  },
  ct: {
    minutter: 20,
    /** Frø i én CT-prøve — som i de rigtige. Udsvinget er det, en prøve af den størrelse giver. */
    froe: 650,
  },
  /** Så længe efter ordrens start tages den første CT-prøve — frøet skal nå frem. */
  foersteCtMin: 15,
  /**
   * Den faste plan: CT-prøverne i den rækkefølge, de tages. Scanneren tager
   * den næste, så snart den er ledig; står maskinen, springes den over.
   * Kastebordene er nøglet på W-ID, jetpealerne på spor.
   */
  ctPlan: [
    "jetpealer:N", "jetpealer:S",
    "636:ready", "635:ready", "746:ready", "745:ready",
    "636:heavy", "635:heavy", "636:light", "635:light",
    "746:heavy", "745:heavy", "746:light", "745:light",
  ],
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
// Ordresimuleringen

/**
 * Én ordre fra første kasse til sidste. Tiden går hurtigt, når alt kører, og
 * langsomt, når der sker noget — så man kan følge med i, hvad agenterne gør,
 * uden at se tolv timers kørsel.
 *
 * Hændelserne er tilfældige, men seedede: det, der sker, opstår af
 * simuleringen, og agenterne reagerer på det, de ser. Et andet seed giver en
 * anden dag. Hyppighederne er skruet op, så en ordre har lidt af hvert.
 */
export const SIMULERING = {
  /** Så mange gange hurtigere end virkeligheden, når alt kører roligt… */
  hurtig: 90,
  /** …og når der sker noget. */
  langsom: 8,
  /** Så længe efter en hændelse, tiden bliver ved med at gå langsomt. */
  efterS: 30,
  /** Klokken, ordren starter. */
  startKl: 6,
  /** Mellem to trin, når linjen startes eller stoppes i rækkefølge. */
  trinS: 15,
  /** Så længe sporene løber, efter sidste kasse er tippet, før de er tomme. */
  udloebS: 300,
  /** Middeltid mellem to maskinstop. Simuleret tid. */
  maskinstopHverS: 2.5 * 3600,
  maskinstopVarighedS: [90, 300] as const,
  /**
   * Andelen af stop, der varsles i signalerne først — vibration, der
   * stiger, et dæk, der ryster for lidt. Det er dem, en linjeagent kan nå
   * at se komme.
   */
  varselAndel: 0.6,
  varselS: 120,
  flaskehalsHverS: 4 * 3600,
  flaskehalsVarighedS: 240,
  varmeHverS: 5 * 3600,
  varmeVarighedS: 600,
  /**
   * Hvor hurtigt frøet varmes op ved friktion. Langsommere end i den
   * korte demo: minutter, ikke sekunder — så en linjeagent kan nå at se
   * det komme og regne på, hvornår grænsen nås.
   */
  varmeTraeghed: 0.004,
  sensorfejlHverS: 6 * 3600,
  sensorfejlVarighedS: 45,
  /** Et seed, der giver en ordre med lidt af hvert. */
  seed: 743,
};

/**
 * Hvor tit hvert slags signal gemmes, og hvad Dataagenten kan skrue på.
 *
 * Hurtige signaler — flowet og hastighederne — røres aldrig: dem styrer
 * Driftsagenten efter. Resten kan tåle at blive gemt sjældnere en tid.
 * Trinene tages i rækkefølge, til der er luft under databasens kapacitet.
 */
export const PROEVERATE = {
  /** Prøver pr. sekund, når intet er skruet ned. */
  normal: 4,
  /** Hvilken gruppe hver slags måler hører til. */
  gruppe: {
    flow: "hurtig",
    speed: "hurtig",
    vibration: "middel",
    drive: "middel",
    temperature: "langsom",
    humidity: "langsom",
    "level-radar": "langsom",
    position: "langsom",
    analyzer: "langsom",
    "motor-run": "di",
  } as Record<string, "hurtig" | "middel" | "langsom" | "di">,
  trin: [
    // Et driftssignal skifter et par gange i timen. At gemme det fire gange
    // i sekundet er at gemme det samme igen og igen.
    { navn: "Driftssignaler ved ændring", gruppe: "di" as const, rate: 0 },
    { navn: "Langsomme signaler hvert 5. s", gruppe: "langsom" as const, rate: 0.2 },
    { navn: "Vibration og drev 1 pr. s", gruppe: "middel" as const, rate: 1 },
  ],
  /** Planen skal ligge under denne andel af det, databasen kan. */
  luft: 0.8,
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
