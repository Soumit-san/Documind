"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

interface Citation {
  text: string;
  page: number | null;
  section: string | null;
  filename: string | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  follow_up_questions?: string[];
}

export default function FolderChatPage() {
  const params = useParams();
  const folderId = params.id as string;
  const router = useRouter();
  const supabase = createClient();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [token, setToken] = useState("");
  const [folderName, setFolderName] = useState<string>("Folder Chat");

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [feedbackState, setFeedbackState] = useState<Record<number, "up" | "down" | null>>({});

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace("/login"); return; }
      setToken(session.access_token);
      fetchFolderName(session.access_token);
    });
  }, []);

  async function fetchFolderName(tok: string) {
    try {
      const res = await fetch(`${API_URL}/folders`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) {
        const folders = await res.json();
        const f = folders.find((f: any) => f.id === folderId);
        if (f) setFolderName(f.name);
      }
    } catch {}
  }

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

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
          folder_id: folderId,
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

  const starterQuestions = [
    { icon: "📋", text: "What is this project about?" },
    { icon: "🔍", text: "What are the common findings across these documents?" },
    { icon: "✅", text: "Summarize the key takeaways from this folder" },
    { icon: "⚠️", text: "Are there any contradictions between documents?" },
  ];

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
          <div className="nb-chip nb-chip--primary" style={{ marginBottom: "16px" }}>MULTI-DOCUMENT CHAT</div>
          <h1 style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "32px", letterSpacing: "-0.04em", marginBottom: "8px" }}>
            Project: {folderName}
          </h1>
          <p style={{ color: "var(--on-surface-variant)" }}>Chat across all documents inside this folder.</p>
        </div>

        {/* ─── Chat Interface ─── */}
        <div className="nb-card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: "600px" }}>
          <div className="nb-card__header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>💬 ASK ANYTHING ABOUT THESE DOCUMENTS</span>
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
                    🗂️
                  </div>
                  <h3 style={{
                    fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "22px",
                    letterSpacing: "-0.03em", textTransform: "uppercase",
                  }}>
                    Cross-Document Synthesis
                  </h3>
                  <p style={{ color: "var(--on-surface-variant)", fontSize: "14px", maxWidth: "500px", lineHeight: 1.6 }}>
                    I can answer questions spanning across all the documents in this folder. My answers will cite which specific document and page the information came from.
                  </p>
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px",
                    width: "100%", maxWidth: "550px", marginTop: "8px",
                  }}>
                    {starterQuestions.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => sendChat(q.text)}
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
                            title={c.text}
                            style={{
                              fontSize: "11px",
                              background: "var(--tertiary-container)",
                              color: "var(--on-tertiary-container)",
                              cursor: "help",
                            }}
                          >
                            {c.filename || 'Source'} {c.page ? ` (p.${c.page})` : ''}
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
                  placeholder="Ask anything about the documents in this folder..."
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
      </main>

      <style>{`
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
