import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
