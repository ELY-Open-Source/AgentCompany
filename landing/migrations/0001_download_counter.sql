CREATE TABLE IF NOT EXISTS download_counter_settings (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

INSERT OR IGNORE INTO download_counter_settings (key, value)
VALUES ('base_downloads', 13674);

CREATE TABLE IF NOT EXISTS unique_download_windows (
  ip_hash TEXT NOT NULL,
  window_key INTEGER NOT NULL,
  first_asset_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ip_hash, window_key)
);

CREATE INDEX IF NOT EXISTS idx_unique_download_windows_created_at
  ON unique_download_windows(created_at);
