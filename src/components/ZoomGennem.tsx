"use client";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { MathUtils, Plane, Raycaster, Vector2, Vector3 } from "three";
import type { MapControls as MapControlsImpl } from "three-stdlib";

/**
 * MapControls kan kun zoome hen mod sit eget punkt. Når kameraet står
 * `minDistance` fra det, sker der ingenting mere ved at rulle ind — og så
 * ser det ud, som om zoom er holdt op med at virke. Her flyttes kameraet og
 * punktet i stedet sammen hen ad gulvet mod musen, så man kan blive ved.
 */
export function ZoomGennem({ min }: { min: number }) {
  const { camera, gl, controls } = useThree();

  useEffect(() => {
    const c = controls as unknown as MapControlsImpl | null;
    if (!c) return;
    // Samme element som kontrollerne lytter på — så rammer det også, når
    // musen står over et mærkat.
    const el = (c.domElement as HTMLElement | undefined) ?? gl.domElement;
    const gulv = new Plane(new Vector3(0, 1, 0), 0);
    const ray = new Raycaster();
    const ndc = new Vector2();
    const ramt = new Vector3();

    const hjul = (e: WheelEvent) => {
      if (e.deltaY >= 0 || !c.enabled) return;
      if (camera.position.distanceTo(c.target) > min * 1.05) return;
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const ret = ray.ray.intersectPlane(gulv, ramt)
        ? ramt.clone().sub(c.target)
        : c.target.clone().sub(camera.position);
      ret.y = 0;
      // Peger musen lige på punktet, går vi den vej, kameraet kigger.
      if (ret.lengthSq() < 0.01) ret.copy(c.target).sub(camera.position).setY(0);
      if (ret.lengthSq() < 1e-6) return;
      ret.setLength(MathUtils.clamp(Math.abs(e.deltaY) * 0.01, 0.4, 2.5));
      camera.position.add(ret);
      c.target.add(ret);
      c.update();
    };
    el.addEventListener("wheel", hjul, { passive: true });
    return () => el.removeEventListener("wheel", hjul);
  }, [camera, gl, controls, min]);

  return null;
}
