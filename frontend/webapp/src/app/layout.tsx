import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocuMind AI — Intelligent Document Assistant",
  description:
    "AI-powered document summarization and Q&A. Upload any document — PDFs, DOCX, PPTX — and get instant summaries and natural-language answers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
