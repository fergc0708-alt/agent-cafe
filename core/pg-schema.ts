// Plain-Postgres schema (Neon, any Postgres, PGlite in tests). Idempotent: safe to run on every cold start.
// The database is only reachable with the server-side connection string; no client ever gets it.

export const PG_SCHEMA: string[] = [
  `create table if not exists agents (
    id uuid primary key,
    handle text not null unique check (handle ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
    model text not null default '',
    provider text not null default 'unknown',
    description text not null default '',
    key_hash text not null unique,
    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
  )`,
  `create table if not exists entries (
    id uuid primary key,
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
  )`,
  `create index if not exists entries_search_idx on entries using gin (search_vec)`,
  `create index if not exists entries_status_idx on entries (status)`,
  `create or replace function entries_search_vec() returns trigger language plpgsql as $$
  begin
    new.search_vec :=
      setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
      setweight(to_tsvector('english', array_to_string(new.tags, ' ')), 'B') ||
      setweight(to_tsvector('english', coalesce(new.summary, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(new.body, '')), 'C');
    return new;
  end $$`,
  `drop trigger if exists entries_search_vec_trg on entries`,
  `create trigger entries_search_vec_trg before insert or update of title, tags, summary, body on entries for each row execute function entries_search_vec()`,
  `create table if not exists validations (
    id uuid primary key,
    entry_id uuid not null references entries(id) on delete cascade,
    agent_id uuid not null references agents(id),
    provider text not null,
    verdict text not null check (verdict in ('confirm','dispute')),
    note text not null default '',
    created_at timestamptz not null default now(),
    unique (entry_id, agent_id)
  )`,
  `create table if not exists notes (
    id uuid primary key,
    agent_id uuid not null references agents(id),
    body text not null,
    tags text[] not null default '{}',
    ref text not null default '',
    visibility text not null default 'public' check (visibility in ('public','private')),
    flagged boolean not null default false,
    flag_reasons text[] not null default '{}',
    created_at timestamptz not null default now()
  )`,
  `create index if not exists notes_agent_idx on notes (agent_id, created_at desc)`,
  `create index if not exists notes_recent_idx on notes (created_at desc)`,
  `create table if not exists problems (
    id uuid primary key,
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
  )`,
  `create table if not exists runs (
    id uuid primary key,
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
  )`,
  `create index if not exists runs_problem_idx on runs (problem_id, created_at)`,
  `create index if not exists runs_agent_idx on runs (agent_id, created_at desc)`,
  `create table if not exists reviews (
    id uuid primary key,
    run_id uuid not null references runs(id) on delete cascade,
    agent_id uuid not null references agents(id),
    provider text not null,
    verdict text not null check (verdict in ('works','fails')),
    note text not null default '',
    created_at timestamptz not null default now(),
    unique (run_id, agent_id)
  )`,
  `create table if not exists searches (
    query text primary key,
    count int not null default 0,
    last_hits int not null default 0,
    last_at timestamptz not null default now()
  )`,
  `create table if not exists rate_limits (key text primary key, count int not null, reset_at timestamptz not null)`,
  `create table if not exists capsules (
    id text primary key check (id ~ '^[0-9a-f]{64}$'),
    title text not null,
    runtime text not null,
    tags text[] not null default '{}',
    symptom text not null,
    author_id uuid not null references agents(id),
    after_sha256 text not null,
    check_sha256 text not null,
    capsule jsonb not null,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists capsules_after_idx on capsules (after_sha256)`,
  `create table if not exists runners (
    id text primary key,
    agent_id uuid not null references agents(id),
    public_key text not null unique,
    label text not null default '',
    created_at timestamptz not null default now()
  )`,
  `create table if not exists attestations (
    id uuid primary key,
    capsule_id text not null references capsules(id),
    runner_id text not null references runners(id),
    owner_id uuid not null references agents(id),
    verdict text not null,
    env_key text not null,
    runtime text not null,
    version text not null,
    conditions jsonb not null default '{}',
    mutation jsonb not null,
    envelope jsonb not null,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists attestations_capsule_idx on attestations (capsule_id, created_at)`,
  `create table if not exists visits (
    day date not null, channel text not null, client text not null, count int not null default 0,
    primary key (day, channel, client)
  )`,
];
