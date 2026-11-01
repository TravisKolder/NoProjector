-- No Projector — initial schema
-- Run this once in the Supabase SQL editor (or with `supabase db push`).

-- ───────────────────────── Tables ─────────────────────────

create table if not exists public.decks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default 'Untitled deck',
  theme       text not null default 'light',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.slides (
  id          uuid primary key default gen_random_uuid(),
  deck_id     uuid not null references public.decks(id) on delete cascade,
  position    int  not null default 0,
  kind        text not null default 'built' check (kind in ('built', 'image')),
  content     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists slides_deck_position on public.slides (deck_id, position);

create table if not exists public.sessions (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  deck_id         uuid not null references public.decks(id) on delete cascade,
  owner_id        uuid not null references auth.users(id) on delete cascade,
  current_slide   int  not null default 0,
  slide_count     int  not null default 0,
  status          text not null default 'live' check (status in ('live', 'ended')),
  keep_after      boolean not null default false,
  ended_at        timestamptz,
  expires_at      timestamptz not null default now() + interval '12 hours',
  presenter_name  text not null default 'Presenter',
  presenter_epoch int  not null default 0,
  handoff_to      uuid,
  handoff_from    text,
  created_at      timestamptz not null default now()
);

-- Presenter token hashes live apart from sessions so viewers can never read them.
create table if not exists public.session_secrets (
  session_id           uuid primary key references public.sessions(id) on delete cascade,
  presenter_token_hash text not null
);

-- Viewers who joined a live session: a random device id, a hashed device secret
-- (so only that device can accept a handoff), and an optional display name.
-- Deleted when the session ends.
create table if not exists public.session_viewers (
  session_id   uuid not null references public.sessions(id) on delete cascade,
  client_id    uuid not null,
  secret_hash  text not null,
  display_name text not null,
  created_at   timestamptz not null default now(),
  primary key (session_id, client_id)
);

-- ───────────────────────── Row-level security ─────────────────────────

alter table public.decks           enable row level security;
alter table public.slides          enable row level security;
alter table public.sessions        enable row level security;
alter table public.session_secrets enable row level security;
alter table public.session_viewers enable row level security;

drop policy if exists "owners manage decks" on public.decks;
create policy "owners manage decks" on public.decks
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "owners manage slides" on public.slides;
create policy "owners manage slides" on public.slides
  for all to authenticated
  using (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = auth.uid()))
  with check (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = auth.uid()));

-- Anyone may read a session row while it is live, or for 3 hours after it ends
-- when the presenter chose to keep it. Owners can always read their own.
-- Writes happen only through the functions below.
drop policy if exists "read viewable sessions" on public.sessions;
create policy "read viewable sessions" on public.sessions
  for select to anon, authenticated
  using (
    owner_id = auth.uid()
    or (status = 'live' and expires_at > now())
    or (status = 'ended' and keep_after and ended_at > now() - interval '3 hours')
  );

-- session_secrets and session_viewers have no policies: functions only.

-- ───────────────────────── Helpers ─────────────────────────

create or replace function public.np_hash(t text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(t, 'UTF8')), 'hex');
$$;

create or replace function public.np_new_token()
returns text language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

create or replace function public.np_viewable(s public.sessions)
returns boolean language sql stable as $$
  select (s.status = 'live' and s.expires_at > now())
      or (s.status = 'ended' and s.keep_after and s.ended_at > now() - interval '3 hours');
$$;

-- Returns the live session for a code if the token belongs to its current presenter.
create or replace function public.np_presenter_session(p_code text, p_token text)
returns public.sessions
language plpgsql security definer set search_path = public as $$
declare v public.sessions;
begin
  select s.* into v
  from public.sessions s
  join public.session_secrets x on x.session_id = s.id
  where s.code = upper(p_code)
    and x.presenter_token_hash = public.np_hash(coalesce(p_token, ''))
    and s.status = 'live'
    and s.expires_at > now();
  if not found then
    raise exception 'You are not the presenter for this session';
  end if;
  return v;
end $$;

-- ───────────────────────── Session functions ─────────────────────────

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
begin
  if v_uid is null then raise exception 'Sign in to present'; end if;
  if not exists (select 1 from public.decks where id = p_deck_id and owner_id = v_uid) then
    raise exception 'Deck not found';
  end if;
  select count(*) into v_count from public.slides where deck_id = p_deck_id;
  if v_count = 0 then raise exception 'Add at least one slide first'; end if;

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_abc, 1 + floor(random() * length(v_abc))::int, 1);
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

-- Everything a viewer needs on join: session state, deck look, and all slides (for preloading).
create or replace function public.get_session(p_code text)
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
    'deck', json_build_object('title', d.title, 'theme', d.theme),
    'slides', coalesce((
      -- Speaker notes never leave the server here; presenters fetch them with get_presenter_notes.
      select json_agg(json_build_object('id', s.id, 'kind', s.kind, 'content', s.content - 'notes') order by s.position)
      from public.slides s where s.deck_id = v.deck_id
    ), '[]'::json)
  );
end $$;

create or replace function public.verify_presenter(p_code text, p_token text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  perform 1
  from public.sessions s
  join public.session_secrets x on x.session_id = s.id
  where s.code = upper(p_code)
    and x.presenter_token_hash = public.np_hash(coalesce(p_token, ''))
    and s.status = 'live';
  return found;
end $$;

-- Speaker notes, in slide order, for the current presenter only.
create or replace function public.get_presenter_notes(p_code text, p_token text)
returns json
language plpgsql stable security definer set search_path = public as $$
declare v public.sessions;
begin
  v := public.np_presenter_session(p_code, p_token);
  return coalesce((
    select json_agg(coalesce(s.content ->> 'notes', '') order by s.position)
    from public.slides s where s.deck_id = v.deck_id
  ), '[]'::json);
end $$;

create or replace function public.set_slide(p_code text, p_token text, p_index int)
returns void
language plpgsql security definer set search_path = public as $$
declare v public.sessions; n int;
begin
  v := public.np_presenter_session(p_code, p_token);
  select count(*) into n from public.slides where deck_id = v.deck_id;
  if p_index < 0 or p_index >= n then raise exception 'Slide out of range'; end if;
  update public.sessions set current_slide = p_index, slide_count = n where id = v.id;
end $$;

create or replace function public.register_viewer(p_code text, p_client_id uuid, p_secret text, p_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare v public.sessions; v_name text;
begin
  select * into v from public.sessions where code = upper(p_code) and status = 'live' and expires_at > now();
  if not found then return; end if;
  v_name := left(coalesce(nullif(trim(p_name), ''), 'Guest'), 40);
  insert into public.session_viewers (session_id, client_id, secret_hash, display_name)
  values (v.id, p_client_id, public.np_hash(p_secret), v_name)
  on conflict (session_id, client_id) do update
    set display_name = excluded.display_name
    where public.session_viewers.secret_hash = excluded.secret_hash;
end $$;

-- Current presenter offers control to a viewer's device.
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
end $$;

create or replace function public.cancel_handoff(p_code text, p_token text)
returns void
language plpgsql security definer set search_path = public as $$
declare v public.sessions;
begin
  v := public.np_presenter_session(p_code, p_token);
  update public.sessions set handoff_to = null, handoff_from = null where id = v.id;
end $$;

-- The offered device accepts and receives a fresh presenter token. The old token stops working.
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
end $$;

-- The signed-in owner can always take control back.
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
  return v_token;
end $$;

-- The current presenter or the owner ends the session.
-- p_keep = true leaves slides viewable at the link for 3 hours.
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
end $$;

-- ───────────────────────── Grants ─────────────────────────

revoke all on function public.np_presenter_session(text, text) from public, anon, authenticated;

grant execute on function public.get_session(text)                        to anon, authenticated;
grant execute on function public.verify_presenter(text, text)             to anon, authenticated;
grant execute on function public.set_slide(text, text, int)               to anon, authenticated;
grant execute on function public.get_presenter_notes(text, text)          to anon, authenticated;
grant execute on function public.register_viewer(text, uuid, text, text)  to anon, authenticated;
grant execute on function public.offer_handoff(text, text, uuid)          to anon, authenticated;
grant execute on function public.cancel_handoff(text, text)               to anon, authenticated;
grant execute on function public.claim_handoff(text, uuid, text)          to anon, authenticated;
grant execute on function public.decline_handoff(text, uuid, text)        to anon, authenticated;
grant execute on function public.end_session(text, text, boolean)         to anon, authenticated;
grant execute on function public.start_session(uuid, text)                to authenticated;
grant execute on function public.reclaim_session(text, text)              to authenticated;

-- ───────────────────────── Realtime ─────────────────────────
-- Viewers subscribe to changes on their session row (slide index, presenter, handoff offers).

do $$
begin
  alter publication supabase_realtime add table public.sessions;
exception when duplicate_object then null;
end $$;

-- ───────────────────────── Storage ─────────────────────────
-- Public bucket for slide images. Presenters upload into a folder named after their user id.

insert into storage.buckets (id, name, public)
values ('slide-images', 'slide-images', true)
on conflict (id) do nothing;

drop policy if exists "presenters upload slide images" on storage.objects;
create policy "presenters upload slide images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'slide-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "presenters delete slide images" on storage.objects;
create policy "presenters delete slide images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'slide-images' and (storage.foldername(name))[1] = auth.uid()::text);
