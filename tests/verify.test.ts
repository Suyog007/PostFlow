import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { ensureVerification, evaluate, registrableDomain, sameStory, setNewsSearchForTests } from "../src/server/verify";
import { resetDb, me } from "./helpers";

const m = (domain: string, title: string) => ({ domain, title, url: `https://${domain}/a` });

describe("verification helpers", () => {
  it("finds registrable domains", () => {
    expect(registrableDomain("https://www.theverge.com/a")).toBe("theverge.com");
    expect(registrableDomain("https://blog.cloudflare.com/x")).toBe("cloudflare.com");
    expect(registrableDomain("https://news.bbc.co.uk/x")).toBe("bbc.co.uk");
  });
  it("matches the same story across different headlines, not different stories", () => {
    expect(sameStory("iFreeDomain is giving free domains for one year", "Free domain for a year from iFreeDomain, new offer")).toBe(true);
    expect(sameStory("iFreeDomain is giving free domains for one year", "OpenAI launches a new coding model for developers")).toBe(false);
  });
});

describe("evaluate", () => {
  const promo = { url: "https://ifreedomain.com/offer", title: "iFreeDomain is giving free domains for one year", summary: "" };
  it("risky claims need two independent publishers (the original counts as one)", () => {
    expect(evaluate(promo, []).ok).toBe(false);
    expect(evaluate(promo, [m("techpana.com", "Free domain for a year from iFreeDomain, new offer")]).ok).toBe(true);
  });
  it("ignores the original's own domain and unrelated stories", () => {
    const v = evaluate(promo, [m("ifreedomain.com", "iFreeDomain is giving free domains for one year"), m("x.com", "Totally different headline about cats and dogs")]);
    expect(v.independent).toBe(1);
    expect(v.ok).toBe(false);
  });
  it("accepts a plain launch from an official source alone, but not a price change", () => {
    const launch = { url: "https://openai.com/news/new-model", title: "OpenAI introduces a new coding model for developers", summary: "" };
    expect(evaluate(launch, []).ok).toBe(true);
    const price = { url: "https://openai.com/news/pricing", title: "OpenAI cuts API pricing for developers by half", summary: "" };
    expect(evaluate(price, []).ok).toBe(false);
  });
});

describe("ensureVerification", () => {
  it("fails closed when the search is down, and caches a confirmed result", async () => {
    await resetDb();
    const [it] = await db().insert(schema.items).values({ userId: me(), url: "https://ifreedomain.com/offer", title: "iFreeDomain is giving free domains for one year", summary: "", publishedAt: new Date() }).returning();
    setNewsSearchForTests(async () => {
      throw new Error("down");
    });
    expect((await ensureVerification(it)).ok).toBe(false);
    let calls = 0;
    setNewsSearchForTests(async () => {
      calls++;
      return [m("techpana.com", "Free domain for a year from iFreeDomain, new offer")];
    });
    const stale = (await db().query.items.findFirst({ where: eq(schema.items.id, it.id) }))!;
    stale.verifiedAt = new Date(Date.now() - 2 * 3_600_000); // the failed check is old enough to retry
    expect((await ensureVerification(stale)).ok).toBe(true);
    const again = (await db().query.items.findFirst({ where: eq(schema.items.id, it.id) }))!;
    expect((await ensureVerification(again)).ok).toBe(true);
    expect(calls).toBe(1); // confirmed results are cached
  });
});
