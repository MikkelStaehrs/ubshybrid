"use client";
import { Html, Line, MapControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { MathUtils, type PerspectiveCamera } from "three";
import { FORBINDELSER, UTEGNEDE } from "../../data/fabrik";
import { INSTRUMENT_NAVN, PROEVESTEDER, type Proevested } from "../../data/proevesteder";
import { SITE } from "../lib/context";
import { fabrikModel, paaGrunden, SLAGS_NAVN, type Blok, type Bue, type FabrikModel, type ForbindelseSlags, type ProeveMaerke } from "../lib/fabrik";
import type { Layout } from "../lib/layout";
import { FABRIK_ID, LINES, type LineOption } from "../lib/lines";
import { isDone, layoutOt, otLayerFor } from "../lib/ot";
import type { MachineKind } from "../lib/types";
import { useSceneTheme, type SceneTheme } from "../lib/useSceneTheme";
import { LinjeVaelger } from "./LinjeVaelger";
import { FloorText } from "./Scene";

const SLAGS: ForbindelseSlags[] = ["materiale", "proever", "data", "mennesker"];

type Farve = Exclude<keyof SceneTheme, "dark">;

/** Hver slags forbindelse har sin farve — den samme som tingen på kortet. */
const FARVE: Record<ForbindelseSlags, Farve> = {
  materiale: "flow",
  proever: "m-analysis",
  data: "ot-cabinet",
  mennesker: "m-person",
};

const MASKINFARVE: Record<MachineKind, Farve> = {
  intake: "m-intake", elevator: "m-elevator", distributor: "m-distributor",
  process: "m-process", analysis: "m-analysis", person: "m-person",
};

/** Det rigtige OT-lag — ikke fremskrivningen. Oversigten viser anlægget, som det står. */
const otFor = (id: string, layout: Layout) => {
  const layer = otLayerFor(id);
  return layer ? layoutOt(layer, layout, id) : null;
};

/**
 * Hele fabrikken på én grund.
 *
 * Hver linje og hvert rum står som sin egen blok med maskinerne i; det, der
 * ikke er tegnet endnu, står stiplet med sit navn. Forbindelserne mellem dem
 * er buer: fuld streg for det, der findes, stiplet for det, der ikke gør.
 * Et klik på en tegnet blok åbner den på kortet.
 */
export function FabrikOversigt({ lines, rooms, onSelectLine }: {
  lines: LineOption[];
  rooms: LineOption[];
  onSelectLine: (id: string) => void;
}) {
  const theme = useSceneTheme();
  const model = useMemo(() => fabrikModel({
    linjer: LINES,
    rum: new Set(rooms.map((r) => r.id)),
    utegnede: UTEGNEDE,
    forbindelser: FORBINDELSER,
    proevesteder: PROEVESTEDER,
    ot: otFor,
  }), [rooms]);
  const [vis, setVis] = useState<Record<ForbindelseSlags, boolean>>({ materiale: true, proever: true, data: true, mennesker: true });
  const [valgt, setValgt] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  /** Valgte prøvesteder — fra et mærkat eller fra listen. De lyser op på kortet. */
  const [valgteSteder, setValgteSteder] = useState<string[]>([]);
  const vaelgSteder = (ids: string[]) => { setValgt(null); setValgteSteder((f) => (f.join() === ids.join() ? [] : ids)); };

  const tegnede = model.blokke.filter((b) => b.tegnet && b.slags !== "rack").length;
  const utegnede = model.blokke.filter((b) => !b.tegnet).length;
  // Én forbindelse kan være flere buer — én fra hver maskine. En prøvebue er
  // allerede samlet pr. instrument og er sin egen.
  const forbindelse = (b: Bue) => (b.steder ? b.id : b.id.split(":").slice(0, b.udledt ? 2 : 1).join(":"));
  const forbindelser = [...new Map(model.buer.map((b) => [forbindelse(b), b])).values()];
  // Prøverne tælles i prøvesteder — en bue samler mange.
  const antal = (s: ForbindelseSlags) => (s === "proever" ? PROEVESTEDER.length : forbindelser.filter((b) => b.slags === s).length);
  const lyser = (b: Bue) => valgt === forbindelse(b) || (!!b.steder && b.steder.some((id) => valgteSteder.includes(id)));
  const personer = model.blokke.reduce((n, b) => n + (b.layout?.machines.filter((m) => m.kind === "person").length ?? 0), 0);

  return (
    <div className="fm-root is-fabrik">
      <div className="fm-canvas" data-hovering={over ? "" : undefined}>
        {theme && (
          <Canvas dpr={[1, 2]} camera={{ fov: 30, near: 0.5, far: 4000, position: [0, 120, 120] }} onPointerMissed={() => { setValgt(null); setValgteSteder([]); }}>
            <Grund model={model} theme={theme} />
            {model.blokke.map((b) => (
              <BlokMesh
                key={b.id}
                blok={b}
                theme={theme}
                over={over === b.id}
                onOver={(ja) => setOver(ja && b.tegnet && b.slags !== "rack" ? b.id : null)}
                onVaelg={() => { if (b.tegnet && b.slags !== "rack") onSelectLine(b.id); }}
              />
            ))}
            {model.buer.filter((b) => vis[b.slags]).map((b) => (
              // En antaget forbindelse har de antagne pilses farve, som på kortet.
              <BueMesh key={b.id} bue={b} farve={theme[b.antaget ? "warn" : FARVE[b.slags]]} valgt={lyser(b)} />
            ))}
            {vis.proever && model.proever.map((mk) => (
              <ProeveMaerkat
                key={mk.id}
                mk={mk}
                valgt={mk.steder.some((st) => valgteSteder.includes(st.id))}
                onVaelg={() => vaelgSteder(mk.steder.map((st) => st.id))}
              />
            ))}
            <Kamera model={model} />
          </Canvas>
        )}
      </div>

      <header className="fm-top">
        <div className="fm-title">
          <div className="fm-eyebrow">
            {SITE} · <LinjeVaelger vaerdi={FABRIK_ID} lines={lines} rooms={rooms} onVaelg={onSelectLine} />
          </div>
          <h1>Hele fabrikken</h1>
          <div className="fm-meta">
            <span>{tegnede} tegnet</span>
            {utegnede > 0 && <span>{utegnede} ikke tegnet</span>}
            <span>{forbindelser.length} forbindelser</span>
            {personer > 0 && <span>{personer === 1 ? "1 person" : `${personer} personer`}</span>}
          </div>
        </div>
      </header>

      <aside className="fm-legend fb-panel" aria-label="Forbindelser">
        <ul className="fb-slags">
          {SLAGS.map((s) => (
            <li key={s}>
              <label>
                <input type="checkbox" checked={vis[s]} onChange={() => setVis((v) => ({ ...v, [s]: !v[s] }))} />
                <span className={`fb-streg s-${s}`} />
                {SLAGS_NAVN[s]}
                <span className="fm-mono">{antal(s)}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="fb-noegle">
          <span className="fb-streg" /> findes · <span className="fb-streg is-stiplet" /> ikke endnu · <span className="fb-streg is-antaget" /> antaget
        </p>
        <ul className="fb-liste">
          {forbindelser.filter((b) => vis[b.slags]).map((b) => {
            const id = forbindelse(b);
            const navn = (d: string) => model.blokke.find((x) => x.id === d)?.navn ?? d;
            return (
              <li key={id}>
                <button
                  type="button"
                  className={valgt === id || lyser(b) ? "is-valgt" : undefined}
                  onClick={() => { setValgteSteder(b.steder && valgt !== id ? b.steder : []); setValgt(valgt === id ? null : id); }}
                >
                  <span className={`fb-streg s-${b.slags}${b.antaget ? " is-antaget" : b.findes ? "" : " is-stiplet"}`} />
                  <span className="fb-navn">{b.navn}{b.antaget && <em className="fb-antaget">Antaget</em>}</span>
                  <span className="fb-hvor">{navn(b.fraDel)} → {navn(b.tilDel)}</span>
                  {valgt === id && b.note && <span className="fb-note">{b.note}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {vis.proever && <ProeveListe valgte={valgteSteder} onVaelg={(id) => vaelgSteder([id])} />}
        {model.fejl.length > 0 && (
          <div className="fb-fejl" role="alert">
            {model.fejl.map((f) => <p key={f}>{f}</p>)}
          </div>
        )}
        {utegnede === 0 && (
          <p>Afdelinger uden tegning står her, når de er skrevet i <span className="fm-mono">data/fabrik.ts</span>.</p>
        )}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Et tomt felt siger det selv — det gættes ikke. */
const IKKE_UDFYLDT = "Ikke udfyldt";

/**
 * Prøverne på én maskine. Sammenklappet er det et lille mærke: antallet —
 * eller operationsnummeret, når der kun er ét. Valgt folder det ud med
 * maskinen og hvert prøvested. Mærket er HTML, så det kan læses i enhver
 * zoom, og lille nok til, at syv på én linje ikke dækker hinanden.
 */
function ProeveMaerkat({ mk, valgt, onVaelg }: { mk: ProeveMaerke; valgt: boolean; onVaelg: () => void }) {
  const ista = mk.steder.some((st) => st.slags === "ista");
  const en = mk.steder.length === 1 ? mk.steder[0] : null;
  const titel = `${mk.maskine}: ${mk.steder.map((st) => `${st.operationsnr ?? IKKE_UDFYLDT} ${st.navn}`).join(", ")}`;
  // Html sætter kun z-index, når mærket flytter sig på skærmen. Nøglen
  // monterer det forfra, når det vælges, så det valgte ligger øverst.
  return (
    <Html key={valgt ? "valgt" : "lukket"} position={[mk.p[0], mk.h + 1.2, mk.p[1]]} center zIndexRange={valgt ? [40, 30] : [20, 0]}>
      <button
        type="button"
        className={`fb-pr${valgt ? " is-valgt" : ""}${ista ? " is-ista" : ""}`}
        title={titel}
        aria-label={titel}
        onClick={onVaelg}
      >
        {valgt ? (
          <>
            <b>{mk.maskine}</b>
            <span className="fb-pr-liste">
              {mk.steder.map((st) => (
                <span key={st.id}>
                  <i>{st.operationsnr ?? "–"}</i>
                  {/* Maskinen står allerede øverst; tilbage er strømmen. */}
                  <span>{st.navn.startsWith(`${mk.maskine} `) ? st.navn.slice(mk.maskine.length + 1) : st.navn}</span>
                </span>
              ))}
            </span>
          </>
        ) : (
          <span className="fb-pr-tal">{en?.operationsnr ?? mk.steder.length}</span>
        )}
      </button>
    </Html>
  );
}

/** Prøvestederne i panelet, delt i proces og ISTA. Det valgte folder formål og hyppighed ud. */
function ProeveListe({ valgte, onVaelg }: { valgte: string[]; onVaelg: (id: string) => void }) {
  const grupper: { slags: Proevested["slags"]; navn: string }[] = [
    { slags: "proces", navn: "Procesprøver" },
    { slags: "ista", navn: "ISTA-prøver" },
  ];
  return (
    <div className="fb-proever">
      {grupper.map((g) => {
        const liste = PROEVESTEDER.filter((st) => st.slags === g.slags);
        return (
          <section key={g.slags}>
            <h3>{g.navn} <span className="fm-mono">{liste.length}</span></h3>
            {liste.length === 0 ? <p>Ikke sagt endnu.</p> : (
              <ul>
                {liste.map((st) => {
                  const aaben = valgte.length === 1 && valgte[0] === st.id;
                  return (
                    <li key={st.id}>
                      <button type="button" className={valgte.includes(st.id) ? "is-valgt" : undefined} onClick={() => onVaelg(st.id)}>
                        <span className={`fb-opnr${st.operationsnr ? "" : " is-tom"}`}>{st.operationsnr ?? IKKE_UDFYLDT}</span>
                        <span className="fb-navn">{st.navn}</span>
                        <span className="fb-hvor">{INSTRUMENT_NAVN[st.analyse.instrument]}</span>
                        {aaben && (
                          <span className="fb-note">
                            {st.formaal}
                            <br />Hyppighed: {st.hyppighed ?? IKKE_UDFYLDT}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Grund({ model, theme }: { model: FabrikModel; theme: SceneTheme }) {
  const g = model.graenser;
  const cx = (g.minX + g.maxX) / 2;
  const cz = (g.minZ + g.maxZ) / 2;
  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[cx + 60, 120, cz + 40]} intensity={1.2} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.06, cz]}>
        <planeGeometry args={[(g.maxX - g.minX) * 3 + 200, (g.maxZ - g.minZ) * 3 + 200]} />
        <meshStandardMaterial color={theme["scene-bg"]} roughness={1} />
      </mesh>
    </>
  );
}

/** Blokkens omrids: fuld streg for det, der er tegnet, stiplet for det, der ikke er. */
function BlokMesh({ blok, theme, over, onOver, onVaelg }: {
  blok: Blok;
  theme: SceneTheme;
  over: boolean;
  onOver: (ja: boolean) => void;
  onVaelg: () => void;
}) {
  const w = blok.x1 - blok.x0;
  const d = blok.z1 - blok.z0;
  const cx = (blok.x0 + blok.x1) / 2;
  const cz = (blok.z0 + blok.z1) / 2;
  // Faste punkter: en ny liste ved hver tegning får drei's Line til at
  // bygge materialet om — og shaderen skal kompileres forfra.
  const kant = useMemo<[number, number, number][]>(() => [
    [blok.x0, 0.05, blok.z0], [blok.x1, 0.05, blok.z0], [blok.x1, 0.05, blok.z1], [blok.x0, 0.05, blok.z1], [blok.x0, 0.05, blok.z0],
  ], [blok.x0, blok.x1, blok.z0, blok.z1]);
  const findes = blok.slags === "rack" ? isDone(blok.status ?? "missing") : blok.tegnet;
  const farve = blok.slags === "rack" ? theme["ot-cabinet"] : theme.wall;
  // Nummeret står ved navnet — det er rækkefølgen i produktionen.
  const titel = `${blok.nr !== null ? `${blok.nr} · ` : ""}${blok.navn.toUpperCase()}`;
  const skrift = Math.min(30, Math.max(12, w / 3.5));
  return (
    <group>
      {blok.tegnet && blok.slags !== "rack" && (
        <mesh
          position={[cx, 0, cz]}
          onPointerOver={(e) => { e.stopPropagation(); onOver(true); }}
          onPointerOut={() => onOver(false)}
          onClick={(e) => { e.stopPropagation(); onVaelg(); }}
        >
          <boxGeometry args={[w, 0.06, d]} />
          <meshStandardMaterial color={over ? theme.floor : theme.slab} roughness={0.95} />
        </mesh>
      )}
      {blok.slags === "rack" && (
        <mesh position={[cx, 1, cz]}>
          <boxGeometry args={[w * 0.6, 2, d * 0.6]} />
          <meshStandardMaterial color={farve} transparent opacity={findes ? 1 : 0.35} />
        </mesh>
      )}
      <Line points={kant} color={farve} lineWidth={findes ? 1.6 : 1.2} dashed={!findes} dashSize={1.2} gapSize={0.9} />
      {blok.tegnet || blok.overLinjerne
        ? <FloorText text={titel} color={theme.flow} size={skrift} position={[blok.x0 + skrift / 2 + 1, 0.06, blok.z0 - skrift / 8 - 1]} />
        : (
          // Uden maskiner er navnet det eneste i blokken — så står det midt i den.
          <>
            <FloorText text={titel} color={theme.flow} size={Math.min(w * 0.9, 30)} position={[cx, 0.06, cz - 2]} />
            <FloorText text={blok.valgfri ? "IKKE ALTID MED" : "IKKE TEGNET"} color={theme.flow} size={Math.min(w * 0.6, 18)} position={[cx, 0.06, cz + 4]} />
          </>
        )}
      {blok.layout?.machines.map((m) => {
        const p = paaGrunden(blok, m);
        return (
          <mesh key={m.id} position={[p.x, m.size.h / 2, p.z]} rotation={[0, m.rotY, 0]}>
            <boxGeometry args={[m.size.x, m.size.h, m.size.z]} />
            <meshStandardMaterial color={theme[MASKINFARVE[m.kind]]} roughness={0.8} />
          </mesh>
        );
      })}
    </group>
  );
}

/** En forbindelse som en bue over grunden. Jo længere, jo højere. */
function BueMesh({ bue, farve, valgt }: { bue: Bue; farve: string; valgt: boolean }) {
  const punkter = useMemo<[number, number, number][]>(() => {
    const [ax, az] = bue.fra;
    const [bx, bz] = bue.til;
    const laengde = Math.hypot(bx - ax, bz - az);
    const top = Math.max(4, laengde * 0.22);
    const ud: [number, number, number][] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      ud.push([ax + (bx - ax) * t, 0.6 + 4 * top * t * (1 - t), az + (bz - az) * t]);
    }
    return ud;
  }, [bue.fra, bue.til]);
  return <Line points={punkter} color={farve} lineWidth={valgt ? 3.2 : 1.8} dashed={!bue.findes} dashSize={1.4} gapSize={1} transparent opacity={valgt ? 1 : 0.85} />;
}

/** Panelet til højre, i pixels. Kameraet stiller grunden i resten. */
const PANEL_PX = 360;

/** Hele grunden i billedet ved start; derefter er kameraet brugerens. */
function Kamera({ model }: { model: FabrikModel }) {
  const { camera, size } = useThree();
  const g = model.graenser;
  const cz = (g.minZ + g.maxZ) / 2;
  const panel = size.width > 900 ? PANEL_PX : 0;
  const cam = camera as PerspectiveCamera;
  const vfov = MathUtils.degToRad(cam.fov);
  const hfov = size.height > 0 ? 2 * Math.atan(Math.tan(vfov / 2) * (size.width / size.height)) : vfov;
  // Den bredde, grunden har at være i, og hvor langt væk kameraet skal stå.
  const fri = size.width > 0 ? (size.width - panel) / size.width : 1;
  const afstand = Math.max((g.maxX - g.minX) / (2 * Math.tan(hfov / 2) * fri), (g.maxZ - g.minZ) / (2 * Math.tan(vfov / 2))) * 1.15;
  // Målet flyttes til højre, så grunden står midt i det fri felt til venstre.
  const skub = size.width > 0 ? (panel / 2 / size.width) * 2 * afstand * Math.tan(hfov / 2) : 0;
  const cx = (g.minX + g.maxX) / 2 + skub;
  useEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    cam.position.set(cx, afstand * 0.78, cz + afstand * 0.62);
    cam.lookAt(cx, 0, cz);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width > 0]);
  return (
    <MapControls
      makeDefault
      target={[cx, 0, cz]}
      enableDamping
      dampingFactor={0.12}
      minDistance={10}
      maxDistance={900}
      maxPolarAngle={Math.PI / 2.25}
      screenSpacePanning={false}
    />
  );
}
