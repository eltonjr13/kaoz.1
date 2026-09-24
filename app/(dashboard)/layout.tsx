import { AppShell } from "@/components/layout/app-shell";
import { FlowCompanionProvider } from "@/components/flow/FlowCompanionConnection";
import { MeetingNotesProvider } from "@/components/meeting-notes/MeetingNotesProvider";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <FlowCompanionProvider>
      <MeetingNotesProvider>
        <AppShell workspaceLabel="Modo funcional sem login">{children}</AppShell>
      </MeetingNotesProvider>
    </FlowCompanionProvider>
  );
}
