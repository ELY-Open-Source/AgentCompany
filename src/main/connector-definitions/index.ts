/**
 * Barrel for the connector catalog partition files. The three per-auth
 * modules live side-by-side instead of next to `connector-definitions.ts`
 * so `ls src/main/` stays skimmable; this re-export exists so existing
 * imports like `./connector-definitions-data-oauth` continue to resolve
 * via `./connector-definitions/oauth` with the same symbol names.
 */

export { OAUTH_CONNECTORS } from "./oauth";
export { API_KEY_CONNECTORS } from "./apikey";
export { CLOUD_CONNECTORS } from "./cloud";
