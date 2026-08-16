-- ============================================================
-- Swim Team "Most Inspirational Swimmer" voting app
-- Supabase / Postgres schema
--
-- Parents vote on behalf of their kids (ages 6-18), including nominating
-- their own child. One email link per family/parent -> lands on a page
-- listing all their swimmers -> one vote per swimmer, cast by the parent,
-- picking any swimmer on the roster via autocomplete.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Tables ----------

-- One row per parent/family. A family can have multiple swimmers.
create table families (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  family_token  uuid not null default gen_random_uuid() unique, -- goes in the voting URL
  created_at    timestamptz not null default now()
);

-- One row per swimmer. group_name is optional, useful for the admin view
-- at ~200 swimmers (e.g. sorting/searching by training group).
create table swimmers (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id),
  name        text not null,
  group_name  text,
  has_voted   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- One row per vote. voter_id UNIQUE is the hard backstop for "one vote per
-- swimmer" -- still true even though a parent is the one clicking submit.
create table votes (
  id           uuid primary key default gen_random_uuid(),
  voter_id     uuid not null unique references swimmers(id),
  candidate_id uuid not null references swimmers(id),
  created_at   timestamptz not null default now()
);

create table voting_settings (
  id        int primary key default 1 check (id = 1),
  is_open   boolean not null default true,
  closed_at timestamptz
);
insert into voting_settings (id, is_open) values (1, true);

-- ---------- Roster view for the candidate autocomplete (name only) ----------
create view swimmer_roster as
  select id, name from swimmers order by name;

-- ---------- RLS: lock every table down; client only ever uses functions ----------
alter table families enable row level security;
alter table swimmers enable row level security;
alter table votes enable row level security;
alter table voting_settings enable row level security;

create table admins (
  user_id uuid primary key references auth.users(id)
);
alter table admins enable row level security;

create or replace function is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- ---------- RPC: look up a family's ballot by their token ----------
-- Returns one row per swimmer in that family: id, name, has_voted, plus
-- whether voting is globally open. Used to render the parent's page with
-- one autocomplete box per kid.
drop function if exists get_family_ballot(uuid);
create function get_family_ballot(token uuid)
returns table (
  swimmer_id uuid,
  swimmer_name text,
  has_voted boolean,
  voting_open boolean,
  voted_for_name text
)
language sql
security definer
stable
as $$
  select s.id, s.name, s.has_voted,
         (select vs.is_open from voting_settings vs where vs.id = 1),
         candidate.name
  from swimmers s
  join families f on f.id = s.family_id
  left join votes v on v.voter_id = s.id
  left join swimmers candidate on candidate.id = v.candidate_id
  where f.family_token = token
  order by s.name;
$$;

-- ---------- RPC: cast a vote for one specific child ----------
-- Verifies the token actually owns voter_swimmer (so a parent can only
-- vote on behalf of THEIR OWN kids, not anyone else's), then applies the
-- same one-vote/voting-open checks as before. Nominating your own child
-- as the candidate is explicitly allowed -- no check against that.
create or replace function cast_vote(token uuid, voter_swimmer uuid, candidate uuid)
returns text
language plpgsql
security definer
as $$
declare
  owns_voter boolean;
  already_voted boolean;
  open_now boolean;
begin
  select is_open into open_now from voting_settings where id = 1;
  if not open_now then
    return 'voting_closed';
  end if;

  select exists (
    select 1 from swimmers s
    join families f on f.id = s.family_id
    where f.family_token = token and s.id = voter_swimmer
  ) into owns_voter;

  if not owns_voter then
    return 'not_your_child';
  end if;

  select has_voted into already_voted from swimmers where id = voter_swimmer;
  if already_voted then
    return 'already_voted';
  end if;

  if not exists (select 1 from swimmers where id = candidate) then
    return 'invalid_candidate';
  end if;

  insert into votes (voter_id, candidate_id) values (voter_swimmer, candidate);
  update swimmers set has_voted = true where id = voter_swimmer;

  return 'ok';
exception
  when unique_violation then
    return 'already_voted';
end;
$$;

-- ---------- Admin-only: results tally ----------
create or replace function get_results()
returns table (candidate_id uuid, candidate_name text, vote_count bigint)
language sql
security definer
stable
as $$
  select s.id, s.name, count(v.id)
  from swimmers s
  left join votes v on v.candidate_id = s.id
  where is_admin()
  group by s.id, s.name
  order by count(v.id) desc;
$$;

-- ---------- Admin: open/close voting ----------
create or replace function set_voting_open(open boolean)
returns void
language plpgsql
security definer
as $$
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;
  update voting_settings
    set is_open = open,
        closed_at = case when open then null else now() end
    where id = 1;
end;
$$;

-- ---------- Admin: full family/swimmer roster, for support & re-sending links ----------
create or replace function get_admin_roster()
returns table (
  family_id uuid, family_email text, family_token uuid,
  swimmer_id uuid, swimmer_name text, group_name text, has_voted boolean
)
language sql
security definer
stable
as $$
  select f.id, f.email, f.family_token, s.id, s.name, s.group_name, s.has_voted
  from swimmers s
  join families f on f.id = s.family_id
  where is_admin()
  order by coalesce(s.group_name, ''), f.email, s.name;
$$;

-- ---------- Grants ----------
grant select on swimmer_roster to anon, authenticated;
grant execute on function get_family_ballot(uuid) to anon, authenticated;
grant execute on function cast_vote(uuid, uuid, uuid) to anon, authenticated;
grant execute on function get_results() to authenticated;
grant execute on function set_voting_open(boolean) to authenticated;
grant execute on function get_admin_roster() to authenticated;

-- No direct grants on families, swimmers, votes, voting_settings: RLS with
-- no policies + no table grants means the client can only reach data
-- through the functions above.
