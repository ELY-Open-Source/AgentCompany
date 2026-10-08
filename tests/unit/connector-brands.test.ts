import { describe, expect, test } from "vitest";
import { connectorDisplayName, connectorLogoUrl } from "../../src/main/services/composio/connector-brands";

describe("connector brands", () => {
  test("known toolkits resolve a display name and a logo.dev URL with the saved token", () => {
    expect(connectorDisplayName("google_analytics")).toBe("Google Analytics");
    expect(connectorLogoUrl("google_analytics", "pk_test")).toBe(
      "https://img.logo.dev/analytics.google.com?token=pk_test",
    );
    expect(connectorDisplayName("share_point")).toBe("SharePoint");
    expect(connectorLogoUrl("stripe", "pk_a&b")).toBe("https://img.logo.dev/stripe.com?token=pk_a%26b");
  });

  test("no saved token means no logo URL", () => {
    expect(connectorLogoUrl("stripe", null)).toBeNull();
  });

  test("unknown toolkits prettify the slug and carry no logo", () => {
    expect(connectorDisplayName("acme_billing")).toBe("Acme Billing");
    expect(connectorLogoUrl("acme_billing", "pk_test")).toBeNull();
  });
});
