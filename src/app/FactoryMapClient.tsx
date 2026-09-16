"use client";
import dynamic from "next/dynamic";
import type { LineData } from "../lib/types";

// WebGL kører kun i browseren.
const FactoryMap = dynamic(() => import("../components/FactoryMap").then((m) => m.FactoryMap), {
  ssr: false,
  loading: () => <div className="fm-loading">Indlæser fabrikskort…</div>,
});

export default function FactoryMapClient({ data }: { data: LineData }) {
  return <FactoryMap data={data} />;
}
