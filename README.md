# Geo Spatial AI

Chat-driven geospatial analytics app. Ask a geographic question, the LLM returns
a chat message plus map features plus numeric KPIs, and the UI renders all three
in sync.

- **Stack**: Next.js 15 + React 19 + TypeScript + Tailwind 4
- **Map**: Mapbox GL + deck.gl (choropleths for country-keyed data, scatterplots for lat/lon)
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

Open <http://localhost:3000> and ask a question, e.g. "Which countries have
shown the biggest improvements in life expectancy this century?".

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

## Using a Kaggle dataset

1. Create an API token at <https://www.kaggle.com/settings>. It downloads a
   `kaggle.json` with `username` and `key`.
2. Visit the dataset page once in your browser and click **Download** to accept
   its license on your account. (Without this step the API 403s.)
3. Set in `.env.local`:

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

4. Run the ingestion once before starting dev:

   ```bash
   npm run build:data
   ```

   This downloads the dataset, joins rows to country polygons, pre-computes
   per-country rollups (earliest / latest / delta / min / max / mean per
   numeric column), and writes three artifacts into `public/data/kaggle/`:

   - `features.geojson` — one polygon per country carrying the latest-year value
   - `rollups.json` — deterministic per-country + global rollups the LLM trusts
   - `summary.json` — dataset description the LLM sees in its system prompt

5. `npm run dev` and ask away. The same script runs as `prebuild` during
   `npm run build` / on Vercel, so deployments always ship fresh data.

### Supported geo shapes

- `KAGGLE_GEO_MODE=country`: rows identified by a country name / code. We
  normalize to ISO-3 via a bundled lookup and join to world-atlas country
  polygons. Used for choropleths.
- `KAGGLE_GEO_MODE=latlon`: rows have `KAGGLE_LAT_COL` and `KAGGLE_LON_COL`.
  Used for scatterplots.

Address / city geocoding is **not** included — it requires an external service
with rate limits and cost. Pre-geocode in a separate pipeline if you need it.

## Deploying to Vercel

1. Push the repo to GitHub.
2. Import the project at <https://vercel.com/new>.
3. Copy every variable from `.env.local` into **Project Settings → Environment
   Variables** (Production and Preview).
4. Deploy. The `prebuild` step will fetch the Kaggle dataset using the env vars;
   watch the build log for `[kaggle] Wrote N features...`.

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
    llm/                   -- provider-agnostic LLM service (OpenAI + Azure)
    data/                  -- pluggable DataProvider (static, kaggle) + geo helpers
    state/                 -- zustand stores (chat, map, kpi)
scripts/fetch-kaggle-data.ts  -- build-time Kaggle ingestion
public/data/                  -- sample data + kaggle/ artifacts (gitignored)
```

## License caveats for Kaggle data

Each dataset has its own license. The life-expectancy dataset is a repackage
of public WHO data, but always re-read the Kaggle page's license line before
deploying publicly.
