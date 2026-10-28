import { describe, expect, it } from "vitest";
import { adviceCheck } from "../src/server/checks";
import { evaluate, isAggregator } from "../src/server/verify";

// The post that went wrong on 28 Oct: written from an MSN copy's two-line summary, with advice nobody gave.
const GLAMSTERDAM_POST =
  "Ethereum developers merged a fix for a Glamsterdam upgrade flaw that could have sent staking deposits to block builders.\n\nThe bug meant a malicious builder might capture funds meant for the network's proof-of-stake system. If your contracts interact with the Glamsterdam upgrade, consider upgrading them promptly to stay safe.";
const GLAMSTERDAM_SOURCE =
  "Source: News: Ethereum\nTitle: Ethereum resolves Glamsterdam bug that could have redirected staking deposits\nSummary: Ethereum developers have merged a fix for a Glamsterdam upgrade vulnerability that could have redirected staking deposits to block builders under certain conditions.";

describe("advice only when the source gives it", () => {
  it("blocks the Glamsterdam post's invented advice", () => {
    const c = adviceCheck(GLAMSTERDAM_POST, GLAMSTERDAM_SOURCE);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ code: "invented_advice", severity: "block" });
    expect(c[0].message).toMatch(/consider upgrading them promptly/);
  });

  it("allows advice the source gives, in the same or an equivalent word", () => {
    const src = "The PHP team released 8.4.9 and asks everyone to patch now.";
    expect(adviceCheck("If your site runs PHP, update to 8.4.9 today.", src)).toEqual([]);
    expect(adviceCheck("Patch to 8.4.9 before the weekend.", src)).toEqual([]);
  });

  it("leaves plain reporting alone", () => {
    expect(adviceCheck("Stripe will update its fees next month, per the company. Small shops pay less.", "Stripe said it will update fees.")).toEqual([]);
    expect(adviceCheck("The maintainers say an upgrade is coming next week.", "Nothing about advice here.")).toEqual([]);
  });

  it("catches money and health advice too", () => {
    expect(adviceCheck("You should sell before the deadline.", "Tax deadline moves to March.")).toHaveLength(1);
    expect(adviceCheck("Consider switching to the new plan.", "A new plan launched.")).toHaveLength(1);
  });
});

describe("copies on aggregators are not extra publishers", () => {
  it("MSN, Yahoo and Google News are aggregators", () => {
    for (const d of ["msn.com", "www.msn.com", "news.yahoo.com", "MSN", "news.google.com"]) expect(isAggregator(d)).toBe(true);
    expect(isAggregator("theverge.com")).toBe(false);
  });

  it("a story found on MSN needs two real publishers behind it", () => {
    const item = { url: "https://www.msn.com/en-in/news/other/ethereum-resolves-glamsterdam-bug/ar-AA2gauYc", title: "Ethereum resolves Glamsterdam bug that could have redirected staking deposits", summary: "fix for a vulnerability" };
    const one = evaluate(item, [{ domain: "Gadgets 360", title: "Ethereum Resolves Glamsterdam Bug That Could Have Redirected Staking Deposits", url: "" }]);
    expect(one.independent).toBe(1);
    expect(one.ok).toBe(false);
    const withMsnCopy = evaluate(item, [
      { domain: "Gadgets 360", title: "Ethereum Resolves Glamsterdam Bug That Could Have Redirected Staking Deposits", url: "" },
      { domain: "MSN", title: "Ethereum resolves Glamsterdam bug that could have redirected staking deposits", url: "" },
    ]);
    expect(withMsnCopy.independent).toBe(1);
  });
});

describe("the other queued posts from 28 Oct", () => {
  it("blocks advice the court story never gave", () => {
    const post = "A federal judge ruled that Anthropic illegally scraped Stanford professors' books to train Claude.\n\nDevelopers who rely on Claude should treat its output cautiously until the copyright dispute is settled, or consider alternatives with clear licensing.";
    const src = "AI giant Anthropic illegally scraped and pirated the work of over 10 Stanford professors to train its Claude models, a federal judge ruled. The Authors Guild wants to ensure that the law is clear that AI companies must license the books they use.";
    expect(adviceCheck(post, src)).toHaveLength(1);
  });

  it("allows advice the company itself published", () => {
    const post = "Tailscale SSH had a bug that could let an allowed user run commands as a more privileged user.\n\nCheck your SSH access policies and turn off SSH forwarding (set TS_SSH_DISABLE_FORWARDING=1) while you wait for the patched client.";
    const src = "What customers can do now. Review SSH access policies. Make sure access is limited to the users and devices that need it. Disable SSH forwarding if you don't need it. Set TS_SSH_DISABLE_FORWARDING=1 in the tailscaled service environment and restart the service. Prepare to update.";
    expect(adviceCheck(post, src)).toEqual([]);
  });
});
