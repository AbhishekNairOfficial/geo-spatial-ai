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
      console.warn(
        "[data] DATA_PROVIDER=kaggle but ingested artifacts are missing; falling back to StaticDataProvider.",
        err instanceof Error ? err.message : err
      );
    }
  }

  cached = new StaticDataProvider();
  return cached;
}

export type { DataProvider, DataFilters, DataQueryResult } from "./provider";
