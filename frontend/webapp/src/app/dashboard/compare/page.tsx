"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

interface FileInfo { filename: string; page_count: number; file_type: string; char_count: number; }
interface DiffBlock { type: string; content: string; content_b: string | null; location: string; }
interface KeyChange { change: string; severity: string; section: string; }
interface Analysis { change_summary: string; risk_delta: string; key_changes: KeyChange[]; recommendation: string; }
interface CompareResult {
  file_a: FileInfo; file_b: FileInfo; similarity_score: number;
  diff_blocks: DiffBlock[]; stats: Record<string, number>; analysis: Analysis;
}

type Step = "upload" | "processing" | "results";

export default function ComparePage() {
  const [token, setToken] = useState("");
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [dragOverA, setDragOverA] = useState(false);
  const [dragOverB, setDragOverB] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [processMsg, setProcessMsg] = useState("Parsing documents...");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [diffFilter, setDiffFilter] = useState<string>("all");
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace("/login"); return; }
      setToken(session.access_token);
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, side: "a" | "b") => {
    e.preventDefault();
    side === "a" ? setDragOverA(false) : setDragOverB(false);
    const file = e.dataTransfer.files[0];
    if (file) side === "a" ? setFileA(file) : setFileB(file);
  }, []);

  async function runComparison() {
    if (!fileA || !fileB || !token) return;
    setStep("processing");
    setError(null);
    setProcessMsg("Parsing documents...");

    const formData = new FormData();
    formData.append("file_a", fileA);
    formData.append("file_b", fileB);

    try {
      const timer1 = setTimeout(() => setProcessMsg("Computing diff..."), 3000);
      const timer2 = setTimeout(() => setProcessMsg("Running AI analysis..."), 8000);
      const timer3 = setTimeout(() => setProcessMsg("Generating risk report..."), 15000);

      const res = await fetch(`${API_URL}/compare`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      clearTimeout(timer1); clearTimeout(timer2); clearTimeout(timer3);

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Comparison failed");
      setResult(data);
      setStep("results");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Comparison failed");
      setStep("upload");
    }
  }

  function reset() { setFileA(null); setFileB(null); setResult(null); setStep("upload"); setError(null); }

  const severityColor = (s: string) => {
    if (s === "high") return { bg: "#3a1a1a", border: "#ff4a3d", color: "#ffb4ab", icon: "🔴" };
    if (s === "medium") return { bg: "#3a3000", border: "#e1c563", color: "#ffe17c", icon: "🟡" };
    return { bg: "#1a3a1a", border: "#2d5a2d", color: "#7dff7d", icon: "🟢" };
  };

  const diffColor = (type: string) => {
    if (type === "added") return { bg: "#0d2b0d", border: "#1a5c1a", label: "ADDED", icon: "+" };
    if (type === "removed") return { bg: "#2b0d0d", border: "#5c1a1a", label: "REMOVED", icon: "−" };
    return { bg: "#2b2500", border: "#5c4d1a", label: "CHANGED", icon: "~" };
  };

  const similarityGrade = (s: number) => {
    if (s >= 0.9) return { label: "Nearly Identical", color: "#7dff7d" };
    if (s >= 0.7) return { label: "Mostly Similar", color: "#ffe17c" };
    if (s >= 0.4) return { label: "Significantly Different", color: "#ffb4ab" };
    return { label: "Completely Different", color: "#ff4a3d" };
  };

  const filteredBlocks = result?.diff_blocks.filter(b => diffFilter === "all" || b.type === diffFilter) || [];

  const dropZoneStyle = (active: boolean, hasFile: boolean) => ({
    flex: 1, border: `2px dashed ${active ? "var(--primary)" : hasFile ? "#2d5a2d" : "#000"}`,
    background: active ? "var(--primary-container)" : hasFile ? "#0d2b0d" : "var(--surface-container)",
    padding: "40px 24px", textAlign: "center" as const, cursor: "pointer",
    transition: "all 0.15s ease", boxShadow: active ? "6px 6px 0 var(--primary)" : "4px 4px 0 #000",
    display: "flex", flexDirection: "column" as const, alignItems: "center", gap: "12px", minHeight: "200px",
    justifyContent: "center",
  });

  return (
    <div style={{ minHeight: "100vh", background: "var(--surface)", display: "flex", flexDirection: "column" }}>
      {/* Navbar */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 48px", borderBottom: "2px solid #000", background: "var(--surface-container)" }}>
        <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "24px", letterSpacing: "-0.05em", color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push("/dashboard")}>
          DOCUMIND<span style={{ color: "var(--on-surface-variant)" }}>AI</span>
        </span>
        <button onClick={() => router.push("/dashboard")} className="nb-btn nb-btn--ghost" style={{ fontSize: "14px" }}>← Back to Dashboard</button>
      </nav>

      <main style={{ flex: 1, padding: "48px", maxWidth: "1200px", width: "100%", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "40px" }}>
          <div className="nb-chip nb-chip--primary" style={{ marginBottom: "16px" }}>COMPARATIVE ANALYSIS</div>
          <h1 style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "36px", letterSpacing: "-0.04em", marginBottom: "8px" }}>
            Compare Documents
          </h1>
          <p style={{ color: "var(--on-surface-variant)", fontSize: "16px" }}>
            Upload two versions of a document to see what changed, new risks, and AI-powered recommendations.
          </p>
        </div>

        {error && (
          <div style={{ padding: "16px", border: "2px solid #ff4a3d", background: "#2a1a1a", color: "#ffb4ab", marginBottom: "24px", fontWeight: 700 }}>
            ⚠ {error}
          </div>
        )}

        {/* ─── Upload Step ─── */}
        {step === "upload" && (
          <>
            <div style={{ display: "flex", gap: "24px", marginBottom: "32px" }}>
              {/* Document A */}
              <div
                onDrop={(e) => handleDrop(e, "a")}
                onDragOver={(e) => { e.preventDefault(); setDragOverA(true); }}
                onDragLeave={() => setDragOverA(false)}
                onClick={() => document.getElementById("compare-file-a")?.click()}
                style={dropZoneStyle(dragOverA, !!fileA)}
              >
                <input id="compare-file-a" type="file" style={{ display: "none" }} accept=".pdf,.docx,.doc,.pptx,.txt,.md,.csv"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setFileA(f); }} />
                <div style={{ fontSize: "36px" }}>{fileA ? "✅" : "📄"}</div>
                <p style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "16px", letterSpacing: "-0.02em" }}>
                  {fileA ? fileA.name : "DOCUMENT A — ORIGINAL"}
                </p>
                <p style={{ color: "var(--on-surface-variant)", fontSize: "13px" }}>
                  {fileA ? `${(fileA.size / 1024).toFixed(1)} KB` : "Drop or click to select the original version"}
                </p>
                {fileA && (
                  <button onClick={(e) => { e.stopPropagation(); setFileA(null); }}
                    style={{ background: "none", border: "1px solid #555", color: "#ffb4ab", padding: "4px 12px", fontSize: "11px", fontWeight: 700, cursor: "pointer", marginTop: "4px" }}>
                    REMOVE
                  </button>
                )}
              </div>

              {/* VS Divider */}
              <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                <div style={{
                  width: "56px", height: "56px", display: "flex", alignItems: "center", justifyContent: "center",
                  background: "var(--primary)", color: "var(--on-primary)", border: "2px solid #000",
                  boxShadow: "4px 4px 0 #000", fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "18px",
                }}>VS</div>
              </div>

              {/* Document B */}
              <div
                onDrop={(e) => handleDrop(e, "b")}
                onDragOver={(e) => { e.preventDefault(); setDragOverB(true); }}
                onDragLeave={() => setDragOverB(false)}
                onClick={() => document.getElementById("compare-file-b")?.click()}
                style={dropZoneStyle(dragOverB, !!fileB)}
              >
                <input id="compare-file-b" type="file" style={{ display: "none" }} accept=".pdf,.docx,.doc,.pptx,.txt,.md,.csv"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setFileB(f); }} />
                <div style={{ fontSize: "36px" }}>{fileB ? "✅" : "📄"}</div>
                <p style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "16px", letterSpacing: "-0.02em" }}>
                  {fileB ? fileB.name : "DOCUMENT B — REVISED"}
                </p>
                <p style={{ color: "var(--on-surface-variant)", fontSize: "13px" }}>
                  {fileB ? `${(fileB.size / 1024).toFixed(1)} KB` : "Drop or click to select the revised version"}
                </p>
                {fileB && (
                  <button onClick={(e) => { e.stopPropagation(); setFileB(null); }}
                    style={{ background: "none", border: "1px solid #555", color: "#ffb4ab", padding: "4px 12px", fontSize: "11px", fontWeight: 700, cursor: "pointer", marginTop: "4px" }}>
                    REMOVE
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center" }}>
              <button onClick={runComparison} disabled={!fileA || !fileB}
                className="nb-btn nb-btn--primary" style={{ fontSize: "16px", padding: "16px 40px", opacity: (!fileA || !fileB) ? 0.5 : 1 }}>
                ⚖️ COMPARE DOCUMENTS
              </button>
            </div>
          </>
        )}

        {/* ─── Processing Step ─── */}
        {step === "processing" && (
          <div className="nb-card" style={{ padding: "64px 48px", textAlign: "center" }}>
            <div style={{ fontSize: "48px", marginBottom: "24px", animation: "pulse 1.5s infinite" }}>⚖️</div>
            <h2 style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "24px", marginBottom: "16px" }}>
              ANALYZING DIFFERENCES
            </h2>
            <p style={{ color: "var(--on-surface-variant)", fontSize: "16px", marginBottom: "24px" }}>{processMsg}</p>
            <div style={{ height: "4px", background: "#333", position: "relative", overflow: "hidden", maxWidth: "400px", margin: "0 auto" }}>
              <div style={{ position: "absolute", top: 0, left: 0, height: "100%", background: "var(--primary)", animation: "slide 1s infinite linear", width: "40%" }} />
            </div>
          </div>
        )}

        {/* ─── Results Step ─── */}
        {step === "results" && result && (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Action bar */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={reset} className="nb-btn nb-btn--ghost" style={{ fontSize: "13px" }}>↻ NEW COMPARISON</button>
            </div>

            {/* Similarity + File info */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
              <div className="nb-card" style={{ padding: "24px", textAlign: "center" }}>
                <p style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--on-surface-variant)", marginBottom: "8px" }}>Similarity</p>
                <p style={{ fontSize: "48px", fontFamily: "var(--font-heading)", fontWeight: 800, color: similarityGrade(result.similarity_score).color }}>
                  {(result.similarity_score * 100).toFixed(1)}%
                </p>
                <p style={{ fontSize: "13px", color: similarityGrade(result.similarity_score).color, fontWeight: 700 }}>
                  {similarityGrade(result.similarity_score).label}
                </p>
              </div>
              <div className="nb-card" style={{ padding: "24px" }}>
                <p style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--on-surface-variant)", marginBottom: "12px" }}>📄 {result.file_a.filename}</p>
                <p style={{ fontSize: "14px" }}>{result.file_a.page_count} pages · {result.file_a.char_count.toLocaleString()} chars</p>
                <span className="nb-chip" style={{ fontSize: "11px", marginTop: "8px" }}>{result.file_a.file_type.toUpperCase()}</span>
              </div>
              <div className="nb-card" style={{ padding: "24px" }}>
                <p style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--on-surface-variant)", marginBottom: "12px" }}>📄 {result.file_b.filename}</p>
                <p style={{ fontSize: "14px" }}>{result.file_b.page_count} pages · {result.file_b.char_count.toLocaleString()} chars</p>
                <span className="nb-chip" style={{ fontSize: "11px", marginTop: "8px" }}>{result.file_b.file_type.toUpperCase()}</span>
              </div>
            </div>

            {/* Stats chips */}
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <span className="nb-chip" style={{ background: "#0d2b0d", color: "#7dff7d", borderColor: "#1a5c1a" }}>+{result.stats.added} Added</span>
              <span className="nb-chip" style={{ background: "#2b0d0d", color: "#ffb4ab", borderColor: "#5c1a1a" }}>−{result.stats.removed} Removed</span>
              <span className="nb-chip" style={{ background: "#2b2500", color: "#ffe17c", borderColor: "#5c4d1a" }}>~{result.stats.changed} Changed</span>
              <span className="nb-chip" style={{ background: "var(--secondary-container)" }}>={result.stats.unchanged} Unchanged</span>
            </div>

            {/* Change Summary */}
            <div className="nb-card">
              <div className="nb-card__header">📝 CHANGE SUMMARY</div>
              <div className="nb-card__body">
                <p style={{ lineHeight: 1.7, fontSize: "15px" }}>{result.analysis.change_summary}</p>
              </div>
            </div>

            {/* Risk Delta */}
            <div className="nb-card" style={{ borderColor: "#ff4a3d" }}>
              <div className="nb-card__header" style={{ background: "#2a1a1a", color: "#ffb4ab" }}>⚠️ RISK DELTA</div>
              <div className="nb-card__body">
                <p style={{ lineHeight: 1.7, fontSize: "15px", color: "#ffb4ab" }}>{result.analysis.risk_delta}</p>
              </div>
            </div>

            {/* Key Changes */}
            {result.analysis.key_changes.length > 0 && (
              <div className="nb-card">
                <div className="nb-card__header">🔑 KEY CHANGES</div>
                <div className="nb-card__body" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {result.analysis.key_changes.map((kc, i) => {
                    const sc = severityColor(kc.severity);
                    return (
                      <div key={i} style={{ padding: "14px 18px", background: sc.bg, border: `2px solid ${sc.border}`, display: "flex", gap: "12px", alignItems: "flex-start" }}>
                        <span style={{ fontSize: "16px", flexShrink: 0 }}>{sc.icon}</span>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontWeight: 700, fontSize: "14px", color: sc.color, marginBottom: "4px" }}>{kc.change}</p>
                          <p style={{ fontSize: "12px", color: "var(--on-surface-variant)" }}>{kc.section}</p>
                        </div>
                        <span className="nb-chip" style={{ fontSize: "10px", background: sc.bg, color: sc.color, borderColor: sc.border }}>
                          {kc.severity.toUpperCase()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Recommendation */}
            <div className="nb-card" style={{ borderColor: "var(--tertiary)" }}>
              <div className="nb-card__header" style={{ background: "var(--on-tertiary-container)", color: "var(--tertiary)" }}>💡 RECOMMENDATION</div>
              <div className="nb-card__body">
                <p style={{ lineHeight: 1.7, fontSize: "15px" }}>{result.analysis.recommendation}</p>
              </div>
            </div>

            {/* Diff Viewer */}
            <div className="nb-card">
              <div className="nb-card__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>🔍 DETAILED DIFF</span>
                <div style={{ display: "flex", gap: "4px" }}>
                  {["all", "added", "removed", "changed"].map(f => (
                    <button key={f} onClick={() => setDiffFilter(f)}
                      style={{
                        padding: "3px 10px", fontSize: "10px", fontWeight: 700, textTransform: "uppercase",
                        cursor: "pointer", border: "1px solid #555", letterSpacing: "0.03em",
                        background: diffFilter === f ? "var(--primary)" : "transparent",
                        color: diffFilter === f ? "#000" : "var(--on-surface-variant)",
                      }}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="nb-card__body" style={{ maxHeight: "500px", overflowY: "auto" }}>
                {filteredBlocks.length === 0 ? (
                  <p style={{ color: "var(--on-surface-variant)", textAlign: "center", padding: "24px" }}>
                    {diffFilter === "all" ? "Documents are identical — no differences found." : `No ${diffFilter} blocks found.`}
                  </p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {filteredBlocks.map((block, i) => {
                      const dc = diffColor(block.type);
                      return (
                        <div key={i} style={{ background: dc.bg, border: `1px solid ${dc.border}`, padding: "12px 16px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                            <span style={{ fontSize: "11px", fontWeight: 700, fontFamily: "monospace" }}>{dc.icon} {dc.label}</span>
                            <span style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>{block.location}</span>
                          </div>
                          <p style={{ fontSize: "13px", lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>{block.content}</p>
                          {block.content_b && (
                            <>
                              <div style={{ borderTop: "1px dashed #555", margin: "10px 0", paddingTop: "10px" }}>
                                <span style={{ fontSize: "11px", fontWeight: 700, color: "#7dff7d", fontFamily: "monospace" }}>→ NEW:</span>
                              </div>
                              <p style={{ fontSize: "13px", lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "monospace", color: "#7dff7d" }}>{block.content_b}</p>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <style>{`
        @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(350%); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
  );
}
