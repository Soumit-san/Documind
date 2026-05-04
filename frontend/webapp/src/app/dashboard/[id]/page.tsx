"use client";

import { useEffect, useState, useRef } from "react";
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
  const chatEndRef = useRef<HTMLDivElement>(null);

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
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [feedbackState, setFeedbackState] = useState<Record<number, "up" | "down" | null>>({});

  // Export & Share state
  const [exporting, setExporting] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [sharePassword, setSharePassword] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareCreating, setShareCreating] = useState(false);
  const [clipboardMsg, setClipboardMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace("/login"); return; }
      setToken(session.access_token);
    });
  }, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

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

  async function sendChat(overrideQuestion?: string) {
    const question = (overrideQuestion || chatInput).trim();
    if (!question || !token) return;
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
      if (!res.ok) throw new Error(data.detail || "Chat failed");
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer || "Sorry, I could not generate an answer.",
          citations: data.citations || [],
          follow_up_questions: data.follow_up_questions || [],
        },
      ]);
    } catch (e: unknown) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠ ${e instanceof Error ? e.message : "Error connecting to the backend."}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  function handleCopy(text: string, idx: number) {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  function handleFeedback(idx: number, type: "up" | "down") {
    setFeedbackState((prev) => ({
      ...prev,
      [idx]: prev[idx] === type ? null : type,
    }));
  }

  const tabStyle = (t: string) => ({
    padding: "12px 24px",
    fontFamily: "var(--font-heading)",
    fontWeight: 800 as const,
    fontSize: "14px",
    letterSpacing: "0.02em",
    border: "2px solid #000",
    cursor: "pointer",
    background: activeTab === t ? "var(--primary)" : "var(--surface-container)",
    color: activeTab === t ? "#000" : "var(--on-surface-variant)",
    boxShadow: activeTab === t ? "4px 4px 0 #000" : "none",
    transition: "all 0.1s ease",
  });

  const starterQuestions = [
    { icon: "📋", text: "What is this document about?" },
    { icon: "🔍", text: "What are the key findings?" },
    { icon: "✅", text: "Summarize the main conclusions" },
    { icon: "⚠️", text: "Are there any risks or concerns mentioned?" },
  ];

  function getExportPayload() {
    return {
      title: `Document ${docId.slice(0, 16)}`,
      executive_summary: executive || "",
      sections: sections.length > 0 ? sections : null,
      entities: entities || null,
      citations: citations.length > 0 ? citations : null,
      chat_messages: chatMessages.length > 0 ? chatMessages.map(m => ({ role: m.role, content: m.content })) : null,
    };
  }

  async function handleExport(format: "pdf" | "docx") {
    if (!token) return;
    setExporting(true);
    try {
      const res = await fetch(`${API_URL}/export/${format}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(getExportPayload()),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `analysis.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function handleCopyAll() {
    let text = "";
    if (executive) text += `EXECUTIVE SUMMARY\n${executive}\n\n`;
    if (sections.length > 0) {
      text += "SECTION BREAKDOWN\n";
      sections.forEach(s => { text += `${s.title}: ${s.summary}\n`; });
      text += "\n";
    }
    if (entities) {
      text += "KEY ENTITIES\n";
      Object.entries(entities).forEach(([k, v]) => { if (v?.length) text += `${k}: ${v.join(", ")}\n`; });
      text += "\n";
    }
    if (chatMessages.length > 0) {
      text += "CHAT TRANSCRIPT\n";
      chatMessages.forEach(m => { text += `${m.role === "user" ? "You" : "DocuMind AI"}: ${m.content}\n`; });
    }
    try {
      await navigator.clipboard.writeText(text.trim());
      setClipboardMsg("Copied!");
      setTimeout(() => setClipboardMsg(null), 2000);
    } catch {
      setClipboardMsg("Failed");
      setTimeout(() => setClipboardMsg(null), 2000);
    }
  }

  async function handleCreateShare() {
    if (!token) return;
    setShareCreating(true);
    try {
      const res = await fetch(`${API_URL}/share`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          document_id: docId,
          title: `Document ${docId.slice(0, 16)}`,
          content: getExportPayload(),
          password: sharePassword || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Share failed");
      setShareUrl(`${window.location.origin}${data.share_url}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Share failed");
    } finally {
      setShareCreating(false);
    }
  }

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

      <main style={{ flex: 1, padding: "48px", maxWidth: "1100px", width: "100%", margin: "0 auto", display: "flex", flexDirection: "column" }}>
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
          <div style={{ padding: "16px", border: "2px solid #ff4a3d", background: "#2a1a1a", color: "#ffb4ab", marginBottom: "24px", fontWeight: 700 }}>
            ⚠ {error}
          </div>
        )}

        {/* Tabs + Export Toolbar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ display: "flex", gap: "0" }}>
            <button style={tabStyle("summary")} onClick={() => setActiveTab("summary")}>📝 SUMMARY</button>
            <button style={tabStyle("chat")} onClick={() => setActiveTab("chat")}>💬 Q&A CHAT</button>
            <button style={tabStyle("entities")} onClick={() => setActiveTab("entities")}>🏷 ENTITIES</button>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              onClick={handleCopyAll}
              disabled={!executive && chatMessages.length === 0}
              style={{
                padding: "8px 14px", fontSize: "12px", fontWeight: 700,
                border: "2px solid #000", cursor: "pointer",
                background: clipboardMsg === "Copied!" ? "var(--primary)" : "var(--surface-container)",
                color: clipboardMsg === "Copied!" ? "#000" : "var(--on-surface)",
                transition: "all 0.15s",
              }}
            >
              {clipboardMsg || "📋 COPY"}
            </button>
            <button
              onClick={() => handleExport("pdf")}
              disabled={exporting || (!executive && chatMessages.length === 0)}
              style={{
                padding: "8px 14px", fontSize: "12px", fontWeight: 700,
                border: "2px solid #000", cursor: "pointer",
                background: "var(--surface-container)", color: "var(--on-surface)",
              }}
            >
              {exporting ? "⏳" : "📄 PDF"}
            </button>
            <button
              onClick={() => handleExport("docx")}
              disabled={exporting || (!executive && chatMessages.length === 0)}
              style={{
                padding: "8px 14px", fontSize: "12px", fontWeight: 700,
                border: "2px solid #000", cursor: "pointer",
                background: "var(--surface-container)", color: "var(--on-surface)",
              }}
            >
              {exporting ? "⏳" : "📝 DOCX"}
            </button>
            <button
              onClick={() => { setShowShareModal(true); setShareUrl(null); setSharePassword(""); }}
              disabled={!executive && chatMessages.length === 0}
              style={{
                padding: "8px 14px", fontSize: "12px", fontWeight: 700,
                border: "2px solid #000", cursor: "pointer",
                background: "var(--tertiary-container)", color: "var(--on-tertiary-container)",
              }}
            >
              🔗 SHARE
            </button>
          </div>
        </div>

        {/* Share Modal */}
        {showShareModal && (
          <div style={{
            position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
            background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center",
            justifyContent: "center", zIndex: 1000,
          }} onClick={() => setShowShareModal(false)}>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--surface-container)", border: "3px solid #000",
                boxShadow: "8px 8px 0 #000", padding: "32px", width: "100%",
                maxWidth: "480px", animation: "chatMsgIn 0.2s ease-out",
              }}
            >
              <h3 style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "20px", marginBottom: "20px" }}>
                🔗 CREATE SHARE LINK
              </h3>

              {!shareUrl ? (
                <>
                  <label style={{ fontSize: "13px", fontWeight: 700, color: "var(--on-surface-variant)", display: "block", marginBottom: "8px" }}>
                    Password (optional)
                  </label>
                  <input
                    type="password"
                    className="nb-input"
                    placeholder="Leave empty for no password"
                    value={sharePassword}
                    onChange={(e) => setSharePassword(e.target.value)}
                    style={{ width: "100%", marginBottom: "20px" }}
                  />
                  <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                    <button onClick={() => setShowShareModal(false)} className="nb-btn nb-btn--ghost">Cancel</button>
                    <button onClick={handleCreateShare} className="nb-btn nb-btn--primary" disabled={shareCreating}>
                      {shareCreating ? "⏳ Creating..." : "CREATE LINK"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ fontSize: "13px", color: "var(--on-surface-variant)", marginBottom: "12px" }}>
                    Your share link is ready! Anyone with this link can view the analysis.
                  </p>
                  <div style={{
                    display: "flex", gap: "8px", padding: "12px",
                    background: "var(--surface-container-high)", border: "2px solid #000",
                  }}>
                    <input
                      type="text" readOnly value={shareUrl}
                      style={{
                        flex: 1, background: "transparent", border: "none",
                        color: "var(--primary)", fontSize: "13px", fontWeight: 700,
                        outline: "none",
                      }}
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(shareUrl);
                        setClipboardMsg("Link copied!");
                        setTimeout(() => setClipboardMsg(null), 2000);
                      }}
                      className="nb-btn nb-btn--primary"
                      style={{ padding: "6px 14px", fontSize: "12px" }}
                    >
                      📋 COPY
                    </button>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
                    <button onClick={() => setShowShareModal(false)} className="nb-btn nb-btn--ghost">Close</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

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

        {/* ─── Chat Tab ─── */}
        {activeTab === "chat" && (
          <div className="nb-card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: "500px" }}>
            <div className="nb-card__header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>💬 ASK ANYTHING ABOUT THIS DOCUMENT</span>
              {chatMessages.length > 0 && (
                <button
                  onClick={() => { setChatMessages([]); setFeedbackState({}); }}
                  style={{
                    background: "none", border: "1px solid #555", color: "var(--on-surface-variant)",
                    padding: "4px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer",
                    textTransform: "uppercase", letterSpacing: "0.03em",
                  }}
                >
                  Clear Chat
                </button>
              )}
            </div>
            <div className="nb-card__body" style={{ flex: 1, display: "flex", flexDirection: "column", padding: 0 }}>
              {/* Messages area */}
              <div style={{
                flex: 1, overflowY: "auto", padding: "24px",
                display: "flex", flexDirection: "column", gap: "16px",
              }}>
                {/* Welcome state */}
                {chatMessages.length === 0 && !chatLoading && (
                  <div style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", textAlign: "center", padding: "48px 24px", gap: "16px",
                  }}>
                    <div style={{
                      width: "64px", height: "64px", display: "flex", alignItems: "center",
                      justifyContent: "center", background: "var(--primary)", color: "var(--on-primary)",
                      border: "2px solid #000", boxShadow: "4px 4px 0 #000", fontSize: "32px",
                    }}>
                      🧠
                    </div>
                    <h3 style={{
                      fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "22px",
                      letterSpacing: "-0.03em", textTransform: "uppercase",
                    }}>
                      Ask me anything
                    </h3>
                    <p style={{ color: "var(--on-surface-variant)", fontSize: "14px", maxWidth: "400px", lineHeight: 1.6 }}>
                      I can answer questions about your document with cited sources. Every answer is grounded in the actual document text.
                    </p>
                    <div style={{
                      display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px",
                      width: "100%", maxWidth: "500px", marginTop: "8px",
                    }}>
                      {starterQuestions.map((q, i) => (
                        <button
                          key={i}
                          onClick={() => { setActiveTab("chat"); sendChat(q.text); }}
                          style={{
                            display: "flex", alignItems: "center", gap: "8px",
                            padding: "12px 16px", background: "var(--surface-container-high)",
                            border: "2px solid #000", cursor: "pointer", color: "var(--on-surface)",
                            fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "13px",
                            textAlign: "left", boxShadow: "3px 3px 0 #000",
                            transition: "all 0.1s ease",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.transform = "translate(2px, 2px)";
                            (e.currentTarget as HTMLElement).style.boxShadow = "1px 1px 0 #000";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.transform = "none";
                            (e.currentTarget as HTMLElement).style.boxShadow = "3px 3px 0 #000";
                          }}
                        >
                          <span style={{ fontSize: "18px" }}>{q.icon}</span>
                          {q.text}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Chat messages */}
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: "12px",
                      justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                      animation: "chatMsgIn 0.25s ease-out",
                    }}
                  >
                    {/* Assistant avatar */}
                    {msg.role === "assistant" && (
                      <div style={{
                        width: "36px", height: "36px", flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "var(--primary)", color: "var(--on-primary)",
                        border: "2px solid #000", fontSize: "20px",
                      }}>
                        🧠
                      </div>
                    )}

                    <div style={{
                      padding: "14px 18px",
                      border: "2px solid #000",
                      maxWidth: "75%",
                      background: msg.role === "user" ? "var(--primary)" : "var(--surface-container-high)",
                      color: msg.role === "user" ? "#000" : "var(--on-surface)",
                      boxShadow: "4px 4px 0 #000",
                      fontSize: "14px",
                      lineHeight: 1.7,
                    }}>
                      <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{msg.content}</p>

                      {/* Citation chips */}
                      {msg.citations && msg.citations.length > 0 && (
                        <div style={{
                          marginTop: "12px", paddingTop: "10px",
                          borderTop: "1px solid rgba(255,255,255,0.15)",
                          display: "flex", flexWrap: "wrap", gap: "6px",
                        }}>
                          {msg.citations.map((c, ci) => (
                            <span
                              key={ci}
                              className="nb-chip"
                              style={{
                                fontSize: "11px",
                                background: "var(--tertiary-container)",
                                color: "var(--on-tertiary-container)",
                              }}
                            >
                              {c.page ? `📄 Page ${c.page}` : (c.section || `Source`)}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Action buttons (assistant only) */}
                      {msg.role === "assistant" && (
                        <div style={{
                          display: "flex", gap: "6px", marginTop: "10px",
                          paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)",
                        }}>
                          <button
                            onClick={() => handleCopy(msg.content, i)}
                            style={{
                              display: "flex", alignItems: "center", gap: "4px",
                              padding: "4px 10px", background: copiedIdx === i ? "var(--primary)" : "transparent",
                              border: "1px solid rgba(255,255,255,0.15)", cursor: "pointer",
                              color: copiedIdx === i ? "#000" : "var(--on-surface-variant)",
                              fontSize: "11px", fontWeight: 700, transition: "all 0.15s",
                            }}
                          >
                            {copiedIdx === i ? "✓ Copied" : "📋 Copy"}
                          </button>
                          <button
                            onClick={() => handleFeedback(i, "up")}
                            style={{
                              padding: "4px 8px",
                              background: feedbackState[i] === "up" ? "var(--primary)" : "transparent",
                              border: "1px solid rgba(255,255,255,0.15)", cursor: "pointer",
                              color: feedbackState[i] === "up" ? "#000" : "var(--on-surface-variant)",
                              fontSize: "14px", transition: "all 0.15s",
                            }}
                          >
                            👍
                          </button>
                          <button
                            onClick={() => handleFeedback(i, "down")}
                            style={{
                              padding: "4px 8px",
                              background: feedbackState[i] === "down" ? "#ff4a3d" : "transparent",
                              border: "1px solid rgba(255,255,255,0.15)", cursor: "pointer",
                              color: feedbackState[i] === "down" ? "#fff" : "var(--on-surface-variant)",
                              fontSize: "14px", transition: "all 0.15s",
                            }}
                          >
                            👎
                          </button>
                        </div>
                      )}

                      {/* Follow-up questions */}
                      {msg.follow_up_questions && msg.follow_up_questions.length > 0 && (
                        <div style={{
                          marginTop: "12px", paddingTop: "10px",
                          borderTop: "1px solid rgba(255,255,255,0.1)",
                        }}>
                          <p style={{
                            fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em",
                            color: "var(--on-surface-variant)", marginBottom: "6px", fontWeight: 700,
                          }}>
                            Follow-up questions
                          </p>
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            {msg.follow_up_questions.map((q, qi) => (
                              <button
                                key={qi}
                                onClick={() => sendChat(q)}
                                style={{
                                  display: "flex", alignItems: "center", gap: "6px",
                                  background: "var(--surface-container)", border: "1px solid #444",
                                  color: "var(--primary)", cursor: "pointer",
                                  fontSize: "12px", fontWeight: 600, textAlign: "left",
                                  padding: "6px 10px", transition: "all 0.1s",
                                  fontFamily: "var(--font-body)",
                                }}
                                onMouseEnter={(e) => {
                                  (e.currentTarget as HTMLElement).style.background = "var(--primary)";
                                  (e.currentTarget as HTMLElement).style.color = "#000";
                                }}
                                onMouseLeave={(e) => {
                                  (e.currentTarget as HTMLElement).style.background = "var(--surface-container)";
                                  (e.currentTarget as HTMLElement).style.color = "var(--primary)";
                                }}
                              >
                                → {q}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Typing indicator */}
                {chatLoading && (
                  <div style={{ display: "flex", gap: "12px" }}>
                    <div style={{
                      width: "36px", height: "36px", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "var(--primary)", color: "var(--on-primary)",
                      border: "2px solid #000", fontSize: "20px",
                    }}>
                      🧠
                    </div>
                    <div style={{
                      padding: "14px 20px", border: "2px solid #000",
                      background: "var(--surface-container-high)", boxShadow: "4px 4px 0 #000",
                    }}>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        {[0, 1, 2].map((d) => (
                          <span
                            key={d}
                            style={{
                              width: "10px", height: "10px",
                              background: "var(--primary)", border: "1px solid #000",
                              animation: `typingBounce 1.2s ease-in-out infinite`,
                              animationDelay: `${d * 0.15}s`,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              {/* Input */}
              <div style={{ padding: "16px 24px", borderTop: "2px solid #000", background: "var(--surface-container)" }}>
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
                    disabled={chatLoading}
                  />
                  <button
                    type="submit"
                    className="nb-btn nb-btn--primary"
                    disabled={chatLoading || !chatInput.trim()}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {chatLoading ? "⏳" : "SEND →"}
                  </button>
                </form>
              </div>
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
        @keyframes chatMsgIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-8px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
