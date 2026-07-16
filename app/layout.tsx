import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "AgenteMrChicken — AI Workspace",
  description: "Ambiente de criação e automação inteligente com IA de próxima geração.",
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
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
