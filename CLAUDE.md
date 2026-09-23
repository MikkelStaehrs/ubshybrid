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
| `data/fremskrivning.ts` | Håndholdt — fremskrivningens antagelser: kanaler, driftspunkter, alarmgrænser |

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
  4,0 – 20,0 mA   måleområdet: 0 til 150 % af nominel kapacitet.
  20,0 – 21,0 mA  over fuldt udslag, inden for tolerancen. Klemmes til maks.
  > 21,0 mA       sensorfejl. Ingen måling.
```

Sløjfen giver **procent af nominel kapacitet** og ikke andet. Fuldt udslag er
150 %, så en overfødning kan ses — en måler, der topper ved 100, kan ikke
vise den. Hvad de 100 % *er* i tons, står ikke i koden: det er en aftale med
driften og ligger som `flow.nominal` i `data/line-config.ts`. Er den tom,
viser kortet procenten og skriver "Ikke udfyldt", hvor takten skulle stå.

Skalaen **ekstrapoleres aldrig**. Gjorde den det, ville 3,7 mA give en negativ
materialestrøm, og sådan noget findes ikke. Ved fejl er `value` `null`, og
UI'et viser en streg — ikke et tal.

Et stop på 4,0 mA er en måling: sløjfen lever, der løber bare ingenting. Det
er ikke en fejl, og det skal ikke behandles som en.

### Kører eller kører ikke

`src/lib/flow.ts` lægger de to ting oven på procenten, der gør den brugbar:
kalibreringen og tilstanden.

Tilstanden har **hysterese**: over `KOERER_OVER_PCT` kører linjen, under
`STAAR_UNDER_PCT` står den, og imellem beholder den, hvad den var. Uden
båndet ville en måler, der vipper omkring nul, lave et stop i sekundet.
Tilstanden udledes af forløbet i `runSegments()`, aldrig af den seneste
prøve alene — hysterese virker ikke på ét punkt.

**Sensorfejl er en tredje tilstand, ikke et stop.** En måler, der er holdt op
med at svare, siger ingenting om, hvorvidt der løber materiale. Et "kører
ikke" bliver først et stop, når det har varet længere end
`stopAfterSeconds`; en fejlperiode bliver det aldrig. Reglen har en test.

Nøgletallene følger samme linje: fejltid tæller hverken som oppetid eller
nedetid, og totalen springer et hul over frem for at brolægge det. Totalen er
et integral af øjebliksmålinger og skal mærkes **"Estimat"**. Før der er
historik nok, står der **"Afventer historik"** — ikke et tal.

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
  (registerkortet, stopgrænsen på 120 s, grænserne for lavt og højt flow).
- **Fremskrivningen er den ene undtagelse** — og den er mærket hele vejen.
  Se nedenfor. Hvert instrument, der viser et simuleret tal, bærer sit eget
  SIM-mærke; mærkatet øverst på siden er ikke nok alene, for et udsnit af
  skærmen kan sendes videre uden det.

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
er en delstatus: FT-743 sidder ved linjens indgang, men der er ingen vej
frem til en database, så den tæller nul. Et `dataset`-input måler i stedet **dækning**
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

### Fremskrivningen

`/ai/demo` viser anlægget, som det ville se ud med signalerne
inde. Det er den eneste flade i repoet, hvor tallene ikke kommer fra
anlægget, og reglerne om den er derfor snævre.

**Den rører kun udgangstilstanden.** `src/lib/fremskrivning.ts` ændrer tre
ting: de signaler, agenterne beder om, findes; alle signaler er i drift; og
skabet og kæden står. Derefter regner `pathState()`, `signalDelivery()` og
agentstatus som altid — de ved ikke, at de er i en fremskrivning, og de får
ingen særbehandling. Går en regel i stykker, går den i stykker begge steder.

**Strukturen opfindes ikke.** De ekstra signaler gribes ikke ud af luften: de
kommer fra agenternes egne `type`-inputs, så fremskrivningen viser det
anlæg, de besluttede agenter allerede har bedt om. Et `signalId` peger på en
bestemt måler og kan ikke opfindes. En idé bliver ikke slået til.

**Tallene er simulerede, og det står på dem.** Temperatur, fugt, hastighed,
omdrejninger, FV0–FV3 og BIGF/BIGH/NOTS kommer fra simulatoren i
`src/lib/telemetri.ts`, som læser sine antagelser fra `data/fremskrivning.ts`.
Ret antagelserne dér — ikke i koden. Simulatoren er seedet og testet for
fysik: værdier holder sig inden for deres grænser, en stoppet elevator har
ingen fart, en motor køler mod hallen og ikke under den, en maskine i
indkøring melder ikke "for langsom", og en sensorfejl er aldrig et stop.
Hyppigheden af stop og fejl er skruet op til en skærm, man ser på i fem
minutter — den siger intet om anlægget.

I den rigtige visning er der ingen simulator. Maskinerne har ingen tal, og
panelerne siger "Afventer signal". Kun flowet kommer ind, fra den samme
LiveSource som kortet.

### Flaskehalse i kæden

Status og ydelse er to forskellige akser. Status siger, om et led *findes*
— de tre ord, PÅ PLADS, TEST, AFVENTER. Ydelse siger, om det *kan følge
med*. Et led kan være på plads og stadig være en flaskehals, så en
flaskehals skifter aldrig leddets status. Den får sit eget mærke over
instrumentet, en udnyttelsesbjælke og en kø på banen foran sig.

Hvert led har en kapacitet, sat i `KAEDE` i `data/fremskrivning.ts`, og
viser **plads til N signaler** ved den. Det tal er svaret på, *hvor* en
flaskehals ville opstå: det led med plads til færrest signaler rammer loftet
først, når anlægget vokser. Med de nuværende skøn er det databasen.

Demoen viser også, *hvordan* en ser ud: med jævne mellemrum skriver
databasen langsommere (`FLASKEHALS`), rækkerne hober sig op i edge's
buffer, data bliver forsinket, og Kædevagten melder det. Bagefter indhenter
kæden køen. Er data forsinkede, er det overskriften — så er alt andet på
skærmen forældet. `?flaskehals=1` holder den fremme til et møde.

**Ingen række forsvinder i regnestykket.** Det, der kommer ind, er skrevet,
i kø eller — kun når bufferen er fuld — tabt. Regnskabet har en test.

Kædevagtens kvartersrunde siger ikke "Kæden svarer", når data halter.
Teknisk sandt, og vildledende.

**Opdigtede tags kan kendes.** De hedder `X…` og har modellen "Ikke valgt" —
de må ikke kunne forveksles med et tag, nogen har tildelt.

**Den må ikke smitte.** Fremskrivningen kopierer og muterer aldrig de delte
dataarrays. Tre tests slår det fast; bryder man dem, ser anlægget bagefter
bedre ud, end det er.

Mærkatet øverst kan ikke klikkes væk og ligger over topbåndet, så det følger
med på et skærmbillede, nogen sender videre.

**Alt der bevæger sig, er enten data eller grænseflade — og de holdes adskilt.**

- *Data*: pulser, materialestrøm, visere, kurver, farver på maskinerne, en
  maskine der ånder, fordi den kører. Hver af dem svarer til en tilstand.
  En puls løber kun på led, der leverer, og stopper ved bruddet. Står noget
  stille i virkeligheden, står det stille på skærmen. Ingen tal tæller op
  for syns skyld — et tal glider kun fra sin gamle værdi til sin nye.
- *Grænseflade*: opstarten, hvor panelerne låser på, og kameraets tur mellem
  maskinerne. De viser ingen data og må ikke ligne det. Opstartslinjerne er
  fakta fra modellen — antal maskiner, hvor langt kæden rækker.

Skanningen over scenen hører til data: den løber kun, når Kædevagten kører.
`prefers-reduced-motion` slukker begge slags uden at tabe indhold.

**Mærkaterne i 3D lever kun inde i scenen.** Bag et panel ville de skinne
igennem og ligne noget, panelet sagde. De projiceres hver frame og skjules
uden for scenens rektangel.

`?fokus=<W-ID>` låser kameraet på én maskine og sætter turen på pause — til
et møde, hvor man vil se på netop den.

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

`inputs` peger fem steder hen — et konkret `signalId`, en `type` fra
sensorkataloget, der endnu ikke er sat op, et `inlet` (materialestrømmen ind
i scopet), et `chainStep`, eller et `dataset` målt som dækning over scopet.
`need` er den sætning, kortet skriver, når det mangler.

Peg på **stedet frem for taget**, når stedet er pointen. Sporagenterne
bruger `inlet: "materiale"` og ikke `signalId: "FT-743"`: flytter måleren
sig igen, skal inputtet stadig passe. Et `signalId` er til, når det er
præcis den måler, der skal bruges.

### Nyt signal

I `data/ot-layer.ts` under `sensors`. Husk `catalogType` — uden den kan en
agent ikke vide, at den slags signal, den mangler, allerede sidder på
maskinen. Kanal og registeradresse udledes; skriv dem ikke.

Flowsignaler skalerer alle ens: 4–20 mA er 0–150 % af nominel kapacitet.
Skal et signal have et andet spænd, hører det på sensoren — ikke som en
undtagelse i `live-source.ts`. Uanset hvad: **skriv en test for grænserne**
(se nedenfor).

Nominel kapacitet for signalet sættes i `flow.nominal` i
`data/line-config.ts`, nøglet på signal-id. Lad den stå tom, indtil driften
har sagt tallet.

## Konventioner

- **Dansk** i UI, kommentarer og commit-beskeder. Kommentarer forklarer
  *hvorfor*, ikke *hvad* — koden siger allerede hvad.
- **Ingen nye dependencies** uden at spørge. Sparklinen er håndtegnet SVG,
  zonerne er `planeGeometry`, testene kører på `node:test`. Det er med vilje.
  Én undtagelse, sagt ja til: `@react-three/postprocessing` (og dens
  `postprocessing`) til bloom og vignet på /ai. Glød kan ikke laves ordentligt
  i hånden. Målere, kurver, oscilloskop og fordelinger er stadig håndtegnet.
- **`npm test` findes** og kører `node:test` gennem tsx. Grænseværdier for
  signaler **skal** have en test: skalering, klemning og fejlgrænser er præcis
  den slags, der går i stykker uden at nogen opdager det. Prøv en ny test af
  ved at bryde reglen med vilje og se den fejle.
- **Farver kommer fra CSS-tokens.** 3D-scenen kan ikke læse CSS, så tokens
  listes i `src/lib/useSceneTheme.ts` og hentes derfra. Nye farver skal
  defineres i alle tre temablokke i `factory-map.css`.
- **Stiplet betyder "findes ikke endnu"** — kabler, zonekanter, DIN-blokke,
  trådnet i 3D. Brug det konsekvent.
- **Stage filer eksplicit.** Brug aldrig `git add -A`, når der ligger
  uafsluttet arbejde i træet — det fejer andres eller ens eget halvfærdige
  arbejde med ind under en besked, der ikke beskriver det. Nævn filerne, eller
  stage dem mappe for mappe, og læs `git diff --cached --name-only` igennem
  før commit.
- Kør `npm test` og `npm run build` før commit. TypeScript er strict, og build
  fanger det, typecheck alene ikke gør.

## Åbne ender

- **`/api/context` skal have sit eget token**, før fase 4. Den ligger bag det
  delte Basic Auth-login i dag, og et script på serveren skal ikke have
  menneskernes adgangskode.
- **Stopgrænsen på 120 sekunder er valgt, ikke aftalt.** Den skal forbi
  driften, før nogen regner tilgængelighed på den.
- **100 %-punktet er ikke aftalt.** `flow.nominal` står tom, så kortet viser
  procent og ingen tons. Tallet — det, der gør procent til t/t — aftales med
  driften efter test, og det er den eneste kalibrering, der findes.
- **FS 550 er en trendmåler, ikke en masseflowmåler.** Den siger, om der
  løber mere eller mindre end før, ikke hvor mange tons der passerer. Enhver
  total udledt af den er et estimat og skal blive ved med at hedde det.
- **Hysteresen og de fem/to procent er valgt, ikke målt.** De skal forbi
  driften sammen med stopgrænsen.
- **Fremskrivningens kanaler er gæt.** FV0–FV3 er læst som fire klasser, der
  summer til 100 %; BIGF/BIGH/NOTS som andele af den tunge side. Begge dele,
  og alle driftspunkter og alarmgrænser i `data/fremskrivning.ts`, skal forbi
  driften, før nogen tager tallene for pålydende.
- **Kædens kapaciteter er skøn.** Kobleren, edge-maskinen og databasen er ikke
  valgt. Med de nuværende tal i `KAEDE` er databasen loftet ved omkring 225
  signaler — tjek det, når udstyret vælges, for det er dér, anlægget ville
  løbe tør først.
- **Den tværgående agent venter på linje nr. 2.** Der er ikke noget at gå på
  tværs af endnu.
- **Fase 4 er et Python-script på serveren**, der henter `/api/context`,
  kalder Claude API og skriver en rapport. Intet af det findes endnu — der er
  ikke kaldt et API fra dette repo.
