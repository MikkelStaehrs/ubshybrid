"use client";
import { useEffect, useState } from "react";

// 3D-scenen kan ikke læse CSS direkte, så vi henter farverne fra CSS-tokens
// og opdaterer når brugeren skifter lyst/mørkt tema.
const TOKENS = [
  "scene-bg", "floor", "slab", "wall", "grid", "flow", "warn", "accent",
  "m-intake", "m-elevator", "m-distributor", "m-process", "m-steel", "label-ink",
] as const;
export type SceneTheme = Record<(typeof TOKENS)[number], string> & { dark: boolean };

function read(): SceneTheme {
  const cs = getComputedStyle(document.documentElement);
  const t = Object.fromEntries(TOKENS.map((k) => [k, cs.getPropertyValue(`--${k}`).trim() || "#888"])) as unknown as SceneTheme;
  const attr = document.documentElement.getAttribute("data-theme");
  t.dark = attr ? attr === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  return t;
}

export function useSceneTheme(): SceneTheme | null {
  const [theme, setTheme] = useState<SceneTheme | null>(null);
  useEffect(() => {
    const update = () => setTheme(read());
    update();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => { mq.removeEventListener("change", update); mo.disconnect(); };
  }, []);
  return theme;
}
