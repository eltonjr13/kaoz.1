import type { Metadata } from "next";
import "./globals.css";
import { startPollingWorker } from "@/lib/videos/polling-worker";

if (typeof window === "undefined") {
  startPollingWorker();
}

export const metadata: Metadata = {
  title: "AI UGC Reaction Studio",
  description: "SaaS para criar videos verticais de react com IA."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
