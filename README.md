# Geo Spatial AI

Chat-driven geospatial analytics app. Ask a geographic question, the LLM returns
a chat message plus map features plus numeric KPIs, and the UI renders all three
in sync.

- **Stack**: Next.js 15 + React 19 + TypeScript + Tailwind 4
- **Map**: Mapbox GL + deck.gl (choropleths: country- or US-ZIP (ZCTA)–keyed, scatter for lat/lon)
- **LLM**: provider-agnostic service layer with OpenAI and Azure OpenAI implementations
- **Data**: pluggable data provider (`static` sample + `kaggle` build-time ingestion)
- **Deploy**: Vercel

## Quick start

```bash
cp .env.example .env.local
# Fill in OPENAI_API_KEY, NEXT_PUBLIC_MAPBOX_TOKEN (and optionally Kaggle vars)
npm install
npm run dev
```

With `DATA_PROVIDER=static`, ask e.g. *"Which site has the highest metric?"*.

With IRS + ZCTA data ingested (see below), the map is **US-only** and you can
ask, e.g. *"Show the top 20 ZIPs by number of returns (N1)"* or
*"Highlight these ZIPs: 90210, 10001"* using the rollups in the system context.

## Environment variables

See [.env.example](.env.example). Summary:

| Variable | Purpose |
| -------- | ------- |
| `LLM_PROVIDER` | `openai` (default) or `azure-openai` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Required when `LLM_PROVIDER=openai` |
| `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION` | Required when `LLM_PROVIDER=azure-openai` |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox public token for the basemap |
| `DATA_PROVIDER` | `static` (default) or `kaggle` |
| `KAGGLE_*` | Required when `DATA_PROVIDER=kaggle` — see below |
| `ZCTA_LOCAL_PATH` | (Optional) Path to a local `cb_2020_us_zcta520_500k.zip` to skip downloading during `us_zip` ingestion |
| `ZCTA_TIGER_URL` | (Optional) Override URL for the ZCTA cartographic shapefile (default: Census 2020 `cb_2020_us_zcta520_500k`) |

## Using a Kaggle dataset

1. Create an API token at <https://www.kaggle.com/settings>. It downloads a
   `kaggle.json` with `username` and `key`.
2. Visit the dataset page once in your browser and click **Download** to accept
   its license on your account. (Without this step the API 403s.)
3. Set in `.env.local` (pick **one** pipeline — country vs US ZIP example):

   **World / country choropleth**

   ```env
   DATA_PROVIDER=kaggle
   KAGGLE_USERNAME=<from kaggle.json>
   KAGGLE_KEY=<from kaggle.json>
   KAGGLE_DATASET=saurabhbadole/life-expectancy-based-on-geographic-locations
   KAGGLE_FILE=Life Expectancy Data.csv
   KAGGLE_GEO_MODE=country
   KAGGLE_COUNTRY_COL=Country
   KAGGLE_METRIC=Life expectancy
   ```

   **US — IRS individual stats by ZIP (ZCTA polygons)**

   ```env
   DATA_PROVIDER=kaggle
   KAGGLE_USERNAME=<from kaggle.json>
   KAGGLE_KEY=<from kaggle.json>
   KAGGLE_DATASET=irs/individual-income-tax-statistics
   KAGGLE_FILE=2014.csv
   KAGGLE_GEO_MODE=us_zip
   KAGGLE_METRIC=N1
   ```

4. Run the ingestion once before starting dev:

   ```bash
   npm run build:data
   ```

   This downloads the Kaggle **CSV** (and, for `us_zip`, a **Census 2020 ZCTA
   shapefile** for boundaries), pre-computes per-area rollups (earliest / latest
   / delta / min / max / mean per numeric column), and writes into
   `public/data/kaggle/`:

   - `features.geojson` — one polygon per country **or** per ZIP (ZCTA) with a primary metric
   - `rollups.json` — per country **or** per-ZIP + global rollups the LLM uses
   - `summary.json` — metadata, including `geography: "us_zip"` for IRS+ZCTA builds

5. `npm run dev` and ask away. The same script runs as `prebuild` during
   `npm run build` / on Vercel, so deployments always ship fresh data.

### Supported geo shapes

- `KAGGLE_GEO_MODE=country`: rows identified by a country name / code. We
  normalize to ISO-3 via a bundled lookup and join to world-atlas country
  polygons. Used for choropleths.
- `KAGGLE_GEO_MODE=latlon`: rows have `KAGGLE_LAT_COL` and `KAGGLE_LON_COL`.
  Used for scatterplots.
- `KAGGLE_GEO_MODE=us_zip` (**IRS-style tabular + ZIP / ZCTA id**): rows have a
  ZIP (or `zipcode` / `ZCTA5`) and optional `state`. We **aggregate to one row
  per 5-digit ZIP** (summing across IRS `agi_stub` / brackets), then join to
  **Census 2020 `cb_2020_us_zcta520_500k`**. The UI locks the basemap to the
  **continental US** when `summary.geography === "us_zip"`. Pre-download the
  shapefile zip to `ZCTA_LOCAL_PATH` in CI to avoid a large network fetch on every
  build, if you prefer.

Address / city geocoding (non-ZIP) is **not** included. Pre-geocode in a
separate pipeline if you need it.

### AI: highlighting ZIPs on the map (IRS + `us_zip`)

The chat API returns a structured JSON payload. For US-ZIP data, the model
should set:

- **Top N by metric** — `highlightTopN: 20`, `highlightMetric: "N1"` (or
  `""` to use the build’s `primaryMetric`), `highlightZipCodes: []`. The
  **server** fills `geoFeatures` with real ZCTA polygons from
  `features.geojson` via `DataProvider.query` (`src/lib/llm/enrichZipPayload.ts`).
- **Explicit ZIPs (rule-style)** — `highlightTopN: 0` and
  `highlightZipCodes: ["90210", "10001", ...]`. The server again resolves
  geometry from the ingested layer.

You can still return `geoFeatures` with real GeoJSON from the model, but
relying on `highlightTopN` / `highlightZipCodes` avoids the model outputting
large polygon coordinates.

## Deploying to Vercel

1. Push the repo to GitHub.
2. Import the project at <https://vercel.com/new>.
3. Copy every variable from `.env.local` into **Project Settings → Environment
   Variables** (Production and Preview).
4. Deploy. The `prebuild` step fetches the Kaggle CSV; for `us_zip` it also
   fetches the Census ZCTA zip (unless `ZCTA_LOCAL_PATH` is set). Watch the
   build log for `[kaggle] Wrote N features...` and any ZCTA download lines.

Only `NEXT_PUBLIC_*` variables are sent to the browser; everything else stays
server-side.

### Cost / limits

- OpenAI `gpt-4o-mini` is the default model — usually a few dollars per month
  for light use. Set a **monthly spend cap** in the OpenAI dashboard before
  sharing the URL.
- Mapbox free tier includes 50k map loads per month.
- Vercel Hobby tier is free for personal projects.

## Adding your own LLM provider

Implement `LlmProvider` in `src/lib/llm/provider.ts` and register it in the
factory at `src/lib/llm/index.ts`. The `/api/chat` route and the UI don't need
to change.

## Adding your own data source

Implement `DataProvider` in `src/lib/data/provider.ts` and register it in
`src/lib/data/index.ts`. The Kaggle ingestion is one example; you could add
Supabase, Postgres (PostGIS), a static bundled file, or a remote JSON feed.

## Project structure

```
src/
  app/
    api/chat/route.ts      -- POST chat endpoint (structured JSON output)
    layout.tsx, page.tsx   -- root shell
  components/
    chat/                  -- ChatPanel, ChatInput, ChatMessageList, ChatEmptyState
    insights/              -- KpiPanel, KpiCard
    layout/AppHeader.tsx
    map/                   -- MapCanvas + color scale
  lib/
    llm/                   -- provider-agnostic LLM (OpenAI + Azure), `enrichZipPayload` for ZCTA
    data/                  -- pluggable DataProvider (static, kaggle) + geo helpers
    state/                 -- zustand stores (chat, map, kpi)
scripts/fetch-kaggle-data.ts  -- build-time Kaggle ingestion
public/data/                  -- sample data + kaggle/ artifacts (gitignored)
```

## License caveats for Kaggle data

Each dataset has its own license. The IRS
`irs/individual-income-tax-statistics` dataset and Census TIGER/Line
boundaries are US government / open terms — read the Kaggle dataset page and
Census product terms before deploying publicly.
