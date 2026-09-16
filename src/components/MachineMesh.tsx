"use client";
import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, Mesh } from "three";
import { shortWIds, type PlacedMachine } from "../lib/layout";
import type { SceneTheme } from "../lib/useSceneTheme";

interface Props {
  m: PlacedMachine;
  theme: SceneTheme;
  selected: boolean;
  hovered: boolean;
  related: boolean;
  dimmed: boolean;
  showLabel: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

// Illustrative former ud fra navnet — nemme at udvide når vi kender modellerne.
type Shape = "box" | "drum" | "tower" | "sieve" | "deck";
function shapeFor(name: string): Shape {
  if (/tri[øo]r/i.test(name)) return "drum";
  if (/jet\s?pe[ae]ler|nordmark/i.test(name)) return "tower";
  if (/^kb[-\s]/i.test(name)) return "sieve";
  if (/alfa/i.test(name)) return "deck";
  return "box";
}

function Mat({ color, theme, dimmed, glow }: { color: string; theme: SceneTheme; dimmed: boolean; glow: number }) {
  return (
    <meshStandardMaterial
      color={color}
      roughness={0.62}
      metalness={0.18}
      emissive={theme.accent}
      emissiveIntensity={glow}
      transparent
      opacity={dimmed ? 0.16 : 1}
      depthWrite={!dimmed}
    />
  );
}

export function MachineMesh({ m, theme, selected, hovered, related, dimmed, showLabel, onSelect, onHover }: Props) {
  const ring = useRef<Mesh>(null);
  const group = useRef<Group>(null);
  const glow = selected ? 0.22 : hovered ? 0.12 : 0;
  const { x, z, h } = m.size;
  const body = theme[`m-${m.kind}` as const];
  const steel = theme["m-steel"];
  const mat = (c: string) => <Mat color={c} theme={theme} dimmed={dimmed} glow={glow} />;

  useFrame(({ clock }) => {
    if (ring.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 3) * 0.04;
      ring.current.scale.set(s, s, 1);
    }
  });

  const handlers = {
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(m.id); },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(m.id); },
    onPointerOut: () => onHover(null),
  };

  let parts: React.ReactNode;
  if (m.kind === "elevator") {
    parts = (
      <>
        <mesh castShadow receiveShadow position={[0, 0.45, 0]}><boxGeometry args={[x * 1.35, 0.9, z * 1.5]} />{mat(steel)}</mesh>
        <mesh castShadow position={[0, h / 2, 0]}><boxGeometry args={[x * 0.7, h, z]} />{mat(body)}</mesh>
        <mesh castShadow position={[0, h + 0.35, 0.1]}><boxGeometry args={[x * 1.3, 0.8, z * 1.6]} />{mat(body)}</mesh>
      </>
    );
  } else if (m.kind === "distributor") {
    parts = (
      <>
        <mesh castShadow position={[0, 0.8, 0]}><cylinderGeometry args={[x * 0.45, x * 0.45, 1.6, 24]} />{mat(body)}</mesh>
        <mesh castShadow position={[0, 1.95, 0]}><coneGeometry args={[x * 0.45, 0.7, 24]} />{mat(steel)}</mesh>
      </>
    );
  } else if (m.kind === "intake") {
    const n = Math.max(1, m.wIds.length);
    const unitZ = z / n;
    parts = Array.from({ length: n }, (_, i) => {
      const oz = -z / 2 + unitZ * (i + 0.5);
      return n > 1 ? (
        // Vippestol: ramme + vippet kar
        <group key={i} position={[0, 0, oz]}>
          <mesh castShadow position={[0, 0.5, 0]}><boxGeometry args={[x * 0.7, 1, unitZ * 0.7]} />{mat(steel)}</mesh>
          <mesh castShadow position={[0.2, 1.25, 0]} rotation={[0, 0, -0.35]}><boxGeometry args={[x * 0.75, 0.5, unitZ * 0.8]} />{mat(body)}</mesh>
        </group>
      ) : (
        // Påslag: tragt på ben
        <group key={i} position={[0, 0, oz]}>
          {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
            <mesh key={`${sx}${sz}`} castShadow position={[sx * x * 0.3, 0.45, sz * unitZ * 0.3]}><boxGeometry args={[0.14, 0.9, 0.14]} />{mat(steel)}</mesh>
          )))}
          <mesh castShadow position={[0, 1.35, 0]} rotation={[0, Math.PI / 4, 0]}>
            <cylinderGeometry args={[x * 0.62, x * 0.18, 0.9, 4]} />{mat(body)}
          </mesh>
        </group>
      );
    });
  } else if (m.kind === "person") {
    // Piktogram frem for forsøg på realisme — han er her for sjov.
    const legH = h * 0.47;
    const torsoH = h * 0.3;
    const headR = h * 0.075;
    parts = (
      <>
        {[-1, 1].map((sx) => (
          <mesh key={`ben${sx}`} castShadow position={[0, legH / 2, sx * z * 0.22]}>
            <boxGeometry args={[x * 0.34, legH, z * 0.3]} />{mat(body)}
          </mesh>
        ))}
        <mesh castShadow position={[0, legH + torsoH / 2, 0]}>
          <boxGeometry args={[x * 0.62, torsoH, z]} />{mat(body)}
        </mesh>
        {[-1, 1].map((sx) => (
          <mesh key={`arm${sx}`} castShadow position={[0, legH + torsoH * 0.55, sx * (z / 2 + 0.06)]}>
            <boxGeometry args={[x * 0.26, torsoH * 0.92, 0.1]} />{mat(body)}
          </mesh>
        ))}
        <mesh castShadow position={[0, legH + torsoH + headR * 1.35, 0]}>
          <sphereGeometry args={[headR, 20, 14]} />{mat(body)}
        </mesh>
      </>
    );
  } else if (m.kind === "analysis") {
    // CT-scanner: massiv kasse med en åbning i enden. Videometer: bånd gennem
    // en kuppel, på et bord — derfor tegnes bordet med.
    const isScanner = /ct|scanner/i.test(m.name);
    if (isScanner) {
      const bore = Math.min(z, h) * 0.22;
      parts = (
        <>
          <mesh castShadow receiveShadow position={[0, h / 2, 0]}><boxGeometry args={[x, h, z]} />{mat(body)}</mesh>
          <mesh castShadow position={[x / 2 + 0.02, h * 0.55, 0]} rotation={[0, Math.PI / 2, 0]}>
            <torusGeometry args={[bore, 0.06, 12, 32]} />{mat(steel)}
          </mesh>
          <mesh position={[x / 2 + 0.02, h * 0.55, 0]} rotation={[0, Math.PI / 2, 0]}>
            <circleGeometry args={[bore, 32]} />{mat(steel)}
          </mesh>
        </>
      );
    } else {
      const tableH = h * 0.66;
      const domeR = Math.min(0.2, z * 0.28);
      parts = (
        <>
          {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
            <mesh key={`${sx}${sz}`} castShadow position={[sx * x * 0.42, tableH / 2, sz * z * 0.36]}>
              <boxGeometry args={[0.06, tableH, 0.06]} />{mat(steel)}
            </mesh>
          )))}
          <mesh castShadow receiveShadow position={[0, tableH, 0]}><boxGeometry args={[x, 0.05, z]} />{mat(steel)}</mesh>
          {/* Transportbåndet er 30 cm bredt — et af de få rigtige mål vi har. */}
          <mesh castShadow position={[0, tableH + 0.06, 0]}><boxGeometry args={[x * 0.95, 0.07, 0.3]} />{mat(body)}</mesh>
          <mesh castShadow position={[0, tableH + 0.09, 0]}>
            <sphereGeometry args={[domeR, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />{mat(body)}
          </mesh>
        </>
      );
    }
  } else {
    const shape = shapeFor(m.name);
    const bodyH = h * 0.62;
    parts = (
      <>
        <mesh castShadow receiveShadow position={[0, 0.08, 0]}><boxGeometry args={[x, 0.16, z]} />{mat(steel)}</mesh>
        {shape === "drum" ? (
          <>
            <mesh castShadow position={[0, 0.55, 0]}><boxGeometry args={[x * 0.9, 0.8, z * 0.55]} />{mat(steel)}</mesh>
            <mesh castShadow position={[0, 1.55, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[z * 0.36, z * 0.36, x * 0.95, 28]} />{mat(body)}
            </mesh>
          </>
        ) : (
          <mesh castShadow position={[0, 0.16 + bodyH / 2, 0]}><boxGeometry args={[x * 0.9, bodyH, z * 0.85]} />{mat(body)}</mesh>
        )}
        {shape === "tower" && (
          <mesh castShadow position={[x * 0.15, 0.16 + bodyH + 0.55, 0]}><cylinderGeometry args={[z * 0.28, z * 0.28, 1.1, 24]} />{mat(steel)}</mesh>
        )}
        {shape === "sieve" && [0, 1, 2].map((i) => (
          <mesh key={i} castShadow position={[0, 0.16 + bodyH + 0.14 + i * 0.26, 0]}>
            <boxGeometry args={[x * (0.8 - i * 0.08), 0.18, z * (0.75 - i * 0.08)]} />{mat(i % 2 ? body : steel)}
          </mesh>
        ))}
        {shape === "deck" && (
          <mesh castShadow position={[0, 0.16 + bodyH + 0.2, 0]} rotation={[0.12, 0, 0.08]}>
            <boxGeometry args={[x * 0.95, 0.12, z * 0.95]} />{mat(steel)}
          </mesh>
        )}
        {(shape === "box" || shape === "drum") && (
          <mesh castShadow position={[-x * 0.25, (shape === "drum" ? 2.2 : 0.16 + bodyH) + 0.3, 0]} rotation={[0, Math.PI / 4, 0]}>
            <cylinderGeometry args={[0.55, 0.2, 0.6, 4]} />{mat(steel)}
          </mesh>
        )}
      </>
    );
  }

  const topY = m.kind === "elevator" ? h + 1 : m.kind === "process" ? h + 0.4 : h + 0.2;

  return (
    <group ref={group} position={m.pos} rotation={[0, m.rotY, 0]} {...handlers}>
      {parts}
      {/* usynlig klikflade, så hele fodaftrykket kan rammes */}
      <mesh position={[0, topY / 2, 0]}>
        <boxGeometry args={[Math.max(x, 1.6), topY, Math.max(z, 1.6)]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      {(selected || related) && (
        <mesh ref={selected ? ring : undefined} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[Math.max(x, z) * 0.78, Math.max(x, z) * 0.78 + (selected ? 0.28 : 0.12), 48]} />
          <meshBasicMaterial color={selected ? theme.accent : theme.flow} transparent opacity={selected ? 0.95 : 0.7} />
        </mesh>
      )}
      {showLabel && !dimmed && (
        <Html position={[0, topY + 0.4, 0]} center zIndexRange={[20, 0]} className="fm-tag-wrap">
          <button
            type="button"
            className={`fm-tag${selected ? " is-selected" : ""}${hovered ? " is-hovered" : ""}`}
            // Stop bobling, så canvas ikke tolker klikket som "klik ved siden af".
            onClick={(e) => { e.stopPropagation(); onSelect(m.id); }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerEnter={() => onHover(m.id)}
            onPointerLeave={() => onHover(null)}
          >
            <span className="fm-tag-name">{m.name}</span>
            {m.wIds.length > 0 && <span className="fm-tag-id">{shortWIds(m.wIds)}</span>}
          </button>
        </Html>
      )}
    </group>
  );
}
