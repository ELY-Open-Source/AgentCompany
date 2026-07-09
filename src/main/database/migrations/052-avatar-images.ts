export const avatarImagesSchema = `
  alter table agents add column avatar_image text;
  alter table employees add column avatar_image text;

  insert into schema_migrations(version, name, applied_at)
  values (52, 'avatar_images', datetime('now'));
`;
