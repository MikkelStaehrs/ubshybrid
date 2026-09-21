"use client";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from "three";
import { buildHologram, PUNKT_BUDGET, type HologramData } from "../../lib/hologram";
import { layoutLine } from "../../lib/layout";
import type { LineData } from "../../lib/types";
import type { OtLayout } from "../../lib/ot";

/**
 * Fabrikken som punktsky.
 *
 * Dybden kommer fra skyen selv, ikke fra glød: punkterne bliver mindre med
 * afstanden, de er bløde og runde, de falmer mod sort langt væk, og de
 * blandes additivt, så tætte områder lyser op af sig selv. Der hvor vi ved
 * mest, er der flest punkter — og derfor lysest.
 *
 * Kameraets langsomme bane er synsvinkel, ikke data. Alt andet, der
 * bevæger sig, svarer til en tilstand.
 */

/** Er frametiden over det her efter opstart, halveres punkterne én gang. */
const FRAMETID_GRAENSE_MS = 22;
/** Hvor længe vi kigger på frametiden, før vi beslutter os. */
const MAALEVINDUE_MS = 1200;

const VERT = /* glsl */ `
  attribute float aBright;
  attribute float aTone;
  uniform float uSize;
  uniform float uFadeNear;
  uniform float uFadeFar;
  varying float vBright;
  varying float vTone;
  varying float vFade;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = -mv.z;
    // Punktstørrelse aftager med afstanden — det er perspektivet.
    gl_PointSize = uSize / max(dist, 0.1);
    // Dybdefade mod sort, så bagsiden af hallen synker væk.
    vFade = 1.0 - smoothstep(uFadeNear, uFadeFar, dist);
    vBright = aBright;
    vTone = aTone;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uTaage;
  uniform vec3 uTest;
  uniform vec3 uDrift;
  varying float vBright;
  varying float vTone;
  varying float vFade;

  void main() {
    // Blødt rundt punkt. Firkantede punkter ser ud som fejl, ikke som støv.
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = dot(d, d);
    if (r > 0.25) discard;
    float alpha = smoothstep(0.25, 0.0, r);

    vec3 col = uTaage;
    if (vTone > 1.5) col = uDrift;
    else if (vTone > 0.5) col = uTest;

    gl_FragColor = vec4(col * vBright, alpha * vBright * vFade);
  }
`;

function Cloud({ data, size }: { data: HologramData; size: number }) {
  const ref = useRef<Points>(null);

  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(data.positions, 3));
    g.setAttribute("aBright", new BufferAttribute(data.bright, 1));
    g.setAttribute("aTone", new BufferAttribute(data.tone, 1));
    return g;
  }, [data]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uSize: { value: size },
          uFadeNear: { value: 40 },
          uFadeFar: { value: 190 },
          // Hvidt på næsten sort. Farve er kun signal: rav = test.
          uTaage: { value: [0.62, 0.69, 0.67] },
          uTest: { value: [0.86, 0.64, 0.24] },
          uDrift: { value: [1, 1, 1] },
        },
        transparent: true,
        depthWrite: false,
        // Tætte områder lyser op af sig selv — det er dér dybden kommer fra.
        blending: AdditiveBlending,
      }),
    [size],
  );

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />;
}

/**
 * Langsom, begrænset bane. Synsvinkel, ikke data — og den står stille, hvis
 * brugeren beder om ro, eller griber fat i den med musen.
 */
function SlowOrbit({ center, still }: { center: [number, number, number]; still: boolean }) {
  const { camera } = useThree();
  const held = useRef(false);
  const t = useRef(0);

  useFrame((_, dt) => {
    if (still || held.current) return;
    t.current += dt * 0.06;
    const a = Math.sin(t.current) * (Math.PI / 12); // ±15°
    const radius = 118;
    camera.position.set(
      center[0] + Math.sin(a) * radius,
      64,
      center[2] + Math.cos(a) * radius,
    );
    camera.lookAt(center[0], 6, center[2]);
  });

  return (
    <OrbitControls
      makeDefault
      target={[center[0], 6, center[2]]}
      enablePan={false}
      enableZoom={false}
      minPolarAngle={Math.PI / 4}
      maxPolarAngle={Math.PI / 2.3}
      minAzimuthAngle={-Math.PI / 12}
      maxAzimuthAngle={Math.PI / 12}
      rotateSpeed={0.35}
      onStart={() => (held.current = true)}
    />
  );
}

/** Måler frametiden og skruer ned én gang, hvis maskinen ikke kan følge med. */
function Governor({ onSlow }: { onSlow: () => void }) {
  const start = useRef(0);
  const frames = useRef(0);
  const done = useRef(false);

  useFrame(() => {
    if (done.current) return;
    const now = performance.now();
    if (start.current === 0) { start.current = now; return; }
    frames.current++;
    const elapsed = now - start.current;
    if (elapsed < MAALEVINDUE_MS) return;
    done.current = true;
    const avg = elapsed / frames.current;
    if (avg > FRAMETID_GRAENSE_MS) onSlow();
  });
  return null;
}

export function Hologram({ data, ot, still }: {
  data: LineData;
  ot: OtLayout | null;
  /** prefers-reduced-motion: stillbillede, ingen bane. */
  still: boolean;
}) {
  const [budget, setBudget] = useState(PUNKT_BUDGET);
  const halved = useRef(false);

  const cloud = useMemo(() => buildHologram(data, ot, budget), [data, ot, budget]);
  const center = useMemo(() => layoutLine(data).center, [data]);

  return (
    <div className="holo" aria-hidden>
      <Canvas
        dpr={[1, 1.6]}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        camera={{ fov: 32, near: 1, far: 600, position: [center[0], 64, center[2] + 118] }}
      >
        <color attach="background" args={["#050807"]} />
        <Cloud data={cloud} size={620} />
        <SlowOrbit center={center} still={still} />
        {!still && (
          <Governor
            onSlow={() => {
              // Kun én gang. Bliver den ved, jager vi vores egen hale.
              if (halved.current) return;
              halved.current = true;
              setBudget((b) => Math.round(b / 2));
            }}
          />
        )}
      </Canvas>
    </div>
  );
}
