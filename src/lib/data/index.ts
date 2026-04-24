import { StaticDataProvider } from "./providers/static";
import { KaggleDataProvider } from "./providers/kaggle";
import type { DataProvider } from "./provider";

let cached: DataProvider | null = null;

export async function getDataProvider(): Promise<DataProvider> {
  if (cached) return cached;

  const choice = process.env.DATA_PROVIDER ?? "static";
  if (choice === "kaggle") {
    try {
      const kaggle = new KaggleDataProvider();
      // Probe — if ingested artifacts are missing, fall through to static.
      await kaggle.getSummary();
      cached = kaggle;
      return cached;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        "[data] DATA_PROVIDER=kaggle but Kaggle data could not be loaded; falling back to static.",
        msg
      );
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[data] Fix: run `npm run build:data` (needs KAGGLE_USERNAME, KAGGLE_KEY, KAGGLE_DATASET in .env). " +
            "`npm run dev` runs this automatically if public/data/kaggle/ is empty."
        );
      }
    }
  }

  cached = new StaticDataProvider();
  return cached;
}

export type { DataProvider, DataFilters, DataQueryResult } from "./provider";
