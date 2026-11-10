-- No Projector: set lists ("tonight's set").
-- Run after 0001_init.sql and 0002_hardening.sql. Safe to run more than once.
--
-- A set list is an ordered list of songs from one deck. Songs are saved by title and
-- number, not slide position, so editing the deck doesn't break a saved set.
-- The deck owner manages sets directly (row-level security). Other leaders edit a set
-- through its share link, which carries a random key; they go through the
-- get_shared_set / save_shared_set functions and never read the table.
-- Whoever is presenting a live session (owner, or anyone handed control) can read the
-- deck's sets and add songs to them through get_session_sets / save_session_set.
-- Only the newest three sets per deck are kept.

create table if not exists public.set_lists (
  id          uuid primary key default gen_random_uuid(),
  deck_id     uuid not null references public.decks(id) on delete cascade,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default '',
  songs       jsonb not null default '[]'::jsonb,
  share_key   text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists set_lists_deck_idx on public.set_lists (deck_id, created_at desc);

-- Shape checks: songs is an array of at most 100 entries; names are short; keys are long.
alter table public.set_lists drop constraint if exists set_lists_shape;
alter table public.set_lists add constraint set_lists_shape check (
  jsonb_typeof(songs) = 'array'
  and jsonb_array_length(songs) <= 100
  and char_length(name) <= 80
  and char_length(share_key) >= 32
);

alter table public.set_lists enable row level security;

drop policy if exists "owners manage set lists" on public.set_lists;
create policy "owners manage set lists" on public.set_lists
  for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = auth.uid())
  );

grant select, insert, update, delete on public.set_lists to authenticated;

-- Keep updated_at current.
create or replace function public.np_set_lists_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists set_lists_touch on public.set_lists;
create trigger set_lists_touch before update on public.set_lists
  for each row execute function public.np_set_lists_touch();

-- Keep only the newest three sets for each deck.
create or replace function public.np_set_lists_keep_three()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.set_lists
  where deck_id = new.deck_id
    and id not in (
      select id from public.set_lists
      where deck_id = new.deck_id
      order by created_at desc, id desc
      limit 3
    );
  return null;
end $$;

drop trigger if exists set_lists_keep_three on public.set_lists;
create trigger set_lists_keep_three after insert on public.set_lists
  for each row execute function public.np_set_lists_keep_three();

revoke execute on function public.np_set_lists_keep_three() from public, anon, authenticated;

-- Validates a songs array from a client: at most 100 entries, each {title, number?}
-- with short strings. Returns a clean copy (other keys dropped).
create or replace function public.np_clean_songs(p_songs jsonb)
returns jsonb language plpgsql immutable as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_item jsonb;
  v_title text;
  v_number text;
begin
  if p_songs is null or jsonb_typeof(p_songs) <> 'array' then
    raise exception 'songs must be a list';
  end if;
  if jsonb_array_length(p_songs) > 100 then
    raise exception 'a set can hold at most 100 songs';
  end if;
  for v_item in select * from jsonb_array_elements(p_songs) loop
    v_title := left(coalesce(v_item->>'title', ''), 200);
    v_number := left(nullif(v_item->>'number', ''), 20);
    if v_title = '' then
      raise exception 'every song needs a title';
    end if;
    v_out := v_out || jsonb_build_array(
      case when v_number is null then jsonb_build_object('title', v_title)
           else jsonb_build_object('title', v_title, 'number', v_number) end
    );
  end loop;
  return v_out;
end $$;

-- For a share-link holder: the set plus what's needed to search the deck's songs.
-- Slides come back with title, body, and table text only. Speaker notes are never sent; only the
-- "Number:" and "First line:" lines the song list uses are pulled out of them.
-- Returns null for a wrong id or key.
create or replace function public.get_shared_set(p_set uuid, p_key text)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v public.set_lists;
  v_deck public.decks;
begin
  select * into v from public.set_lists
  where id = p_set and share_key = coalesce(p_key, '') and char_length(coalesce(p_key, '')) >= 32;
  if not found then
    return null;
  end if;
  select * into v_deck from public.decks where id = v.deck_id;
  return json_build_object(
    'id', v.id,
    'name', v.name,
    'songs', v.songs,
    'created_at', v.created_at,
    'updated_at', v.updated_at,
    'deck_title', v_deck.title,
    'slides', coalesce((
      select json_agg(json_build_object(
        'title', s.content->>'title',
        'body', s.content->>'body',
        'table', s.content->'table',
        'number', substring(s.content->>'notes' from '(?in)^Number:[ \t]*([^\r\n]*[^[:space:]])'),
        'first_line', substring(s.content->>'notes' from '(?in)^First line:[ \t]*([^\r\n]*[^[:space:]])')
      ) order by s.position)
      from public.slides s where s.deck_id = v.deck_id
    ), '[]'::json)
  );
end $$;

-- For a share-link holder: save the set's name and songs. Returns the new updated_at,
-- or null for a wrong id or key.
create or replace function public.save_shared_set(p_set uuid, p_key text, p_name text, p_songs jsonb)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_at timestamptz;
begin
  update public.set_lists
  set name = left(coalesce(p_name, ''), 80),
      songs = public.np_clean_songs(p_songs)
  where id = p_set and share_key = coalesce(p_key, '') and char_length(coalesce(p_key, '')) >= 32
  returning updated_at into v_at;
  return v_at;
end $$;

-- For whoever is presenting a live session (the owner, or a phone handed control):
-- the sets for the session's deck, newest first. Empty list if not allowed.
create or replace function public.get_session_sets(p_code text, p_token text)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v public.sessions;
begin
  select * into v from public.sessions
  where code = upper(p_code) and status = 'live' and expires_at > now();
  if not found then
    return '[]'::json;
  end if;
  if v.owner_id is distinct from auth.uid() and not public.verify_presenter(p_code, p_token) then
    return '[]'::json;
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', l.id, 'name', l.name, 'songs', l.songs,
      'created_at', l.created_at, 'updated_at', l.updated_at
    ) order by l.created_at desc)
    from public.set_lists l where l.deck_id = v.deck_id
  ), '[]'::json);
end $$;

-- For whoever is presenting: save the songs of one of the session deck's sets (used when
-- a song outside the set is picked mid-gathering and added to it).
create or replace function public.save_session_set(p_code text, p_token text, p_set uuid, p_songs jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v public.sessions;
begin
  select * into v from public.sessions
  where code = upper(p_code) and status = 'live' and expires_at > now();
  if not found then
    raise exception 'session not found';
  end if;
  if v.owner_id is distinct from auth.uid() and not public.verify_presenter(p_code, p_token) then
    raise exception 'not the presenter';
  end if;
  update public.set_lists set songs = public.np_clean_songs(p_songs)
  where id = p_set and deck_id = v.deck_id;
  if not found then
    raise exception 'set not found';
  end if;
end $$;

grant execute on function public.get_shared_set(uuid, text)                   to anon, authenticated;
grant execute on function public.save_shared_set(uuid, text, text, jsonb)     to anon, authenticated;
grant execute on function public.get_session_sets(text, text)                 to anon, authenticated;
grant execute on function public.save_session_set(text, text, uuid, jsonb)    to anon, authenticated;
