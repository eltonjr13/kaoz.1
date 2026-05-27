import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AppShell workspaceLabel="Modo funcional sem login">{children}</AppShell>;
}
