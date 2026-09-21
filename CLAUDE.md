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

**Agenter** får deres status af `beslutning` og af deres inputs i
`src/lib/agents.ts`. `beslutning` er en beslutning, ikke en status — den siger,
hvor langt nogen har taget stilling, og status udledes af den:

| `beslutning` | | |
|---|---|---|
| `ide` | **Idé** | uanset inputs |
| `besluttet` | Mangler / Delvis / **Klar** | efter inputs |
| `aktiveret` | Mangler / Delvis / **I drift** | efter inputs |

| Status | |
|---|---|
| Idé | tænkt, men ikke besluttet — som `idea` i OT-laget |
| Mangler – nødvendig | intet påkrævet input leverer |
| Delvis | mindst ét påkrævet input leverer, men ikke alle |
| Klar | alle påkrævede leverer, men agenten er ikke slået til |
| I drift | alle leverer, **og** agenten er slået til |

En `aktiveret` agent uden data **falder tilbage** til Mangler eller Delvis.
"I drift" må aldrig kunne stå om noget, der ikke har noget at arbejde med,
bare fordi nogen huskede at slå den til. Reglen har en test.

**Idéer tæller ikke med.** De får ingen zone på gulvet, former ikke
fælleszonen og udelades af alle optællinger. Brug `decidedAgents()` — ikke
rå `states` — hvert sted, der tælles.

Kun **påkrævede** inputs tæller. En stoprapport kan skrives uden flowmåling,
ikke uden driftssignal — så flow er `required: false`.

Et input **leverer** først, når kæden står hele vejen til databasen. "Monteret"
er en delstatus: FT-756 hænger på elevatoren, men der er ingen vej fra den til
en database, så den tæller nul. Et `dataset`-input måler i stedet **dækning**
over agentens scope — "3 af 26 maskiner har vedligeholdshistorik" — og leverer
først over `DATASET_COVERAGE_MIN`. Tærsklen er valgt, ikke målt.

**`engine`** skiller `"kode"` fra `"claude"`. Kædevagtens kædetjek er ren
regel-logik og koster ingenting; linjeagenterne kalder API'et og koster penge
pr. kørsel. Det skal kunne ses i fladen, før nogen slår noget til.

**`til` og `svarerPaa`** er påkrævede. En agent uden modtager og uden ét
spørgsmål, den besvarer, har intet formål — og så er den ikke færdigtænkt.

## HUD'en på /ai

`/ai` er et kontrolrum til en skærm i et mødelokale. `/ai?visning=dokument`
er den samme viden til at læse og printe. De bygger på de samme funktioner —
det er udtrykket, der skifter, ikke dataene.

**Tre tilstande, ikke flere.** Under motorhjelmen har OT-laget seks statusser
og agenterne fem. De bærer beslutninger og indkøb, og de er uændrede. På
skærmen er spørgsmålet kun ét:

| | |
|---|---|
| **PÅ PLADS** | findes og leverer |
| **TEST** | findes, men ikke i drift |
| **AFVENTER** | findes ikke endnu |

Oversættelsen sker ét sted, i `hudState()` og `hudAgentState()` i
`src/lib/ai-hud.ts`. Ord som "købes nu", "planlagt", "bestilt" og
"mangler – nødvendig" hører til i dokumentvisningen og må ikke nå HUD'en.
En test scanner modellens synlige strenge for dem.

**Ingen forklarende sætninger.** Labels er på højst fire ord, og brudpanelet
er to linjer: hvor kæden stopper, og hvad den afventer. Skal noget uddybes,
hører det til i dokumentvisningen. Også det er en test.

**Alt der bevæger sig, viser en tilstand.** En puls løber kun på led, der
leverer, og stopper ved bruddet. Ingen tilfældig flimren, ingen tal der
tæller op for syns skyld. Står noget stille i virkeligheden, står det stille
på skærmen. `prefers-reduced-motion` slukker alle animationer uden at tabe
indhold.

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

I `data/agents.ts`. Husk `til`, `svarerPaa` og `engine`. Sæt `beslutning`
til `"ide"`, hvis den bare er tænkt, ellers `"besluttet"` — ingen agent skal
starte, fordi nogen tilføjede den. Skriv **ikke** en status; den udledes.

`scope` kan være `line`, `lane`, `machines` eller `chain`, og kan have
`upstream` med W-ID'er, agenten må se uden at eje. Indløbet er upstream for
begge sporagenter: et stop der forklarer et stop i sporet, men det er ikke
sporets ansvar og tæller ikke i status.

`inputs` peger fire steder hen — et konkret `signalId`, en `type` fra
sensorkataloget, der endnu ikke er sat op, et `chainStep`, eller et `dataset`
målt som dækning over scopet. `need` er den sætning, kortet skriver, når det
mangler.

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
