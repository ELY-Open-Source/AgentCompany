import type { AppDatabase } from "../database";

export interface PrepareDatabaseDeps {
  profileDir: string;
  appDatabaseFactory: (profileDir: string) => AppDatabase;
  initSigningKey: (profileDir: string) => void;
}

export function prepareDatabase(deps: PrepareDatabaseDeps): AppDatabase {
  const db = deps.appDatabaseFactory(deps.profileDir);
  db.init();
  deps.initSigningKey(db.profileDir);
  return db;
}
