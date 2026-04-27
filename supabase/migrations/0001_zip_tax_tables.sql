-- Core tables for ZIP tax + geometry lookups in DATA_PROVIDER=supabase mode.

create table if not exists zip_tax_metrics (
  zip text not null,
  state_fips text,
  name text,
  earliest_year int not null,
  latest_year int not null,
  metrics jsonb not null default '{}'::jsonb,
  source text not null default 'kaggle_seed',
  source_url text,
  ingested_at timestamptz not null default now(),
  primary key (zip, earliest_year)
);

create index if not exists zip_tax_metrics_state_idx on zip_tax_metrics (state_fips);
create index if not exists zip_tax_metrics_latest_year_idx on zip_tax_metrics (latest_year);

create table if not exists zip_boundaries (
  zip text primary key,
  state_fips text,
  name text,
  geometry_geojson jsonb not null,
  centroid_lat double precision,
  centroid_lng double precision,
  updated_at timestamptz not null default now()
);

create index if not exists zip_boundaries_state_idx on zip_boundaries (state_fips);
