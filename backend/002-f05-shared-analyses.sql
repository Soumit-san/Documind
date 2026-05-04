-- F-05: Export & Share (Shared Analyses table)
-- Execute this script in your Supabase SQL Editor.

-- 1. Create the `shared_analyses` table
CREATE TABLE IF NOT EXISTS public.shared_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content JSONB NOT NULL,
    password_hash TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.shared_analyses ENABLE ROW LEVEL SECURITY;

-- Owner can manage their shares
CREATE POLICY "Users can manage their own shares"
ON public.shared_analyses FOR ALL
USING (auth.uid() = user_id);

-- Anyone can read shared analyses (password check happens in API layer)
CREATE POLICY "Public read for shared analyses"
ON public.shared_analyses FOR SELECT
USING (true);
