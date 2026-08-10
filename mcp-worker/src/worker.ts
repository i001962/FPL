import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";
import { z } from "zod";

interface Env {
  ASSETS: Fetcher;
  FPL_API_BASE?: string;
  FPL_DEFAULT_PROJECT_ROUTE?: string;
  FPL_SHOP_URL?: string;
}

const RESOURCE_URI = "ui://fpl-league-shop/standings.html";
const MAX_STANDINGS = 250;
const PROJECT_ROUTE = /^(base|basesep):[1-9]\d*$/;
const projectRouteSchema = z.string().trim().regex(PROJECT_ROUTE, "Use a Juicebox route such as base:9 or basesep:19.");

const CHAINS = {
  base: {
    directory: "0x5aff29060e023e6fb87be5596652b33c65af535b",
    rpcUrls: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  },
  basesep: {
    directory: "0x5aff29060e023e6fb87be5596652b33c65af535b",
    rpcUrls: ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"],
  },
} as const;

const CONTROLLER_OF_ABI = [{
  type: "function",
  name: "controllerOf",
  stateMutability: "view",
  inputs: [{ name: "projectId", type: "uint256" }],
  outputs: [{ name: "", type: "address" }],
}] as const;
const URI_OF_ABI = [{
  type: "function",
  name: "uriOf",
  stateMutability: "view",
  inputs: [{ name: "projectId", type: "uint256" }],
  outputs: [{ name: "", type: "string" }],
}] as const;
const PROJECTS_OF_ABI = [{
  type: "function",
  name: "PROJECTS",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "address" }],
}] as const;
const TOKEN_URI_ABI = [{
  type: "function",
  name: "tokenURI",
  stateMutability: "view",
  inputs: [{ name: "projectId", type: "uint256" }],
  outputs: [{ name: "", type: "string" }],
}] as const;

type ChainSlug = keyof typeof CHAINS;
type FplManagerRow = {
  rank?: number;
  last_rank?: number;
  entry: number;
  entry_name: string;
  player_name?: string;
  player_first_name?: string;
  player_last_name?: string;
  total?: number;
  event_total?: number;
};
type FplLeagueResponse = {
  league: { id: number; name: string };
  standings: { has_next: boolean; results: FplManagerRow[] };
  new_entries: { has_next: boolean; results: FplManagerRow[] };
};
type ProjectMetadata = Record<string, unknown> & { fpl?: Record<string, unknown>; details?: Record<string, unknown> };

function fplBase(env: Env): string {
  return (env.FPL_API_BASE || "https://fantasy.premierleague.com/api").replace(/\/$/, "");
}

function resolveProjectRoute(env: Env, projectRoute?: string): string {
  const route = projectRoute ?? env.FPL_DEFAULT_PROJECT_ROUTE;
  if (!route || !PROJECT_ROUTE.test(route)) {
    throw new Error("Provide a Juicebox project route such as base:9.");
  }
  return route;
}

function metadataLeagueId(metadata: ProjectMetadata): { leagueId: number; source: string } | null {
  const direct: [unknown, string][] = [
    [metadata.leagueId, "metadata.leagueId"],
    [metadata.fplLeagueId, "metadata.fplLeagueId"],
    [metadata.fpl_league_id, "metadata.fpl_league_id"],
    [metadata.fpl?.leagueId, "metadata.fpl.leagueId"],
    [metadata.fpl?.league_id, "metadata.fpl.league_id"],
    [metadata.details?.leagueId, "metadata.details.leagueId"],
    [metadata.details?.fplLeagueId, "metadata.details.fplLeagueId"],
  ];
  for (const [value, source] of direct) {
    const candidate = String(value ?? "").trim();
    if (/^\d{3,9}$/.test(candidate)) return { leagueId: Number(candidate), source };
  }
  const text = [
    metadata.name, metadata.description, metadata.projectTagline, metadata.payDisclosure,
    metadata.website, metadata.external_url, metadata.url, metadata.details?.name,
    metadata.details?.description, metadata.details?.website,
  ].filter(Boolean).join(" ");
  const match = text.match(/(?:fpl[^0-9]{0,24}|league[^0-9]{0,24}|team[^0-9]{0,24}|#)(\d{3,9})/i);
  return match ? { leagueId: Number(match[1]), source: "project metadata text" } : null;
}

function metadataUrls(uri: string): string[] {
  if (!uri.startsWith("ipfs://")) return [uri];
  const path = uri.slice("ipfs://".length);
  return [
    `https://gateway.pinata.cloud/ipfs/${path}`,
    `https://ipfs.io/ipfs/${path}`,
    `https://cloudflare-ipfs.com/ipfs/${path}`,
  ];
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Request failed (${response.status}).`);
  return response.json();
}

async function ethCall(chain: ChainSlug, address: string, data: Hex): Promise<Hex> {
  let lastError: unknown;
  for (const rpcUrl of CHAINS[chain].rpcUrls) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "eth_call", params: [{ to: address, data }, "latest"] }),
      });
      if (!response.ok) throw new Error(`RPC request failed (${response.status}).`);
      const payload = await response.json() as { result?: `0x${string}`; error?: { message?: string } };
      if (payload.error || !payload.result) throw new Error(payload.error?.message || "RPC returned no result.");
      return payload.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Project metadata RPC read failed.");
}

async function projectContext(env: Env, requestedRoute?: string) {
  const projectRoute = resolveProjectRoute(env, requestedRoute);
  const [chain, projectIdText] = projectRoute.split(":") as [ChainSlug, string];
  const projectId = BigInt(projectIdText);
  const controller = decodeFunctionResult({
    abi: CONTROLLER_OF_ABI,
    functionName: "controllerOf",
    data: await ethCall(chain, CHAINS[chain].directory, encodeFunctionData({ abi: CONTROLLER_OF_ABI, functionName: "controllerOf", args: [projectId] })),
  });
  let metadataUri = controller && !/^0x0+$/i.test(controller)
    ? decodeFunctionResult({
      abi: URI_OF_ABI,
      functionName: "uriOf",
      data: await ethCall(chain, controller, encodeFunctionData({ abi: URI_OF_ABI, functionName: "uriOf", args: [projectId] })),
    })
    : "";
  if (!metadataUri) {
    const projects = decodeFunctionResult({
      abi: PROJECTS_OF_ABI,
      functionName: "PROJECTS",
      data: await ethCall(chain, CHAINS[chain].directory, encodeFunctionData({ abi: PROJECTS_OF_ABI, functionName: "PROJECTS" })),
    });
    metadataUri = decodeFunctionResult({
      abi: TOKEN_URI_ABI,
      functionName: "tokenURI",
      data: await ethCall(chain, projects, encodeFunctionData({ abi: TOKEN_URI_ABI, functionName: "tokenURI", args: [projectId] })),
    });
  }
  if (!metadataUri) throw new Error(`Project ${projectRoute} has no readable metadata URI.`);

  let metadata: ProjectMetadata | null = null;
  let lastError: unknown;
  for (const url of metadataUrls(metadataUri)) {
    try {
      const data = await fetchJson(url);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Project metadata is not a JSON object.");
      metadata = data as ProjectMetadata;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!metadata) throw lastError instanceof Error ? lastError : new Error(`Could not load metadata for ${projectRoute}.`);
  const resolvedLeague = metadataLeagueId(metadata);
  if (!resolvedLeague) {
    throw new Error(`Could not resolve an FPL league from ${projectRoute}. Publish fpl.leagueId in the Juicebox project metadata.`);
  }
  return { projectRoute, projectId: projectIdText, metadataUri, projectName: String(metadata.name ?? metadata.details?.name ?? projectRoute), ...resolvedLeague };
}

async function loadStandings(env: Env, leagueId: number, limit: number) {
  const managers = new Map<number, FplManagerRow>();
  let standingsPage = 1;
  let newEntriesPage = 1;
  let standingsHasNext = true;
  let newEntriesHasNext = true;
  let leagueName = "FPL league";
  do {
    const url = new URL(`${fplBase(env)}/leagues-classic/${leagueId}/standings/`);
    url.searchParams.set("page_standings", String(standingsPage));
    url.searchParams.set("page_new_entries", String(newEntriesPage));
    const data = await fetchJson(url.toString()) as FplLeagueResponse;
    leagueName = data.league.name;
    const newEntries = data.new_entries ?? { has_next: false, results: [] };
    if (standingsHasNext) {
      data.standings.results.forEach((manager) => managers.set(manager.entry, manager));
      standingsHasNext = data.standings.has_next;
      standingsPage += 1;
    }
    if (newEntriesHasNext) {
      newEntries.results.forEach((manager) => managers.set(manager.entry, manager));
      newEntriesHasNext = newEntries.has_next;
      newEntriesPage += 1;
    }
  } while ((standingsHasNext || newEntriesHasNext) && managers.size < limit);
  return {
    leagueId, leagueName, hasMore: standingsHasNext || newEntriesHasNext,
    managers: [...managers.values()].slice(0, limit).map((manager) => ({
      rank: manager.rank ?? null,
      lastRank: manager.last_rank ?? 0,
      entry: manager.entry,
      entryName: manager.entry_name,
      playerName: manager.player_name || [manager.player_first_name, manager.player_last_name].filter(Boolean).join(" ") || "Unknown manager",
      total: manager.total ?? manager.event_total ?? 0,
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
  const server = new McpServer({ name: "FPL League Shop", version: "0.2.0" });
  registerAppTool(server, "fpl_shop", {
    title: "Open FPL league shop",
    description: "Use a Juicebox project route to resolve its FPL league from project metadata and show manager standings.",
    inputSchema: { projectRoute: projectRouteSchema.optional() },
    _meta: { ui: { resourceUri: RESOURCE_URI } },
  }, async ({ projectRoute }) => {
    if (!projectRoute && !env.FPL_DEFAULT_PROJECT_ROUTE) {
      return {
        content: [{ type: "text", text: "Open the FPL shop and enter a Juicebox project route such as base:9." }],
        structuredContent: { inputRequired: true },
      };
    }
    const project = await projectContext(env, projectRoute);
    const standings = await loadStandings(env, project.leagueId, 100);
    return {
      content: [{ type: "text", text: `${project.projectRoute} resolved FPL league ${project.leagueId} from ${project.source}; ${standings.managers.length} manager rows loaded.` }],
      structuredContent: { ...standings, ...project },
    };
  });
  server.tool("fpl_standings", "Resolve a Juicebox project route to its FPL league and return public manager standings.", {
    projectRoute: projectRouteSchema.optional(), limit: z.coerce.number().int().min(1).max(MAX_STANDINGS).default(100),
  }, async ({ projectRoute, limit }) => {
    const project = await projectContext(env, projectRoute);
    const standings = await loadStandings(env, project.leagueId, limit);
    return {
      content: [{ type: "text", text: `${project.projectRoute} resolved FPL league ${project.leagueId} from ${project.source}; ${standings.managers.length} manager rows returned.` }],
      structuredContent: { ...standings, ...project },
    };
  });
  server.tool("fpl_prepare_buy", "Prepare a manager-specific FPL shop purchase memo from a Juicebox project route. This never signs or sends a transaction.", {
    projectRoute: projectRouteSchema.optional(), entryId: z.coerce.number().int().positive(),
  }, async ({ projectRoute, entryId }) => {
    const project = await projectContext(env, projectRoute);
    const standings = await loadStandings(env, project.leagueId, MAX_STANDINGS);
    const manager = standings.managers.find((row) => row.entry === entryId);
    if (!manager) return { content: [{ type: "text", text: `FPL entry ${entryId} was not found in the first ${MAX_STANDINGS} standings for ${project.projectRoute}.` }], isError: true };
    const memo = `fpl:league=${project.leagueId};entry=${entryId}`;
    const warning = "The memo is evidence of the selected FPL entry, not proof that the buyer wallet controls that manager.";
    return {
      content: [{ type: "text", text: `Prepared ${memo}. Review the shop and wallet transaction before paying.` }],
      structuredContent: { ...project, entryId, entryName: manager.entryName, playerName: manager.playerName, memo, checkoutUrl: manualShopUrl(env, project.projectRoute, project.leagueId, entryId), warning },
    };
  });
  registerAppResource(server, RESOURCE_URI, RESOURCE_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: await appHtml(env) }],
  }));
  return server;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true, service: "fpl-league-shop-mcp" });
    if (url.pathname !== "/mcp") return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
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
