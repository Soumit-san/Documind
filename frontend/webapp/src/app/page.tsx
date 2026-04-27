import Link from "next/link";

export default function Home() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ─── Navbar ─── */}
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 48px",
          borderBottom: "2px solid #000",
          background: "var(--surface-container)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 800,
            fontSize: "24px",
            letterSpacing: "-0.05em",
            color: "var(--primary)",
          }}
        >
          DOCUMIND<span style={{ color: "var(--on-surface-variant)" }}>AI</span>
        </span>
        <div style={{ display: "flex", gap: "12px" }}>
          <Link href="/login" className="nb-btn nb-btn--ghost">
            Login
          </Link>
          <Link href="/login" className="nb-btn nb-btn--primary">
            Get Started
          </Link>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "64px 48px",
          textAlign: "center",
        }}
      >
        <div
          className="nb-chip nb-chip--primary"
          style={{ marginBottom: "24px" }}
        >
          AI-POWERED DOCUMENT INTELLIGENCE
        </div>

        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 800,
            fontSize: "clamp(40px, 6vw, 72px)",
            letterSpacing: "-0.05em",
            lineHeight: 1.05,
            maxWidth: "900px",
            marginBottom: "24px",
          }}
        >
          Read less.
          <br />
          <span style={{ color: "var(--primary)" }}>Know more.</span>
        </h1>

        <p
          style={{
            fontSize: "18px",
            lineHeight: 1.6,
            color: "var(--on-surface-variant)",
            maxWidth: "640px",
            marginBottom: "48px",
          }}
        >
          Upload any document — PDFs, DOCX, PPTX — and instantly get
          AI-generated summaries, key entity extraction, and natural-language
          Q&A. Stop scrolling. Start understanding.
        </p>

        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", justifyContent: "center" }}>
          <Link href="/login" className="nb-btn nb-btn--primary" style={{ fontSize: "16px", padding: "16px 32px" }}>
            Upload a Document →
          </Link>
          <button className="nb-btn nb-btn--secondary" style={{ fontSize: "16px", padding: "16px 32px" }}>
            Install Chrome Extension
          </button>
        </div>

        {/* ─── Feature Cards ─── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "24px",
            maxWidth: "1000px",
            width: "100%",
            marginTop: "80px",
          }}
        >
          <div className="nb-card">
            <div className="nb-card__header">⚡ INSTANT SUMMARIES</div>
            <div className="nb-card__body">
              <p style={{ color: "var(--on-surface-variant)" }}>
                Executive summaries, section breakdowns, and key entity
                extraction — generated in under 3 seconds.
              </p>
            </div>
          </div>

          <div className="nb-card">
            <div className="nb-card__header">💬 ASK ANYTHING</div>
            <div className="nb-card__body">
              <p style={{ color: "var(--on-surface-variant)" }}>
                Natural-language Q&A with cited answers. Multi-turn
                conversations that remember context.
              </p>
            </div>
          </div>

          <div className="nb-card">
            <div className="nb-card__header">📁 MULTI-DOC CORPUS</div>
            <div className="nb-card__body">
              <p style={{ color: "var(--on-surface-variant)" }}>
                Build a personal document library. Ask questions across your
                entire collection at once.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* ─── Footer ─── */}
      <footer
        style={{
          padding: "24px 48px",
          borderTop: "2px solid #000",
          background: "var(--surface-container)",
          textAlign: "center",
          fontFamily: "var(--font-body)",
          fontSize: "14px",
          color: "var(--on-surface-variant)",
        }}
      >
        DocuMind AI © 2025 — Built with a 100% free stack.
      </footer>
    </div>
  );
}
