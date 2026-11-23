import { BookOpenCheck, FileCheck2, Layers, PenTool, ShieldCheck, Sparkles, Users, Wand2 } from "lucide-react";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";

/** Original inline line art used for the sample books (no external or copyrighted assets). */
function SampleArt({ kind }: { kind: "critter" | "flower" | "fish" }) {
  const s = { fill: "#fff", stroke: "#221b3a", strokeWidth: 3, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  if (kind === "flower")
    return (
      <svg viewBox="0 0 200 200" width="100%" height="100%" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <ellipse key={i} cx={100 + Math.cos((i / 8) * Math.PI * 2) * 38} cy={92 + Math.sin((i / 8) * Math.PI * 2) * 38} rx="26" ry="15" transform={`rotate(${(i / 8) * 360} ${100 + Math.cos((i / 8) * Math.PI * 2) * 38} ${92 + Math.sin((i / 8) * Math.PI * 2) * 38})`} {...s} />
        ))}
        <circle cx="100" cy="92" r="22" {...s} />
        <path d="M100 135 C 98 160 102 175 100 195" {...s} fill="none" />
        <ellipse cx="122" cy="165" rx="20" ry="8" transform="rotate(-30 122 165)" {...s} />
      </svg>
    );
  if (kind === "fish")
    return (
      <svg viewBox="0 0 200 200" width="100%" height="100%" aria-hidden>
        <path d="M40 100 L10 75 L10 125 Z" {...s} />
        <ellipse cx="95" cy="100" rx="58" ry="36" {...s} />
        <path d="M75 66 C 80 85 80 115 75 134" {...s} fill="none" />
        <circle cx="128" cy="92" r="6" fill="#221b3a" />
        <circle cx="160" cy="50" r="8" {...s} />
        <circle cx="175" cy="28" r="5" {...s} />
        <path d="M30 185 C 40 160 30 150 40 130 M60 190 C 70 165 58 155 66 140" {...s} fill="none" />
      </svg>
    );
  return (
    <svg viewBox="0 0 200 200" width="100%" height="100%" aria-hidden>
      <ellipse cx="100" cy="135" rx="52" ry="45" {...s} />
      <ellipse cx="100" cy="142" rx="28" ry="26" {...s} />
      <circle cx="64" cy="58" r="14" {...s} />
      <circle cx="136" cy="58" r="14" {...s} />
      <ellipse cx="100" cy="80" rx="44" ry="38" {...s} />
      <circle cx="85" cy="76" r="7" {...s} />
      <circle cx="115" cy="76" r="7" {...s} />
      <circle cx="86" cy="77" r="3.5" fill="#221b3a" />
      <circle cx="116" cy="77" r="3.5" fill="#221b3a" />
      <path d="M88 94 Q100 104 112 94" {...s} fill="none" />
      <ellipse cx="72" cy="180" rx="20" ry="10" {...s} />
      <ellipse cx="128" cy="180" rx="20" ry="10" {...s} />
    </svg>
  );
}

const SAMPLES = [
  { title: "Picnic Pals", tag: "Kids 4–8 · Story + coloring", bg: "linear-gradient(160deg,#ffd76a,#ff9a7a)", art: "critter" as const },
  { title: "Bloom & Breathe", tag: "Adults · Patterns", bg: "linear-gradient(160deg,#b9f3df,#7cc7ff)", art: "flower" as const },
  { title: "Bubble Buddies", tag: "Preschool · Bold & easy", bg: "linear-gradient(160deg,#a9dcff,#c7b6ff)", art: "fish" as const },
];

export function Landing() {
  const { user } = useSession();
  const start = user ? "/new" : "/signup";
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div>
            <span className="badge manual" style={{ marginBottom: 14 }}>
              <Sparkles size={13} /> From one idea to KDP-ready files
            </span>
            <h1>
              Make a <em>whole coloring book</em>, not just pages.
            </h1>
            <p className="lead">Describe your book once. The studio writes the concept and story, keeps your characters consistent, draws every page as clean line art, typesets the cover wrap to your exact spine width, and checks the files against Amazon KDP's print rules.</p>
            <div className="row" style={{ marginTop: 22 }}>
              <Link to={start} className="btn primary lg">
                <Wand2 size={18} /> Start a new book
              </Link>
              <a href="#how" className="btn lg">
                See how it works
              </a>
            </div>
            <p className="subtle" style={{ marginTop: 14 }}>
              Works without API keys in a clearly labelled demo mode. Connect your own AI providers for real illustrations.
            </p>
          </div>
          <div className="book-stack" aria-label="Sample books">
            {SAMPLES.map((b, i) => (
              <div key={b.title} className="book" style={{ background: b.bg, left: `${8 + i * 22}%`, top: `${i * 22}px`, transform: `rotate(${(i - 1) * 6}deg)`, zIndex: 3 - Math.abs(i - 1) }}>
                <div className="spine" />
                <div className="cover-title">{b.title}</div>
                <div style={{ position: "absolute", left: "14%", right: "8%", bottom: "8%", height: "62%", background: "#fff", borderRadius: 10, padding: 8 }}>
                  <SampleArt kind={b.art} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="features">
        <h2>Everything between the idea and the upload</h2>
        <p className="center">One workspace for the story, the art, the layout and the paperwork, so you don't stitch five tools together for every book.</p>
        <div className="features">
          {[
            { icon: <PenTool size={20} />, c: "var(--primary-soft)", t: "Story & concept", d: "Title, synopsis, character bible and a page-by-page scene plan, validated before it's saved. Story-only, coloring-only or both." },
            { icon: <Users size={20} />, c: "var(--ink-soft)", t: "Consistent characters", d: "Every prompt repeats the same character descriptions, and approved reference images condition providers that support it." },
            { icon: <Layers size={20} />, c: "var(--mint-soft)", t: "Page studio", d: "Grid and single-page views, drag to reorder, edit prompts, regenerate, upload replacements, approve and lock, undo." },
            { icon: <BookOpenCheck size={20} />, c: "var(--sun-soft)", t: "Cover wrap", d: "Front art plus a typeset back, spine and front, sized from your trim, paper and final page count." },
            { icon: <FileCheck2 size={20} />, c: "var(--sky-soft)", t: "KDP validation", d: "Page count, trim, margins, gutter, bleed, DPI, fonts, spine and barcode checks, each with a suggested fix." },
            { icon: <ShieldCheck size={20} />, c: "var(--success-soft)", t: "Honest by design", d: "Demo placeholders are always labelled, costs are estimated before big batches, and nothing is ever published for you." },
          ].map((f) => (
            <div className="feature" key={f.t}>
              <div className="icon" style={{ background: f.c }}>
                {f.icon}
              </div>
              <h3>{f.t}</h3>
              <p className="muted" style={{ margin: 0 }}>
                {f.d}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="how" style={{ paddingTop: 0 }}>
        <h2>How a book comes together</h2>
        <p className="center">You stay in charge at every step: nothing is final until you approve it.</p>
        <div className="steps">
          {[
            ["Write the brief", "Theme, audience, language, art style, trim size and page count."],
            ["Review the plan", "Edit the story, scenes and character bible. Regenerate any section."],
            ["Illustrate", "Generate pages in a background batch with a cost estimate up front."],
            ["Approve & arrange", "Inspect each page at full size, reorder, replace and approve."],
            ["Design the cover", "Front art, back blurb, spine text and barcode space."],
            ["Export & validate", "Interior PDF, cover PDF, listing copy and a KDP checklist in one package."],
          ].map(([t, d]) => (
            <div className="step" key={t}>
              <h3>{t}</h3>
              <p className="muted" style={{ margin: 0 }}>
                {d}
              </p>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 34 }}>
          <Link to={start} className="btn primary lg">
            Create your first book
          </Link>
          <p className="subtle" style={{ marginTop: 12 }}>
            Not affiliated with Amazon. KDP is a trademark of Amazon.com, Inc. Files are checked against KDP's published specifications; always review them in KDP's Print Previewer.
          </p>
        </div>
      </section>
    </>
  );
}
