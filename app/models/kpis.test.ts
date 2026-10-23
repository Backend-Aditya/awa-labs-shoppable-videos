import { describe, expect, it } from "vitest";
import { deriveKpis, formatWatchTime, formatPercent, funnel, percent, toCsv } from "./kpis";

const zero = { views: 0, clicks: 0, addToCarts: 0, completions: 0, watchSeconds: 0 };

describe("deriveKpis", () => {
  it("computes every rate per view, and money per order and per 1,000 views", () => {
    expect(
      deriveKpis({ views: 400, clicks: 60, addToCarts: 20, completions: 100, watchSeconds: 6000, orders: 8, revenue: 480 }),
    ).toEqual({
      views: 400,
      clickRate: 15,
      addToCarts: 20,
      addToCartRate: 5,
      completionRate: 25,
      avgWatchSeconds: 15,
      orders: 8,
      conversionRate: 2,
      revenue: 480,
      averageOrderValue: 60,
      revenuePerThousandViews: 1200,
    });
  });

  it("no views or orders means no rate (null), not 0%", () => {
    const kpis = deriveKpis(zero);
    expect(kpis.clickRate).toBeNull();
    expect(kpis.avgWatchSeconds).toBeNull();
    expect(kpis.averageOrderValue).toBeNull();
    expect(kpis.revenuePerThousandViews).toBeNull();
  });

  it("caps rates at 100% (views are de-duplicated, taps aren't)", () => {
    expect(percent(12, 10)).toBe(100);
  });
});

describe("formatting", () => {
  it.each([
    [null, "—"],
    [0, "0:00"],
    [42.4, "0:42"],
    [185, "3:05"],
    [3730, "1:02:10"],
  ])("duration %j → %s", (seconds, text) => {
    expect(formatWatchTime(seconds)).toBe(text);
  });

  it("percent", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(12.345)).toBe("12.3%");
  });
});

describe("funnel", () => {
  it("each step against the one before it and against views", () => {
    expect(funnel({ ...zero, views: 200, clicks: 50, addToCarts: 10, orders: 2 })).toEqual([
      { label: "Watched a video", count: 200, ofPrevious: null, ofViews: 100 },
      { label: "Tapped a product", count: 50, ofPrevious: 25, ofViews: 25 },
      { label: "Added to cart", count: 10, ofPrevious: 20, ofViews: 5 },
      { label: "Ordered", count: 2, ofPrevious: 20, ofViews: 1 },
    ]);
  });
});

describe("toCsv", () => {
  it("quotes what needs quoting and defuses spreadsheet formulas", () => {
    expect(
      toCsv([
        ["Video", "Views"],
        ['Summer "drop", part 2', 10],
        ["=HYPERLINK(\"http://evil\")", 3],
        ["-5 off", null],
      ]),
    ).toBe('Video,Views\r\n"Summer ""drop"", part 2",10\r\n"\'=HYPERLINK(""http://evil"")",3\r\n\'-5 off,');
  });

  it("negative numbers stay numbers", () => {
    expect(toCsv([[-5]])).toBe("-5");
  });
});
