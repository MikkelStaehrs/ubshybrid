import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FactoryMap } from "../src/components/FactoryMap";
import { DEFAULT_LINE, LINE_OPTIONS, LINES } from "../src/lib/lines";

function App() {
  const [lineId, setLineId] = useState(DEFAULT_LINE);
  const data = LINES[lineId] ?? LINES[DEFAULT_LINE];
  return <FactoryMap data={data} lines={LINE_OPTIONS} onSelectLine={setLineId} />;
}

createRoot(document.getElementById("app")!).render(<App />);
