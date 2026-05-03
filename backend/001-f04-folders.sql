-- F-04: Multi-Document Corpus (Folders & Cross-Document Chat)
-- Execute this script in your Supabase SQL Editor.

-- 1. Create the `folders` table
CREATE TABLE IF NOT EXISTS public.folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Enable Row Level Security (RLS) on folders
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own folders" 
ON public.folders FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own folders" 
ON public.folders FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own folders" 
ON public.folders FOR DELETE 
USING (auth.uid() = user_id);

-- 3. Add `folder_id` to the existing `documents` table
-- Assuming the documents table already exists
ALTER TABLE public.documents 
ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL;
