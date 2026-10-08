/** Credentials no provider uses any more lose their secret; their rows stay for history. */
export const ERASE_RETIRED_CREDENTIALS_SQL = `
  update credentials set ciphertext = x''
  where id not in (select credential_id from providers where credential_id is not null)
    and id not in (select credential_id from provider_auth_profiles where active = 1);
`;

export const eraseRetiredCredentialsSchema = `
  ${ERASE_RETIRED_CREDENTIALS_SQL}

  insert into schema_migrations(version, name, applied_at)
  values (79, 'erase_retired_credentials', datetime('now'));
`;
