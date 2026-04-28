"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

type SummaryTier = "executive" | "sections" | "entities";

interface Citation {
  text: string;
  page: number | null;
  section: string | null;
}

interface SectionItem {
  title: string;
  summary: string;
  page: number | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  follow_up_questions?: string[];
}

export default function DocumentPage() {
  const params = useParams();
  const docId = params.id as string;
  const router = useRouter();
  const supabase = createClient();

  const [token, setToken] = useState("");
  const [activeTab, setActiveTab] = useState<"summary" | "chat" | "entities">("summary");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Summary state
  const [executive, setExecutive] = useState<string | null>(null);
  const [sections, setSections] = useState<SectionItem[]>([]);
  const [entities, setEntities] = useState<Record<string, string[]> | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace("/login"); return; }
      setToken(session.access_token);
    });
  }, []);

  async function runAutoSummarize() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/summarize/auto`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ document_id: docId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Summarization failed");

      const r = data.results;
      if (r.executive) {
        setExecutive(r.executive.summary || "");
        setCitations(r.executive.citations || []);
      }
      if (r.sections?.sections) setSections(r.sections.sections);
      if (r.entities?.entities) setEntities(r.entities.entities);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  async function sendChat() {
    if (!chatInput.trim() || !token) return;
    const question = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: question }]);
    setChatLoading(true);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          document_id: docId,
          question,
          history: chatMessages.slice(-6),
        }),
      });
      const data = await res.json();
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer || "Sorry, I could not generate an answer.",
          citations: data.citations || [],
          follow_up_questions: data.follow_up_questions || [],
        },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error connecting to the backend." },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  const tabStyle = (t: string) => ({
    padding: "12px 24px",
    fontFamily: "var(--font-heading)",
    fontWeight: 800,
    fontSize: "14px",
    letterSpacing: "0.02em",
    border: "2px solid #000",
    cursor: "pointer",
    background: activeTab === t ? "var(--primary)" : "var(--surface-container)",
    color: activeTab === t ? "#000" : "var(--on-surface-variant)",
    boxShadow: activeTab === t ? "4px 4px 0 #000" : "none",
    transition: "all 0.1s ease",
  });

  return (
    <div style={{ minHeight: "100vh", background: "var(--surface)", display: "flex", flexDirection: "column" }}>
      {/* Navbar */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 48px", borderBottom: "2px solid #000", background: "var(--surface-container)" }}>
        <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "24px", letterSpacing: "-0.05em", color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push("/dashboard")}>
          DOCUMIND<span style={{ color: "var(--on-surface-variant)" }}>AI</span>
        </span>
        <button onClick={() => router.push("/dashboard")} className="nb-btn nb-btn--ghost" style={{ fontSize: "14px" }}>
          ← Back to Dashboard
        </button>
      </nav>

      <main style={{ flex: 1, padding: "48px", maxWidth: "1100px", width: "100%", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "32px" }}>
          <div className="nb-chip nb-chip--primary" style={{ marginBottom: "16px" }}>DOCUMENT ANALYSIS</div>
          <h1 style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "32px", letterSpacing: "-0.04em", marginBottom: "8px" }}>
            Document: {docId.slice(0, 16)}
          </h1>
          <button
            onClick={runAutoSummarize}
            className="nb-btn nb-btn--primary"
            disabled={loading}
            style={{ fontSize: "16px", padding: "14px 28px", marginTop: "16px" }}
          >
            {loading ? "⏳ ANALYZING..." : "🧠 RUN AI ANALYSIS"}
          </button>
        </div>

        {error && (
          <div style={{ padding: "16px", border: "2px solid #ff4a3d", background: "#ffebe5", color: "#c92a1f", marginBottom: "24px", fontWeight: 700 }}>
            ⚠ {error}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: "0", marginBottom: "32px", flexWrap: "wrap" }}>
          <button style={tabStyle("summary")} onClick={() => setActiveTab("summary")}>📝 SUMMARY</button>
          <button style={tabStyle("chat")} onClick={() => setActiveTab("chat")}>💬 Q&A CHAT</button>
          <button style={tabStyle("entities")} onClick={() => setActiveTab("entities")}>🏷 ENTITIES</button>
        </div>

        {/* Summary Tab */}
        {activeTab === "summary" && (
          <div>
            {/* Executive Summary */}
            <div className="nb-card" style={{ marginBottom: "24px" }}>
              <div className="nb-card__header">⚡ EXECUTIVE SUMMARY</div>
              <div className="nb-card__body">
                {loading ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ height: "14px", background: "#333", borderRadius: "2px", opacity: 0.15, animation: "pulse 1.5s infinite" }} />
                    <div style={{ height: "14px", width: "75%", background: "#333", borderRadius: "2px", opacity: 0.15, animation: "pulse 1.5s infinite" }} />
                    <div style={{ height: "14px", width: "50%", background: "#333", borderRadius: "2px", opacity: 0.15, animation: "pulse 1.5s infinite" }} />
                  </div>
                ) : executive ? (
                  <p style={{ color: "var(--on-surface)", lineHeight: 1.7, fontSize: "15px" }}>{executive}</p>
                ) : (
                  <p style={{ color: "var(--on-surface-variant)" }}>Click &quot;Run AI Analysis&quot; to generate the summary.</p>
                )}
              </div>
            </div>

            {/* Citations */}
            {citations.length > 0 && (
              <div className="nb-card" style={{ marginBottom: "24px" }}>
                <div className="nb-card__header">📎 CITATIONS</div>
                <div className="nb-card__body" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {citations.map((c, i) => (
                    <span key={i} className="nb-chip" style={{ fontSize: "12px" }}>
                      {c.section || (c.page ? `Page ${c.page}` : `Source ${i + 1}`)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Section Breakdown */}
            {sections.length > 0 && (
              <div className="nb-card">
                <div className="nb-card__header">📑 SECTION BREAKDOWN</div>
                <div className="nb-card__body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {sections.map((sec, i) => (
                    <div key={i} style={{ padding: "16px", border: "1px solid #444", background: "var(--surface-container)" }}>
                      <h4 style={{ fontWeight: 700, marginBottom: "8px", fontSize: "14px" }}>
                        {sec.title} {sec.page && <span className="nb-chip" style={{ fontSize: "11px", marginLeft: "8px" }}>Page {sec.page}</span>}
                      </h4>
                      <p style={{ fontSize: "13px", lineHeight: 1.6, color: "var(--on-surface-variant)" }}>{sec.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Chat Tab */}
        {activeTab === "chat" && (
          <div className="nb-card">
            <div className="nb-card__header">💬 ASK ANYTHING ABOUT THIS DOCUMENT</div>
            <div className="nb-card__body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Messages */}
              <div style={{ maxHeight: "400px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", paddingBottom: "16px" }}>
                {chatMessages.length === 0 && (
                  <p style={{ color: "var(--on-surface-variant)", textAlign: "center", padding: "24px" }}>
                    Ask a question about the document. Make sure to run &quot;AI Analysis&quot; first!
                  </p>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} style={{ display: "flex", gap: "12px", alignItems: msg.role === "user" ? "flex-end" : "flex-start", flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
                    <div style={{
                      padding: "12px 16px",
                      border: "2px solid #000",
                      maxWidth: "80%",
                      background: msg.role === "user" ? "var(--primary)" : "var(--surface-container)",
                      color: msg.role === "user" ? "#000" : "var(--on-surface)",
                      boxShadow: "3px 3px 0 #000",
                      fontSize: "14px",
                      lineHeight: 1.6,
                    }}>
                      {msg.content}
                      {msg.citations && msg.citations.length > 0 && (
                        <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {msg.citations.map((c, ci) => (
                            <span key={ci} className="nb-chip" style={{ fontSize: "11px" }}>
                              {c.section || (c.page ? `Page ${c.page}` : `Source`)}
                            </span>
                          ))}
                        </div>
                      )}
                      {msg.follow_up_questions && msg.follow_up_questions.length > 0 && (
                        <div style={{ marginTop: "12px", borderTop: "1px solid #555", paddingTop: "8px" }}>
                          <p style={{ fontSize: "11px", color: "var(--on-surface-variant)", marginBottom: "4px" }}>Follow-up questions:</p>
                          {msg.follow_up_questions.map((q, qi) => (
                            <button
                              key={qi}
                              onClick={() => setChatInput(q)}
                              style={{ display: "block", background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: "13px", textAlign: "left", padding: "2px 0", textDecoration: "underline" }}
                            >
                              → {q}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div style={{ padding: "12px 16px", border: "2px solid #000", background: "var(--surface-container)", boxShadow: "3px 3px 0 #000", maxWidth: "60%" }}>
                    <span style={{ animation: "pulse 1s infinite" }}>Thinking...</span>
                  </div>
                )}
              </div>

              {/* Input */}
              <form
                onSubmit={(e) => { e.preventDefault(); sendChat(); }}
                style={{ display: "flex", gap: "12px" }}
              >
                <input
                  type="text"
                  className="nb-input"
                  placeholder="Ask anything about this document..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button type="submit" className="nb-btn nb-btn--primary" disabled={chatLoading || !chatInput.trim()}>
                  SEND →
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Entities Tab */}
        {activeTab === "entities" && (
          <div className="nb-card">
            <div className="nb-card__header">🏷 KEY ENTITIES</div>
            <div className="nb-card__body">
              {entities ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                  {Object.entries(entities).map(([category, items]) => (
                    <div key={category}>
                      <h4 style={{ fontWeight: 700, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--on-surface-variant)", marginBottom: "8px" }}>
                        {category.replace(/_/g, " ")}
                      </h4>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        {(items || []).length > 0 ? items.map((item, i) => (
                          <span key={i} className="nb-chip" style={{ fontSize: "13px" }}>{item}</span>
                        )) : (
                          <span style={{ color: "var(--on-surface-variant)", fontSize: "13px" }}>None found</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: "var(--on-surface-variant)" }}>
                  Click &quot;Run AI Analysis&quot; to extract entities (people, dates, amounts, key terms).
                </p>
              )}
            </div>
          </div>
        )}
      </main>

      <style>{`
        @keyframes pulse {
          0% { opacity: 0.15; }
          50% { opacity: 0.35; }
          100% { opacity: 0.15; }
        }
      `}</style>
    </div>
  );
}
