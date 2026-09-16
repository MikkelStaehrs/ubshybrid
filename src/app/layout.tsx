import type { Metadata } from "next";
// Selv-hostede fonte (virker bag firmaets proxy / uden Google Fonts).
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "../components/factory-map.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "UBS Fabrikskort",
  description: "Interaktivt 3D-kort over produktionslinjerne i Holeby",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da">
      <body>{children}</body>
    </html>
  );
}
