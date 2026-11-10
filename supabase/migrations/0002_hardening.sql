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


-- ───────────────────────── Task 3: session codes can't be listed ─────────────────────────
-- Viewers used to get live updates by reading the sessions table through Realtime, which meant
-- anyone with the public key could list every live session code. Now the database announces
-- each change on the session's own broadcast channel ("np:CODE", event "refresh"), phones
-- respond by calling get_session_state, and only owners can read session rows directly.

-- Sends an empty "refresh" broadcast to everyone following a session.
-- Uses Supabase's realtime.send(payload, event, topic, private); private => false matches
-- the public channel the app subscribes to. A failure here must never undo a slide change,
-- so it's caught and logged instead.
create or replace function public.np_notify(p_code text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send('{}'::jsonb, 'refresh', 'np:' || upper(p_code), false);
exception when others then
  raise warning 'np_notify(%) failed: %', p_code, sqlerrm;
end $$;

revoke all on function public.np_notify(text) from public, anon, authenticated;

-- The session functions below are copied unchanged from 0001_init.sql; the only addition
-- is the "perform public.np_notify(p_code);" line in each.
create or replace function public.set_slide(p_code text, p_token text, p_index int)
returns void
language plpgsql security definer set search_path = public as $$
declare v public.sessions; n int;
begin
  v := public.np_presenter_session(p_code, p_token);
  select count(*) into n from public.slides where deck_id = v.deck_id;
  if p_index < 0 or p_index >= n then raise exception 'Slide out of range'; end if;
  update public.sessions set current_slide = p_index, slide_count = n where id = v.id;
  perform public.np_notify(p_code);
end $$;
create or replace function public.offer_handoff(p_code text, p_token text, p_client_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v public.sessions;
begin
  v := public.np_presenter_session(p_code, p_token);
  if not exists (select 1 from public.session_viewers where session_id = v.id and client_id = p_client_id) then
    raise exception 'That person has left the session';
  end if;
  update public.sessions set handoff_to = p_client_id, handoff_from = v.presenter_name where id = v.id;
  perform public.np_notify(p_code);
end $$;
create or replace function public.cancel_handoff(p_code text, p_token text)
returns void
language plpgsql security definer set search_path = public as $$
declare v public.sessions;
begin
  v := public.np_presenter_session(p_code, p_token);
  update public.sessions set handoff_to = null, handoff_from = null where id = v.id;
  perform public.np_notify(p_code);
end $$;
create or replace function public.claim_handoff(p_code text, p_client_id uuid, p_secret text)
returns text
language plpgsql security definer set search_path = public as $$
declare v public.sessions; v_name text; v_token text;
begin
  select * into v from public.sessions
  where code = upper(p_code) and status = 'live' and expires_at > now()
  for update;
  if not found or v.handoff_to is distinct from p_client_id then
    raise exception 'This handoff is no longer available';
  end if;
  select display_name into v_name from public.session_viewers
  where session_id = v.id and client_id = p_client_id and secret_hash = public.np_hash(p_secret);
  if not found then raise exception 'This handoff is no longer available'; end if;

  v_token := public.np_new_token();
  update public.session_secrets set presenter_token_hash = public.np_hash(v_token) where session_id = v.id;
  update public.sessions
    set handoff_to = null, handoff_from = null,
        presenter_name = v_name, presenter_epoch = presenter_epoch + 1
    where id = v.id;
  perform public.np_notify(p_code);
  return v_token;
end $$;
create or replace function public.decline_handoff(p_code text, p_client_id uuid, p_secret text)
returns void
language plpgsql security definer set search_path = public as $$
declare v public.sessions;
begin
  select * into v from public.sessions where code = upper(p_code) and status = 'live';
  if not found or v.handoff_to is distinct from p_client_id then return; end if;
  if exists (select 1 from public.session_viewers
             where session_id = v.id and client_id = p_client_id and secret_hash = public.np_hash(p_secret)) then
    update public.sessions set handoff_to = null, handoff_from = null where id = v.id;
  end if;
  perform public.np_notify(p_code);
end $$;
create or replace function public.reclaim_session(p_code text, p_presenter_name text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare v public.sessions; v_token text;
begin
  select * into v from public.sessions
  where code = upper(p_code) and owner_id = auth.uid() and status = 'live' and expires_at > now();
  if not found then raise exception 'Only the session owner can take control back'; end if;
  v_token := public.np_new_token();
  update public.session_secrets set presenter_token_hash = public.np_hash(v_token) where session_id = v.id;
  update public.sessions
    set handoff_to = null, handoff_from = null,
        presenter_name = coalesce(nullif(trim(p_presenter_name), ''), 'Presenter'),
        presenter_epoch = presenter_epoch + 1
    where id = v.id;
  perform public.np_notify(p_code);
  return v_token;
end $$;
create or replace function public.end_session(p_code text, p_token text, p_keep boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v public.sessions;
begin
  select * into v from public.sessions where code = upper(p_code) and status = 'live';
  if not found then raise exception 'Session is not live'; end if;
  if v.owner_id is distinct from auth.uid() and not public.verify_presenter(p_code, p_token) then
    raise exception 'You are not the presenter for this session';
  end if;
  update public.sessions
    set status = 'ended', ended_at = now(), keep_after = coalesce(p_keep, false),
        handoff_to = null, handoff_from = null
    where id = v.id;
  delete from public.session_viewers where session_id = v.id;
  perform public.np_notify(p_code);
end $$;

-- Only owners may read session rows directly. Everyone else goes through get_session /
-- get_session_state (security definer), so codes can't be listed with the public key.
drop policy if exists "read viewable sessions" on public.sessions;
drop policy if exists "owners read sessions" on public.sessions;
create policy "owners read sessions" on public.sessions
  for select to authenticated
  using (owner_id = auth.uid());

-- Phones no longer listen for table changes, so stop publishing them.
do $$
begin
  alter publication supabase_realtime drop table public.sessions;
exception when others then null; -- already removed
end $$;

-- ───────────────────────── Task 4: cap viewer registrations ─────────────────────────
-- Same as 0001, plus: a session holds at most 200 registered devices. A device that's
-- already registered can always update its name; new devices past the cap are ignored
-- (they can still watch; they just can't be handed control).

create or replace function public.register_viewer(p_code text, p_client_id uuid, p_secret text, p_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare v public.sessions; v_name text;
begin
  select * into v from public.sessions where code = upper(p_code) and status = 'live' and expires_at > now();
  if not found then return; end if;
  if not exists (select 1 from public.session_viewers where session_id = v.id and client_id = p_client_id)
     and (select count(*) from public.session_viewers where session_id = v.id) >= 200 then
    return;
  end if;
  v_name := left(coalesce(nullif(trim(p_name), ''), 'Guest'), 40);
  insert into public.session_viewers (session_id, client_id, secret_hash, display_name)
  values (v.id, p_client_id, public.np_hash(p_secret), v_name)
  on conflict (session_id, client_id) do update
    set display_name = excluded.display_name
    where public.session_viewers.secret_hash = excluded.secret_hash;
end $$;

-- ───────────────────────── Task 6: small hardening items ─────────────────────────

-- verify_presenter now also requires the session not to have expired (matching np_presenter_session).
create or replace function public.verify_presenter(p_code text, p_token text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  perform 1
  from public.sessions s
  join public.session_secrets x on x.session_id = s.id
  where s.code = upper(p_code)
    and x.presenter_token_hash = public.np_hash(coalesce(p_token, ''))
    and s.status = 'live'
    and s.expires_at > now();
  return found;
end $$;

-- Session codes now come from a cryptographic random source (pgcrypto's gen_random_bytes,
-- in Supabase's "extensions" schema) instead of random(). Same 31-character alphabet and
-- 6-character length. Bytes of 248 or more are discarded so every character is equally
-- likely (248 = 8 × 31). Otherwise unchanged from 0001.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.start_session(p_deck_id uuid, p_presenter_name text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_abc   text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code  text;
  v_token text;
  v_count int;
  v_id    uuid;
  v_byte  int;
begin
  if v_uid is null then raise exception 'Sign in to present'; end if;
  if not exists (select 1 from public.decks where id = p_deck_id and owner_id = v_uid) then
    raise exception 'Deck not found';
  end if;
  select count(*) into v_count from public.slides where deck_id = p_deck_id;
  if v_count = 0 then raise exception 'Add at least one slide first'; end if;

  loop
    v_code := '';
    while length(v_code) < 6 loop
      v_byte := get_byte(extensions.gen_random_bytes(1), 0);
      if v_byte < 248 then
        v_code := v_code || substr(v_abc, 1 + (v_byte % length(v_abc)), 1);
      end if;
    end loop;
    exit when not exists (select 1 from public.sessions where code = v_code);
  end loop;

  v_token := public.np_new_token();
  insert into public.sessions (code, deck_id, owner_id, slide_count, presenter_name)
  values (v_code, p_deck_id, v_uid, v_count, coalesce(nullif(trim(p_presenter_name), ''), 'Presenter'))
  returning id into v_id;
  insert into public.session_secrets (session_id, presenter_token_hash)
  values (v_id, public.np_hash(v_token));

  return json_build_object('code', v_code, 'token', v_token);
end $$;
