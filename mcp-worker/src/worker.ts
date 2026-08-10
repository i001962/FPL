import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

interface Env {
  ASSETS: Fetcher;
  FPL_API_BASE?: string;
  FPL_LEAGUE_ID?: string;
  FPL_DEFAULT_PROJECT_ROUTE?: string;
  FPL_SHOP_URL?: string;
}

const RESOURCE_URI = "ui://fpl-league-shop/standings.html";
const MAX_STANDINGS = 250;
const PROJECT_ROUTE = /^(base|basesep|eth|sep|arb|arbsep|op|opsep):[1-9]\d*$/;
const leagueIdSchema = z.coerce.number().int().positive();
const projectRouteSchema = z.string().trim().regex(PROJECT_ROUTE, "Use a Juicebox route such as base:123.");

type FplStandingRow = { rank: number; last_rank: number; entry: number; entry_name: string; player_name: string; total: number };
type FplLeagueResponse = { league: { id: number; name: string }; standings: { has_next: boolean; results: FplStandingRow[] } };

function configuredLeagueId(env: Env): number | undefined {
  const value = Number(env.FPL_LEAGUE_ID);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function fplBase(env: Env): string {
  return (env.FPL_API_BASE || "https://fantasy.premierleague.com/api").replace(/\/$/, "");
}

async function loadStandings(env: Env, leagueId: number, limit: number) {
  const managers: FplStandingRow[] = [];
  let page = 1;
  let hasMore = false;
  let leagueName = "FPL league";
  do {
    const url = new URL(`${fplBase(env)}/leagues-classic/${leagueId}/standings/`);
    url.searchParams.set("page_standings", String(page));
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`FPL standings request failed (${response.status}).`);
    const data = (await response.json()) as FplLeagueResponse;
    leagueName = data.league.name;
    managers.push(...data.standings.results);
    hasMore = data.standings.has_next;
    page += 1;
  } while (hasMore && managers.length < limit);
  return {
    leagueId,
    leagueName,
    hasMore,
    managers: managers.slice(0, limit).map((manager) => ({
      rank: manager.rank,
      lastRank: manager.last_rank,
      entry: manager.entry,
      entryName: manager.entry_name,
      playerName: manager.player_name,
      total: manager.total,
    })),
  };
}

function manualShopUrl(env: Env, projectRoute: string, leagueId: number, entryId: number): string {
  const [chain, projectId] = projectRoute.split(":");
  const url = new URL(env.FPL_SHOP_URL || "https://fpl.d33m.com/");
  url.searchParams.set("chain", chain);
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("leagueId", String(leagueId));
  url.searchParams.set("entryId", String(entryId));
  url.hash = projectRoute;
  return url.toString();
}

async function appHtml(env: Env): Promise<string> {
  const response = await env.ASSETS.fetch("https://assets.invalid/mcp-app.html");
  if (!response.ok) throw new Error("MCP app asset is unavailable. Run npm run build before deploying.");
  return response.text();
}

function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "FPL League Shop", version: "0.1.0" });
  registerAppTool(server, "fpl_shop", {
    title: "Open FPL league shop",
    description: "Show an FPL league manager table and prepare a manager-specific Juicebox shop handoff.",
    inputSchema: { leagueId: leagueIdSchema.optional(), projectRoute: projectRouteSchema.optional() },
    _meta: { ui: { resourceUri: RESOURCE_URI } },
  }, async ({ leagueId, projectRoute }) => {
    const resolvedLeagueId = leagueId ?? configuredLeagueId(env);
    if (!resolvedLeagueId) return { content: [{ type: "text", text: "Provide an FPL classic league ID to load its standings." }], isError: true };
    const standings = await loadStandings(env, resolvedLeagueId, 100);
    return {
      content: [{ type: "text", text: `${standings.leagueName}: ${standings.managers.length} manager standings loaded.` }],
      structuredContent: { ...standings, projectRoute: projectRoute ?? env.FPL_DEFAULT_PROJECT_ROUTE ?? null },
    };
  });
  server.tool("fpl_standings", "Get FPL classic league standings and manager rows. This is read-only public FPL data.", {
    leagueId: leagueIdSchema.optional(), limit: z.coerce.number().int().min(1).max(MAX_STANDINGS).default(100),
  }, async ({ leagueId, limit }) => {
    const resolvedLeagueId = leagueId ?? configuredLeagueId(env);
    if (!resolvedLeagueId) return { content: [{ type: "text", text: "Provide an FPL classic league ID." }], isError: true };
    const standings = await loadStandings(env, resolvedLeagueId, limit);
    return { content: [{ type: "text", text: `${standings.leagueName}: ${standings.managers.length} manager rows returned.` }], structuredContent: standings };
  });
  server.tool("fpl_prepare_buy", "Prepare a manager-specific FPL shop purchase memo and manual Juicebox shop handoff. This never signs or sends a transaction.", {
    leagueId: leagueIdSchema.optional(), entryId: z.coerce.number().int().positive(), projectRoute: projectRouteSchema.optional(),
  }, async ({ leagueId, entryId, projectRoute }) => {
    const resolvedLeagueId = leagueId ?? configuredLeagueId(env);
    if (!resolvedLeagueId) return { content: [{ type: "text", text: "Provide an FPL classic league ID." }], isError: true };
    const standings = await loadStandings(env, resolvedLeagueId, MAX_STANDINGS);
    const manager = standings.managers.find((row) => row.entry === entryId);
    if (!manager) return { content: [{ type: "text", text: `FPL entry ${entryId} was not found in the first ${MAX_STANDINGS} league standings.` }], isError: true };
    const route = projectRoute ?? env.FPL_DEFAULT_PROJECT_ROUTE;
    const memo = `fpl:league=${resolvedLeagueId};entry=${entryId}`;
    const checkoutUrl = route ? manualShopUrl(env, route, resolvedLeagueId, entryId) : null;
    const warning = "The memo is evidence of the selected FPL entry, not proof that the buyer wallet controls that manager.";
    return {
      content: [{ type: "text", text: checkoutUrl ? `Prepared ${memo}. Review the shop and wallet transaction before paying.` : `Prepared ${memo}. Configure a project route before opening checkout.` }],
      structuredContent: { leagueId: resolvedLeagueId, entryId, entryName: manager.entryName, playerName: manager.playerName, projectRoute: route ?? null, memo, checkoutUrl, warning },
    };
  });
  registerAppResource(server, RESOURCE_URI, RESOURCE_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: await appHtml(env) }],
  }));
  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true, service: "fpl-league-shop-mcp" });
    if (url.pathname !== "/mcp") return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createServer(env);
    await server.connect(transport);
    return withCors(await transport.handleRequest(request));
  },
};

function corsHeaders(): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, MCP-Protocol-Version",
  });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  corsHeaders().forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
