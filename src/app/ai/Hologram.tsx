"use client";
import { Html, Line, PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, ChromaticAberration, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry,
  EdgesGeometry, Euler, InstancedMesh, Matrix4, Object3D, Quaternion, RingGeometry,
  ShaderMaterial, SphereGeometry, Vector2, Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildHologram, flowEdgesFor, PUNKT_BUDGET, type HologramData } from "../../lib/hologram";
import { KOERER_OVER_PCT } from "../../lib/flow";
import { layoutLine, type Layout } from "../../lib/layout";
import { formFor, formTop } from "../../lib/machine-form";
import type { OtLayout } from "../../lib/ot";
import type { MaskinLaesning, TelemetriBillede } from "../../lib/telemetri";
import type { LineData } from "../../lib/types";

/**
 * Fabrikken som hologram.
 *
 * Alt der lyser eller bevæger sig, svarer til en tilstand:
 *   - Punkternes farve er maskinens tilstand: hvid kører, rød står, rav er
 *     i test, grå tåge ved vi intet om. En maskine, der kører, ånder svagt.
 *   - Materialestrømmen flyder kun mellem maskiner, der begge kører, og med
 *     en fart, der følger flowet ved indgangen.
 *   - Mærkaterne viser maskinens egne tal.
 *   - Skanningen løber kun, når Kædevagten kører.
 *
 * Kameraets tur er synsvinkel, ikke data. Den går efter alarmer først.
 */

/**
 * Kvalitetstrin. Scenen starter øverst og skruer ned, hvis maskinen ikke kan
 * følge med — opløsningen først, så punkterne, så de dyreste effekter. Det
 * ser næsten ens ud på hvert trin; det er arbejdet pr. frame, der falder.
 *
 *   3  op til 1,5x opløsning, alle punkter, alle effekter
 *   2  1x opløsning
 *   1  halvt så mange punkter
 *   0  kun bloom og vignet
 */
type Kvalitet = 0 | 1 | 2 | 3;
const DPR: Record<Kvalitet, number> = { 3: 1.5, 2: 1, 1: 1, 0: 1 };

/** Højst så mange maskiner. Uniform-arrays i shaderen har en fast længde. */
const MAX_MASKINER = 32;

/**
 * Maskinens tilstand, som shaderne kender den.
 *   0 ukendt · 1 test · 2 kører · 3 står · 4 alarm · 5 stoppet af agenten
 *
 * Et styret stop er rav, ikke rødt: maskinen står på en beslutning, ikke på
 * en fejl. Kun den maskine, der var årsagen, er rød.
 */
type Kode = 0 | 1 | 2 | 3 | 4 | 5;

const PALET = /* glsl */ `
  vec3 farve(float s) {
    if (s > 4.5) return vec3(1.00, 0.66, 0.22);  // stoppet af agenten
    if (s > 3.5) return vec3(1.00, 0.30, 0.24);  // alarm
    if (s > 2.5) return vec3(0.95, 0.36, 0.28);  // står
    if (s > 1.5) return vec3(0.78, 0.95, 0.90);  // kører: kølig hvid
    if (s > 0.5) return vec3(1.00, 0.72, 0.28);  // test: rav
    return vec3(0.30, 0.38, 0.36);               // ukendt: tåge
  }
`;

// ---------------------------------------------------------------------------
// Punktskyen

const CLOUD_VERT = /* glsl */ `
  attribute float aBright;
  attribute float aMaskine;
  uniform float uSize;
  uniform float uTime;
  uniform float uState[${MAX_MASKINER}];
  uniform float uFadeNear;
  uniform float uFadeFar;
  varying vec3 vCol;
  varying float vAlpha;
  ${PALET}

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = -mv.z;
    float s = aMaskine < 0.0 ? 0.0 : uState[int(aMaskine)];
    float lys = aBright;

    // Kører den, ånder den. Står den, står den stille. Alarmen banker.
    if (s > 1.5 && s < 2.5) lys *= 0.82 + 0.18 * sin(uTime * 1.3 + aMaskine * 1.7);
    if (s > 3.5 && s < 4.5) lys *= 0.55 + 0.45 * (0.5 + 0.5 * sin(uTime * 6.0));
    // Står den på en beslutning, er den dæmpet og stille — ingen ånde, ingen alarm.
    if (s > 4.5) lys *= 0.7;
    if (aMaskine < 0.0) lys *= 0.9;

    gl_PointSize = uSize * (0.75 + 0.25 * aBright) / max(dist, 0.1);
    vAlpha = lys * (1.0 - smoothstep(uFadeNear, uFadeFar, dist));
    vCol = aMaskine < 0.0 ? vec3(0.34, 0.44, 0.42) : farve(s);
    gl_Position = projectionMatrix * mv;
  }
`;

const CLOUD_FRAG = /* glsl */ `
  precision mediump float;
  uniform float uGain;
  varying vec3 vCol;
  varying float vAlpha;

  void main() {
    // Blød kerne. Additiv blanding gør resten — tætte områder lyser selv.
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = dot(d, d);
    if (r > 0.25) discard;
    float a = smoothstep(0.25, 0.0, r);
    a = a * a;
    gl_FragColor = vec4(vCol * vAlpha * uGain, a * vAlpha * uGain);
  }
`;

function Cloud({ data, state, still }: { data: HologramData; state: Float32Array; still: boolean }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(data.positions, 3));
    g.setAttribute("aBright", new BufferAttribute(data.bright, 1));
    g.setAttribute("aMaskine", new BufferAttribute(data.maskine, 1));
    return g;
  }, [data]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        uniforms: {
          uSize: { value: 300 },
          uTime: { value: 0 },
          uGain: { value: 0.62 },
          uState: { value: new Float32Array(MAX_MASKINER) },
          uFadeNear: { value: 50 },
          uFadeFar: { value: 200 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  );

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = still ? 0 : clock.elapsedTime;
    (material.uniforms.uState.value as Float32Array).set(state);
  });

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

// ---------------------------------------------------------------------------
// Silhuetterne: skarpe kanter fra den samme form, kortet tegner efter

const LINE_VERT = /* glsl */ `
  attribute float aMaskine;
  uniform float uState[${MAX_MASKINER}];
  uniform float uTime;
  varying vec3 vCol;
  varying float vAlpha;
  ${PALET}
  void main() {
    float s = uState[int(aMaskine)];
    vCol = farve(s);
    // Det, vi intet ved om, er kun en antydning. Alarmen banker.
    vAlpha = s < 0.5 ? 0.16 : s > 4.5 ? 0.45 : s > 3.5 ? 0.5 + 0.5 * sin(uTime * 6.0) : 0.55;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LINE_FRAG = /* glsl */ `
  precision mediump float;
  varying vec3 vCol;
  varying float vAlpha;
  void main() { gl_FragColor = vec4(vCol * vAlpha, vAlpha); }
`;

function Silhouetter({ layout, ids, state, still }: {
  layout: Layout;
  ids: string[];
  state: Float32Array;
  still: boolean;
}) {
  const geometry = useMemo(() => {
    const dele: BufferGeometry[] = [];
    const q = new Quaternion();
    const e = new Euler();
    const at = new Vector3();
    const en = new Vector3(1, 1, 1);
    ids.forEach((id, i) => {
      const m = layout.byId.get(id);
      if (!m) return;
      const verden = new Matrix4().makeTranslation(m.pos[0], 0, m.pos[2])
        .multiply(new Matrix4().makeRotationY(m.rotY));
      for (const p of formFor({ kind: m.kind, name: m.name, size: m.size, wIdCount: m.wIds.length })) {
        const g = p.form === "box" ? new BoxGeometry(...p.size)
          : p.form === "cylinder" ? new CylinderGeometry(p.rTop, p.rBottom, p.h, p.sides)
            : new SphereGeometry(p.r, 10, 6);
        const kant = new EdgesGeometry(g, 24);
        g.dispose();
        const rot = p.form === "sphere" ? [0, 0, 0] : (p.rot ?? [0, 0, 0]);
        // Samme rækkefølge som punkterne samples i: z, så x, så y.
        e.set(rot[0], rot[1], rot[2], "YXZ");
        q.setFromEuler(e);
        at.set(...p.at);
        kant.applyMatrix4(verden.clone().multiply(new Matrix4().compose(at, q, en)));
        const n = kant.getAttribute("position").count;
        kant.setAttribute("aMaskine", new BufferAttribute(new Float32Array(n).fill(i), 1));
        dele.push(kant);
      }
    });
    const samlet = mergeGeometries(dele) ?? new BufferGeometry();
    dele.forEach((d) => d.dispose());
    return samlet;
  }, [layout, ids]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: LINE_VERT,
        fragmentShader: LINE_FRAG,
        uniforms: { uState: { value: new Float32Array(MAX_MASKINER) }, uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  );

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = still ? 0 : clock.elapsedTime;
    (material.uniforms.uState.value as Float32Array).set(state);
  });
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return <lineSegments geometry={geometry} material={material} frustumCulled={false} />;
}

// ---------------------------------------------------------------------------
// Fodspor: en ring på gulvet under hver maskine, i tilstandens farve

const RING_FARVE: Record<Kode, Color> = {
  0: new Color(0.16, 0.22, 0.21),
  1: new Color(1.3, 0.9, 0.3),
  2: new Color(0.35, 1.25, 1.0),
  3: new Color(1.5, 0.45, 0.35),
  4: new Color(1.8, 0.4, 0.3),
  5: new Color(1.4, 0.9, 0.25),
};

function Fodspor({ layout, ids, state, still }: {
  layout: Layout;
  ids: string[];
  state: Float32Array;
  still: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  const geo = useMemo(() => new RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2), []);
  const tmp = useMemo(() => new Object3D(), []);

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = still ? 0 : clock.elapsedTime;
    ids.forEach((id, i) => {
      const m = layout.byId.get(id);
      if (!m) return;
      const s = state[i] as Kode;
      const r = Math.max(m.size.x, m.size.z) * 0.78 + 0.4;
      // Alarmen slår ud som en ring. Resten ligger stille.
      const puls = s === 4 ? 1 + ((t * 0.9) % 1) * 0.6 : 1;
      tmp.position.set(m.pos[0], 0.03, m.pos[2]);
      tmp.scale.setScalar(r * puls);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
      mesh.setColorAt(i, RING_FARVE[s] ?? RING_FARVE[0]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[geo, undefined, ids.length]} frustumCulled={false}>
      <meshBasicMaterial transparent opacity={0.85} toneMapped={false} depthWrite={false} blending={AdditiveBlending} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// Materialestrømmen

const STROEM_VERT = /* glsl */ `
  attribute vec3 aFra;
  attribute vec3 aTil;
  attribute vec3 aOver;
  attribute float aFase;
  attribute float aKant;
  uniform float uOff[${MAX_MASKINER}];
  uniform float uOn[${MAX_MASKINER}];
  uniform float uSize;
  varying float vAlpha;
  void main() {
    int k = int(aKant);
    float t = fract(aFase + uOff[k]);
    // En bue fra afkastet til næste maskines indløb.
    vec3 p = mix(mix(aFra, aOver, t), mix(aOver, aTil, t), t);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float on = uOn[k];
    gl_PointSize = uSize * (0.7 + 0.3 * fract(aFase * 17.0)) / max(-mv.z, 0.1) * on;
    vAlpha = on * smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.88, t);
    gl_Position = projectionMatrix * mv;
  }
`;

const STROEM_FRAG = /* glsl */ `
  precision mediump float;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = dot(d, d);
    if (r > 0.25) discard;
    float a = smoothstep(0.25, 0.0, r);
    gl_FragColor = vec4(vec3(0.55, 1.0, 0.85) * 1.6 * a * vAlpha, a * vAlpha);
  }
`;

const PR_KANT = 22;

function Stroem({ data, layout, kanter, still }: {
  data: LineData;
  layout: Layout;
  /** Pr. kant: fart i baner pr. sekund. 0 står stille, null findes ikke. */
  kanter: (number | null)[];
  still: boolean;
}) {
  const geometry = useMemo(() => {
    const n = data.edges.length * PR_KANT;
    const fra = new Float32Array(n * 3);
    const til = new Float32Array(n * 3);
    const over = new Float32Array(n * 3);
    const fase = new Float32Array(n);
    const kant = new Float32Array(n);
    let j = 0;
    data.edges.forEach((e, k) => {
      const a = layout.byId.get(e.from);
      const b = layout.byId.get(e.to);
      if (!a || !b) return;
      const ya = a.size.h * 0.92;
      const yb = b.size.h * 0.85;
      const top = Math.max(ya, yb) + 1.6;
      for (let i = 0; i < PR_KANT; i++, j++) {
        fra.set([a.pos[0], ya, a.pos[2]], j * 3);
        til.set([b.pos[0], yb, b.pos[2]], j * 3);
        over.set([(a.pos[0] + b.pos[0]) / 2, top, (a.pos[2] + b.pos[2]) / 2], j * 3);
        fase[j] = i / PR_KANT + ((i * 0.618) % 1) * 0.02;
        kant[j] = k;
      }
    });
    const g = new BufferGeometry();
    // Positionen regnes i shaderen. Attributten er der, fordi three kræver den.
    g.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aFra", new BufferAttribute(fra, 3));
    g.setAttribute("aTil", new BufferAttribute(til, 3));
    g.setAttribute("aOver", new BufferAttribute(over, 3));
    g.setAttribute("aFase", new BufferAttribute(fase, 1));
    g.setAttribute("aKant", new BufferAttribute(kant, 1));
    return g;
  }, [data, layout]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: STROEM_VERT,
        fragmentShader: STROEM_FRAG,
        uniforms: {
          uOff: { value: new Float32Array(MAX_MASKINER) },
          uOn: { value: new Float32Array(MAX_MASKINER) },
          uSize: { value: 210 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  );

  useFrame((_, dt) => {
    const off = material.uniforms.uOff.value as Float32Array;
    const on = material.uniforms.uOn.value as Float32Array;
    kanter.forEach((fart, k) => {
      // Tænd og sluk glidende. En strøm, der stopper, forsvinder ikke på et blink.
      const maal = fart === null ? 0 : fart > 0 ? 1 : 0.35;
      on[k] += (maal - on[k]) * Math.min(1, dt * 2.5);
      if (!still && fart) off[k] = (off[k] + dt * fart) % 1;
    });
  });

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

/** Banerne selv: svage, stiplede. Man kan se vejen, også hvor intet løber. */
function Baner({ data, layout }: { data: LineData; layout: Layout }) {
  const baner = useMemo(
    () =>
      data.edges.flatMap((e) => {
        const a = layout.byId.get(e.from);
        const b = layout.byId.get(e.to);
        if (!a || !b) return [];
        const ya = a.size.h * 0.92;
        const yb = b.size.h * 0.85;
        const top = Math.max(ya, yb) + 1.6;
        const pts: [number, number, number][] = [];
        for (let i = 0; i <= 16; i++) {
          const t = i / 16;
          const u = 1 - t;
          pts.push([
            u * u * a.pos[0] + 2 * u * t * ((a.pos[0] + b.pos[0]) / 2) + t * t * b.pos[0],
            u * u * ya + 2 * u * t * top + t * t * yb,
            u * u * a.pos[2] + 2 * u * t * ((a.pos[2] + b.pos[2]) / 2) + t * t * b.pos[2],
          ]);
        }
        return [{ id: `${e.from}-${e.to}`, pts }];
      }),
    [data, layout],
  );
  return (
    <>
      {baner.map((b) => (
        <Line key={b.id} points={b.pts} color="#2d4a44" lineWidth={1} dashed dashSize={0.35} gapSize={0.5} transparent opacity={0.55} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Skanningen: kun når Kædevagten kører

function Skanning({ layout, aktiv }: { layout: Layout; aktiv: boolean }) {
  const ref = useRef<import("three").Mesh>(null);
  const start = useRef<number | null>(null);
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uA: { value: 0 } },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: `precision mediump float; uniform float uA; varying vec2 vUv;
          void main(){
            float kant = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 6.0);
            float hoejde = 1.0 - vUv.y;
            float a = kant * hoejde * uA;
            gl_FragColor = vec4(vec3(0.45, 1.0, 0.85) * a * 1.4, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  );
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    if (!aktiv) { start.current = null; material.uniforms.uA.value = 0; return; }
    if (start.current === null) start.current = clock.elapsedTime;
    const t = ((clock.elapsedTime - start.current) / 3.6) % 1;
    m.position.x = minX - 4 + t * (maxX - minX + 8);
    material.uniforms.uA.value = Math.sin(t * Math.PI) * 0.9;
  });
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh ref={ref} position={[minX, 5, (minZ + maxZ) / 2]} rotation={[0, Math.PI / 2, 0]} material={material}>
      <planeGeometry args={[maxZ - minZ + 8, 10]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Mærkaterne

/** Samme talformat som panelerne: dansk, med tusindtalsseparator. */
const fmt = (v: number | null, d: number) =>
  v === null ? "—" : v.toLocaleString("da-DK", { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Et mærkat skal kun stå inde i scenen. Bag et panel skinner det igennem og
 * ligner noget, panelet siger; i skærmkanten skæres det over. Derfor
 * projiceres det hver frame, og uden for scenen skjules det.
 */
function Maerkat({ m, pos, fokus, scene, sim }: {
  m: MaskinLaesning;
  pos: [number, number, number];
  fokus: boolean;
  scene: React.RefObject<DOMRect | null>;
  /** Tallet er simuleret. Mærkatet siger det selv. */
  sim: boolean;
}) {
  const gruppe = useRef<import("three").Group>(null);
  const tag = useRef<HTMLDivElement>(null);
  const v = useMemo(() => new Vector3(), []);
  const { camera, size } = useThree();
  useFrame(() => {
    const r = scene.current;
    if (!r || !gruppe.current || !tag.current) return;
    v.set(pos[0], pos[1], pos[2]).project(camera);
    const x = ((v.x + 1) / 2) * size.width;
    const y = ((1 - v.y) / 2) * size.height;
    const inde = v.z < 1 && x > r.left + 50 && x < r.right - 50 && y > r.top + 30 && y < r.bottom - 10;
    gruppe.current.visible = inde;
    tag.current.style.opacity = inde ? "1" : "0";
  });
  const hoved = m.kanaler.find((k) => k.value !== null);
  const tilstand = m.alarm ? "alarm" : m.styret ? "styret" : m.koerer === false ? "staar" : m.koerer ? "koerer" : "ukendt";
  // Maskinen i fokus får ikke flere rækker her — dens tal står i fokuspanelet,
  // og et stort mærkat midt i scenen ville støde ind i overskriften.
  const vis = hoved ? [hoved] : [];
  return (
    <group position={pos} ref={gruppe}>
      <Line points={[[0, -2.6, 0], [0, -0.3, 0]]} color={tilstand === "koerer" ? "#5fc4a9" : tilstand === "ukendt" ? "#2b3936" : tilstand === "styret" ? "#ffc766" : "#e0705f"} lineWidth={1} transparent opacity={0.7} />
      <Html center zIndexRange={[30, 0]} className="h3-wrap">
        <div ref={tag} className={`h3-tag t-${tilstand}${fokus ? " is-fokus" : ""}`}>
          <div className="h3-head">
            <span className="h3-dot" />
            <span className="h3-navn">{m.kort}</span>
            {m.koerer === false && !m.styret && <span className="h3-stop">Stop</span>}
            {m.styret && <span className="h3-styret">AI-stop</span>}
            {sim && <span className="h3-sim">Sim</span>}
          </div>
          {vis.map((k) => (
            <div key={k.spec.id} className={`h3-row${k.alarm ? " is-alarm" : ""}`}>
              <span className="h3-lbl">{k.spec.label}</span>
              <span className="h3-val">{fmt(k.value, k.spec.decimaler)}<i>{k.spec.unit}</i></span>
            </div>
          ))}
        </div>
      </Html>
    </group>
  );
}

/** Hvilke maskiner der får et mærkat. Alle ville drukne scenen. */
function vaelgMaerkater(billede: TelemetriBillede, fokus: string | null): MaskinLaesning[] {
  return billede.maskiner.filter((m) => {
    if (!m.kanaler.some((k) => k.value !== null)) return false;
    // Et spor, agenten har stoppet, får ikke et mærkat pr. maskine — kun
    // årsagen, og den står ikke som styret.
    if (m.styret) return m.id === fokus;
    if (m.id === fokus || m.alarm || m.koerer === false) return true;
    // Det, driften kigger efter først: slibningen og kastebordene.
    return /jet|kb[-\s]|påslag/i.test(m.navn);
  });
}

// ---------------------------------------------------------------------------
// Kameraet

function Kamera({ layout, fokus, still }: { layout: Layout; fokus: string | null; still: boolean }) {
  const { camera, gl } = useThree();
  const kig = useRef(new Vector3(...layout.center));
  const oenske = useMemo(() => new Vector3(), []);
  const maal = useMemo(() => new Vector3(), []);
  const bruger = useRef({ az: 0, zoom: 1, ned: false, x: 0 });

  useEffect(() => {
    const el = gl.domElement;
    const ned = (e: PointerEvent) => { bruger.current.ned = true; bruger.current.x = e.clientX; };
    const op = () => { bruger.current.ned = false; };
    const flyt = (e: PointerEvent) => {
      if (!bruger.current.ned) return;
      bruger.current.az -= (e.clientX - bruger.current.x) * 0.004;
      bruger.current.az = Math.max(-1.1, Math.min(1.1, bruger.current.az));
      bruger.current.x = e.clientX;
    };
    const hjul = (e: WheelEvent) => {
      bruger.current.zoom = Math.max(0.55, Math.min(1.5, bruger.current.zoom * (1 + e.deltaY * 0.0012)));
    };
    el.addEventListener("pointerdown", ned);
    addEventListener("pointerup", op);
    addEventListener("pointercancel", op);
    addEventListener("pointermove", flyt);
    el.addEventListener("wheel", hjul, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", ned);
      removeEventListener("pointerup", op);
      removeEventListener("pointercancel", op);
      removeEventListener("pointermove", flyt);
      el.removeEventListener("wheel", hjul);
    };
  }, [gl]);

  useFrame(({ clock }, dt) => {
    const t = still ? 0 : clock.elapsedTime;
    const m = fokus ? layout.byId.get(fokus) : undefined;
    const [cx, , cz] = layout.center;
    // Overblikket skal rumme hele linjen mellem panelerne. Fokus sætter
    // maskinen midt i scenen — mærkatet udvides ikke, så overskriften over
    // den har plads.
    if (m) maal.set(m.pos[0], m.size.h * 0.5 + 1.5, m.pos[2]);
    else maal.set(cx, 2, cz);

    const az = Math.sin(t * 0.045) * 0.42 + bruger.current.az;
    const R = (m ? 52 : 112) * bruger.current.zoom;
    const H = (m ? 27 : 57) * bruger.current.zoom;
    oenske.set(maal.x + Math.sin(az) * R, H, maal.z + Math.cos(az) * R);

    const k = still ? 1 : 1 - Math.exp(-dt * (m ? 1.1 : 0.8));
    camera.position.lerp(oenske, k);
    kig.current.lerp(maal, still ? 1 : 1 - Math.exp(-dt * 1.4));
    camera.lookAt(kig.current);
  });
  return null;
}

/**
 * Efterbehandlingen. Ingen multisampling: bloom blødgør kanterne alligevel,
 * og 4x udglatning på en skærm i høj opløsning kostede mere end alt andet i
 * scenen tilsammen.
 */
function Effekter({ kvalitet }: { kvalitet: Kvalitet }) {
  const aberration = useMemo(() => new Vector2(0.0007, 0.0005), []);
  if (kvalitet === 0) {
    return (
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur intensity={1.1} luminanceThreshold={0.2} luminanceSmoothing={0.35} radius={0.6} />
        <Vignette offset={0.22} darkness={0.82} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={1.25} luminanceThreshold={0.16} luminanceSmoothing={0.35} radius={0.72} />
      <ChromaticAberration offset={aberration} radialModulation modulationOffset={0.35} blendFunction={BlendFunction.NORMAL} />
      <Noise opacity={0.045} premultiply blendFunction={BlendFunction.SCREEN} />
      <Vignette offset={0.22} darkness={0.82} />
    </EffectComposer>
  );
}

// ---------------------------------------------------------------------------

export const Hologram = memo(function Hologram({ data, ot, still, billede, fokus, skanning }: {
  data: LineData;
  ot: OtLayout | null;
  /** prefers-reduced-motion: stillbillede. Tilstande vises stadig. */
  still: boolean;
  billede: TelemetriBillede;
  /** Maskinen, kameraet er på besøg hos. null er overblikket. */
  fokus: string | null;
  /** Kædevagten kører. Skanningen løber. */
  skanning: boolean;
}) {
  const [kvalitet, setKvalitet] = useState<Kvalitet>(3);
  const budget = kvalitet <= 1 ? Math.round(PUNKT_BUDGET / 2) : PUNKT_BUDGET;
  const layout = useMemo(() => layoutLine(data), [data]);
  const cloud = useMemo(() => buildHologram(data, ot, budget), [data, ot, budget]);
  const ids = useMemo(() => cloud.machines.map((m) => m.id), [cloud]);
  const tele = useMemo(() => new Map(billede.maskiner.map((m) => [m.id, m])), [billede]);

  // Maskinernes tilstand, som shaderne læser den. Simuleret telemetri vinder;
  // uden den er det signalkæden, der afgør, som resten af HUD'en.
  const state = useMemo(() => {
    const arr = new Float32Array(MAX_MASKINER);
    cloud.machines.forEach((m, i) => {
      const t = tele.get(m.id);
      if (billede.simuleret && t) arr[i] = t.alarm ? 4 : t.koerer ? 2 : t.styret ? 5 : 3;
      else arr[i] = m.state === "paa-plads" ? 2 : m.state === "test" ? 1 : 0;
    });
    return arr;
  }, [cloud, tele, billede.simuleret]);

  // Strømmen. I fremskrivningen løber den mellem maskiner, der begge kører.
  // Ellers kun hvor flow er målt, og kun når måleren siger, at der løber noget.
  const kanter = useMemo(() => {
    const flow = billede.flowPct;
    const fart = flow === null ? 0 : Math.min(1.6, flow / 92) * 0.32;
    if (billede.simuleret) {
      return data.edges.map((e) => {
        const a = tele.get(e.from);
        const b = tele.get(e.to);
        return a?.koerer && b?.koerer ? fart : 0;
      });
    }
    const maalt = new Set(flowEdgesFor(data, layout, ot).map((e) => `${e.from}>${e.to}`));
    return data.edges.map((e) =>
      maalt.has(`${e.from}>${e.to}`) ? (flow !== null && flow > KOERER_OVER_PCT ? fart : 0) : null,
    );
  }, [billede, tele, data, layout, ot]);

  const maerkater = useMemo(() => vaelgMaerkater(billede, fokus), [billede, fokus]);

  // Hvor scenen er på skærmen. Måles igen ved ændret størrelse og løbende
  // under opstarten, hvor panelerne glider ind.
  const scene = useRef<DOMRect | null>(null);
  useEffect(() => {
    // Bunden af scenen er optaget af fokuspanelet og det store tal. Et
    // mærkat dernede ville ligge oven i dem, så scenen slutter over dem.
    const maal = () => {
      const stage = document.querySelector(".hud-stage")?.getBoundingClientRect();
      const bund = document.querySelector(".hud-stage-bund")?.getBoundingClientRect();
      scene.current = stage
        ? new DOMRect(stage.left, stage.top, stage.width, (bund ? bund.top : stage.bottom) - stage.top)
        : null;
    };
    maal();
    const id = setInterval(maal, 1000);
    addEventListener("resize", maal);
    return () => { clearInterval(id); removeEventListener("resize", maal); };
  }, []);

  return (
    <div className="holo" aria-hidden>
      <Canvas
        dpr={[1, DPR[kvalitet]]}
        gl={{ antialias: false, powerPreference: "high-performance", stencil: false, depth: true }}
        camera={{ fov: 34, near: 0.5, far: 500, position: [layout.center[0], 40, 80] }}
      >
        <color attach="background" args={["#020504"]} />
        <fog attach="fog" args={["#020504", 70, 190]} />
        <Cloud data={cloud} state={state} still={still} />
        <Silhouetter layout={layout} ids={ids} state={state} still={still} />
        <Fodspor layout={layout} ids={ids} state={state} still={still} />
        <Baner data={data} layout={layout} />
        <Stroem data={data} layout={layout} kanter={kanter} still={still} />
        {!still && <Skanning layout={layout} aktiv={skanning} />}
        {maerkater.map((m) => {
          const pm = layout.byId.get(m.id);
          if (!pm) return null;
          const top = formTop(formFor({ kind: pm.kind, name: pm.name, size: pm.size, wIdCount: pm.wIds.length }));
          return <Maerkat key={m.id} m={m} pos={[pm.pos[0], top + 3, pm.pos[2]]} fokus={m.id === fokus} scene={scene} sim={billede.simuleret} />;
        })}
        <Kamera layout={layout} fokus={fokus} still={still} />
        <Effekter kvalitet={kvalitet} />
        {/* Skruer kun ned, aldrig op igen: en scene, der vipper frem og
            tilbage mellem to trin, ser værre ud end én, der ligger lavt. */}
        <PerformanceMonitor
          flipflops={1}
          onDecline={() => setKvalitet((k) => (k > 0 ? ((k - 1) as Kvalitet) : k))}
          onFallback={() => setKvalitet(0)}
        />
      </Canvas>
    </div>
  );
});
