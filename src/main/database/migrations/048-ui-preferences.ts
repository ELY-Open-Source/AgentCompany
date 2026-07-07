/**
 * App-level UI preferences on the single app_state row. Theme drives the
 * renderer palette; language pins Chromium's UI locale (form-control strings
 * were following the OS locale and leaking Chinese into the English UI, so
 * the default is English rather than system).
 */
export const uiPreferencesSchema = `
  alter table app_state add column theme text not null default 'system';
  alter table app_state add column language text not null default 'en';
`;
