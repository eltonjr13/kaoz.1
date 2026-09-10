import { AppShell } from "@/components/layout/app-shell";
import { FlowCompanionProvider } from "@/components/flow/FlowCompanionConnection";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <FlowCompanionProvider>
      <AppShell workspaceLabel="Modo funcional sem login">{children}</AppShell>
    </FlowCompanionProvider>
  );
}
