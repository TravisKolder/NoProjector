-- No Projector — hardening (run after 0001_init.sql)
-- Paste into the Supabase SQL editor and run. Safe to run more than once.

-- ───────────────────────── Task 1: storage limits ─────────────────────────
-- Only JPEG, PNG, WebP, and GIF, up to 10 MB. The app converts everything else before upload.

update storage.buckets
set file_size_limit = 10485760,  -- 10 MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'slide-images';
