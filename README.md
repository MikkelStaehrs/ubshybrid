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
3. Registrér linjen i `src/lib/lines.ts`.

Parseren læser:
- **Label:** Maskinnavn på første linje og `W-ID:611` på næste. Flere id'er skrives `W-ID:793/794/795`.
- **Pile:** Materialeflowet. Løse pile og manglende pile mellem maskiner, der står lige under hinanden, bliver *antaget* og vist med orange stiplet linje.
- **Edit Data (Ctrl+M):** `navn`, `wid`, `maskintype` og `spor` styrer selve kortet. `producent`, `model`, `aar`, `proces`, `kapacitet`, `dim`, `ot` og `noter` vises i maskinpanelet. Andre felter bliver også gemt i data.
- **Spor:** Feltet `spor`. Mangler det, gættes sporet ud fra navnets endelse (S/N) efter en fordeler.

## Struktur

| Sti | Indhold |
| --- | --- |
| `src/lib/drawio.ts` | Draw.io → `LineData` (virker også i browseren) |
| `src/lib/types.ts` | Datamodellen (klar til at flytte til MSSQL) |
| `src/lib/layout.ts` | Tegning → meter, maskinstørrelser, flowruter |
| `src/components/` | 3D-scene (React Three Fiber), maskinpanel, styles |
| `scripts/build-preview.ts` | `npm run preview` → én selvstændig HTML-fil til deling |

## Kendte begrænsninger

- Placeringerne kommer fra flowdiagrammet og er **ikke målfaste**. Når vi har plantegningen, sættes `positionMode: "floorplan"` med rigtige koordinater.
- Maskinformerne er illustrative og vælges ud fra maskinens navn i `MachineMesh.tsx`.
