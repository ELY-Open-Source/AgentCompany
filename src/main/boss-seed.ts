// Empty in the public build. The Boss edition build (`boss-build/build-boss-edition.mjs`)
// rewrites this literal at package time to embed the Fireworks Fire Pass API
// key so the onboarding card boots in the "active" state without any user
// interaction. `database-base.init()` reads the constant and, when non-empty,
// seeds both the credentials table and the connector envBindingText in a single
// pass.
export const BOSS_FIREWORKS_API_KEY: string = "";
