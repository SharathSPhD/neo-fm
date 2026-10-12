/**
 * /help -- static FAQ (Sprint E).
 *
 * Static is intentional: the FAQ has answers that change with
 * the product, not with the user. We keep the markdown-style copy
 * inline so it ships with the bundle (no separate fetch).
 */
import type { Metadata } from "next";
import Link from "next/link";

import { serverI18n } from "@/lib/i18n/server";
import type { UiKey } from "@/lib/i18n/ui-strings";

export const metadata: Metadata = {
  alternates: { canonical: "/help" },
  title: "Help -- neo-fm",
  description:
    "Answers to the most-asked questions about neo-fm: how generation works, what we support, quota, ownership, and getting help.",
};

type TFn = Awaited<ReturnType<typeof serverI18n>>["t"];

interface FaqEntry {
  q: UiKey;
  a: (t: TFn) => React.ReactNode;
}

const FAQ: readonly FaqEntry[] = [
  { q: "help.q1", a: (t) => <p>{t("help.a1")}</p> },
  { q: "help.q2", a: (t) => <p>{t("help.a2")}</p> },
  { q: "help.q3", a: (t) => <p>{t("help.a3")}</p> },
  { q: "help.q4", a: (t) => <p>{t("help.a4")}</p> },
  {
    q: "help.q5",
    a: (t) => (
      <p>
        {t("help.a5")} <Link href="/pricing">{t("help.a5.link")}</Link>.
      </p>
    ),
  },
  { q: "help.q6", a: (t) => <p>{t("help.a6")}</p> },
  {
    q: "help.q7",
    a: (t) => (
      <p>
        {t("help.a7.pre")} <strong>{t("song.recover")}</strong>{" "}
        {t("help.a7.mid")} <Link href="/feedback">{t("help.a7.link")}</Link>.
      </p>
    ),
  },
  {
    q: "help.q8",
    a: (t) => (
      <p>
        {t("help.a8.pre")}{" "}
        <Link href="/pricing">{t("help.a8.link")}</Link>. {t("help.a8.post")}
      </p>
    ),
  },
  {
    q: "help.q9",
    a: (t) => (
      <p>
        {t("help.a9.pre")} <Link href="/account">/account</Link>{" "}
        {t("help.a9.mid")}
        <em> {t("help.a9.btn")}</em> {t("help.a9.post")}
      </p>
    ),
  },
];

export default async function HelpPage() {
  const { t } = await serverI18n();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-widest text-foreground/40">
          {t("help.kicker")}
        </p>
        <h1 className="text-4xl font-medium tracking-tight">
          {t("help.title")}
        </h1>
        <p className="text-base text-foreground/60">
          {t("help.intro.pre")}{" "}
          <Link href="/feedback" className="underline hover:text-foreground">
            /feedback
          </Link>{" "}
          {t("help.intro.post")}
        </p>
      </header>
      <section className="flex flex-col gap-6">
        {FAQ.map((entry) => (
          <details
            key={entry.q}
            className="group rounded-md border border-muted/20 bg-muted/5 px-5 py-4 open:border-muted/40"
          >
            <summary className="cursor-pointer text-base font-medium text-foreground/90 list-none flex items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 text-accent transition group-open:rotate-90"
              >
                ▸
              </span>
              <span>{t(entry.q)}</span>
            </summary>
            <div className="prose prose-invert mt-3 pl-6 text-sm text-foreground/75">
              {entry.a(t)}
            </div>
          </details>
        ))}
      </section>
    </main>
  );
}
