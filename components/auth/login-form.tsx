"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { LogIn, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSuccess(false);
    setIsLoading(true);

    const supabase = createClient();
    const authResult =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setIsLoading(false);

    if (authResult.error) {
      setMessage(authResult.error.message);
      return;
    }

    if (mode === "signup" && !authResult.data.session) {
      setIsSuccess(true);
      setMessage("Cadastro criado. Confirme seu email para entrar.");
      return;
    }

    const nextPath = searchParams.get("next");
    const redirectTo = nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/dashboard";

    router.replace(redirectTo as Route);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="password">Senha</label>
        <input
          id="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>

      {message ? <p className={`form-message ${isSuccess ? "success" : ""}`}>{message}</p> : null}

      <div className="row-actions">
        <button className="button full" type="submit" disabled={isLoading}>
          {mode === "login" ? <LogIn size={18} /> : <UserPlus size={18} />}
          {isLoading ? "Processando" : mode === "login" ? "Entrar" : "Criar conta"}
        </button>
        <button
          className="button secondary full"
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setMessage("");
          }}
        >
          {mode === "login" ? "Criar conta" : "Ja tenho conta"}
        </button>
      </div>
    </form>
  );
}
