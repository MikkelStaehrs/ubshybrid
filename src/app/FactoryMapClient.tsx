"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { DEFAULT_LINE, LINE_OPTIONS, LINES } from "../lib/lines";

// WebGL kører kun i browseren.
const FactoryMap = dynamic(() => import("../components/FactoryMap").then((m) => m.FactoryMap), {
  ssr: false,
  loading: () => <div className="fm-loading">Indlæser fabrikskort…</div>,
});

export default function FactoryMapClient() {
  const [lineId, setLineId] = useState(DEFAULT_LINE);
  const data = LINES[lineId] ?? LINES[DEFAULT_LINE];
  return <FactoryMap data={data} lines={LINE_OPTIONS} onSelectLine={setLineId} />;
}
