export const avatarsSchema = `
  alter table agents add column avatar_emoji text;
  alter table agents add column avatar_color text;
  alter table employees add column avatar_emoji text;
  alter table employees add column avatar_color text;

  insert into schema_migrations(version, name, applied_at)
  values (49, 'avatars', datetime('now'));
`;
