# UBS Fabrikskort

Et interaktivt 3D-kort over produktionslinjerne. Fabrikken ses oppefra, uden tag. Første linje er **Linje 2 – Sliberiet**.

## Kom i gang

```bash
npm install
npm run dev          # http://localhost:3000
```

Kortet er bag login fra første kald. Uden `.env.local` svarer det 503 — se
**Opsætning** nedenfor.

## Opsætning

Alt styres af miljøvariabler i `.env.local`, som er git-ignoreret. Der står
ingen værdier i repoet, og der skal aldrig komme nogen.

```bash
BASIC_AUTH_USER=
BASIC_AUTH_PASSWORD=
LIVE_SOURCE=mock

# Kun til simuleringen med rigtige agenter (/ai/demo?agenter=claude).
ANTHROPIC_API_KEY=
# Kun hvis nøglen ikke hører til et workspace.
ANTHROPIC_WORKSPACE_ID=
# Loft i kroner. Udeladt: 10 pr. kørsel og 50 pr. døgn.
AGENT_LOFT_KR_KOERSEL=
AGENT_LOFT_KR_DOEGN=

# Kun når linjeskærmen og kontoret kører på Vercel (se nedenfor).
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

På Vercel sættes de samme navne under *Settings → Environment Variables*.

### Linjeskærm og kontor

En ordre køres med linjeskærmen på `/ai/demo` (storskærmen i operatørrummet)
og kontoret på `/ai/demo/kontor` (formandens skærm), gerne på hver sin
maskine. Kontoret styrer fart, forfra og Claude, og kan udføre eller afvise
anbefalinger. De to taler sammen gennem serveren.

- **Lokalt** (`npm run dev` eller `npm start` på én maskine, den anden på
  netværket) er serverens hukommelse nok. Der skal ikke sættes noget op.
- **På Vercel** kan de to lande i hver sin instans, og så ser kontoret intet.
  Opret en Redis-database hos Upstash — gratis, eller via *Storage* i
  Vercel — og sæt `UPSTASH_REDIS_REST_URL` og `UPSTASH_REDIS_REST_TOKEN`.
  Vercels egne navne, `KV_REST_API_URL` og `KV_REST_API_TOKEN`, virker også.
  Uden står der "Uden fælles lager" på kontoret.

### Login

`src/proxy.ts` ligger foran alt: sider, API-ruter og JS-bundterne. Den
matcher `/:path*`, så der er ingen vej uden om — heller ikke til
`/api/context` eller `/api/live`.

Den læser `BASIC_AUTH_USER` og `BASIC_AUTH_PASSWORD` og sammenligner i
konstant tid. Der er **ingen indbygget standardbruger**: mangler en af
variablerne, svarer hele appen 503 frem for at lukke op. Et glemt miljø skal
fejle lukket.

Det er ét delt login for alle, ikke en bruger pr. person, og der er ingen
log ud-knap — browseren husker til vinduet lukkes. Til et internt kort er det
som regel nok.

> `/api/context` deler login med mennesker i dag. Før et script på serveren
> begynder at hente den, skal den have sit eget token. Se *Åbne ender* i
> [CLAUDE.md](CLAUDE.md).

### LIVE_SOURCE

Bestemmer, hvor **Live**-visningen henter tal fra. Læses på serveren i
`src/app/page.tsx` og gives videre til kortet, så navnet kan stå uden
`NEXT_PUBLIC`-præfiks.

| Værdi | |
|---|---|
| `mock` | Simulerer FT-743 ved linjens indgang i browseren: 4–20 mA med støj, af og til stop på 4 mA, sjældent kabelbrud under 3,6 mA. Visningen viser et tydeligt **Simulerede data**-banner |
| `api` | Henter `/api/live`, som læser seneste værdier fra MSSQL |

Alt andet end `api` — også en tom variabel — betyder `mock`. Det er med
vilje: falder en variabel væk, skal kortet simulere med banneret fremme, ikke
foregive at vise målinger.

Uanset kilde vises materialestrømmen i **procent af nominel kapacitet**, hvor
4 mA er 0 % og 20 mA er 150 %. Procenten kan først blive til tons, når nogen
har sagt, hvad 100 % er; indtil da står takten som "Ikke udfyldt". Tallet
sættes i `flow.nominal` i `data/line-config.ts`.

**Før du skifter til `api`** skal tre ting være på plads:

1. `/api/live` er en stub i dag. Den svarer `200` med `ok: false` og en
   grund, så panelet kan skelne et dødt endpoint fra et levende uden database
   bag. Den skal implementeres mod MSSQL.
2. Databasen skal findes, og edge-collectoren skal skrive til den. Tabellen
   skal bære **råsignalet i mA** som egen kolonne — uden det kan kabelbrud
   ikke kendes fra et stop.
3. Kæden fra IO-skab til database skal stå. Åbn IO-skabet i **OT Layer** →
   fanen *Forudsætninger*; den tæller ned, hvor mange der mangler.

Skifter du for tidligt, går der ikke noget i stykker — alle signaler står
bare som *Ingen kilde*, og Forbindelser-panelet peger på det led, der tier.

### Kommandoer

```bash
npm run dev      # udviklingsserver
npm run build    # produktionsbuild, kør det før commit
npm test         # node:test gennem tsx
npm run parse    # Draw.io → data/lines/<id>.json
```

`npm run parse` tager tegningen som argument og **overskriver** filerne i
`data/lines/`:

```bash
npm run parse -- data/drawio/flow-sliberi.drawio
npm run parse -- data/drawio/analytics.drawio analytics "Analytics" 0
```

Håndholdte data — vedligehold, OT-lag, driftsparametre, agenter — ligger i
andre filer og røres ikke. Se afsnittet om genereret kontra håndholdt i
[CLAUDE.md](CLAUDE.md).

`npm test` dækker grænseværdierne på strømsløjfen og dommen over et signal.
Rører du skalering eller fejlgrænser, skal der følge en test med.

Konventioner for kodestil, statusregler og hvad der ikke må gættes står i
[CLAUDE.md](CLAUDE.md) — de gentages ikke her.

## Skabelon til line managers

`templates/UBS-linjeskabelon.drawio` (fanen *Vejledning* forklarer det hele) og
`templates/UBS-maskiner.xml` (Fil → Åbn bibliotek). Maskinerne har faste felter
(Ctrl+M), så navn og W-ID vises automatisk i boksen. Kør `npm run template` for at gendanne dem.

## Fra Draw.io til kort

1. Læg tegningen i `data/drawio/`.
2. `npm run parse -- data/drawio/<fil>.drawio`
   – laver én `data/lines/<id>.json` pr. fane med navnet *Linje N – Navn* og lister de ting, der bør rettes i tegningen.
3. Registrér linjen i `src/lib/lines.ts` — importér JSON-filen og tilføj den til
   `LINES`. Resten sker af sig selv: linjen kommer med i vælgeren i headeren,
   sorteret efter sit nummer. Vælgeren vises først, når der er mere end én linje.

Linjerne er selvstændige procesafsnit uden materialeflow imellem sig, så en
maskines `upstream`/`downstream` peger altid på maskiner i samme linje.

### Rum

Ud over de nummererede linjer kan der være **rum**, der hører til hele fabrikken
— fx `Analytics` med Videometer og CT-scanner. De registreres som en linje, men
tilføjes `ROOM_IDS` i `src/lib/lines.ts`. Så ligger de i deres egen gruppe i
vælgeren og kan nås uanset hvilken linje man står på.

**Hele fabrikken** øverst i vælgeren viser alle linjer og rum på én grund og
forbindelserne mellem dem: materialeflow, prøver, data og mennesker.
Afdelinger uden tegning og de håndholdte forbindelser står i `data/fabrik.ts`.

Et rum tegnes uden pile. Er der ikke en eneste pil i tegningen, forstår parseren
den som et rum og gætter hverken forbindelser eller brokker sig over løse
maskiner. Spor-, flow- og trin-visningen skjuler sig selv, når der ikke er noget
at vise. Rummet parses med sit eget navn og nummer 0:

```bash
npm run parse -- data/drawio/analytics.drawio analytics "Analytics" 0
```

Parseren læser:
- **Label:** Maskinnavn på første linje og `W-ID:611` på næste. Flere id'er skrives `W-ID:793/794/795`.
- **Pile:** Materialeflowet. Løse pile og manglende pile mellem maskiner, der står lige under hinanden, bliver *antaget* og vist med orange stiplet linje.
- **Edit Data (Ctrl+M):** `navn`, `wid`, `maskintype` (Indtag, Elevator, Fordeler, Proces, Analyse eller Person) og `spor` styrer selve kortet. `producent`, `model`, `aar`, `proces`, `kapacitet`, `dim`, `ot` og `noter` vises i maskinpanelet. `x`, `z`, `rot`, `bredde`, `dybde` og `hoejde` er målfast placering (se nedenfor). Andre felter bliver også gemt i data.
- **Spor:** Feltet `spor`. Mangler det, gættes sporet ud fra navnets endelse (S/N) efter en fordeler.

## Vedligehold og historik

Hver maskine har et vedligeholdsafsnit i panelet med **sidste hovedeftersyn** og
**sidste retrofit** (dato og hvor længe siden), og en knap der åbner en tidslinje
over alle hændelser — nyeste først, med filter på type.

Hændelserne ligger i `data/maintenance.json`, **adskilt fra linjedata**: filerne i
`data/lines/` genereres fra Draw.io og bliver overskrevet ved hver `npm run parse`,
mens vedligehold er driftsdata, der skal overleve. Det er også derfor, de er nøglet
på W-ID og ikke på tegningens celle-id'er — en hændelse følger maskinen, selv om
tegningen laves om. Filen svarer til én tabel og flytter senere til MSSQL.

```json
{
  "id": "ex-001",
  "wid": "614",
  "dato": "2022-09-05",
  "type": "retrofit",
  "beskrivelse": "Nyt sold, nye lejer og ny frekvensomformer.",
  "udfoertAf": "Nordmark Service",
  "omkostning": 285000
}
```

| Felt | Krav | Betydning |
| --- | --- | --- |
| `id` | Ja | Entydigt id for hændelsen |
| `wid` | Ja | W-ID på maskinen. Dækker en maskine flere W-ID'er, tæller hændelsen på dem alle |
| `dato` | Ja | ISO: `2024-06-15` |
| `type` | Ja | `hovedeftersyn`, `retrofit`, `reparation` eller `udskiftning` |
| `beskrivelse` | Ja | Hvad der blev lavet |
| `udfoertAf` | | Internt team eller leverandør |
| `omkostning` | | Kroner, som tal |

Findes der ingen hændelser, står der **"Ingen registreringer"** — både i panelet og
i modalen. Det er en anden oplysning end "aldrig vedligeholdt".

Filen indeholder pt. **fem eksempelhændelser** på Nordmark (614), Jetpealer S (789)
og Vippestol (795). De er mærket `EKSEMPELDATA` i beskrivelsen og skal slettes,
når rigtige data kommer ind.

## Målfast placering fra plantegningen

Som standard kommer placeringen fra flowdiagrammet og er ikke målfast. Når linjen
er målt op på plantegningen, skrives koordinaterne ind i tegningen og linjen
skifter til `positionMode: "floorplan"`.

**Aftal først fabrikkens nulpunkt og nordretning** — ét fast punkt pr. fabrik, fx
det nordvestlige hjørne af bygningens indervæg. Alle linjer skal bruge samme
nulpunkt, ellers passer de ikke sammen indbyrdes. Skriv det aftalte punkt her:

> Nulpunkt for UBS Holeby: _(ikke aftalt endnu)_

Felterne sættes pr. maskine med Ctrl+M og står klar på alle bokse fra skabelonen
og maskinbiblioteket. Alle mål er i **meter**, og både `12,5` og `12.5` virker.
Tomme felter betyder bare "ikke målt op endnu" og giver ingen advarsler:

| Felt | Betydning |
| --- | --- |
| `x` | Maskinens midte, meter mod **øst** fra nulpunktet |
| `z` | Maskinens midte, meter mod **syd** fra nulpunktet |
| `rot` | Grader med uret set oppefra. 0 = maskinens længdeakse peger mod øst |
| `bredde` / `dybde` | Opmålt fodaftryk i maskinens egne akser. Udelades de, bruges standardmålene for maskintypen |
| `hoejde` | Opmålt højde |

`bredde`, `dybde` og `hoejde` er **uafhængige af `x`/`z`**: man kan godt kende en
maskines mål uden at vide, hvor i fabrikken den står. Målene bruges altid, også
når placeringen er skematisk. `x` og `z` hører sammen — udfyld enten begge eller
ingen. Kør derefter:

```bash
npm run parse -- data/drawio/<fil>.drawio --floorplan
```

Uden `--floorplan` bliver linjen ved med at være skematisk, men parseren læser og
validerer koordinaterne alligevel og fortæller, hvor mange maskiner der mangler.
Maskiner uden `x`/`z` falder tilbage til den skematiske placering og markeres
både i signaturforklaringen og i maskinpanelet.

### Plantegning som underlag

For at kontrollere at koordinaterne rammer rigtigt, kan selve plantegningen
lægges ind under maskinerne. Læg billedet i `public/` og tilføj `floorplan` til
`line` i `data/lines/<id>.json` — feltet overlever en ny `npm run parse`:

```json
"floorplan": {
  "src": "/plantegninger/holeby.png",
  "x": 0, "z": 0, "width": 120, "depth": 60, "opacity": 0.55
}
```

`x`/`z` er billedets **nordvestlige hjørne**, `width`/`depth` dets udstrækning i
meter, og billedets top er nord. Ligger tegningen skævt, drejes den med `rot`
(grader med uret om billedets midte).

## Struktur

| Sti | Indhold |
| --- | --- |
| `src/lib/drawio.ts` | Draw.io → `LineData` (virker også i browseren) |
| `src/lib/types.ts` | Datamodellen (klar til at flytte til MSSQL) |
| `src/lib/layout.ts` | Tegning → meter, maskinstørrelser, flowruter |
| `src/lib/dates.ts` | Danske datoer, også upræcise som `2024` |
| `src/lib/maintenance.ts` | Opslag i vedligeholdshistorikken |
| `data/maintenance.json` | Vedligeholdshændelser (senere MSSQL) |
| `src/components/` | 3D-scene (React Three Fiber), maskinpanel, styles |
| `scripts/build-preview.ts` | `npm run preview` → én selvstændig HTML-fil til deling |

## Kendte begrænsninger

- Linje 2 – Sliberiet er stadig **skematisk**: placeringerne kommer fra flowdiagrammet og er ikke målfaste. Datamodellen er klar til plantegningen (se *Målfast placering*), men koordinaterne er ikke målt op endnu.
- Maskinformerne er illustrative og vælges ud fra maskinens navn i `MachineMesh.tsx`.
- **Jan** i Analytics er maskintypen `Person` og er sat ind for sjov. Personer
  tælles for sig i headeren og har hverken W-ID, OT-felter eller
  vedligeholdshistorik. Slet ham i `data/drawio/analytics.drawio`, hvis kortet
  skal vises frem udadtil.
- `Analytics` mangler W-ID på begge instrumenter, og rummet er ikke målt ind på
  plantegningen. CT-scannerens mål (0,9 × 1,8 × 1,8 m) er rigtige; videometerets
  bordmål (1,6 × 0,8 m) er et gæt — kun båndets bredde på 30 cm er oplyst.
  Afstanden mellem de to instrumenter er skematisk, ikke målt.
