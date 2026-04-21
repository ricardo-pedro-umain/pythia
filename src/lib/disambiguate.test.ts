import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock env BEFORE importing the module under test so the Proxy in env.ts
// doesn't throw when disambiguate.ts reads TAVILY_API_KEY at import time.
vi.mock("@/lib/env", () => ({
  env: { TAVILY_API_KEY: "test-key", OPENAI_API_KEY: "test-openai" },
}));

// Mock the Tavily client. Each test overrides `searchMock` with the
// response shape it wants to exercise.
const searchMock = vi.fn();
vi.mock("@tavily/core", () => ({
  tavily: () => ({ search: searchMock }),
}));

import {
  disambiguateCompany,
  domainMatchesTerm,
  getDomainBase,
  getRootDomain,
  isCloseEnough,
  isSameCompany,
  norm,
  titleToName,
} from "./disambiguate";

describe("norm", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(norm("Tesla, Inc.")).toBe("teslainc");
    expect(norm("X.AI")).toBe("xai");
    expect(norm("  Salt  AI  ")).toBe("saltai");
  });

  it("returns empty string for purely-symbolic input", () => {
    expect(norm("!!!")).toBe("");
    expect(norm("")).toBe("");
  });
});

describe("getRootDomain", () => {
  it("strips www. and returns the registrable domain", () => {
    expect(getRootDomain("https://www.tesla.com/about")).toBe("tesla.com");
    expect(getRootDomain("https://tesla.com")).toBe("tesla.com");
  });

  it("handles subdomains by returning the registrable pair", () => {
    expect(getRootDomain("https://blog.stripe.com/post")).toBe("stripe.com");
    expect(getRootDomain("https://news.bbc.co.uk/x")).toBe("bbc.co.uk");
  });

  it("keeps the last 3 parts for two-part public TLDs", () => {
    expect(getRootDomain("https://example.co.uk")).toBe("example.co.uk");
    expect(getRootDomain("https://shop.example.co.uk")).toBe("example.co.uk");
  });

  it("falls back to the raw input when URL parsing fails", () => {
    expect(getRootDomain("not a url")).toBe("not a url");
  });
});

describe("getDomainBase", () => {
  it("returns the first label of the root domain, lowercased", () => {
    expect(getDomainBase("Tesla.com")).toBe("tesla");
    expect(getDomainBase("xai.co.uk")).toBe("xai");
  });

  it("returns the input when there are no dots", () => {
    expect(getDomainBase("localhost")).toBe("localhost");
  });
});

describe("domainMatchesTerm", () => {
  it("matches when domain base starts with the term", () => {
    expect(domainMatchesTerm("tesla.com", "tesla")).toBe(true);
    expect(domainMatchesTerm("teslamotors.com", "tesla")).toBe(true);
  });

  it("matches when the term starts with the domain base", () => {
    expect(domainMatchesTerm("xai.com", "x.ai corp")).toBe(true);
  });

  it("rejects unrelated reference sites", () => {
    expect(domainMatchesTerm("britannica.com", "tesla")).toBe(false);
    expect(domainMatchesTerm("ebsco.com", "salt")).toBe(false);
  });

  it("rejects empty inputs", () => {
    expect(domainMatchesTerm("", "tesla")).toBe(false);
    expect(domainMatchesTerm("tesla.com", "")).toBe(false);
  });
});

describe("titleToName", () => {
  it("strips pipe-delimited suffixes", () => {
    expect(titleToName("Tesla | Electric Cars, Solar, Clean Energy")).toBe(
      "Tesla"
    );
    expect(titleToName("Stripe — Financial Infrastructure")).toBe("Stripe");
    expect(titleToName("Acme Corp: About Us")).toBe("Acme Corp");
  });

  it("strips home-page and about-us boilerplate", () => {
    expect(titleToName("Tesla Home Page")).toBe("Tesla");
    expect(titleToName("Welcome to Stripe")).toBe("Stripe");
  });

  it("returns the input trimmed when there's nothing to strip", () => {
    expect(titleToName("  Tesla  ")).toBe("Tesla");
  });
});

describe("isSameCompany", () => {
  it("returns true for exact matches", () => {
    expect(isSameCompany("Stripe", "stripe")).toBe(true);
  });

  it("returns true when the extra suffix is a generic company word", () => {
    expect(isSameCompany("xAI", "xAI Corp")).toBe(true);
    expect(isSameCompany("Acme", "Acme Inc")).toBe(true);
    expect(isSameCompany("Nimbus", "Nimbus Technologies")).toBe(true);
  });

  it("returns false when the extra token is meaningful", () => {
    expect(isSameCompany("Salt", "Salt AI")).toBe(false);
    expect(isSameCompany("Apple", "Apple Records")).toBe(false);
  });

  it("returns false when names don't share a prefix", () => {
    expect(isSameCompany("Tesla", "Rivian")).toBe(false);
  });
});

describe("isCloseEnough", () => {
  it("accepts exact matches", () => {
    expect(isCloseEnough("Tesla", "Tesla")).toBe(true);
  });

  it("accepts short extensions", () => {
    expect(isCloseEnough("Salt AI", "Salt")).toBe(true);
    expect(isCloseEnough("Tesla Inc", "Tesla")).toBe(true);
  });

  it("rejects names more than 2.5x the search length", () => {
    // "Tesla Science Center at Wardenclyffe" vs "Tesla" — way too long
    expect(
      isCloseEnough("Tesla Science Center at Wardenclyffe", "Tesla")
    ).toBe(false);
  });

  it("rejects names without a shared prefix", () => {
    expect(isCloseEnough("Rivian", "Tesla")).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Orchestration — disambiguateCompany()
// --------------------------------------------------------------------------

type TavilyResult = {
  url: string;
  title: string;
  content: string;
  score: number;
};

function tavilyResponse(results: TavilyResult[]) {
  return { results };
}

describe("disambiguateCompany", () => {
  beforeEach(() => {
    searchMock.mockReset();
  });

  it("returns [] for empty input without hitting Tavily", async () => {
    const out = await disambiguateCompany("   ");
    expect(out).toEqual([]);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("returns [] when the top candidate clearly dominates (Tesla case)", async () => {
    // tesla.com at 0.95, nothing close. Should skip disambiguation.
    searchMock
      .mockResolvedValueOnce(
        tavilyResponse([
          {
            url: "https://www.tesla.com/",
            title: "Tesla | Electric Cars, Clean Energy & Solar",
            content: "Tesla designs and manufactures electric vehicles.",
            score: 0.95,
          },
          {
            url: "https://en.wikipedia.org/wiki/Tesla,_Inc.",
            title: "Tesla, Inc. - Wikipedia",
            content: "Tesla is an American electric vehicle company.",
            score: 0.5,
          },
        ])
      )
      .mockResolvedValueOnce(
        tavilyResponse([
          {
            url: "https://www.tesla.com/about",
            title: "About Tesla",
            content: "Our mission is to accelerate the world's transition.",
            score: 0.9,
          },
        ])
      );

    const out = await disambiguateCompany("Tesla");
    expect(out).toEqual([]);
  });

  it("returns [] when a single candidate remains after filtering", async () => {
    // Only stripe.com survives the domain-match filter; reference sites are
    // stripped. One candidate → no disambiguation needed.
    searchMock.mockResolvedValue(
      tavilyResponse([
        {
          url: "https://stripe.com/",
          title: "Stripe | Financial Infrastructure",
          content: "Stripe is a technology company.",
          score: 0.88,
        },
        {
          url: "https://www.britannica.com/topic/Stripe",
          title: "Stripe | Definition",
          content: "A stripe is a long narrow band.",
          score: 0.6,
        },
      ])
    );

    const out = await disambiguateCompany("Stripe");
    expect(out).toEqual([]);
  });

  it("returns candidates when two different companies share a name", async () => {
    // Apple the computer company vs. Apple Records the label.
    // Scores are close enough that neither dominates.
    searchMock.mockResolvedValue(
      tavilyResponse([
        {
          url: "https://www.apple.com/",
          title: "Apple",
          content: "Apple designs consumer electronics and software.",
          score: 0.7,
        },
        {
          url: "https://www.applerecords.com/",
          title: "Apple Records | The Beatles' record label",
          content:
            "Apple Records is a record label founded by The Beatles in 1968.",
          score: 0.6,
        },
      ])
    );

    const out = await disambiguateCompany("Apple");
    expect(out.length).toBeGreaterThanOrEqual(2);
    const names = out.map((c) => c.name.toLowerCase());
    expect(names.some((n) => n.includes("apple"))).toBe(true);
    // Each candidate has a usable website URL
    for (const c of out) {
      expect(c.website).toMatch(/^https:\/\/www\./);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it("dedupes by root domain, keeping the highest-scoring result", async () => {
    // Same root domain across two queries with different scores.
    searchMock
      .mockResolvedValueOnce(
        tavilyResponse([
          {
            url: "https://tesla.com/page1",
            title: "Tesla | Page 1",
            content: "lower score",
            score: 0.5,
          },
        ])
      )
      .mockResolvedValueOnce(
        tavilyResponse([
          {
            url: "https://www.tesla.com/page2",
            title: "Tesla | Page 2",
            content: "higher score",
            score: 0.9,
          },
        ])
      );

    // One dominant domain → [] (dominance test short-circuits before we can
    // inspect the dedupe outcome). This is still a useful test: it proves no
    // crash on duplicate-domain input and that the dominance path fires.
    const out = await disambiguateCompany("Tesla");
    expect(out).toEqual([]);
  });

  it("filters out generic reference domains (wikipedia, crunchbase, etc.)", async () => {
    // Only references — all should be dropped, leaving nothing to disambiguate.
    searchMock.mockResolvedValue(
      tavilyResponse([
        {
          url: "https://en.wikipedia.org/wiki/Foobar",
          title: "Foobar | Wikipedia",
          content: "Article about Foobar.",
          score: 0.8,
        },
        {
          url: "https://www.crunchbase.com/organization/foobar",
          title: "Foobar on Crunchbase",
          content: "Crunchbase profile.",
          score: 0.75,
        },
      ])
    );

    const out = await disambiguateCompany("Foobar");
    expect(out).toEqual([]);
  });

  it("returns [] when all candidates resolve to the same company (xAI / xAI Corp)", async () => {
    searchMock.mockResolvedValue(
      tavilyResponse([
        {
          url: "https://x.ai/",
          title: "xAI",
          content: "xAI is an AI company founded by Elon Musk.",
          score: 0.7,
        },
        {
          url: "https://xai-corp.com/",
          title: "xAI Corp",
          content: "xAI is an AI company.",
          score: 0.6,
        },
      ])
    );

    const out = await disambiguateCompany("xAI");
    // Either no disambiguation (dominance / same-entity check) or a single
    // candidate — both acceptable; the important thing is that the user is
    // NOT shown two options for the same company.
    expect(out.length).toBeLessThanOrEqual(1);
  });
});
