-- No Projector — hardening (run after 0001_init.sql)
-- Paste into the Supabase SQL editor and run. Safe to run more than once.

-- ───────────────────────── Task 1: storage limits ─────────────────────────
-- Only JPEG, PNG, WebP, and GIF, up to 10 MB. The app converts everything else before upload.

update storage.buckets
set file_size_limit = 10485760,  -- 10 MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'slide-images';

-- ───────────────────────── Task 2: small session state ─────────────────────────
-- Same as get_session, without the slides. Phones download the deck once with
-- get_session, then use this for every reconnect, wake-up, and live update.

create or replace function public.get_session_state(p_code text)
returns json
language plpgsql stable security definer set search_path = public as $$
declare v public.sessions; d public.decks;
begin
  select * into v from public.sessions where code = upper(p_code);
  if not found then return null; end if;
  if not public.np_viewable(v) and v.owner_id is distinct from auth.uid() then
    return json_build_object('code', v.code, 'expired', true);
  end if;
  select * into d from public.decks where id = v.deck_id;
  return json_build_object(
    'id', v.id,
    'code', v.code,
    'status', v.status,
    'current_slide', v.current_slide,
    'slide_count', v.slide_count,
    'presenter_name', v.presenter_name,
    'presenter_epoch', v.presenter_epoch,
    'handoff_to', v.handoff_to,
    'handoff_from', v.handoff_from,
    'keep_after', v.keep_after,
    'ended_at', v.ended_at,
    'is_owner', coalesce(v.owner_id = auth.uid(), false),
    'deck', json_build_object('title', d.title, 'theme', d.theme)
  );
end $$;

grant execute on function public.get_session_state(text) to anon, authenticated;
