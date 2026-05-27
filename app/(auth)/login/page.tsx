import Link from "next/link";
import { redirect } from "next/navigation";
import { Play } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <Play size={18} fill="currentColor" />
          </span>
          <span>AI UGC Reaction Studio</span>
        </Link>
        <div style={{ marginTop: 28 }}>
          <h1>Entrar</h1>
          <p>Acesse sua conta para criar avatares e jobs de react.</p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
