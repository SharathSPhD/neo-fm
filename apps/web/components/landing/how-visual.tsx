/**
 * "How it works" visual: one worked example flowing brief -> lyrics -> song. The example is an illustration
 * (a real engine output for an evaluation brief), and says so. Pure markup, no client JS.
 */
const BARS = [30, 55, 40, 75, 50, 90, 60, 80, 45, 70, 35, 65, 85, 50, 40, 70, 55, 30];

export function HowVisual() {
  return (
    <figure className="mt-10" aria-labelledby="how-visual-caption">
      <div className="grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
        <div className="glass rounded-2xl p-5">
          <p className="text-[11px] font-medium uppercase tracking-widest text-foreground/60">1 · Your brief</p>
          <p className="mt-3 text-sm leading-relaxed text-foreground/90">
            &ldquo;A tender bhavageete about a daughter leaving home after marriage, remembering the courtyard and her mother&apos;s lullabies.&rdquo;
          </p>
          <p className="mt-3 text-xs text-foreground/60">Kannada · light-classical · 30 seconds</p>
        </div>

        <Arrow />

        <div className="rounded-xl border border-accent/30 bg-accent/5 p-5">
          <p className="text-[11px] font-medium uppercase tracking-widest text-accent">2 · Lyrics, written natively</p>
          <p lang="kn" className="mt-3 whitespace-pre-line text-lg leading-relaxed">{"ಅಂಗಳದ ತುಳಸಿಯ ನೆರಳು ಕರೆದಿದೆ\nಅಮ್ಮನ ಲಾಲಿ ಇನ್ನೂ ಉಸಿರಾಡಿದೆ"}</p>
          <ul className="mt-4 flex flex-wrap gap-2 text-xs text-foreground/70" aria-label="Lyric engine steps">
            <li className="rounded-full border border-muted/40 px-2.5 py-0.5">several drafts</li>
            <li className="rounded-full border border-muted/40 px-2.5 py-0.5">best fit chosen</li>
            <li className="rounded-full border border-muted/40 px-2.5 py-0.5">meter &amp; diction pass</li>
          </ul>
        </div>

        <Arrow />

        <div className="glass rounded-2xl p-5">
          <p className="text-[11px] font-medium uppercase tracking-widest text-foreground/60">3 · Your song</p>
          <div className="mt-4 flex h-12 items-end gap-1" aria-hidden>
            {BARS.map((h, i) => (
              <span key={i} className="w-1.5 rounded-xs bg-accent/70" style={{ height: `${h}%` }} />
            ))}
          </div>
          <p className="mt-3 text-xs text-foreground/70">Performed by a singer, then checked line by line against your lyrics.</p>
          <p className="mt-1 text-xs text-foreground/60">Labelled AI-generated · share by link</p>
        </div>
      </div>
      <figcaption id="how-visual-caption" className="mt-3 text-xs text-foreground/60">
        Example only: the brief and lyric are an engine output from our own evaluation set, not a customer&apos;s song.
      </figcaption>
    </figure>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center text-accent" aria-hidden>
      <span className="text-2xl lg:hidden">↓</span>
      <span className="hidden text-2xl lg:inline">→</span>
    </div>
  );
}
