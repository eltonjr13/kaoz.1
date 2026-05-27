import Link from "next/link";
import type { Route } from "next";

type EmptyStateProps = {
  title: string;
  description: string;
  actionHref?: Route;
  actionLabel?: string;
};

export function EmptyState({ title, description, actionHref, actionLabel }: EmptyStateProps) {
  return (
    <section className="empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
      {actionHref && actionLabel ? (
        <Link className="button" href={actionHref}>
          {actionLabel}
        </Link>
      ) : null}
    </section>
  );
}
