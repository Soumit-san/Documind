"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

interface Document {
  id: string;
  filename: string;
  file_type: string;
  page_count: number;
  chunk_count: number;
  created_at: string;
  doc_vector_id: string;
}

export default function DashboardPage() {
  const [user, setUser] = useState<{ email: string; id: string } | null>(null);
  const [token, setToken] = useState("");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [folders, setFolders] = useState<{ id: string; name: string; created_at: string }[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lastUploadedDocId, setLastUploadedDocId] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace("/login");
        return;
      }
      setUser({ email: session.user.email ?? "", id: session.user.id });
      setToken(session.access_token);
      fetchFolders(session.access_token);
    });
  }, []);

  useEffect(() => {
    if (token) fetchDocuments(token, selectedFolderId);
  }, [selectedFolderId, token]);

  async function fetchFolders(tok: string) {
    try {
      const res = await fetch(`${API_URL}/folders`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) {
        const data = await res.json();
        setFolders(data);
      }
    } catch {}
  }

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!newFolderName.trim() || !token) return;
    setCreatingFolder(true);
    try {
      const res = await fetch(`${API_URL}/folders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name: newFolderName.trim() })
      });
      if (res.ok) {
        setNewFolderName("");
        await fetchFolders(token);
      }
    } catch {}
    setCreatingFolder(false);
  }

  async function fetchDocuments(tok: string, folderId: string | null = null) {
    try {
      const url = new URL(`${API_URL}/documents`);
      if (folderId) url.searchParams.append("folder_id", folderId);
      
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) {
        const docs = await res.json();
        setDocuments(docs);
      }
    } catch {
      // backend may not be running
    }
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError(null);
    setLastUploadedDocId(null);

    const tok = token || (await supabase.auth.getSession()).data.session?.access_token;
    if (!tok) { router.replace("/login"); return; }

    const formData = new FormData();
    formData.append("file", file);
    if (selectedFolderId) {
      formData.append("folder_id", selectedFolderId);
    }

    try {
      const res = await fetch(`${API_URL}/documents/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload failed");
      
      // The response id IS the doc_vector_id (set in documents.py line 136)
      setLastUploadedDocId(data.id);
      await fetchDocuments(tok, selectedFolderId);
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function getAnalyzeId(doc: Document): string {
    // Prefer the ChromaDB vector ID; fall back to the response ID
    return doc.doc_vector_id || doc.id;
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--surface)", display: "flex", flexDirection: "column" }}>
      {/* ─── Navbar ─── */}
      <nav style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 48px", borderBottom: "2px solid #000",
        background: "var(--surface-container)",
      }}>
        <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "24px", letterSpacing: "-0.05em", color: "var(--primary)" }}>
          DOCUMIND<span style={{ color: "var(--on-surface-variant)" }}>AI</span>
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "14px", color: "var(--on-surface-variant)" }}>{user?.email}</span>
          <button onClick={handleSignOut} className="nb-btn nb-btn--ghost" style={{ fontSize: "14px" }}>
            Sign Out
          </button>
        </div>
      </nav>

      <main style={{ flex: 1, padding: "48px", maxWidth: "1400px", width: "100%", margin: "0 auto", display: "flex", gap: "48px" }}>
        
        {/* ─── Left Pane: Folders Sidebar ─── */}
        <aside style={{ width: "300px", flexShrink: 0 }}>
          <h2 style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "24px", letterSpacing: "-0.03em", marginBottom: "24px" }}>
            PROJECTS
          </h2>

          <form onSubmit={createFolder} style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
            <input
              type="text"
              className="nb-input"
              placeholder="New folder name..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              style={{ flex: 1, fontSize: "14px", padding: "10px" }}
              disabled={creatingFolder}
            />
            <button type="submit" className="nb-btn nb-btn--primary" disabled={creatingFolder || !newFolderName.trim()} style={{ padding: "0 16px" }}>
              +
            </button>
          </form>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <button
              onClick={() => setSelectedFolderId(null)}
              style={{
                textAlign: "left", padding: "12px 16px", cursor: "pointer",
                background: selectedFolderId === null ? "var(--primary)" : "var(--surface-container)",
                color: selectedFolderId === null ? "#000" : "var(--on-surface)",
                border: "2px solid #000", fontFamily: "var(--font-heading)", fontWeight: 800,
                boxShadow: selectedFolderId === null ? "3px 3px 0 #000" : "none",
              }}
            >
              All Documents
            </button>
            {folders.map(f => (
              <button
                key={f.id}
                onClick={() => setSelectedFolderId(f.id)}
                style={{
                  textAlign: "left", padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
                  background: selectedFolderId === f.id ? "var(--primary)" : "var(--surface-container)",
                  color: selectedFolderId === f.id ? "#000" : "var(--on-surface)",
                  border: "2px solid #000", fontFamily: "var(--font-heading)", fontWeight: 800,
                  boxShadow: selectedFolderId === f.id ? "3px 3px 0 #000" : "none",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📁 {f.name}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* ─── Right Pane: Documents ─── */}
        <section style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "40px" }}>
            <div>
              <div className="nb-chip nb-chip--primary" style={{ marginBottom: "16px" }}>DASHBOARD</div>
              <h1 style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "40px", letterSpacing: "-0.04em", marginBottom: "8px" }}>
                {selectedFolderId ? folders.find(f => f.id === selectedFolderId)?.name || "Folder" : "Your Documents"}
              </h1>
              <p style={{ color: "var(--on-surface-variant)", fontSize: "16px" }}>
                {selectedFolderId 
                  ? "Upload and analyze documents within this project."
                  : "Upload a document to analyze it with AI — summaries, Q&A, and entity extraction."}
              </p>
            </div>
            
            {/* Folder Q&A Chat Button */}
            {selectedFolderId && documents.length > 0 && (
              <button
                onClick={() => router.push(`/dashboard/folder/${selectedFolderId}`)}
                className="nb-btn nb-btn--primary"
                style={{ fontSize: "14px", padding: "12px 24px", background: "var(--tertiary-container)", color: "var(--on-tertiary-container)" }}
              >
                🧠 CHAT WITH FOLDER →
              </button>
            )}
          </div>

          {/* ─── Upload Zone ─── */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            style={{
              border: `2px dashed ${dragOver ? "var(--primary)" : "#000"}`,
              background: dragOver ? "var(--primary-container)" : "var(--surface-container)",
              padding: "48px",
              textAlign: "center",
              marginBottom: "40px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              boxShadow: dragOver ? "6px 6px 0 var(--primary)" : "6px 6px 0 #000",
            }}
            onClick={() => document.getElementById("file-upload-input")?.click()}
          >
            <input
              id="file-upload-input"
              type="file"
              style={{ display: "none" }}
              accept=".pdf,.docx,.doc,.pptx,.txt,.md,.csv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
            />
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>📄</div>
            <p style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "20px", marginBottom: "8px" }}>
              {uploading ? "UPLOADING & INDEXING..." : "DROP A DOCUMENT HERE"}
            </p>
            <p style={{ color: "var(--on-surface-variant)", fontSize: "14px" }}>
              Supports PDF, DOCX, PPTX, TXT, CSV, Markdown — up to 50MB
            </p>
            {uploading && (
              <div style={{ marginTop: "16px", height: "4px", background: "#eee", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, height: "100%", background: "var(--primary)", animation: "slide 1s infinite linear", width: "40%" }} />
              </div>
            )}
            {uploadError && (
              <p style={{ marginTop: "16px", color: "var(--error)", fontWeight: 700, fontSize: "14px" }}>
                ⚠ {uploadError}
              </p>
            )}
          </div>

          {/* ─── Last Uploaded — Quick Action ─── */}
          {lastUploadedDocId && (
            <div className="nb-card" style={{ padding: "20px 24px", marginBottom: "24px", background: "#1a3a1a", borderColor: "#2d5a2d" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontWeight: 700, fontSize: "16px", color: "#7dff7d" }}>✅ Document uploaded & indexed!</p>
                  <p style={{ fontSize: "12px", color: "#aaa", marginTop: "4px" }}>ID: {lastUploadedDocId}</p>
                </div>
                <button
                  onClick={() => router.push(`/dashboard/${lastUploadedDocId}`)}
                  className="nb-btn nb-btn--primary"
                  style={{ fontSize: "16px", padding: "12px 24px" }}
                >
                  🧠 ANALYZE NOW →
                </button>
              </div>
            </div>
          )}

          {/* ─── Documents List ─── */}
          <h2 style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "24px", letterSpacing: "-0.03em", marginBottom: "24px" }}>
            INDEXED DOCUMENTS
          </h2>

          {documents.length === 0 ? (
            <div className="nb-card" style={{ padding: "48px", textAlign: "center" }}>
              <p style={{ fontSize: "40px", marginBottom: "16px" }}>🗂</p>
              <p style={{ color: "var(--on-surface-variant)" }}>No documents in this view. Upload one above to get started.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "16px" }}>
              {documents.map((doc) => (
                <div key={doc.id} className="nb-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <span style={{ fontSize: "28px" }}>
                      {doc.file_type === "pdf" ? "📄" : doc.file_type === "docx" ? "📝" : "📋"}
                    </span>
                    <div>
                      <p style={{ fontWeight: 700, fontSize: "16px", marginBottom: "4px" }}>{doc.filename}</p>
                      <p style={{ fontSize: "12px", color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {doc.page_count} pages · {doc.chunk_count} chunks · {new Date(doc.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <span className="nb-chip" style={{ fontSize: "11px" }}>{doc.file_type.toUpperCase()}</span>
                    <button
                      onClick={() => router.push(`/dashboard/${getAnalyzeId(doc)}`)}
                      className="nb-btn nb-btn--primary"
                      style={{ fontSize: "13px", padding: "8px 16px" }}
                    >
                      🧠 ANALYZE
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <style>{`
        @keyframes slide {
          from { transform: translateX(-100%); }
          to { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}
