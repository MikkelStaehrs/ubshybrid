import { createRoot } from "react-dom/client";
import { FactoryMap } from "../src/components/FactoryMap";
import { LINES } from "../src/lib/lines";

createRoot(document.getElementById("app")!).render(<FactoryMap data={LINES.sliberi} />);
