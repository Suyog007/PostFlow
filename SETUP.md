# Connecting LinkedIn and X

PostFlow can discover, analyze, research and draft without any social accounts. To **publish** and to use the scheduling calendar end to end, connect your accounts once. This is the only setup that cannot be done for you: both platforms require *you* to create a developer app under your own account.

After each step, run:

```bash
npm run doctor
```

It checks exactly what is missing and prints the fix.

---

## LinkedIn

**What you need:** a LinkedIn *Page* (any page you administer — a personal brand page is fine; LinkedIn requires one to create an app).

1. Go to **https://www.linkedin.com/developers/apps** → **Create app**.
   - App name: e.g. "PostFlow".
   - LinkedIn Page: pick the page from above.
   - App logo: any square image.
2. In the new app, open the **Products** tab and request:
   - **Share on LinkedIn** (this is the one that allows posting).
   - **Sign In with LinkedIn using OpenID Connect** (used to identify your member id).
   
   Both are approved instantly for most apps.
3. Open the **Auth** tab and add a redirect URL (exactly, including the port):

   ```
   http://localhost:3000/api/oauth/linkedin/callback
   ```

   If you later run PostFlow on another hostname, add that URL too (`${APP_URL}/api/oauth/linkedin/callback`) and update `APP_URL` in `.env` so it matches.
4. Copy **Client ID** and **Client secret** from the Auth tab into `.env`:

   ```
   LINKEDIN_CLIENT_ID=...
   LINKEDIN_CLIENT_SECRET=...
   ```
5. Restart the web app and worker (`Ctrl-C` the `npm run desk` terminal and start it again, or restart `npm start` / `npm run worker`).
6. Open **http://localhost:3000/settings** → *Accounts* → **Connect LinkedIn**, and approve.

PostFlow requests this scope: `openid profile w_member_social`. Posts are published to your personal profile with `POST /v2/ugcPosts`.

**Notes**
- LinkedIn's API cannot read your posts back, so if a publish attempt is interrupted, PostFlow asks you to check your profile and mark it published/not published — it will not blindly retry a post that may exist.
- Images work out of the box with the same scope: a single attached image posts as an image post, and a carousel posts as a multi-image post (via the `/rest/posts` API, using the `LinkedIn-Version` header — set `LINKEDIN_VERSION` in `.env` if LinkedIn sunsets the default).

---

## X

**What you need:** an X developer account. Check the current **access tier** first: posting is available on the free tier (with monthly caps); reading is restricted. **X API pricing and limits change often — verify before relying on it.**

1. Go to **https://developer.x.com** → create a project and an app.
2. Open the app → **User authentication settings** → **Set up**:
   - App permissions: **Read and write**.
   - Type of App: **Web App / Automated App or Bot**.
   - Callback URI (exactly):

     ```
     http://localhost:3000/api/oauth/x/callback
     ```

   - Website URL: any real URL you control (e.g. your LinkedIn or a GitHub page).
3. Scopes used by PostFlow (requested automatically, nothing to configure beyond "Read and write"):
   `tweet.read tweet.write users.read offline.access`.
4. Copy the **OAuth 2.0 Client ID** (and Client Secret if X shows one — usually only needed for confidential clients) into `.env`:

   ```
   X_CLIENT_ID=...
   X_CLIENT_SECRET=...
   ```
5. Restart the web app and worker, then **http://localhost:3000/settings** → *Accounts* → **Connect X**, and authorize.
6. `offline.access` gives PostFlow a refresh token, so the connection survives access-token expiry. If you ever revoke access in X, just connect again.

**Notes**
- X posts longer than 280 characters are automatically kept within limit when drafted (threads up to 15 posts are supported by the composer).
- Images are uploaded via the v2 media endpoint (with alt text) and attach to the first post of a thread.
- With **link-in-reply** enabled in Settings (default), any link is stripped from the main post and posted as the final reply — X demotes link posts in the feed. The reply itself still bills at X's link rate.
- Performance numbers (impressions, likes, reposts, replies) are collected automatically every ~6 hours using the same `tweet.read` scope and shown on the Scorecard.
- On an interrupted publish, PostFlow searches your recent timeline to find out whether the post exists before doing anything else.

---

## Optional: MCP server (use PostFlow from your editor's AI assistant)

`npm run mcp` exposes PostFlow over the Model Context Protocol (stdio). It can read the briefing, list and read drafts, write drafts from a briefing item, and run intakes. **It has no approve or publish tools** — publishing always needs your click in the web UI.

Add it to your MCP client (opencode, Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "postflow": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/PostFlow"
    }
  }
}
```

Tools exposed: `list_briefing`, `list_drafts`, `get_draft`, `create_drafts_from_item`, `create_intake`, `get_intake`.

## Useful checks afterwards

| Command | What it does |
| --- | --- |
| `npm run doctor` | Full health check: env, database, AI model, sources, accounts, worker, web |
| `npm run doctor -- --no-llm --no-sources` | Fast structural check (~2 seconds) |
| `npm run doctor -- --github` | Also polls the GitHub sources (costs API rate limit) |

## Keeping the desk running

- `npm run desk` starts Postgres, the web app and the worker together. Scheduled posts only go out while the **worker** is running, and discovery only runs automatically while it is running.
- If your machine sleeps, the worker pauses too — that is fine; on wake it processes anything due (with freshness checks: stale time-sensitive posts are held for review instead of being published late).
- To run it unattended on macOS you can keep the terminal open, use `tmux`, or add a `launchd` agent that runs `npm run desk` at login.
