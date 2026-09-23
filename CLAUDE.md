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

Én undtagelse, sagt ja til: **signalkæden**. Hvert led har en rolle på højst
fire ord under sit navn ("Gemmer alt"), og hver bane siger, hvad der løber
på den ("Modbus TCP"). Uden dem var kæden ikke til at forstå — det sagde
den, der skrev reglen. En rolle er en etiket for, *hvad* leddet er, ikke en
forklaring på *hvorfor*; det sidste hører stadig til i dokumentvisningen.

**Kæden på skærmen har fire led, ikke seks.** Sensor, DIN-skab, Server og
MSSQL. OT-laget har stadig sine seks trin — de bærer indkøb og
afhængigheder og står uændret i dokumentvisningen. Men "kobler" og "edge"
er ord, man skal have forklaret, før kæden kan læses. IO-kortet og kobleren
sidder på den samme DIN-skinne i det samme skab, så de er ét led; edge er et
program på en server i racket, så det hedder Server. Oversættelsen sker ét
sted, i `HUD_LED` i `src/lib/ai-hud.ts`. DIN-skabet er ikke stærkere end
sit svageste trin: leverer kobleren ikke, leverer skabet ikke. Reglen har
en test, og en anden test holder de to ord væk fra skærmen.

**Sensoren er alle målerne, når der er flere.** Én måler står med model,
kanal og registeradresse. Er der mange — som i demoen — tæller leddet dem
efter slags med katalogets ord (`kort` i `data/ot-sensor-types.ts`):
"Temperatur 18", "Fugt 1". Sensordata er ikke kun flow.

**Hver kanal på en maskine har en grænse — eller en grund.** `alarmLav` og
`alarmHoej` i `data/fremskrivning.ts`; mangler begge, skal `ingenGraense`
sige hvorfor (fordelerens andel følger sporene og må stå på 0 eller 100).
Mangler kun den ene side, er det, fordi den anden ikke er en fejl: en kold
motor er ikke et problem. Grænsen står ved kanalens navn — "2,0–2,8",
"max 70" — formateret af `graense()` i `src/lib/telemetri.ts`, ved siden
af alarmreglen, så det, skærmen viser, er det, der melder. Begge dele har
tests.

**Ordren er masterdata, ikke en måling.** Ordre nr., genetik og varietet
står øverst til venstre (`HudModel.ordre`). Der er ingen forbindelse til
ordresystemet, så i den rigtige visning står felterne "Ikke udfyldt". I
demoen kommer de fra `ORDRE` i `data/fremskrivning.ts`, hedder `X-…` som de
opdigtede tags og bærer et SIM-mærke — et ordrenummer, der lignede et
rigtigt, kunne blive slået op.

Ordren har også estimeret kg og **Box** — kørte kasser ud af ordrens. I
demoen tælles de af strømmen ind (`gennemloeb`, procent·sekunder, lagt
sammen i simulatoren) gange 100 %-punktet, delt med kassernes snitvægt, i
`kasserKoert()`. Står linjen, står tælleren; den tæller aldrig forbi ordren,
og uden 100 %-punkt eller strøm står der en streg, ikke et nul. En
sensorfejl er et hul i summen, ikke et gæt.

**Hændelserne kan læses som en log.** "Hele loggen" åbner et vindue med alt,
der er sket, siden siden åbnede (højst `LOG_MAKS`), nyeste først og med hele
teksten. Der kan filtreres på niveau, på AI og på ét sted. Billedet husker
kun de seneste; `samlLog()` lægger dem sammen, hver hændelse én gang.
Vinduet er grænseflade: det viser intet, anlægget ikke selv har meldt.

**Partiklerne i maskinerne bevæger sig kun, når maskinen kører**, og med dens
fart (`maskinFart()`): løftet op gennem elevatorerne, på langs gennem
maskinerne. Ved vi ikke, om den kører — som i den rigtige visning i dag —
står de stille. Hver maskine har sin egen fase, så en maskine, der bremser,
bremser i stedet for at springe.

### Fremskrivningen

`/ai/demo` viser anlægget, som det ville se ud med signalerne
inde. Det er den eneste flade i repoet, hvor tallene ikke kommer fra
anlægget, og reglerne om den er derfor snævre.

**Den rører kun udgangstilstanden.** `src/lib/fremskrivning.ts` ændrer tre
ting: de signaler, agenterne beder om, findes; alle signaler er i drift; og
skabet og kæden står. Derefter regner `pathState()`, `signalDelivery()` og
agentstatus som altid — de ved ikke, at de er i en fremskrivning, og de får
ingen særbehandling. Går en regel i stykker, går den i stykker begge steder.

**Strukturen opfindes ikke.** De ekstra signaler gribes ikke ud af luften. De
kommer to steder fra: agenternes egne `type`-inputs, og demoens kanaler.
Hver kanal i `data/fremskrivning.ts` siger med `maaler`, hvilken slags måler
der leverer den, og fremskrivningen sætter netop den måler på netop den
maskine. Viser demoen en temperatur, sidder der altså en temperaturmåler
bag den, med en kanal i skabet og en plads i kæden — ellers stod der et tal
på skærmen, ingen kanal kunne bære. Et `signalId` peger på en bestemt måler
og kan ikke opfindes. En idé bliver ikke slået til.

**Feltbus fylder ingen kanal.** En frekvensomformer eller et analyseudstyr
taler selv på netværket (`signal: "feltbus"`). `channelReport()` springer
dem over; talte de med, forudsatte fremskrivningen kort, ingen skal bruge.

**Tallene er simulerede, og det står på dem.** Temperatur, fugt, hastighed,
omdrejninger, kastebordenes vibration, slag, hældning og luft, FV0–FV3 og
BIGF/BIGH/NOTS kommer fra simulatoren i
`src/lib/telemetri.ts`, som læser sine antagelser fra `data/fremskrivning.ts`.
Ret antagelserne dér — ikke i koden. Kanalerne og flowet tager et eksakt
skridt, ikke en tilnærmelse: udsvinget er det samme, uanset hvor tit siden
tikker, så en bærbar, der hakker, ikke rammer grænser, som en, der ikke
gør, aldrig ramte. Det har en test. Simulatoren er seedet og testet for
fysik: værdier holder sig inden for deres grænser, en stoppet elevator har
ingen fart, en motor køler mod hallen og ikke under den, en maskine i
indkøring melder ikke "for langsom", og en sensorfejl er aldrig et stop.
Hyppigheden af stop og fejl er skruet op til en skærm, man ser på i fem
minutter — den siger intet om anlægget.

I den rigtige visning er der ingen simulator. Maskinerne har ingen tal, og
panelerne siger "Afventer signal". Kun flowet kommer ind, fra den samme
LiveSource som kortet.

### Driftsagenten

Den eneste agent, der griber ind i stedet for at skrive (`role: "styring"`).
I demoen stopper den et spor, før en ophobning foran en stoppet maskine
løber over, eller før frøet i en jetpealer tager skade, og den starter
sporet igen, når årsagen er væk. Står begge spor, stopper den indgangen.
Grænserne står i `DRIFTSAGENT` i `data/fremskrivning.ts`.

- **Den handler ikke på én prøve.** Et fund skal holde i `overvejS`.
- **Den handler ikke på data, den ikke kan stole på.** Er data mere end
  `FLASKEHALS.forsinkelseAlarmS` bagud, holder den sine beslutninger og siger
  det. Den stopper ikke linjen for en langsom database: anlægget kører fint,
  det er dens eget syn, der er forsinket. Prisen — at en buffer kan løbe
  over, mens den holder — er testet og skal kunne ses.
- **Hver beslutning har en begrundelse** og et AI-mærke i loggen.
- **Et styret stop er rav, en fejl er rød.** Maskiner, agenten har stoppet,
  er ikke fejl (`styret: true`) og tælles ikke som stop. Kun årsagen er rød.
- **Et stop koster gennemløb.** Står et spor, sender fordeleren alt til det
  andet, og W/HR falder til det halve.
- **Et overløb har en pris i modellen** (`TILLOEB.rengoeringS`). Uden den
  ville en simulation uden agent se bedre ud end en med.

`?ophobning=1` lader KB-3N gå i stå kort efter, siden er åbnet, så agenten
kan ses gribe ind. Testene bruger `planlagteStop` til det samme — en test
skal bestemme, hvad der sker, ikke håbe på det.

Det store tal på scenen hedder **"På plads"**, ikke "i drift": det tæller
signaler, ikke maskiner, der kører. Står et spor på agentens beslutning,
ville "i drift 26" ved siden af "kører 16" være en modsigelse.

### Ordresimuleringen

`/ai/demo` kører én ordre fra første kasse til sidste: linjen startes
bagfra, kører, til sidste kasse er tippet, løber tom og stoppes forfra —
og Operatøragenten skriver en rapport. Antagelserne står i `SIMULERING` og
`ORDRE` i `data/fremskrivning.ts`.

**Det er en simulering, ikke en drejebog.** Stop, varme, database-episoder
og sensorfejl opstår af simuleringen, seedet, og agenterne reagerer på det,
de ser i tallene. `?seed=N` giver en anden dag med de samme regler.

**Tiden går hurtigt, når alt er roligt, og langsomt, når der sker noget.**
Simulatoren melder sin `uro` — et spor, der står, en database, der halter,
et varsel — og så længe listen ikke er tom, går tiden langsomt. Sker der
noget midt i et hurtigt spring, stopper springet dér. Gangen står altid i
toppen (×90, ×8), så ingen tager en time på skærmen for en time i hallen, og
den kan sættes i hånden: pause, 1×, 10×, 90×, auto, forfra.

**Arbejdsdelingen er pointen.** Hver agent ser sit og siger det til de
andre; Operatøragenten afvejer og beslutter, og det, et menneske skal gøre,
siges til et menneske.

| Agent | Ser | Gør |
|---|---|---|
| Linjeagent N/S | Et stop på vej, frø der bliver varmt, FV3 | Melder, med tallene og en prognose |
| Kædevagt | At MSSQL ikke kan følge med | Melder til Dataagenten |
| Dataagent | Rækker mod kapacitet, målere, der falder ud | Foreslår og sætter prøveraten |
| Driftsagent | Buffere og frøtemperatur | Stopper og starter spor efter faste regler |
| Operatøragent | Alle de andre | Afvejer, beslutter, fortæller operatøren |

Som standard er beskederne **regler og skabeloner** (`src/lib/samspil.ts`),
mærket SIM og REGEL. Hver beslutning og hvert forslag har en begrundelse med
tallene bag; det har en test.

### Rigtige agenter: `?agenter=claude`

Med `/ai/demo?agenter=claude` tænker de agenter, der i virkeligheden er
Claude — Operatøragent, Dataagent og de to linjeagenter — med Claude. Det
koster penge pr. kald, og derfor er det et valg i adressen.

- **Reglerne afgør, hvornår; Claude afgør, hvad.** Simulatoren opdager, at
  noget sker, og laver en *opgave*: spørgsmålet, tallene, de handlinger,
  agenten kan vælge imellem, og hvem den kan skrive til. Det, der afhænger
  af beslutningen — en genstart, en prøverate — venter på svaret.
- **Driftsagent og Kædevagt tænker aldrig med Claude.** Et spor skal stoppes
  inden for to sekunder, og et kald tager flere. Det er arbejdsdelingen
  mellem sikringen og den vagthavende, og simuleringen viser den.
- **Mens en agent tænker, går tiden i virkelig tid**, så svartiden er ægte.
- **Svaret valideres.** En handling, opgaven ikke tilbød, bliver reglernes;
  en besked til en, opgaven ikke nævnte, falder væk. Svarer Claude ikke,
  svarer reglerne med deres skabelon. Tre fejl i træk, loftet eller en
  manglende nøgle: så tager reglerne over for resten af kørslen, og det står
  på skærmen.
- **Hver besked er mærket CLAUDE (med svartid) eller REGEL.** Prisen og
  antallet af kald står i toppen.
- **Kaldet sker kun på serveren**, i `src/lib/claude.ts` via `/api/agent`.
  Nøglen forlader aldrig serveren og skrives aldrig ud. Loftet håndhæves dér:
  `AGENT_LOFT_KR_KOERSEL` (10 kr) og `AGENT_LOFT_KR_DOEGN` (50 kr).
- **Hver kørsel er en ny dag** med et tilfældigt seed, der står på skærmen.
  Samme seed giver de samme hændelser — ikke de samme svar.

- **At skrue linjen ned for databasens skyld afvises med regnestykket.**
  Rækkerne kommer fra antallet af signaler, ikke fra tons — færre tons giver
  nul færre rækker. Dataagenten sænker i stedet prøveraten i trin
  (`PROEVERATE`): så få som muligt, men nok til luft under kapaciteten, og
  aldrig på de hurtige signaler, Driftsagent styrer efter. Raten sættes op
  igen, når databasen har kunnet følge med i et halvt minut.
- **Et varsel gælder kun den farlige retning, og først ved fem gange det
  normale udsving.** En kold motor efter et stop varsler ingenting, og ved
  fire vandrede en motortemperatur derud af sig selv. En test holder, at
  varsler kun kommer før stop, der faktisk kommer.
- **Et spor startes bagfra og stoppes forfra.** Så fødes ingen buffer, før
  maskinen efter den kører, og intet står fuldt til næste ordre. En maskine,
  der er slukket efter planen, er ikke en fejl (`styret`). Begge har tests.
- **Én FV3-prøve er ikke en trend.** Den meldes som en iagttagelse. En
  anbefaling kræver to prøver i træk — se kastebordene nedenfor.

**Loggen på skærm 2** (`/ai/demo/log`) kører ingen simulering selv. Den
lytter på kontrolrummet gennem browserens `BroadcastChannel` — samme maskine,
ingen server — og viser agenterne imellem og hændelserne side om side. Tier
kontrolrummet, bliver loggen stående og siger det.

`frem()` tager et skridt uden at bygge et billede, til mellemskridtene, når
tiden går hurtigt. Støjen i billedet trækkes, før billedet bygges, så et
forløb med og uden billeder er det samme.

### Kastebordene

**Maskinen viser drift, analysen viser output.** Det, der står på en maskine
— på mærkatet, i enheden — er det, den stilles og køres efter: på et
kastebord dækkets vibration, slag, tværhældning, langshældning og luft.
FV0–FV3, BIGF, BIGH, NOTS og udskud er klassificeringer af frøet, der
kommer ud, og står i analysen (`Analyse.andele`, `tung`, `udskudPct`). En
test holder klassificeringerne væk fra maskinens kanaler. Analyseudstyret er
en måler på bordet (`ekstraMaalere`), så fremskrivningen stadig sætter det,
der leverer tallene.

**Indstillingen styrer skillet.** Hældning og luft sættes under kørslen
(`indstillinger` i billedet), og målingen følger efter med kanalens
træghed. Mere tværhældning eller mere luft skiller skarpere: mindre FV3
i den tunge ende, mere udskud i den lette. Hvor meget pr. grad og pr. ti
procent luft står i `KASTEBORDET` i `data/fremskrivning.ts` — skøn, som
resten af fremskrivningens tal. Partiet vandrer langsomt, så et bord, der
skilte fint for en time siden, kan skille for blødt nu.

**Agenten anbefaler, et menneske udfører.** Linjeagenten ser prøverne og
anbefaler én indstilling ét trin (`KASTEBORDET.trin`), med det forventede.
Anbefalingen står i enheden og i Anbefalinger-panelet med **Udfør** og
**Afvis**; ingen hældning flytter sig, før nogen trykker. Det, operatøren
gør, står i samtalen som `kilde: "menneske"`. Efter
`proeverFoerVurdering` prøver gør agenten virkningen op mod det forventede.
Tager ingen stilling, bortfalder den efter `anbefalingGyldigS` — og bremser
kun tiden det første minut, så en glemt anbefaling ikke holder simuleringen i
langsom gang.

- **To prøver i træk, samme vej.** For meget FV3 over bordets normale
  giver "hæv"; for meget udskud med FV3 i orden giver "sænk".
- **Aldrig på et bord, der ikke står, hvor det er sat.** Lige efter en start
  er luften på vej op, og bordet skiller dårligt af den grund. Prøver, hvor
  hældning eller luft er mere end et halvt trin fra det satte
  (`staarSomSat()`), står i analysen, men melder ingen FV3- eller
  NOTS-alarm og tæller hverken til en anbefaling eller til opgørelsen af en
  — som en maskine i indkøring, der ikke melder "for langsom". Begge dele
  har tests.
- **Inden for grænserne.** En anbefaling går aldrig over kanalens alarmgrænse
  minus et trin.
- **Ét skridt ad gangen.** Ingen ny anbefaling til et bord, før virkningen af
  den sidste udførte er gjort op — ellers ved ingen, hvad der virkede.
- **Et nej bliver hørt.** Afviser operatøren, eller bortfalder anbefalingen,
  får bordet ro i `roEfterNejS`. En agent, der gentager sig hvert andet
  minut, bliver ikke hørt — og i `?agenter=claude` koster hver gentagelse et
  kald. Begge har tests.

**Enheden.** Tryk på en maskine — på mærkatet eller i scenen — og kameraet
låser på den, og enheden erstatter fokuspanelet: drift med grænser og
kurver, bufferen foran, og på et kastebord indstillingen, dækket tegnet fra
enden og fra siden (hældningen fire gange overdrevet, det satte stiplet,
når målingen ikke er nået derhen), klassificeringen, anbefalingerne, målerne
og de seneste beskeder. "Oversigt" eller Escape lukker den. Et træk i scenen
er ikke et klik.

**Kameraet flyver ikke i en simulering.** Turen er slået fra, når en ordre
køres — man skal kunne følge en kørsel, uden at scenen flytter sig. "Tur" i
toppen slår den til igen. Svajet følger turen.

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

**W/HR er vægt pr. time**, i `t/hr` — det tal, driften spørger efter først.
Det findes kun, når 100 %-punktet er kendt. Et aftalt tal i
`flow.nominal` i `data/line-config.ts` vinder altid. Kun i demoen falder
modellen tilbage på skønnet i `FLOW_NOMINAL` i `data/fremskrivning.ts`
("normalt omkring 1 ton i timen"), og så står der "Skøn" på tallet. I den
rigtige visning står der "Ikke udfyldt", indtil tallet er aftalt. Afgørelsen
sker ét sted, i `flowFor()` i `src/lib/ai-hud.ts`, og har tests.

**Ingen række forsvinder i regnestykket.** Det, der kommer ind, er skrevet,
i kø eller — kun når bufferen er fuld — tabt. Regnskabet har en test.

Kædevagtens kvartersrunde siger ikke "Kæden svarer", når data halter.
Teknisk sandt, og vildledende.

**Opdigtede tags kan kendes.** De hedder `X…` og har modellen "Ikke valgt" —
de må ikke kunne forveksles med et tag, nogen har tildelt.

**Den forudsætter det, planen kræver — og siger det.** Beder de besluttede
agenter om flere signaler, end skabet har kanaler til, lægger fremskrivningen
de IO-kort til, der skal til. De hedder `X-IO-…`, har modellen "Ikke valgt"
og står som "Forudsat" på DIN-skabets instrument. Uden dem ville signaler stå
som "på plads", der aldrig kunne læses. IO-kortet viser analoge og digitale
kanaler hver for sig: lagt sammen skjulte de et underskud.

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

En ny slags måler hører i `data/ot-sensor-types.ts` med et `kort` ord til
HUD'en. En ny kanal i demoen skal have sin `maaler`; uden den vil typen
ikke kompilere, og en test tjekker, at måleren står i kataloget.

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
  procent og ingen tons. Tallet — det, der gør procent til t/hr — aftales med
  driften efter test, og det er den eneste kalibrering, der findes.
- **FS 550 er en trendmåler, ikke en masseflowmåler.** Den siger, om der
  løber mere eller mindre end før, ikke hvor mange tons der passerer. Enhver
  total udledt af den er et estimat og skal blive ved med at hedde det.
- **Hysteresen og de fem/to procent er valgt, ikke målt.** De skal forbi
  driften sammen med stopgrænsen.
- **Fremskrivningens kanaler er gæt.** FV0–FV3 er læst som fire klasser i en
  prøve fra hvert kastebord, der summer til 100 %, hvor FV0 og FV1 dominerer
  og FV3 er det, bordene renser ud; BIGF/BIGH/NOTS som andele af den tunge
  side. At andet bord i sporet har markant mindre af det hele og nærmest
  ingen NOTS, er sagt af driften — tallene for det er valgt. Alt det, og
  alle driftspunkter og alarmgrænser i `data/fremskrivning.ts`, skal forbi
  driften, før nogen tager tallene for pålydende.
- **Hvor BIGF, BIGH og FV kommer fra, er ikke afklaret.** Demoen antager ét
  analyseudstyr på feltbussen pr. kastebord. Er det laboratoriets prøver, er
  det et `dataset` og ikke et signal.
- **Ordren har ingen kilde.** Ordre nr., genetik, varietet, estimeret kg og
  kasser skal komme fra ordresystemet. Hvilket, hvordan og i hvilket format
  er ikke afklaret; det ved driften. Demoen læser kasserne som dem, der
  tippes i vippestolene, og tæller dem af strømmen ind — i virkeligheden
  kunne en tæller på vippestolene gøre det bedre.
- **Dataagent og Operatøragent er besluttet på demoens præmisser.** De står
  som besluttede, så simuleringen kan vise dem arbejde. Prisen for dem er et
  skøn (6 og 30 kørsler i døgnet), og i virkeligheden ville deres beskeder
  være Claude-kald, ikke skabeloner.
- **Driftsagenten kan ikke stoppe noget i dag.** Der findes ingen vej fra en
  agent tilbage til styringen. En skrivning til PLC'en er en
  sikkerhedsbeslutning — interlocks, hvem der kan tilsidesætte, hvad der
  sker ved et netværksudfald — og skal tages for sig, før agenten slås til.
  I demoen er dens beslutninger regler, så de kan testes; i virkeligheden er
  den `engine: "claude"`, og prisen bygger på et skøn på 20 beslutninger i
  døgnet.
- **Kanalerne rækker ikke til planen.** De besluttede agenter beder om 29
  digitale signaler; skabet har 16. Demoen forudsætter et DI-kort mere. Det
  skal med i styklisten, før driftssignalerne rulles ud.
- **`signalDelivery()` kender ikke kanaler.** Et signal uden ledig kanal
  tæller i dag som leverende. Det betyder intet med ét signal, men skal
  rettes, før skabet fyldes.
- **Kædens kapaciteter er skøn.** Kobleren, edge-maskinen og databasen er ikke
  valgt. Med de nuværende tal i `KAEDE` er databasen loftet ved omkring 225
  signaler — tjek det, når udstyret vælges, for det er dér, anlægget ville
  løbe tør først.
- **Den tværgående agent venter på linje nr. 2.** Der er ikke noget at gå på
  tværs af endnu.
- **Fase 4 er et Python-script på serveren**, der henter `/api/context`,
  kalder Claude API og skriver en rapport. Det findes ikke endnu. Det eneste
  sted, repoet kalder Claude, er simuleringens `/api/agent`.
- **Modellerne og priserne i `src/lib/claude.ts` skal tjekkes** mod
  Anthropics prisliste. De bruges til loftet og tallet på skærmen; kontoens
  eget beløbsloft hos Anthropic er det sidste værn.
- **Budgettet i `/api/agent` bor i serverens hukommelse** og nulstilles ved
  genstart. På Vercel er det pr. instans. Det er et loft, ikke et regnskab.
- **`/api/agent` deler login med mennesker**, som `/api/context`. Den kan
  bruge penge, så den skal have sit eget token, før den åbnes for andre.
