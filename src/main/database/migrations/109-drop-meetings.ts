// Meetings were saved but never held; the records are removed rather than kept as a promise.
export const dropMeetingsSchema = `
  drop index if exists idx_meetings_org;
  drop table if exists meetings;
`;
