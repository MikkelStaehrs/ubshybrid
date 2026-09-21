# CLAUDE.md

Noter til den, der arbejder videre på fabrikskortet — menneske eller agent.
README forklarer, hvad projektet er, og hvordan man kører det. Det her
forklarer, hvorfor koden ser ud, som den gør, og hvad man ikke skal lave om
uden at vide hvorfor.

## Genereret eller håndholdt

Den vigtigste skelnen i repoet. Bland de to, og arbejde går tabt.

| Fil | |
|---|---|
| `data/lines/*.json` | **Genereres.** `npm run parse` overskriver dem uden at spørge |
| `data/maintenance.json` | Håndholdt — vedligeholdshistorik |
| `data/ot-layer.ts` | Håndholdt — sensorer, IO-skab, kabelbakker |
| `data/ot-infrastructure.ts` | Håndholdt — uplink, rack, VLAN, edge, sky |
| `data/ot-sensor-types.ts` | Håndholdt — sensorkatalog |
| `data/line-config.ts` | Håndholdt — normtakt, stopdefinition, stopårsager |
| `data/agents.ts` | Håndholdt — agenterne |

Alt håndholdt bindes til maskinerne på **W-ID**, aldrig på tegningens celle-id
eller på maskinens navn. En hændelse, en sensor eller en override skal følge
maskinen, også når tegningen laves om.

**Geometri hører ikke til i data.** Kabelbakker beskrives ved det spor, de
følger; skabet ved den maskine, det står ved. Koordinaterne udledes af
layoutet i `src/lib/ot.ts`. Det er derfor OT-laget overlever en ny parse.

## Én kilde

`pathState()` i `src/lib/ot.ts` afgør, hvor langt kæden fra måler til database
rækker. `signalDelivery()` samme sted lægger sensorfejl-reglen ovenpå og
afgiver den endelige dom over et signal.

De tre steder, der skal vide det, spørger der — ingen af dem regner selv:

- **Live-visningen** (`LivePanel`, `LiveLayer`)
- **Agentstatus** (`src/lib/agents.ts`)
- **`/api/context`** (`src/lib/context.ts`)

Kæde-tjekket lå engang to steder og gjorde det samme hver for sig. Det er
netop den slags, der først bliver farligt, når de to begynder at svare
forskelligt. Skal reglen ændres, ændres den ét sted.

`signalDelivery()` tager en **valgfri aflæsning**. Serveren kan ikke se
måleren, så uden aflæsning er dommen truffet på kæden alene — og `basis`
siger `"kæde"` eller `"kæde+aflæsning"`, så en agent ved forskellen.

### Strømsløjfen

Grænserne står i `src/lib/live-source.ts` og kun der:

```
  < 3,6 mA        sensorfejl. Ingen måling.
  3,6 – 4,0 mA    under nulpunktet, inden for tolerancen. Klemmes til 0.
  4,0 – 20,0 mA   måleområdet.
  20,0 – 21,0 mA  over fuldt udslag, inden for tolerancen. Klemmes til maks.
  > 21,0 mA       sensorfejl. Ingen måling.
```

Skalaen **ekstrapoleres aldrig**. Gjorde den det, ville 3,7 mA give en negativ
materialestrøm, og sådan noget findes ikke. Ved fejl er `value` `null`, og
UI'et viser en streg — ikke et tal.

Et stop på 4,0 mA er en måling: sløjfen lever, der løber bare ingenting. Det
er ikke en fejl, og det skal ikke behandles som en.

## Ingen gæt

Kortet må aldrig vise noget, der ser ud som en måling uden at være det.

- Tomme felter står som **"Ikke udfyldt"**. De udelades i `/api/context` og
  opsummeres i maskinens `missing`-liste. Samme feltdefinitioner (`src/lib/fields.ts`)
  bruges begge steder, så "ikke udfyldt" betyder det samme i panelet og i API'et.
- **Simulerede data mærkes.** `LIVE_SOURCE=mock` giver et banner, og
  Forbindelser-panelet siger, at tallene ikke er hentet gennem kæden.
- **Skabeloner mærkes.** Agenternes "seneste rapport" bruger klammer —
  `[antal]`, `[maskine]` — netop for ikke at ligne et resultat.
- Mangler noget en kilde, så sig det i fladen. OEE-sektionen står tom med en
  begrundelse frem for et tomt felt med et gæt i.
- Adresser og tal, der er foreslået og ikke aftalt, skrives som forslag
  (registerkortet, måleområdet 0–40 t/t, stopgrænsen på 120 s).

## Status udledes

Ingen status skrives i hånden. Skrev vi den, ville den før eller siden lyve.

**OT-komponenter** har en skala fra `active` til `idea`. To skel må ikke
udviskes: `planned` er besluttet og skal købes, `idea` er en mulighed ingen
har sagt ja til — og `missing` er hverken af delene, men en forudsætning, der
ikke findes. En manglende ting er ikke valgfri.

**Agenter** får deres status af deres inputs i `src/lib/agents.ts`:

| | |
|---|---|
| Mangler – nødvendig | intet påkrævet input leverer |
| Delvis | mindst ét påkrævet input leverer, men ikke alle |
| Klar | alle påkrævede leverer, men `enabled` er false |
| I drift | alle leverer, og agenten er slået til |

Kun **påkrævede** inputs tæller. En stoprapport kan skrives uden flowmåling,
ikke uden driftssignal — så flow er `required: false`.

Et input **leverer** først, når kæden står hele vejen til databasen. "Monteret"
er en delstatus: FT-756 hænger på elevatoren, men der er ingen vej fra den til
en database, så den tæller nul.

**`engine`** skiller `"kode"` fra `"claude"`. Vagtagentens kædetjek er ren
regel-logik og koster ingenting; linjeagenterne kalder API'et og koster penge
pr. kørsel. Det skal kunne ses i fladen, før nogen slår noget til.

## Trin for trin

### Ny linje

1. Læg tegningen i `data/drawio/` og kør `npm run parse -- data/drawio/<fil>.drawio`.
2. Importér den nye `data/lines/<id>.json` i `src/lib/lines.ts` og føj den til `LINES`.
3. Er det et rum frem for en nummereret linje, så tilføj id'et til `ROOM_IDS`.
4. Vil linjen have driftsparametre, agenter eller OT-lag, så tilføj nøglen
   `<id>` i `data/line-config.ts`, `data/agents.ts`, `data/ot-layer.ts`.
   Uden dem skjuler kortet selv de visninger, der ikke har noget at vise.

### Override på én maskine

I `data/line-config.ts` under `machines`, nøglet på W-ID. Skriv **kun** det,
der afviger — resten arves fra linjen:

```ts
machines: {
  "756": { stopAfterSeconds: 30, note: "Kort buffer — tilstopper hurtigt." },
},
```

Panelet skriver "afviger fra linjen" af sig selv. Ingen skal udfylde
seksogtyve maskiner for at få en default.

### Ny agent

I `data/agents.ts`. Husk `engine`, og sæt `enabled: false` — ingen agent skal
starte, fordi nogen tilføjede den. Skriv **ikke** en status; den udledes.

`scope` kan være `line`, `lane`, `machines` eller `chain`, og kan have
`upstream` med W-ID'er, agenten må se uden at eje. Indløbet er upstream for
begge sporagenter: et stop der forklarer et stop i sporet, men det er ikke
sporets ansvar og tæller ikke i status.

`inputs` peger tre steder hen — et konkret `signalId`, en `type` fra
sensorkataloget, der endnu ikke er sat op, eller et `chainStep`. `need` er den
sætning, kortet skriver, når det mangler.

### Nyt signal

I `data/ot-layer.ts` under `sensors`. Husk `catalogType` — uden den kan en
agent ikke vide, at den slags signal, den mangler, allerede sidder på
maskinen. Kanal og registeradresse udledes; skriv dem ikke.

Har signalet et andet måleområde end de nuværende, så tilføj det i `SCALE` i
`src/lib/live-source.ts` **og skriv en test for grænserne** (se nedenfor).

## Konventioner

- **Dansk** i UI, kommentarer og commit-beskeder. Kommentarer forklarer
  *hvorfor*, ikke *hvad* — koden siger allerede hvad.
- **Ingen nye dependencies** uden at spørge. Sparklinen er håndtegnet SVG,
  zonerne er `planeGeometry`, testene kører på `node:test`. Det er med vilje.
- **`npm test` findes** og kører `node:test` gennem tsx. Grænseværdier for
  signaler **skal** have en test: skalering, klemning og fejlgrænser er præcis
  den slags, der går i stykker uden at nogen opdager det. Prøv en ny test af
  ved at bryde reglen med vilje og se den fejle.
- **Farver kommer fra CSS-tokens.** 3D-scenen kan ikke læse CSS, så tokens
  listes i `src/lib/useSceneTheme.ts` og hentes derfra. Nye farver skal
  defineres i alle tre temablokke i `factory-map.css`.
- **Stiplet betyder "findes ikke endnu"** — kabler, zonekanter, DIN-blokke,
  trådnet i 3D. Brug det konsekvent.
- Kør `npm run build` før commit. TypeScript er strict, og build fanger det,
  typecheck alene ikke gør.

## Åbne ender

- **`/api/context` skal have sit eget token**, før fase 4. Den ligger bag det
  delte Basic Auth-login i dag, og et script på serveren skal ikke have
  menneskernes adgangskode.
- **Stopgrænsen på 120 sekunder er valgt, ikke aftalt.** Den skal forbi
  driften, før nogen regner tilgængelighed på den.
- **Måleområdet 0–40 t/t for FT-756 er en pladsholder.** Det skal rettes, før
  nogen aflæser tallene.
- **Den tværgående agent venter på linje nr. 2.** Der er ikke noget at gå på
  tværs af endnu.
- **Fase 4 er et Python-script på serveren**, der henter `/api/context`,
  kalder Claude API og skriver en rapport. Intet af det findes endnu — der er
  ikke kaldt et API fra dette repo.
