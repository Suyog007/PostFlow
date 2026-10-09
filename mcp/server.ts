/**
 * PostFlow MCP server (stdio transport). Run with: npm run mcp
 *
 * Deliberately limited scope: it can read the briefing, list/inspect drafts,
 * create drafts from a briefing item, and run intakes. It CANNOT approve,
 * schedule, or publish anything — that stays a human click in the web UI.
 */
import { loadDotEnv } from "../scripts/load-env";

loadDotEnv();

async function main() {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { z } = await import("zod");
  const { ensureOwner } = await import("../src/server/users");
  const { latestBriefing, draftsWithCurrent, getDraftDetail } = await import("../src/server/queries");
  const { generateDrafts } = await import("../src/server/content");
  const { createIntake, getIntake } = await import("../src/server/intake/service");

  const server = new McpServer({ name: "postflow", version: "0.1.0" });
  const owner = await ensureOwner();

  const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

  server.registerTool(
    "list_briefing",
    {
      title: "List the latest briefing",
      description: "The most recent discovery briefing: ranked items with headlines, categories and sources. Read-only.",
      inputSchema: {},
    },
    async () => {
      const b = await latestBriefing();
      if (!b) return json({ items: [], note: "No briefing yet — run discovery in the PostFlow web UI." });
      return json({
        briefingId: b.briefing.id,
        createdAt: b.briefing.createdAt,
        items: b.items.map((i) => ({
          id: i.id,
          headline: (i.analysis as { headline?: string } | null)?.headline ?? i.title,
          category: i.category,
          timeliness: i.timeliness,
          sources: i.sources.map((s) => ({ publisher: s.publisher, url: s.url })),
        })),
      });
    },
  );

  server.registerTool(
    "list_drafts",
    {
      title: "List drafts",
      description: "All drafts with platform, status and format. Useful to check what is awaiting the human's approval. Read-only.",
      inputSchema: { status: z.string().optional().describe("Filter by status, e.g. awaiting_approval, approved, published") },
    },
    async ({ status }) => {
      const rows = await draftsWithCurrent(owner.id);
      const filtered = status ? rows.filter((r) => r.status === status) : rows;
      return json(
        filtered.map((d) => ({
          id: d.id,
          platform: d.platform,
          status: d.status,
          format: d.revision?.format ?? "post",
          parts: d.revision?.parts.length ?? 0,
          images: d.revision?.media?.length ?? 0,
          firstLine: (d.revision?.parts[0] ?? "").slice(0, 160),
        })),
      );
    },
  );

  server.registerTool(
    "get_draft",
    {
      title: "Read one draft",
      description: "Full text of one draft revision, its quality warnings, and attached image alt texts. Read-only.",
      inputSchema: { draftId: z.string().describe("Draft id from list_drafts") },
    },
    async ({ draftId }) => {
      const d = await getDraftDetail(owner.id, draftId);
      if (!d) return json({ error: "Draft not found" });
      const rev = d.revisions.find((r) => r.id === d.draft.currentRevisionId);
      const review = rev?.review as { quality?: unknown; unsupportedClaims?: string[]; fabricatedExperience?: boolean } | null;
      return json({
        id: d.draft.id,
        platform: d.draft.platform,
        status: d.draft.status,
        format: rev?.format ?? "post",
        parts: rev?.parts ?? [],
        quality: review?.quality ?? [],
        unsupportedClaims: review?.unsupportedClaims ?? [],
        images: (rev?.media ?? []).map((m) => ({ id: m.mediaId, alt: m.alt, url: `/api/media/${m.mediaId}` })),
        note: "Approving and publishing happen only in the web UI.",
      });
    },
  );

  server.registerTool(
    "create_drafts_from_item",
    {
      title: "Write drafts from a briefing item",
      description:
        "Generates LinkedIn and/or X drafts from a briefing item. Drafts land in 'awaiting_approval'; nothing is posted. May take ~30-60 seconds.",
      inputSchema: {
        itemId: z.string().describe("Item id from list_briefing"),
        platforms: z.array(z.enum(["linkedin", "x"])).min(1).describe("Which platform drafts to write"),
        angle: z.string().optional().describe("Optional angle to steer the writing"),
      },
    },
    async ({ itemId, platforms, angle }) => {
      const results = await generateDrafts(owner.id, { itemId }, platforms, angle);
      return json(results);
    },
  );

  server.registerTool(
    "create_intake",
    {
      title: "Intake a URL or pasted text",
      description:
        "Stores an article (URL or pasted text), mines it into numbered atoms (stats, quotes, insights), and returns them. Drafts are NOT created here — pick atoms and generate in the web UI Intake page, or use the returned intake id with your own flow.",
      inputSchema: { input: z.string().min(20).describe("A public http(s) URL, or the article text itself") },
    },
    async ({ input }) => {
      const out = await createIntake(owner.id, input);
      return json(out);
    },
  );

  server.registerTool(
    "get_intake",
    {
      title: "Read one intake",
      description: "Atoms and summary of a stored intake, by id. Read-only.",
      inputSchema: { intakeId: z.string() },
    },
    async ({ intakeId }) => {
      const i = await getIntake(owner.id, intakeId);
      if (!i) return json({ error: "Intake not found" });
      return json({ id: i.id, title: i.title, url: i.url, summary: i.summary, atoms: i.atoms, status: i.status });
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("PostFlow MCP server running on stdio (owner:", owner.email, ")");
}

main().catch((err) => {
  console.error("MCP server failed:", err);
  process.exit(1);
});
