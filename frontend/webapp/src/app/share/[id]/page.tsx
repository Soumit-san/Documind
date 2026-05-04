"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

interface SharedData {
  title: string;
  content: {
    executive_summary?: string;
    sections?: { title: string; summary: string; page?: number }[];
    entities?: Record<string, string[]>;
    citations?: { text: string; page?: number; section?: string }[];
    chat_messages?: { role: string; content: string }[];
  };
  created_at: string;
}

export default function ShareViewPage() {
  const params = useParams();
  const shareId = params.id as string;

  const [data, setData] = useState<SharedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Password flow
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    fetchShare();
  }, []);

  async function fetchShare(pw?: string) {
    setLoading(true);
    setError(null);
    setPasswordError(null);
    try {
      const url = new URL(`${API_URL}/share/${shareId}`);

      const res = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: pw || null }),
      });

      if (res.status === 401) {
        setNeedsPassword(true);
        setLoading(false);
        return;
      }
      if (res.status === 403) {
        setPasswordError("Incorrect password. Please try again.");
        setLoading(false);
        return;
      }

      let json = null;
      if (res.headers.get("content-type")?.includes("application/json")) {
        json = await res.json();
      }

      if (!res.ok) throw new Error(json?.detail || "Share not found or expired");

      setData(json);
      setNeedsPassword(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load shared analysis");
    } finally {
      setLoading(false);
    }
  }

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    fetchShare(password);
  }

  // ─── Password Gate ───
  if (needsPassword && !data) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          background: "var(--surface-container)", border: "3px solid #000",
          boxShadow: "8px 8px 0 #000", padding: "48px", width: "100%",
          maxWidth: "420px", textAlign: "center",
        }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>🔒</div>
          <h2 style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "22px", marginBottom: "8px" }}>
            PASSWORD PROTECTED
          </h2>
          <p style={{ color: "var(--on-surface-variant)", fontSize: "14px", marginBottom: "24px" }}>
            This shared analysis requires a password to view.
          </p>
          <form onSubmit={handlePasswordSubmit}>
            <input
              type="password"
              className="nb-input"
              placeholder="Enter password..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: "100%", marginBottom: "16px" }}
              autoFocus
            />
            {passwordError && (
              <p style={{ color: "var(--error)", fontSize: "13px", fontWeight: 700, marginBottom: "12px" }}>
                ⚠ {passwordError}
              </p>
            )}
            <button type="submit" className="nb-btn nb-btn--primary" style={{ width: "100%", fontSize: "16px", padding: "14px" }}>
              UNLOCK →
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ─── Loading / Error ───
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "18px", color: "var(--on-surface-variant)" }}>
          ⏳ LOADING SHARED ANALYSIS...
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>❌</div>
          <p style={{ fontWeight: 700, color: "var(--error)", fontSize: "16px" }}>{error || "Share not found"}</p>
        </div>
      </div>
    );
  }

  const { content } = data;

  // ─── Rendered Share ───
  return (
    <div style={{ minHeight: "100vh", background: "var(--surface)", display: "flex", flexDirection: "column" }}>
      {/* Navbar */}
      <nav style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 48px", borderBottom: "2px solid #000",
        background: "var(--surface-container)",
      }}>
        <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "24px", letterSpacing: "-0.05em", color: "var(--primary)" }}>
          DOCUMIND<span style={{ color: "var(--on-surface-variant)" }}>AI</span>
        </span>
        <span className="nb-chip" style={{ fontSize: "11px" }}>SHARED ANALYSIS</span>
      </nav>

      <main style={{ flex: 1, padding: "48px", maxWidth: "900px", width: "100%", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "40px" }}>
          <div className="nb-chip nb-chip--primary" style={{ marginBottom: "16px" }}>SHARED DOCUMENT</div>
          <h1 style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "32px", letterSpacing: "-0.04em", marginBottom: "8px" }}>
            {data.title}
          </h1>
          <p style={{ color: "var(--on-surface-variant)", fontSize: "13px" }}>
            Shared on {new Date(data.created_at).toLocaleDateString()} · View-only
          </p>
        </div>

        {/* Executive Summary */}
        {content.executive_summary && (
          <div className="nb-card" style={{ marginBottom: "24px" }}>
            <div className="nb-card__header">⚡ EXECUTIVE SUMMARY</div>
            <div className="nb-card__body">
              <p style={{ color: "var(--on-surface)", lineHeight: 1.7, fontSize: "15px" }}>
                {content.executive_summary}
              </p>
            </div>
          </div>
        )}

        {/* Section Breakdown */}
        {content.sections && content.sections.length > 0 && (
          <div className="nb-card" style={{ marginBottom: "24px" }}>
            <div className="nb-card__header">📑 SECTION BREAKDOWN</div>
            <div className="nb-card__body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {content.sections.map((sec, i) => (
                <div key={i} style={{ padding: "16px", border: "1px solid #444", background: "var(--surface-container)" }}>
                  <h4 style={{ fontWeight: 700, fontSize: "14px", marginBottom: "8px" }}>
                    {sec.title} {sec.page && <span className="nb-chip" style={{ fontSize: "11px", marginLeft: "8px" }}>Page {sec.page}</span>}
                  </h4>
                  <p style={{ fontSize: "13px", lineHeight: 1.6, color: "var(--on-surface-variant)" }}>{sec.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Entities */}
        {content.entities && (
          <div className="nb-card" style={{ marginBottom: "24px" }}>
            <div className="nb-card__header">🏷 KEY ENTITIES</div>
            <div className="nb-card__body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {Object.entries(content.entities).map(([category, items]) => (
                <div key={category}>
                  <h4 style={{ fontWeight: 700, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--on-surface-variant)", marginBottom: "8px" }}>
                    {category.replace(/_/g, " ")}
                  </h4>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {(items || []).map((item, i) => (
                      <span key={i} className="nb-chip" style={{ fontSize: "13px" }}>{item}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chat Transcript */}
        {content.chat_messages && content.chat_messages.length > 0 && (
          <div className="nb-card" style={{ marginBottom: "24px" }}>
            <div className="nb-card__header">💬 CHAT TRANSCRIPT</div>
            <div className="nb-card__body" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {content.chat_messages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex", gap: "12px",
                    justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                  }}
                >
                  {msg.role === "assistant" && (
                    <div style={{
                      width: "32px", height: "32px", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "var(--primary)", color: "var(--on-primary)",
                      border: "2px solid #000", fontSize: "16px",
                    }}>
                      🧠
                    </div>
                  )}
                  <div style={{
                    padding: "12px 16px", border: "2px solid #000", maxWidth: "75%",
                    background: msg.role === "user" ? "var(--primary)" : "var(--surface-container-high)",
                    color: msg.role === "user" ? "#000" : "var(--on-surface)",
                    boxShadow: "3px 3px 0 #000", fontSize: "13px", lineHeight: 1.6,
                  }}>
                    <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{msg.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Citations */}
        {content.citations && content.citations.length > 0 && (
          <div className="nb-card">
            <div className="nb-card__header">📎 CITATIONS</div>
            <div className="nb-card__body" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {content.citations.map((c, i) => (
                <span key={i} className="nb-chip" style={{ fontSize: "12px" }}>
                  {c.section || (c.page ? `Page ${c.page}` : `Source ${i + 1}`)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: "48px", textAlign: "center", padding: "24px", borderTop: "1px solid #333" }}>
          <p style={{ fontSize: "12px", color: "var(--on-surface-variant)" }}>
            Shared via <strong>DocuMind AI</strong> — Intelligent Document Assistant
          </p>
        </div>
      </main>
    </div>
  );
}
