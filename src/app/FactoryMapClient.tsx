"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { DEFAULT_LINE, LINE_OPTIONS, LINES, ROOM_OPTIONS } from "../lib/lines";

// WebGL kører kun i browseren.
const FactoryMap = dynamic(() => import("../components/FactoryMap").then((m) => m.FactoryMap), {
  ssr: false,
  loading: () => <div className="fm-loading">Indlæser fabrikskort…</div>,
});

export default function FactoryMapClient() {
  const [viewId, setViewId] = useState(DEFAULT_LINE);
  const data = LINES[viewId] ?? LINES[DEFAULT_LINE];
  return <FactoryMap data={data} lines={LINE_OPTIONS} rooms={ROOM_OPTIONS} onSelectLine={setViewId} />;
}
