import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import { DesktopTitlebar } from "@/components/layout/desktop-titlebar";
import "./globals.css";

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
});

export const metadata: Metadata = {
  title: "Kaoz.1 — AI Workspace",
  description: "Ambiente de criação e automação inteligente com IA de próxima geração.",
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={ibmPlexMono.variable} suppressHydrationWarning>
        <DesktopTitlebar />
        <div className="flow-cinematic-background" aria-hidden="true">
          <div className="flow-cinematic-background__art" />
          <div className="flow-cinematic-background__overlay" />
          <div className="flow-cinematic-background__grain" />
        </div>
        {children}
      </body>
    </html>
  );
}
