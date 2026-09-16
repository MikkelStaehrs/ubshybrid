import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FactoryMap } from "../src/components/FactoryMap";
import { DEFAULT_LINE, LINE_OPTIONS, LINES, ROOM_OPTIONS } from "../src/lib/lines";

function App() {
  const [viewId, setViewId] = useState(DEFAULT_LINE);
  const data = LINES[viewId] ?? LINES[DEFAULT_LINE];
  return <FactoryMap data={data} lines={LINE_OPTIONS} rooms={ROOM_OPTIONS} onSelectLine={setViewId} />;
}

createRoot(document.getElementById("app")!).render(<App />);
