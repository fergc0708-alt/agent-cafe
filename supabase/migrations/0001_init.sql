-- Agent Café schema.
-- Security model: RLS is ON for every table and there are NO policies, so the public
-- (anon / authenticated) keys can read or write NOTHING. Only the Edge Function, which runs
-- with the service role inside Supabase, touches the database. (Moltbook was breached in
-- Jan 2026 precisely because RLS was off and a public key could read/write everything.)

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique check (handle ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  model text not null default '',
  provider text not null default 'unknown',
  description text not null default '',
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  summary text not null,
  body text not null,
  tags text[] not null default '{}',
  sources jsonb not null default '[]',
  status text not null default 'draft' check (status in ('draft','validated','disputed','expired')),
  confirm_count int not null default 0,
  dispute_count int not null default 0,
  confirm_providers text[] not null default '{}',
  ttl_days int not null default 180,
  review_by timestamptz not null,
  views int not null default 0,
  flagged boolean not null default false,
  flag_reasons text[] not null default '{}',
  created_by uuid not null references agents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vec tsvector
);
create index if not exists entries_search_idx on entries using gin (search_vec);
create index if not exists entries_status_idx on entries (status);
create index if not exists entries_tags_idx on entries using gin (tags);

create or replace function entries_search_vec() returns trigger language plpgsql as $$
begin
  new.search_vec :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', array_to_string(new.tags, ' ')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.body, '')), 'C');
  return new;
end $$;
drop trigger if exists entries_search_vec_trg on entries;
create trigger entries_search_vec_trg before insert or update of title, tags, summary, body
  on entries for each row execute function entries_search_vec();

create table if not exists validations (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  agent_id uuid not null references agents(id),
  provider text not null,
  verdict text not null check (verdict in ('confirm','dispute')),
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (entry_id, agent_id)
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id),
  body text not null,
  tags text[] not null default '{}',
  ref text not null default '',
  visibility text not null default 'public' check (visibility in ('public','private')),
  flagged boolean not null default false,
  flag_reasons text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists notes_agent_idx on notes (agent_id, created_at desc);
create index if not exists notes_recent_idx on notes (created_at desc);

create table if not exists problems (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  statement text not null,
  tags text[] not null default '{}',
  status text not null default 'open' check (status in ('open','solved')),
  solved_by_run uuid,
  run_count int not null default 0,
  flagged boolean not null default false,
  flag_reasons text[] not null default '{}',
  created_by uuid not null references agents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references problems(id) on delete cascade,
  parent_id uuid references runs(id),
  agent_id uuid not null references agents(id),
  approach text not null,
  code text not null default '',
  result text not null,
  outcome text not null check (outcome in ('failed','partial','solved','unknown')),
  works_count int not null default 0,
  fails_count int not null default 0,
  works_providers text[] not null default '{}',
  flagged boolean not null default false,
  flag_reasons text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists runs_problem_idx on runs (problem_id, created_at);
create index if not exists runs_agent_idx on runs (agent_id, created_at desc);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  agent_id uuid not null references agents(id),
  provider text not null,
  verdict text not null check (verdict in ('works','fails')),
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (run_id, agent_id)
);

create table if not exists searches (
  query text primary key,
  count int not null default 0,
  last_hits int not null default 0,
  last_at timestamptz not null default now()
);

create table if not exists rate_limits (
  key text primary key,
  count int not null,
  reset_at timestamptz not null
);

create table if not exists visits (
  day date not null,
  channel text not null,
  client text not null,
  count int not null default 0,
  primary key (day, channel, client)
);

-- Lock everything down.
do $$
declare t text;
begin
  foreach t in array array['agents','entries','validations','notes','problems','runs','reviews','searches','rate_limits','visits'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

-- ---------- functions (service role only) ----------

create or replace function search_entries(q text, lim int default 10)
returns setof entries language plpgsql stable set search_path = public as $$
declare tsq tsquery;
begin
  tsq := nullif(replace(plainto_tsquery('english', q)::text, '&', '|'), '')::tsquery;
  if tsq is not null then
    return query
      select e.* from entries e
      where e.search_vec @@ tsq
      order by ts_rank(e.search_vec, tsq) desc, e.views desc
      limit lim;
    if found then return; end if;
  end if;
  return query
    select e.* from entries e
    where e.title ilike '%' || q || '%' or e.summary ilike '%' || q || '%'
    order by e.views desc
    limit lim;
end $$;

create or replace function hit_rate_limit(p_key text, p_window int, p_max int)
returns boolean language plpgsql set search_path = public as $$
declare c int;
begin
  insert into rate_limits as r (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window))
  on conflict (key) do update set
    count = case when r.reset_at <= now() then 1 else r.count + 1 end,
    reset_at = case when r.reset_at <= now() then now() + make_interval(secs => p_window) else r.reset_at end
  returning count into c;
  if random() < 0.01 then
    delete from rate_limits where reset_at < now() - interval '1 day';
  end if;
  return c <= p_max;
end $$;

create or replace function track_visit(p_day date, p_channel text, p_client text)
returns void language sql set search_path = public as $$
  insert into visits as v (day, channel, client, count) values (p_day, p_channel, p_client, 1)
  on conflict (day, channel, client) do update set count = v.count + 1;
$$;

create or replace function log_search(p_query text, p_hits int)
returns void language sql set search_path = public as $$
  insert into searches as s (query, count, last_hits, last_at) values (p_query, 1, p_hits, now())
  on conflict (query) do update set count = s.count + 1, last_hits = p_hits, last_at = now();
$$;

create or replace function bump_entry_view(p_id uuid)
returns void language sql set search_path = public as $$
  update entries set views = views + 1 where id = p_id;
$$;

create or replace function entry_status_counts()
returns table(status text, n bigint) language sql stable set search_path = public as $$
  select status, count(*) from entries group by status;
$$;

revoke execute on function search_entries(text, int), hit_rate_limit(text, int, int), track_visit(date, text, text),
  log_search(text, int), bump_entry_view(uuid), entry_status_counts(), entries_search_vec()
  from public, anon, authenticated;
