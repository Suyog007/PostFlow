import { beforeEach } from "vitest";
import { setNewsSearchForTests } from "../src/server/verify";
import { setFetchArticleForTests } from "../src/server/net";
import { setArticleFinderForTests, setXReaderForTests } from "../src/server/research";
import { setImageDrawerForTests, setImageMakingForTests } from "../src/server/post-images";

// Never touch the network from tests. By default every story is "confirmed" by two other publishers.
beforeEach(() => {
  setNewsSearchForTests(async (q) => [
    { domain: "a-news.example", title: q, url: "https://a-news.example/x" },
    { domain: "b-news.example", title: q, url: "https://b-news.example/x" },
  ]);
  setFetchArticleForTests(async (url) => ({ title: `Article at ${new URL(url).hostname}`, text: "A long enough article body. ".repeat(40) }));
  setArticleFinderForTests(async () => []);
  setXReaderForTests(async () => null);
  setImageMakingForTests(false);
  setImageDrawerForTests(async () => null);
});
