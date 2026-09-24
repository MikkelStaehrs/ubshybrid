"use client";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { LiveSourceKind } from "../lib/live-source";
import { DEFAULT_LINE, FABRIK_ID, LINE_OPTIONS, LINES, ROOM_OPTIONS } from "../lib/lines";

// WebGL kører kun i browseren.
const FactoryMap = dynamic(() => import("../components/FactoryMap").then((m) => m.FactoryMap), {
  ssr: false,
  loading: () => <div className="fm-loading">Indlæser fabrikskort…</div>,
});

// Hele fabrikken er sin egen, lettere scene — også kun i browseren.
const FabrikOversigt = dynamic(() => import("../components/FabrikOversigt").then((m) => m.FabrikOversigt), {
  ssr: false,
  loading: () => <div className="fm-loading">Indlæser hele fabrikken…</div>,
});

export default function FactoryMapClient({ liveSource }: { liveSource: LiveSourceKind }) {
  const [viewId, setViewId] = useState(DEFAULT_LINE);
  // Dybt link fra AI-overblikket: /?lag=agents&agent=AG-SLIB-N
  const params = useSearchParams();
  const lag = params.get("lag");
  if (viewId === FABRIK_ID) {
    return <FabrikOversigt lines={LINE_OPTIONS} rooms={ROOM_OPTIONS} onSelectLine={setViewId} />;
  }
  const data = LINES[viewId] ?? LINES[DEFAULT_LINE];
  return (
    <FactoryMap
      data={data}
      lines={LINE_OPTIONS}
      rooms={ROOM_OPTIONS}
      onSelectLine={setViewId}
      liveSource={liveSource}
      initialLayer={lag === "agents" || lag === "ot" || lag === "live" ? lag : undefined}
      initialAgent={params.get("agent") ?? undefined}
    />
  );
}
