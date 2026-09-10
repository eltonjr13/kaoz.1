import { FlowCompanionProvider } from '@/components/flow/FlowCompanionConnection';
export default function FlowLayout({ children }: { children: React.ReactNode }) {
  return <FlowCompanionProvider>{children}</FlowCompanionProvider>;
}
