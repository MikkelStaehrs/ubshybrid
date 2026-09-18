import FactoryMapClient from "./FactoryMapClient";

// LIVE_SOURCE læses på serveren, så navnet kan stå uden NEXT_PUBLIC-præfiks.
// Uden den kører Live-visningen på simulerede tal — og siger det tydeligt.
export default function Page() {
  const liveSource = process.env.LIVE_SOURCE === "api" ? "api" : "mock";
  return (
    <main style={{ height: "100dvh" }}>
      <FactoryMapClient liveSource={liveSource} />
    </main>
  );
}
