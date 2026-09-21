// OT-installationen pr. linje: sensorer, sensorskabe og kabelbakker.
//
// Håndholdt fil — modsat data/lines/*.json, der genereres fra Draw.io og
// overskrives ved hver `npm run parse`. Bindingen til maskinerne sker på W-ID,
// og geometrien står der bevidst ikke: bakker og skabe beskrives ved det spor
// eller den maskine, de følger, så de flytter med når tegningen ændrer sig.
//
// Linjer uden OT-udstyr udelades — så skjuler kortet selv OT-visningen.
import type { OtHardware, OtLayer, OtSensor } from "../src/lib/types";

/** Fjernt IO-skab — "RIO" som i remote IO. */
const CABINET = "RIO-SLIB-01";

/**
 * Kun piloten står her. Hvad der ellers kunne sættes op, hører hjemme i
 * sensorkataloget og i de idéer, man selv stikker ind på kortet — ikke i
 * projektdata, hvor det ville ligne noget, der var besluttet.
 */
const sliberiSensors: OtSensor[] = [
  {
    id: "FT-756",
    type: "Materialestrøm",
    catalogType: "flow",
    model: "Mütec FS 550",
    signal: "4-20 mA",
    machineId: "756",
    cabinetId: CABINET,
    phase: 1,
    status: "test",
  },
];

/** Én pr. sensorkanal — følger antallet af sensorer af sig selv. */
const perSensor = sliberiSensors.length;

/**
 * Stykliste for IO-skabet.
 *
 * `model` står tom, hvor tavlebyggeren vælger fabrikatet — kortet skriver
 * "afklares". `provides` er det, kanaltallene i skabsmodalen regnes ud fra, så
 * de aldrig kan komme til at sige noget andet end listen her. `rail` er blokken
 * på DIN-skinne-tegningen; komponenter uden sidder ikke på skinnen.
 */
const sliberiHardware: OtHardware[] = [
  // --- Forsyning ---
  {
    id: "HW-PWR-01",
    category: "forsyning",
    name: "Hovedafbryder + automatsikring",
    qty: 1,
    status: "planned",
    note: "230 VAC forsyning til skabet.",
    rail: { width: 2, label: "Afbryder" },
  },
  {
    id: "HW-PWR-02",
    category: "forsyning",
    name: "Strømforsyning 24 VDC / 10 A",
    qty: 1,
    status: "planned",
    note: "Fælles 24 V til sensorer, IO og switch.",
    rail: { width: 3, label: "24 V PSU" },
  },
  {
    id: "HW-PWR-03",
    category: "forsyning",
    name: "Sikringsklemmer",
    qty: perSensor,
    status: "planned",
    note: "Én pr. sensorkanal, så en enkelt sløjfe kan afbrydes for sig.",
    rail: { width: 4, label: "Sikringer" },
  },

  // --- IO ---
  {
    id: "HW-IO-01",
    category: "io",
    name: "Feltbus-kobler",
    qty: 1,
    status: "planned",
    note: "Modbus TCP / OPC UA. Modulært system — Wago 750, Beckhoff eller ET200SP.",
    rail: { width: 1.5, label: "Kobler" },
  },
  {
    id: "HW-IO-02",
    category: "io",
    name: "AI-kort 8 × 4-20 mA",
    qty: 1,
    status: "planned",
    note: "Galvanisk adskilt. Dækker piloten og har plads til en fase 2.",
    provides: { ai: 8 },
    rail: { width: 1, label: "AI 1" },
  },
  {
    id: "HW-IO-03",
    category: "io",
    name: "AI-kort 8 × 4-20 mA (nr. 2)",
    qty: 1,
    status: "idea",
    // Uden dette kort mangler der kanaler til de sidste to sensorer i fase 3.
    phase: 3,
    note: "Galvanisk adskilt. Købes kun, hvis udrulningen når fase 3.",
    provides: { ai: 8 },
    rail: { width: 1, label: "AI 2" },
  },
  {
    id: "HW-IO-04",
    category: "io",
    name: "DI-kort 16 × 24 V",
    qty: 1,
    status: "planned",
    note: "Reserveret til driftsmeldinger og alarmkontakter.",
    provides: { di: 16 },
    rail: { width: 1, label: "DI" },
  },
  {
    id: "HW-IO-05",
    category: "io",
    name: "Endemodul",
    qty: 1,
    status: "planned",
    rail: { width: 0.9, label: "End" },
  },

  // --- Netværk ---
  {
    id: "HW-NET-01",
    category: "netvaerk",
    name: "Managed switch, 8 porte",
    qty: 1,
    status: "planned",
    note: "DIN-monteret.",
    rail: { width: 2.5, label: "Switch" },
  },
  {
    id: "HW-NET-02",
    category: "netvaerk",
    name: "Uplink til OT-net",
    qty: 1,
    status: "planned",
    note: "RJ45 eller fiber afklares.",
  },

  // --- Klemmer ---
  {
    id: "HW-TRM-01",
    category: "klemmer",
    name: "3-leder rækkeklemmer",
    qty: perSensor,
    status: "planned",
    note: "24 V / 0 V / signal pr. sensor.",
    rail: { width: 5, label: "Klemmer" },
  },
  {
    id: "HW-TRM-02",
    category: "klemmer",
    name: "Skærmskinne",
    qty: 1,
    status: "planned",
    note: "Fælles jording af kabelskærme.",
  },

  // --- Skab ---
  {
    id: "HW-ENC-01",
    category: "skab",
    name: "Stålskab IP65",
    qty: 1,
    status: "planned",
    note: "Ca. 50 % reserveplads. ATEX-zone afklares.",
  },
];

const sliberi: OtLayer = {
  cabinets: [
    {
      id: CABINET,
      name: "IO-skab Sliberiet",
      // Ved fordeleren: midt på linjen, hvor begge spor kan nås.
      nearMachine: "615",
      offset: { x: 0, z: -2.8 },
      hardware: sliberiHardware,
      status: "planned",
      // network: { switch: "…", vlan: "…", uplink: "…" }
      // Netværket er ikke projekteret endnu. Feltet findes i OtCabinet, så
      // switch, VLAN og uplink kan skrives ind her, når de er valgt — og
      // OT-nettet kan tegnes ovenpå uden at datamodellen skal laves om.
    },
  ],

  sensors: sliberiSensors,

  cableTrays: [
    {
      id: "KB-N",
      name: "Kabelbakke Spor N",
      cabinetId: CABINET,
      lane: "N",
      // Ud forbi maskinerne, så bakken ikke ligger oven i dem.
      offset: -1.6,
      height: 4.2,
    },
    {
      id: "KB-S",
      name: "Kabelbakke Spor S",
      cabinetId: CABINET,
      lane: "S",
      offset: 1.6,
      height: 4.2,
    },
    {
      id: "KB-F",
      name: "Kabelbakke fælles stræk",
      cabinetId: CABINET,
      lane: null,
      // Samme side som skabet, så stikket går lige ud fra det.
      offset: -2.8,
      height: 4.2,
      // Helt frem til vippestolene, så indtaget kan kobles på senere.
      extendTo: "793",
    },
  ],
};

export const OT_LAYERS: Record<string, OtLayer> = { sliberi };
