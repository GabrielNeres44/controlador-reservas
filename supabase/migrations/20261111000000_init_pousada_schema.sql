-- Schema inicial para persistência do Controlador de Reservas no Supabase

create table if not exists public.rooms (
  id text primary key,
  name text not null,
  capacity integer not null check (capacity >= 1),
  price numeric(10, 2) not null check (price >= 0),
  status text not null default 'ativo' check (status in ('ativo', 'manutencao')),
  sky_expiration text,
  position integer not null default 0
);

create table if not exists public.channels (
  id text primary key,
  name text not null,
  position integer not null default 0
);

create table if not exists public.guests (
  id text primary key,
  name text not null,
  phone text not null default '',
  email text not null default '',
  document text not null default '',
  position integer not null default 0
);

create table if not exists public.reservations (
  id text primary key,
  room_id text not null references public.rooms(id) on delete cascade,
  guest_id text not null references public.guests(id) on delete cascade,
  channel_id text not null references public.channels(id),
  check_in text not null,
  check_out text not null,
  people integer not null check (people >= 1),
  total numeric(10, 2) not null check (total >= 0),
  notes text not null default '',
  status text not null default 'confirmada' check (status in ('confirmada', 'hospedado', 'finalizada', 'cancelada')),
  created_at text not null,
  position integer not null default 0
);

-- Índices em chaves estrangeiras e colunas de busca de conflito (Postgres Best Practices)
create index if not exists reservations_room_id_idx on public.reservations (room_id);
create index if not exists reservations_guest_id_idx on public.reservations (guest_id);
create index if not exists reservations_channel_id_idx on public.reservations (channel_id);
create index if not exists reservations_room_dates_idx on public.reservations (room_id, check_in, check_out);

-- Habilita RLS em todas as tabelas expostas no schema public
alter table public.rooms enable row level security;
alter table public.channels enable row level security;
alter table public.guests enable row level security;
alter table public.reservations enable row level security;

-- Permissões para acesso via Data API (anon / authenticated / service_role)
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on table
  public.rooms,
  public.channels,
  public.guests,
  public.reservations
to anon, authenticated, service_role;

-- Políticas de acesso (modo sem autenticação de usuário final)
drop policy if exists "rooms_access_policy" on public.rooms;
create policy "rooms_access_policy" on public.rooms
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "channels_access_policy" on public.channels;
create policy "channels_access_policy" on public.channels
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "guests_access_policy" on public.guests;
create policy "guests_access_policy" on public.guests
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "reservations_access_policy" on public.reservations;
create policy "reservations_access_policy" on public.reservations
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- Função RPC para ler todo o estado de uma só vez (SECURITY INVOKER respeita RLS)
create or replace function public.get_pousada_state()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'rooms', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'name', r.name,
          'capacity', r.capacity,
          'price', r.price::float8,
          'status', r.status,
          'skyExpiration', r.sky_expiration
        ) order by r.position, r.name
      ) from public.rooms r
    ), '[]'::jsonb),
    'channels', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name
        ) order by c.position, c.name
      ) from public.channels c
    ), '[]'::jsonb),
    'guests', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', g.id,
          'name', g.name,
          'phone', g.phone,
          'email', g.email,
          'document', g.document
        ) order by g.position, g.name
      ) from public.guests g
    ), '[]'::jsonb),
    'reservations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', rv.id,
          'roomId', rv.room_id,
          'guestId', rv.guest_id,
          'channelId', rv.channel_id,
          'checkIn', rv.check_in,
          'checkOut', rv.check_out,
          'people', rv.people,
          'total', rv.total::float8,
          'notes', rv.notes,
          'status', rv.status,
          'createdAt', rv.created_at
        ) order by rv.position, rv.created_at
      ) from public.reservations rv
    ), '[]'::jsonb)
  );
$$;

-- Função RPC transacional para sincronizar o estado completo em uma única chamada
create or replace function public.sync_pousada_state(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Remove registros que não estão mais no payload (respeitando ordem das FKs)
  delete from public.reservations
  where id not in (
    select coalesce(elem->>'id', '')
    from jsonb_array_elements(coalesce(payload->'reservations', '[]'::jsonb)) as elem
  );

  delete from public.rooms
  where id not in (
    select coalesce(elem->>'id', '')
    from jsonb_array_elements(coalesce(payload->'rooms', '[]'::jsonb)) as elem
  );

  delete from public.guests
  where id not in (
    select coalesce(elem->>'id', '')
    from jsonb_array_elements(coalesce(payload->'guests', '[]'::jsonb)) as elem
  );

  delete from public.channels
  where id not in (
    select coalesce(elem->>'id', '')
    from jsonb_array_elements(coalesce(payload->'channels', '[]'::jsonb)) as elem
  );

  -- Upsert de rooms
  insert into public.rooms (id, name, capacity, price, status, sky_expiration, position)
  select
    elem->>'id',
    elem->>'name',
    (elem->>'capacity')::integer,
    (elem->>'price')::numeric,
    coalesce(elem->>'status', 'ativo'),
    nullif(elem->>'skyExpiration', ''),
    ord::integer
  from jsonb_array_elements(coalesce(payload->'rooms', '[]'::jsonb)) with ordinality as t(elem, ord)
  on conflict (id) do update set
    name = excluded.name,
    capacity = excluded.capacity,
    price = excluded.price,
    status = excluded.status,
    sky_expiration = excluded.sky_expiration,
    position = excluded.position;

  -- Upsert de channels
  insert into public.channels (id, name, position)
  select
    elem->>'id',
    elem->>'name',
    ord::integer
  from jsonb_array_elements(coalesce(payload->'channels', '[]'::jsonb)) with ordinality as t(elem, ord)
  on conflict (id) do update set
    name = excluded.name,
    position = excluded.position;

  -- Upsert de guests
  insert into public.guests (id, name, phone, email, document, position)
  select
    elem->>'id',
    elem->>'name',
    coalesce(elem->>'phone', ''),
    coalesce(elem->>'email', ''),
    coalesce(elem->>'document', ''),
    ord::integer
  from jsonb_array_elements(coalesce(payload->'guests', '[]'::jsonb)) with ordinality as t(elem, ord)
  on conflict (id) do update set
    name = excluded.name,
    phone = excluded.phone,
    email = excluded.email,
    document = excluded.document,
    position = excluded.position;

  -- Upsert de reservations
  insert into public.reservations (
    id, room_id, guest_id, channel_id, check_in, check_out,
    people, total, notes, status, created_at, position
  )
  select
    elem->>'id',
    elem->>'roomId',
    elem->>'guestId',
    elem->>'channelId',
    elem->>'checkIn',
    elem->>'checkOut',
    (elem->>'people')::integer,
    (elem->>'total')::numeric,
    coalesce(elem->>'notes', ''),
    coalesce(elem->>'status', 'confirmada'),
    coalesce(elem->>'createdAt', now()::text),
    ord::integer
  from jsonb_array_elements(coalesce(payload->'reservations', '[]'::jsonb)) with ordinality as t(elem, ord)
  on conflict (id) do update set
    room_id = excluded.room_id,
    guest_id = excluded.guest_id,
    channel_id = excluded.channel_id,
    check_in = excluded.check_in,
    check_out = excluded.check_out,
    people = excluded.people,
    total = excluded.total,
    notes = excluded.notes,
    status = excluded.status,
    created_at = excluded.created_at,
    position = excluded.position;
end;
$$;

grant execute on function public.get_pousada_state() to anon, authenticated, service_role;
grant execute on function public.sync_pousada_state(jsonb) to anon, authenticated, service_role;
