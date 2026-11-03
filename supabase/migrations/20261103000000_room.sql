create table public.rooms (
  ticker text primary key check (ticker ~ '^[A-Z0-9.]{1,12}$'),
  title text not null,
  capacity integer not null default 100 check (capacity between 1 and 100)
);

create table public.seats (
  room text references public.rooms on delete cascade,
  slot integer check (slot between 1 and 100),
  guest uuid not null,
  expires_at timestamptz not null,
  primary key (room, slot),
  unique (room, guest)
);

create table public.messages (
  id bigint generated always as identity primary key,
  room text not null references public.rooms on delete cascade,
  guest uuid not null,
  body text not null check (char_length(body) between 1 and 180),
  created_at timestamptz not null default clock_timestamp()
);

create table public.reactions (
  room text references public.rooms on delete cascade,
  candle integer check (candle between 0 and 31),
  guest uuid,
  emoji text not null check (emoji in ('🔥','👀','💎')),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (room, candle, guest)
);

create index messages_room_id on public.messages(room, id desc);
create index messages_guest_time on public.messages(guest, created_at desc);
create index reactions_guest_time on public.reactions(guest, updated_at desc);

alter table public.rooms enable row level security;
alter table public.seats enable row level security;
alter table public.messages enable row level security;
alter table public.reactions enable row level security;
revoke all on public.rooms, public.seats, public.messages, public.reactions from anon, authenticated;
grant select on public.rooms, public.seats, public.messages, public.reactions to anon, authenticated;
create policy rooms_read on public.rooms for select using (true);
create policy seats_read on public.seats for select using (true);
create policy messages_read on public.messages for select using (true);
create policy reactions_read on public.reactions for select using (true);

-- Clients keep a random bearer UUID. Only its derived public identifier is stored.
create function public.room_action(
  ticker text, token uuid, action text, message text default null,
  candle_id integer default null, reaction text default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  guest_id uuid := md5(token::text)::uuid;
  room_capacity integer;
  seat_number integer;
begin
  if token is null then raise exception 'INVALID_GUEST'; end if;
  -- All admissions and capacity edits serialize on the same room row.
  select capacity into room_capacity from public.rooms r where r.ticker = room_action.ticker for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;

  select slot into seat_number from public.seats s
  where s.room = ticker and s.guest = guest_id and s.expires_at > clock_timestamp();

  if action = 'leave' then
    update public.seats set expires_at = clock_timestamp()
      where room = ticker and guest = guest_id and slot = seat_number;
    return 0;
  end if;

  if action = 'join' then
    if seat_number is null then
      if (select count(*) from public.seats where room = ticker and expires_at > clock_timestamp()) >= room_capacity
        then raise exception 'ROOM_FULL'; end if;
      -- Prefer the previous slot so a retry after expiration stays idempotent.
      select n into seat_number from generate_series(1, 100) n
      left join public.seats s on s.room = ticker and s.slot = n
      where s.slot is null or s.expires_at <= clock_timestamp()
      order by (s.guest = guest_id) desc nulls last, n limit 1;
    end if;
    insert into public.seats values (ticker, seat_number, guest_id, clock_timestamp() + interval '90 seconds')
      on conflict (room, slot) do update set guest = excluded.guest, expires_at = excluded.expires_at;
    return seat_number;
  end if;

  if seat_number is null then raise exception 'SEAT_EXPIRED'; end if;
  if action = 'heartbeat' then
    update public.seats set expires_at = clock_timestamp() + interval '90 seconds'
      where room = ticker and slot = seat_number;
  elsif action = 'chat' then
    message := btrim(message);
    if message is null or char_length(message) not between 1 and 180 then raise exception 'INVALID_MESSAGE'; end if;
    perform pg_advisory_xact_lock(hashtextextended(guest_id::text, 0));
    if exists (select 1 from public.messages m where m.guest = guest_id
      and (m.created_at > clock_timestamp() - interval '3 seconds'
      or (m.body = message and m.created_at > clock_timestamp() - interval '30 seconds'))) then
      raise exception 'CHAT_RATE_LIMIT';
    end if;
    insert into public.messages(room, guest, body) values (ticker, guest_id, message);
  elsif action = 'react' then
    if exists (select 1 from public.reactions r where r.guest = guest_id
      and r.updated_at > clock_timestamp() - interval '1 second') then raise exception 'REACTION_RATE_LIMIT'; end if;
    insert into public.reactions(room, candle, guest, emoji) values (ticker, candle_id, guest_id, reaction)
      on conflict (room, candle, guest) do update set emoji = excluded.emoji, updated_at = clock_timestamp();
  else
    raise exception 'INVALID_ACTION';
  end if;
  return seat_number;
end;
$$;
revoke execute on function public.room_action(text, uuid, text, text, integer, text) from public;
grant execute on function public.room_action(text, uuid, text, text, integer, text) to anon, authenticated;

create function public.check_room_capacity() returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.seats where room = old.ticker and expires_at > clock_timestamp()) > new.capacity then
    raise exception 'CAPACITY_BELOW_OCCUPANCY';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_room_capacity() from public, anon, authenticated;
create trigger check_room_capacity before update of capacity on public.rooms
for each row execute function public.check_room_capacity();

alter publication supabase_realtime add table public.rooms, public.seats, public.messages, public.reactions;
insert into public.rooms(ticker, title) values ('005930', '삼성전자');
