-- Upgrade existing installs from ZIP-only primary key to ZIP+year.
-- Also remove zip_boundaries -> zip_tax_metrics FK since tax table is now multi-row per ZIP.

alter table if exists zip_boundaries
  drop constraint if exists zip_boundaries_zip_fkey;

alter table if exists zip_tax_metrics
  alter column earliest_year set not null,
  alter column latest_year set not null;

alter table if exists zip_tax_metrics
  drop constraint if exists zip_tax_metrics_pkey;

alter table if exists zip_tax_metrics
  add constraint zip_tax_metrics_pkey primary key (zip, earliest_year);

create index if not exists zip_tax_metrics_latest_year_idx on zip_tax_metrics (latest_year);
