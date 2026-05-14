import Link from "next/link";

const phases = [
  { n: 0, name: "Bootstrap on DGX", status: "in-progress" },
  { n: 1, name: "music-inference vertical slice", status: "pending" },
  { n: 2, name: "Song Document DSL + Western co-composer", status: "pending" },
  { n: 3, name: "Public lyrics provider + Pratyabhijna seam", status: "pending" },
  { n: 4, name: "Supabase schema + cloud API + worker", status: "pending" },
  { n: 5, name: "Web UI", status: "pending" },
  { n: 6, name: "Carnatic + Hindustani + Kannada-folk modules", status: "pending" },
  { n: 7, name: "Indic phonetics + svara-TTS vocal layer", status: "pending" },
  { n: 8, name: "GPU-share governor", status: "pending" },
  { n: 9, name: "PWA polish, notifications, quotas", status: "pending" },
  { n: 10, name: "Pratyabhijna integration", status: "pending" },
  { n: 11, name: "Observability", status: "pending" },
  { n: 12, name: "Managed-API pro tier (deferred)", status: "deferred" },
];

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-16 sm:py-24">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-medium tracking-tight">neo-fm</h1>
        <p className="text-base text-foreground/70">
          India-first, composition-aware AI music. Web app coming together phase by phase.
        </p>
        <nav className="mt-2 flex gap-3 text-sm">
          <Link
            href="/sign-in"
            className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-accent hover:bg-accent/20"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-md border border-muted/30 px-3 py-1.5 text-foreground/70 hover:text-foreground"
          >
            Create account
          </Link>
        </nav>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm uppercase tracking-widest text-foreground/50">
          Phase status
        </h2>
        <ol className="flex flex-col gap-1.5 text-sm">
          {phases.map((p) => (
            <li
              key={p.n}
              className="flex items-center gap-3 rounded-md border border-muted/30 bg-muted/20 px-3 py-2"
            >
              <span className="font-mono text-xs text-foreground/50 tabular-nums">
                {p.n.toString().padStart(2, "0")}
              </span>
              <span className="flex-1">{p.name}</span>
              <StatusBadge status={p.status} />
            </li>
          ))}
        </ol>
      </section>

      <footer className="text-xs text-foreground/40">
        Apache-2.0. Source:{" "}
        <a
          className="underline hover:text-accent"
          href="https://github.com/SharathSPhD/neo-fm"
        >
          github.com/SharathSPhD/neo-fm
        </a>
      </footer>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "in-progress"
      ? "border-accent/40 text-accent"
      : status === "deferred"
        ? "border-foreground/15 text-foreground/40 line-through"
        : "border-foreground/20 text-foreground/60";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}
    >
      {status}
    </span>
  );
}
