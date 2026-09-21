"use client";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh } from "three";
import type { PlacedSensor } from "../lib/ot";
import { describeFault, type Quality, type SignalValue } from "../lib/live-source";
import type { SceneTheme } from "../lib/useSceneTheme";

interface Props {
  sensors: PlacedSensor[];
  values: Map<string, SignalValue>;
  theme: SceneTheme;
  selectedId: string | null;
  onSelect: (signalId: string) => void;
}

type ColorToken = Exclude<keyof SceneTheme, "dark">;

const QUALITY_TOKEN: Record<Quality, ColorToken> = {
  good: "live-good",
  stale: "live-stale",
  fault: "live-fault",
  "no-source": "live-none",
};

/**
 * Værdien som den skrives i badgen. En sensor i fejl har ingen måling, så
 * der står en streg — aldrig et tal, og aldrig et negativt et.
 */
function show(v: SignalValue): string {
  if (v.value === null || !Number.isFinite(v.value)) return "—";
  const n = Math.abs(v.value) >= 100 ? v.value.toFixed(0) : v.value.toFixed(1);
  return `${n.replace(".", ",")} ${v.unit}`;
}

function LiveMarker({ s, v, theme, on, onSelect }: {
  s: PlacedSensor;
  v: SignalValue | undefined;
  theme: SceneTheme;
  on: boolean;
  onSelect: () => void;
}) {
  const head = useRef<Mesh>(null);
  const quality: Quality = v?.quality ?? "no-source";
  const color = theme[QUALITY_TOKEN[quality]];
  const live = quality === "good";
  const fault = v && quality === "fault" ? describeFault(v.raw) : null;

  useFrame(({ clock }) => {
    if (!head.current) return;
    // Kun et signal, der faktisk kommer ind, banker. Stille = noget er galt.
    const beat = live ? 1 + Math.sin(clock.elapsedTime * 2.4) * 0.09 : 1;
    head.current.scale.setScalar(on ? beat * 1.2 : beat);
  });

  return (
    <group position={s.pos!}>
      <mesh
        ref={head}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        onPointerOver={(e) => e.stopPropagation()}
      >
        <sphereGeometry args={[0.22, 20, 14]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={live ? 0.9 : quality === "no-source" ? 0.05 : 0.5}
          roughness={0.3}
        />
      </mesh>
      {/* Klikflade — kuglen er for lille at ramme oppefra. */}
      <mesh onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        <boxGeometry args={[1.1, 1.1, 1.1]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <Html position={[0, 0.85, 0]} center zIndexRange={[20, 0]} className="fm-tag-wrap">
        <button
          type="button"
          className={`fm-live-badge q-${quality}${on ? " is-selected" : ""}`}
          title={fault ?? undefined}
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="fm-live-value">{v ? show(v) : "—"}</span>
          <span className="fm-live-tag">{fault ? "Sensorfejl" : s.id}</span>
        </button>
      </Html>
    </group>
  );
}

export function LiveLayer({ sensors, values, theme, selectedId, onSelect }: Props) {
  return (
    <group>
      {sensors.filter((s) => s.pos).map((s) => (
        <LiveMarker
          key={s.id}
          s={s}
          v={values.get(s.id)}
          theme={theme}
          on={selectedId === s.id}
          onSelect={() => onSelect(s.id)}
        />
      ))}
    </group>
  );
}
