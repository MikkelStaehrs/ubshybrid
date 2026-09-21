"use client";
import { Grid, MapControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasTexture, MathUtils, PerspectiveCamera, Spherical, SRGBColorSpace, TextureLoader, Vector3, type Texture } from "three";
import type { MapControls as MapControlsImpl } from "three-stdlib";
import { flowPath, halfExtent, type Layout } from "../lib/layout";
import type { AgentState } from "../lib/agents";
import type { OtLayout, OtSelection, PlacedIdea } from "../lib/ot";
import type { FloorplanImage, LineData, OtPhase } from "../lib/types";
import type { SceneTheme } from "../lib/useSceneTheme";
import { FlowRibbon } from "./FlowRibbon";
import { MachineMesh } from "./MachineMesh";
import type { SignalValue } from "../lib/live-source";
import { LiveLayer } from "./LiveLayer";
import { AgentLayer } from "./AgentLayer";
import { OtLayer } from "./OtLayer";

export type ViewMode = "perspective" | "top";

/** Hvilket lag kortet viser. Kameraet er det samme i begge. */
export type MapLayer = "maintenance" | "ot" | "live" | "agents";

interface SceneProps {
  data: LineData;
  layout: Layout;
  theme: SceneTheme;
  selectedId: string | null;
  hoveredId: string | null;
  lane: string | null;
  query: string;
  animateFlow: boolean;
  showLabels: boolean;
  view: ViewMode;
  /** Øges for at tvinge kameraet tilbage til oversigten. */
  resetToken: number;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  layer: MapLayer;
  /** OT-installationen, når linjen har en. */
  ot: OtLayout | null;
  otPhase: OtPhase;
  otSelected: OtSelection | null;
  otHovered: OtSelection | null;
  /** Sensoridéer brugeren har skitseret på maskinerne. */
  otIdeas: PlacedIdea[];
  /** Seneste måleværdier. Tom uden for Live-visningen. */
  liveValues: Map<string, SignalValue>;
  liveSelected: string | null;
  onLiveSelect: (signalId: string) => void;
  /** Agenterne med udledt status. Tom uden for Agents-visningen. */
  agents: AgentState[];
  agentSelected: string | null;
  onAgentSelect: (agentId: string | null) => void;
  onOtSelect: (sel: OtSelection | null) => void;
  onOtHover: (sel: OtSelection | null) => void;
}

function matchesQuery(m: { name: string; wIds: string[] }, q: string) {
  if (!q) return true;
  const s = q.toLowerCase().replace(/^w-?(id)?:?\s*/, "");
  return m.name.toLowerCase().includes(s) || m.wIds.some((w) => w.includes(s));
}

// ---------------------------------------------------------------------------
/** Det, MapControls tillader. Et mål uden for det kan aldrig nås. */
const CAM = { minDistance: 6, maxDistance: 260, maxPolar: Math.PI / 2.25 };

/** Længst et kameramål får lov at leve. Efter det slipper vi — uanset hvad. */
const GOAL_MS = 2500;

interface CameraGoal {
  pos: Vector3;
  target: Vector3;
  until: number;
}

function CameraRig({ layout, selectedId, view, resetToken }: Pick<SceneProps, "layout" | "selectedId" | "view" | "resetToken">) {
  const controls = useRef<MapControlsImpl>(null);
  const { camera, size, gl } = useThree();
  const goal = useRef<CameraGoal | null>(null);
  const booted = useRef(false);

  const finite = (v: Vector3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

  /**
   * Sæt et mål — men kun ét, kontrollerne kan nå. Afstand og hældning klemmes
   * til MapControls' grænser først. Ellers klemmer update() kameraet tilbage
   * hver frame, målet nås aldrig, og lerp'en overskriver brugerens zoom og pan
   * for evigt. Det var den lås, man ramte efter at have været inde på en maskine.
   */
  const aim = (g: { pos: Vector3; target: Vector3 } | null) => {
    if (!g || !finite(g.pos) || !finite(g.target)) { goal.current = null; return; }
    const offset = g.pos.clone().sub(g.target);
    const sph = new Spherical().setFromVector3(offset);
    sph.radius = MathUtils.clamp(sph.radius, CAM.minDistance, CAM.maxDistance);
    sph.phi = MathUtils.clamp(sph.phi, 0.0001, CAM.maxPolar);
    sph.makeSafe();
    goal.current = {
      pos: g.target.clone().add(offset.setFromSpherical(sph)),
      target: g.target.clone(),
      until: performance.now() + GOAL_MS,
    };
  };

  const overview = (mode: ViewMode) => {
    // Uden et lærred med mål bliver alt herunder NaN.
    if (size.width === 0 || size.height === 0) return null;
    const cam = camera as PerspectiveCamera;
    const { minX, maxX, minZ, maxZ } = layout.bounds;
    const vfov = MathUtils.degToRad(cam.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (size.width / size.height));
    const d = Math.max((maxX - minX) / (2 * Math.tan(hfov / 2)), (maxZ - minZ) / (2 * Math.tan(vfov / 2))) * 1.02;
    // Løft kortet lidt væk fra headeren.
    const target = new Vector3(...layout.center).add(new Vector3(0, 0, -(maxZ - minZ) * 0.06));
    const dir = mode === "top" ? new Vector3(0, 1, 0.0001) : new Vector3(0, 0.78, 0.62).normalize();
    return { pos: target.clone().add(dir.multiplyScalar(mode === "top" ? d : d * 0.95)), target };
  };

  // Første visning: sæt kameraet direkte.
  useEffect(() => {
    if (booted.current || !controls.current) return;
    const o = overview(view);
    if (!o) return;
    camera.position.copy(o.pos);
    controls.current.target.copy(o.target);
    controls.current.update();
    booted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!booted.current) return;
    aim(overview(view));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, resetToken]);

  useEffect(() => {
    if (!selectedId || !controls.current) return;
    const m = layout.byId.get(selectedId);
    if (!m) return;
    const target = new Vector3(m.pos[0], 1.2, m.pos[2]);
    const dir = camera.position.clone().sub(controls.current.target);
    // Står kameraet oven i målet, er der ingen retning at bevare — tag standardvinklen.
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.78, 0.62);
    aim({ pos: target.clone().add(dir.normalize().multiplyScalar(38)), target });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Brugeren tager over: enhver berøring af lærredet dropper målet. Lyttes
  // direkte på DOM'en, så det ikke afhænger af, at kontrollernes start-event
  // når frem.
  useEffect(() => {
    const el = gl.domElement;
    const drop = () => { goal.current = null; };
    const opts = { passive: true } as const;
    el.addEventListener("pointerdown", drop, opts);
    el.addEventListener("wheel", drop, opts);
    el.addEventListener("pointercancel", drop, opts);
    return () => {
      el.removeEventListener("pointerdown", drop);
      el.removeEventListener("wheel", drop);
      el.removeEventListener("pointercancel", drop);
    };
  }, [gl]);

  useFrame((_, dt) => {
    const g = goal.current;
    const c = controls.current;
    if (!g || !c) return;
    // Aldrig et mål, der får lov at låse kortet.
    if (performance.now() > g.until) { goal.current = null; return; }
    // Efter et faneskift kan dt være sekunder — så snapper vi frem for at springe.
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 4.5);
    camera.position.lerp(g.pos, k);
    c.target.lerp(g.target, k);
    c.update();
    if (camera.position.distanceTo(g.pos) < 0.05 && c.target.distanceTo(g.target) < 0.05) goal.current = null;
  });

  return (
    <MapControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={CAM.minDistance}
      maxDistance={CAM.maxDistance}
      maxPolarAngle={CAM.maxPolar}
      screenSpacePanning={false}
      onStart={() => (goal.current = null)}
    />
  );
}

// ---------------------------------------------------------------------------
function paintedText(text: string, color: string) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif";
  g.font = `600 88px ${family}`;
  g.textBaseline = "middle";
  g.fillText(text, 8, 68);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function FloorText({ text, color, position, size = 6 }: { text: string; color: string; position: [number, number, number]; size?: number }) {
  // Tegn igen når webfonten er indlæst.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => { document.fonts?.ready.then(() => setFontsReady(true)); }, []);
  const tex = useMemo(() => paintedText(text, color), [text, color, fontsReady]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={position}>
      <planeGeometry args={[size, size / 4]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} />
    </mesh>
  );
}

/**
 * Plantegningen lagt fladt ind under maskinerne. Billedets top er nord.
 * Indlæses uden Suspense, så resten af scenen tegnes med det samme.
 */
function FloorplanUnderlay({ plan }: { plan: FloorplanImage }) {
  const [tex, setTex] = useState<Texture | null>(null);

  useEffect(() => {
    let alive = true;
    new TextureLoader().load(plan.src, (t) => {
      t.colorSpace = SRGBColorSpace;
      if (alive) setTex(t);
      else t.dispose();
    });
    return () => { alive = false; };
  }, [plan.src]);
  useEffect(() => () => tex?.dispose(), [tex]);

  if (!tex) return null;
  return (
    <mesh
      // Rotationen om z lægges i tegningens eget plan, før den vippes ned.
      rotation={[-Math.PI / 2, 0, (-(plan.rot ?? 0) * Math.PI) / 180]}
      position={[plan.x + plan.width / 2, 0.008, plan.z + plan.depth / 2]}
    >
      <planeGeometry args={[plan.width, plan.depth]} />
      <meshBasicMaterial map={tex} transparent opacity={plan.opacity ?? 0.55} depthWrite={false} />
    </mesh>
  );
}

function Building({ layout, theme, data }: { layout: Layout; theme: SceneTheme; data: LineData }) {
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const w = maxX - minX, d = maxZ - minZ;
  const [cx, , cz] = layout.center;
  const wallH = 1.3, t = 0.35;
  const door = 5; // åbning ved indtaget

  const laneZones = data.lanes.map((lane) => {
    const ms = layout.machines.filter((m) => m.lane === lane);
    const x0 = Math.min(...ms.map((m) => m.pos[0] - halfExtent(m).x)) - 1.2;
    const x1 = Math.max(...ms.map((m) => m.pos[0] + halfExtent(m).x)) + 1.2;
    const z0 = Math.min(...ms.map((m) => m.pos[2] - halfExtent(m).z)) - 1.2;
    const z1 = Math.max(...ms.map((m) => m.pos[2] + halfExtent(m).z)) + 1.2;
    return { lane, x0, x1, z0, z1 };
  });

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.06, cz]} receiveShadow>
        <planeGeometry args={[w * 4, d * 8]} />
        <meshStandardMaterial color={theme["scene-bg"]} roughness={1} />
      </mesh>
      <mesh position={[cx, -0.03, cz]} receiveShadow>
        <boxGeometry args={[w, 0.06, d]} />
        <meshStandardMaterial color={theme.slab} roughness={0.95} />
      </mesh>
      <Grid
        position={[cx, 0.005, cz]}
        args={[w, d]}
        cellSize={1}
        sectionSize={5}
        cellThickness={0.5}
        sectionThickness={1}
        cellColor={theme.grid}
        sectionColor={theme.grid}
        fadeDistance={400}
        infiniteGrid={false}
      />
      {data.line.positionMode === "floorplan" && data.line.floorplan && (
        <FloorplanUnderlay plan={data.line.floorplan} />
      )}
      {/* Afskårne vægge — taget er fjernet */}
      <mesh castShadow receiveShadow position={[cx, wallH / 2, minZ]}><boxGeometry args={[w, wallH, t]} /><meshStandardMaterial color={theme.wall} /></mesh>
      <mesh castShadow receiveShadow position={[cx, wallH / 2, maxZ]}><boxGeometry args={[w, wallH, t]} /><meshStandardMaterial color={theme.wall} /></mesh>
      <mesh castShadow receiveShadow position={[maxX, wallH / 2, cz]}><boxGeometry args={[t, wallH, d]} /><meshStandardMaterial color={theme.wall} /></mesh>
      <mesh castShadow receiveShadow position={[minX, wallH / 2, minZ + (d - door) / 4]}><boxGeometry args={[t, wallH, (d - door) / 2]} /><meshStandardMaterial color={theme.wall} /></mesh>
      <mesh castShadow receiveShadow position={[minX, wallH / 2, maxZ - (d - door) / 4]}><boxGeometry args={[t, wallH, (d - door) / 2]} /><meshStandardMaterial color={theme.wall} /></mesh>

      {laneZones.map((z) => (
        <group key={z.lane}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(z.x0 + z.x1) / 2, 0.012, (z.z0 + z.z1) / 2]}>
            <planeGeometry args={[z.x1 - z.x0, z.z1 - z.z0]} />
            <meshBasicMaterial color={theme.flow} transparent opacity={theme.dark ? 0.07 : 0.08} depthWrite={false} />
          </mesh>
          <FloorText
            text={`SPOR ${z.lane}`}
            color={theme.flow}
            size={7}
            position={[z.x0 + 3.6, 0.02, z.z0 + z.z1 > 0 ? z.z1 + 1.3 : z.z0 - 1.3]}
          />
        </group>
      ))}
      <FloorText text={data.line.name.toUpperCase()} color={theme.flow} size={10} position={[minX + 6.5, 0.02, minZ + 2.4]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
export function Scene(p: SceneProps) {
  const { layout, theme, data } = p;
  const selected = p.selectedId ? layout.byId.get(p.selectedId) : undefined;
  const related = new Set(selected ? [...selected.upstream, ...selected.downstream] : []);
  // I OT-visningen træder maskiner og materialeflow tilbage, så sensorer,
  // skab og kabler er det man ser. I Live står anlægget i normale farver —
  // det er tallene ovenpå, der er nye.
  const ot = p.layer === "ot";
  const live = p.layer === "live";
  const agentsView = p.layer === "agents";
  // Både OT og Agents toner anlægget ned — laget ovenpå er det, man skal se.
  const faded = ot || agentsView;

  // Pilene bevæger sig kun, hvor et flowsignal siger, at der løber noget.
  // Et signal i fejl eller uden kilde ved ingenting og får intet til at rulle.
  const flowing = new Set<string>();
  if (live && p.ot) {
    for (const sensor of p.ot.sensors) {
      if (sensor.type !== "Materialestrøm" || !sensor.machine) continue;
      const v = p.liveValues.get(sensor.id);
      // Over nulpunktet på sløjfen = der er materiale i maskinen.
      if (!v || v.quality === "no-source" || v.quality === "fault" || !(v.raw > 4.5)) continue;
      for (const e of data.edges) {
        if (e.from === sensor.machine.id || e.to === sensor.machine.id) flowing.add(e.id);
      }
    }
  }
  const visible = (m: { lane: string | null; name: string; wIds: string[] }) =>
    (!p.lane || m.lane === p.lane || m.lane === null) && matchesQuery(m, p.query);

  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const span = Math.max(maxX - minX, maxZ - minZ);

  return (
    <>
      <color attach="background" args={[theme["scene-bg"]]} />
      <hemisphereLight args={[theme.dark ? "#9fb3c8" : "#ffffff", theme.slab, theme.dark ? 0.7 : 1.1]} />
      <ambientLight intensity={theme.dark ? 0.25 : 0.35} />
      <directionalLight
        castShadow
        position={[layout.center[0] - span * 0.3, span * 0.7, layout.center[2] + span * 0.35]}
        intensity={theme.dark ? 1.4 : 2.1}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-span * 0.7}
        shadow-camera-right={span * 0.7}
        shadow-camera-top={span * 0.7}
        shadow-camera-bottom={-span * 0.7}
        shadow-camera-near={1}
        shadow-camera-far={span * 3}
      >
        <object3D attach="target" position={layout.center} />
      </directionalLight>

      <Building layout={layout} theme={theme} data={data} />

      {data.edges.map((e) => {
        const a = layout.byId.get(e.from);
        const b = layout.byId.get(e.to);
        if (!a || !b) return null;
        const hot = !!selected && (e.from === selected.id || e.to === selected.id);
        const shown = visible(a) && visible(b);
        return (
          <FlowRibbon
            key={e.id}
            points={flowPath(a, b)}
            color={hot ? theme.accent : e.inferred ? theme.warn : theme.flow}
            dashed={e.inferred}
            width={hot ? 1.0 : 0.85}
            y={hot ? 0.06 : 0.04}
            animate={live ? flowing.has(e.id) : p.animateFlow}
            opacity={faded ? 0.12 : shown ? 1 : 0.15}
          />
        );
      })}

      {layout.machines.map((m) => (
        <MachineMesh
          key={m.id}
          m={m}
          theme={theme}
          selected={m.id === p.selectedId}
          hovered={m.id === p.hoveredId}
          related={related.has(m.id)}
          dimmed={faded || !visible(m)}
          showLabel={p.showLabels}
          onSelect={p.onSelect}
          onHover={p.onHover}
        />
      ))}

      {agentsView && (
        <AgentLayer
          states={p.agents}
          ot={p.ot}
          theme={theme}
          selectedId={p.agentSelected}
          showLabels={p.showLabels}
          onSelect={p.onAgentSelect}
        />
      )}

      {live && p.ot && (
        <LiveLayer
          sensors={p.ot.sensors}
          values={p.liveValues}
          theme={theme}
          selectedId={p.liveSelected}
          onSelect={p.onLiveSelect}
        />
      )}

      {ot && p.ot && (
        <OtLayer
          ot={p.ot}
          theme={theme}
          phase={p.otPhase}
          showLabels={p.showLabels}
          selected={p.otSelected}
          hovered={p.otHovered}
          ideas={p.otIdeas}
          onSelect={p.onOtSelect}
          onHover={p.onOtHover}
        />
      )}

      <CameraRig layout={layout} selectedId={p.selectedId} view={p.view} resetToken={p.resetToken} />
    </>
  );
}
