-- Виконай цей файл у Supabase: SQL Editor -> New query -> Run

create table if not exists users (
  user_id bigint primary key,
  city text,
  mode text,
  cat text,
  last_report timestamptz not null default 'epoch'
);

create table if not exists reports (
  id bigserial primary key,
  city text not null,
  category text not null,
  text text not null,
  user_id bigint not null,
  created_at timestamptz not null default now(),
  ups int not null default 0,
  downs int not null default 0
);

create index if not exists idx_reports_city on reports (city, created_at desc);

create table if not exists votes (
  report_id bigint references reports(id) on delete cascade,
  user_id bigint,
  primary key (report_id, user_id)
);

-- Доступ тільки через service_role ключ на сервері
alter table users enable row level security;
alter table reports enable row level security;
alter table votes enable row level security;

create or replace function vote_report(p_report bigint, p_user bigint, p_dir text)
returns text
language plpgsql
as $$
declare
  v_owner bigint;
begin
  select user_id into v_owner from reports where id = p_report;
  if not found then return 'gone'; end if;
  if v_owner = p_user then return 'own'; end if;

  insert into votes (report_id, user_id) values (p_report, p_user)
  on conflict do nothing;
  if not found then return 'dup'; end if;

  if p_dir = 'up' then
    update reports set ups = ups + 1 where id = p_report;
  else
    update reports set downs = downs + 1 where id = p_report;
  end if;
  return 'ok';
end;
$$;
