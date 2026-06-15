import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { startPollingWorker } from "@/lib/videos/polling-worker";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

if (typeof window === "undefined") {
  startPollingWorker();
}

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
    <html lang="pt-BR">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
