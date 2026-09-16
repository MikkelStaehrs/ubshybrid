"use client";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

// Bånd på gulvet med chevroner der bevæger sig i flowretningen.
function makeChevronTexture(color: string, dashed: boolean) {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 64;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 128, 64);
  g.fillStyle = color;
  g.globalAlpha = dashed ? 0.35 : 0.22;
  if (dashed) { g.fillRect(0, 22, 64, 20); } else { g.fillRect(0, 18, 128, 28); }
  g.globalAlpha = 1;
  g.beginPath();
  g.moveTo(50, 10); g.lineTo(78, 32); g.lineTo(50, 54);
  g.lineTo(38, 54); g.lineTo(66, 32); g.lineTo(38, 10);
  g.closePath();
  g.fill();
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

interface Props {
  points: [number, number][];
  color: string;
  width?: number;
  y?: number;
  dashed?: boolean;
  animate: boolean;
  opacity?: number;
}

export function FlowRibbon({ points, color, width = 0.9, y = 0.04, dashed = false, animate, opacity = 1 }: Props) {
  const segments = useMemo(() => {
    const segs: { mid: [number, number]; len: number; angle: number }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, z0] = points[i];
      const [x1, z1] = points[i + 1];
      const dx = x1 - x0, dz = z1 - z0;
      // forlæng indre knæk lidt så båndene mødes pænt
      const ext = i < points.length - 2 ? width / 2 : 0;
      const len = Math.hypot(dx, dz) + ext;
      const ux = dx / Math.hypot(dx, dz), uz = dz / Math.hypot(dx, dz);
      segs.push({ mid: [x0 + ux * len / 2, z0 + uz * len / 2], len, angle: Math.atan2(-dz, dx) });
    }
    return segs;
  }, [points, width]);

  const textures = useMemo(
    () => segments.map((s) => {
      const t = makeChevronTexture(color, dashed);
      t.repeat.set(s.len / (width * 1.6), 1);
      return t;
    }),
    [segments, color, dashed, width],
  );
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);

  useFrame((_, delta) => {
    if (!animate) return;
    for (const t of textures) t.offset.x -= delta * 0.9;
  });

  return (
    <group>
      {segments.map((s, i) => (
        <group key={i} position={[s.mid[0], y + i * 0.002, s.mid[1]]} rotation={[0, s.angle, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
            <planeGeometry args={[s.len, width]} />
            <meshBasicMaterial map={textures[i]} transparent opacity={opacity} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
