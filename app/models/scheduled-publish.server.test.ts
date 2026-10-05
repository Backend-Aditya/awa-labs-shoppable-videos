import { afterEach, describe, expect, it, vi } from "vitest";
import { isCronAuthorized, isReelDue } from "./scheduled-publish.server";

describe("isCronAuthorized", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a request whose Bearer token matches CRON_SECRET", () => {
    vi.stubEnv("CRON_SECRET", "test-secret-123");
    const request = new Request("https://example.com", {
      headers: { authorization: "Bearer test-secret-123" },
    });
    expect(isCronAuthorized(request)).toBe(true);
  });

  it("rejects a mismatched token", () => {
    vi.stubEnv("CRON_SECRET", "test-secret-123");
    const request = new Request("https://example.com", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(isCronAuthorized(request)).toBe(false);
  });

  it("rejects a missing Authorization header", () => {
    vi.stubEnv("CRON_SECRET", "test-secret-123");
    const request = new Request("https://example.com");
    expect(isCronAuthorized(request)).toBe(false);
  });

  it("fails closed when CRON_SECRET isn't configured, even with a token provided", () => {
    vi.stubEnv("CRON_SECRET", "");
    const request = new Request("https://example.com", {
      headers: { authorization: "Bearer anything" },
    });
    expect(isCronAuthorized(request)).toBe(false);
  });
});

describe("isReelDue", () => {
  const baseConfig = {
    productIds: [] as string[],
    interactions: {},
    source: { type: "upload" as const },
  };
  const now = Date.parse("2026-10-05T12:00:00Z");

  it("is due when publishAt has passed and the reel isn't published", () => {
    const reel = {
      published: false,
      config: { ...baseConfig, publishAt: "2026-10-05T11:59:00Z" },
    };
    expect(isReelDue(reel, now)).toBe(true);
  });

  it("is due exactly at the scheduled instant", () => {
    const reel = {
      published: false,
      config: { ...baseConfig, publishAt: "2026-10-05T12:00:00Z" },
    };
    expect(isReelDue(reel, now)).toBe(true);
  });

  it("is not due when publishAt is in the future", () => {
    const reel = {
      published: false,
      config: { ...baseConfig, publishAt: "2026-10-05T12:01:00Z" },
    };
    expect(isReelDue(reel, now)).toBe(false);
  });

  it("is not due when there's no publishAt at all", () => {
    const reel = { published: false, config: { ...baseConfig } };
    expect(isReelDue(reel, now)).toBe(false);
  });

  it("is never due once already published, even with a past publishAt", () => {
    const reel = {
      published: true,
      config: { ...baseConfig, publishAt: "2026-10-05T11:59:00Z" },
    };
    expect(isReelDue(reel, now)).toBe(false);
  });
});
