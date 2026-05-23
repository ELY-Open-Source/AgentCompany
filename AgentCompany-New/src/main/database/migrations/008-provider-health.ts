export const providerHealthSchema = `
  alter table providers add column auth_state text not null default 'unconfigured';
  alter table providers add column health_state text not null default 'unchecked';
  alter table providers add column last_checked_at text;
  alter table providers add column last_error text;
`;
