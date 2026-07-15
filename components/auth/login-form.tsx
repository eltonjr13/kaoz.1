"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { LogIn } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);

    const nextPath = searchParams.get("next");
    const redirectTo = nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/flow";

    router.replace(redirectTo as Route);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="muted">
        Modo local ativo. Os dados ficam salvos neste computador.
      </p>

      <div className="row-actions">
        <button className="button full" type="submit" disabled={isLoading}>
          <LogIn size={18} />
          {isLoading ? "Entrando" : "Entrar no modo local"}
        </button>
      </div>
    </form>
  );
}
