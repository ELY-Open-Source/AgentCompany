import { describe, expect, test } from "vitest";
import { connectorDisplayName, connectorLogoUrl } from "../../src/main/services/composio/connector-brands";

describe("connector brands", () => {
  test("known toolkits resolve a display name and a logo.dev URL", () => {
    expect(connectorDisplayName("google_analytics")).toBe("Google Analytics");
    expect(connectorLogoUrl("google_analytics")).toBe(
      "https://img.logo.dev/analytics.google.com?token=***REMOVED***",
    );
    expect(connectorDisplayName("share_point")).toBe("SharePoint");
    expect(connectorLogoUrl("stripe")).toContain("img.logo.dev/stripe.com");
  });

  test("unknown toolkits prettify the slug and carry no logo", () => {
    expect(connectorDisplayName("acme_billing")).toBe("Acme Billing");
    expect(connectorLogoUrl("acme_billing")).toBeNull();
  });
});
