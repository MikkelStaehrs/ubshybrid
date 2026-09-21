// De felter, en maskine kan have udfyldt — ét sted, så panelet og
// kontekst-endpointet er enige om, hvad "ikke udfyldt" betyder.
//
// Stamdata og OT kommer fra tegningen (Edit Data i Draw.io), drift fra
// data/line-config.ts. Feltnavnene her er nøglerne, ikke etiketterne — det
// er dem, en agent kan bruge til at slå op med.

export interface FieldDef {
  key: string;
  label: string;
}

/** Fra tegningen. Vises under "Stamdata". */
export const STAMDATA_FIELDS: FieldDef[] = [
  { key: "producent", label: "Producent" },
  { key: "model", label: "Model" },
  { key: "aar", label: "År" },
  { key: "proces", label: "Proces" },
  { key: "kapacitet", label: "Kapacitet" },
];

/** Fra tegningen. Vises under "OT & el". */
export const OT_FIELDS: FieldDef[] = [
  { key: "dimSkab", label: "DIM-skab" },
  { key: "otNet", label: "OT-netværk" },
];

/** Fritekst fra tegningen. Vises kun når den er der. */
export const NOTE_FIELD: FieldDef = { key: "noter", label: "Noter" };

/**
 * Fra line-config. Kun de felter, der kan stå tomme — stopdefinition og
 * stopårsager arves altid fra linjen og mangler derfor aldrig.
 */
export const OPS_FIELDS: FieldDef[] = [
  { key: "normtakt", label: "Normtakt" },
  { key: "note", label: "Driftsnote" },
];
