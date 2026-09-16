# UBS Fabrikskort

Et interaktivt 3D-kort over produktionslinjerne. Fabrikken ses oppefra, uden tag. Første linje er **Linje 2 – Sliberiet**.

## Kom i gang

```bash
npm install
npm run dev          # http://localhost:3000
```

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

Parseren læser:
- **Label:** Maskinnavn på første linje og `W-ID:611` på næste. Flere id'er skrives `W-ID:793/794/795`.
- **Pile:** Materialeflowet. Løse pile og manglende pile mellem maskiner, der står lige under hinanden, bliver *antaget* og vist med orange stiplet linje.
- **Edit Data (Ctrl+M):** `navn`, `wid`, `maskintype` og `spor` styrer selve kortet. `producent`, `model`, `aar`, `proces`, `kapacitet`, `dim`, `ot` og `noter` vises i maskinpanelet. `x`, `z`, `rot`, `bredde`, `dybde` og `hoejde` er målfast placering (se nedenfor). Andre felter bliver også gemt i data.
- **Spor:** Feltet `spor`. Mangler det, gættes sporet ud fra navnets endelse (S/N) efter en fordeler.

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

Kun `x` og `z` er nødvendige. Kør derefter:

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
| `src/components/` | 3D-scene (React Three Fiber), maskinpanel, styles |
| `scripts/build-preview.ts` | `npm run preview` → én selvstændig HTML-fil til deling |

## Kendte begrænsninger

- Linje 2 – Sliberiet er stadig **skematisk**: placeringerne kommer fra flowdiagrammet og er ikke målfaste. Datamodellen er klar til plantegningen (se *Målfast placering*), men koordinaterne er ikke målt op endnu.
- Maskinformerne er illustrative og vælges ud fra maskinens navn i `MachineMesh.tsx`.
