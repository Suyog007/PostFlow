import { describe, expect, it } from "vitest";
import { cleanSource, sourceFor } from "../src/lib/attribution";

const HOST = "postfloow.netlify.app";

describe("where a visitor came from", () => {
  it("a ref tag on the link wins", () => {
    expect(sourceFor("?ref=reddit", "https://www.linkedin.com/feed/", HOST)).toBe("reddit");
    expect(sourceFor("?utm_source=IndieHackers&utm_campaign=launch", "", HOST)).toBe("indiehackers / launch");
  });

  it("otherwise the site they clicked through from, under a readable name", () => {
    expect(sourceFor("", "https://www.linkedin.com/feed/", HOST)).toBe("linkedin");
    expect(sourceFor("", "https://lnkd.in/abc", HOST)).toBe("linkedin");
    expect(sourceFor("", "https://t.co/xyz", HOST)).toBe("x");
    expect(sourceFor("", "https://www.google.com.np/", HOST)).toBe("google");
    expect(sourceFor("", "https://news.ycombinator.com/item?id=1", HOST)).toBe("hacker news");
    expect(sourceFor("", "https://someblog.dev/post", HOST)).toBe("someblog.dev");
  });

  it("no referrer, or our own site, is direct", () => {
    expect(sourceFor("", "", HOST)).toBe("direct");
    expect(sourceFor("", `https://${HOST}/pricing`, HOST)).toBe("direct");
  });

  it("keeps labels short and harmless", () => {
    expect(cleanSource("<script>alert(1)</script>")).toBe("scriptalert1/script");
    expect(cleanSource("a".repeat(100))).toHaveLength(60);
    expect(cleanSource("   ")).toBeNull();
  });
});
