"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage({ type: "success", text: "Check your email for a confirmation link!" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Redirect to dashboard on success
        window.location.href = "/dashboard";
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Something went wrong.";
      setMessage({ type: "error", text: errorMessage });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface)",
        padding: "24px",
      }}
    >
      <div
        className="nb-card"
        style={{ width: "100%", maxWidth: "440px" }}
      >
        {/* Header with dot pattern */}
        <div
          className="nb-yellow-surface"
          style={{
            padding: "32px 32px 24px",
            borderBottom: "2px solid #000",
          }}
        >
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 800,
              fontSize: "32px",
              letterSpacing: "-0.04em",
              lineHeight: 1.1,
              marginBottom: "8px",
            }}
          >
            {isSignUp ? "CREATE ACCOUNT" : "WELCOME BACK"}
          </h1>
          <p style={{ fontSize: "14px", opacity: 0.8 }}>
            {isSignUp
              ? "Sign up to start analyzing documents with AI."
              : "Sign in to your DocuMind AI account."}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: "32px" }}>
          <div style={{ marginBottom: "16px" }}>
            <label
              htmlFor="email"
              style={{
                display: "block",
                fontFamily: "var(--font-body)",
                fontWeight: 700,
                fontSize: "12px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: "8px",
                color: "var(--on-surface-variant)",
              }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              className="nb-input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div style={{ marginBottom: "24px" }}>
            <label
              htmlFor="password"
              style={{
                display: "block",
                fontFamily: "var(--font-body)",
                fontWeight: 700,
                fontSize: "12px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: "8px",
                color: "var(--on-surface-variant)",
              }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              className="nb-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          {/* Message */}
          {message && (
            <div
              style={{
                padding: "12px 16px",
                marginBottom: "16px",
                border: "2px solid #000",
                background: message.type === "error" ? "var(--error-container)" : "var(--secondary-container)",
                color: message.type === "error" ? "var(--on-error-container)" : "var(--on-secondary-container)",
                fontSize: "14px",
              }}
            >
              {message.text}
            </div>
          )}

          <button
            type="submit"
            className="nb-btn nb-btn--primary"
            disabled={loading}
            style={{ width: "100%", justifyContent: "center", fontSize: "16px" }}
          >
            {loading ? "LOADING..." : isSignUp ? "SIGN UP" : "SIGN IN"}
          </button>

          <div
            style={{
              marginTop: "24px",
              textAlign: "center",
              fontSize: "14px",
              color: "var(--on-surface-variant)",
            }}
          >
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setMessage(null);
              }}
              style={{
                background: "none",
                border: "none",
                color: "var(--primary)",
                fontWeight: 700,
                cursor: "pointer",
                textDecoration: "underline",
                fontSize: "14px",
              }}
            >
              {isSignUp ? "Sign in" : "Sign up"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
