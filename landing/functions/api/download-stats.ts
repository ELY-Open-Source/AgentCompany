import type { CounterDatabase, PagesHandler } from "../types";
import { DOWNLOAD_COUNT_SEED } from "../../lib/downloads";

interface Env {
  DOWNLOAD_COUNTER_DB: CounterDatabase;
}

async function readDownloadCount(db: CounterDatabase) {
  const result = await db
    .prepare(`
      SELECT
        COALESCE(
          (SELECT value FROM download_counter_settings WHERE key = 'base_downloads'),
          ?
        ) + COUNT(*) AS downloads
      FROM unique_download_windows
    `)
    .bind(DOWNLOAD_COUNT_SEED)
    .first<{ downloads: number }>();

  if (!result) {
    throw new Error("Download count query returned no row.");
  }
  return result.downloads;
}

export const onRequestGet: PagesHandler<Env> = async (context) => {
  if (!context.env.DOWNLOAD_COUNTER_DB) {
    throw new Error("DOWNLOAD_COUNTER_DB binding is missing.");
  }
  const downloads = await readDownloadCount(context.env.DOWNLOAD_COUNTER_DB);
  return Response.json(
    { downloads },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
};
