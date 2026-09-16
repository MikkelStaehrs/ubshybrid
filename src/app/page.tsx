import { LINES } from "../lib/lines";
import FactoryMapClient from "./FactoryMapClient";

export default function Page() {
  return (
    <main style={{ height: "100dvh" }}>
      <FactoryMapClient data={LINES.sliberi} />
    </main>
  );
}
