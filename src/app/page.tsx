import { Suspense } from "react";
import FactoryMapClient from "./FactoryMapClient";

// Fabrikskortet. Live hører til AI-overblikket på /ai.
export default function Page() {
  return (
    <main style={{ height: "100dvh" }}>
      {/* useSearchParams kræver en grænse, når siden præ-renderes. */}
      <Suspense fallback={<div className="fm-loading">Indlæser fabrikskort…</div>}>
        <FactoryMapClient />
      </Suspense>
    </main>
  );
}
