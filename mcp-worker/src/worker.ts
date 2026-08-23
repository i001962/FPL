import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, stringToHex, type Hex } from "viem";
import { z } from "zod";

interface Env {
  ASSETS: Fetcher;
  FPL_API_BASE?: string;
  FPL_DEFAULT_PROJECT_ROUTE?: string;
  /** Wrangler secret shared by Dwellir Base Mainnet and Sepolia archive endpoint paths. */
  DWELLIR_API_KEY?: string;
}

const RESOURCE_URI = "ui://fpl-league-shop/standings.html";
const MAX_STANDINGS = 500;
const PROJECT_ROUTE = /^(base|basesep):[1-9]\d*$/;
const projectRouteSchema = z.string().trim().regex(PROJECT_ROUTE, "Use a Juicebox route such as base:9 or basesep:19.");

const CHAINS = {
  base: {
    chainId: 8453,
    directory: "0x5aff29060e023e6fb87be5596652b33c65af535b",
    terminal: "0x130f5dd2bd8805443cf41755253d778a75a67f53",
    prices: "0xad45e4627f068d1e6b21e5301870d807543a8401",
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  basesep: {
    chainId: 84532,
    directory: "0x5aff29060e023e6fb87be5596652b33c65af535b",
    terminal: "0x130f5dd2bd8805443cf41755253d778a75a67f53",
    prices: "0xad45e4627f068d1e6b21e5301870d807543a8401",
    token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
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
const CURRENT_RULESET_ABI = [{
  type: "function",
  name: "currentRulesetOf",
  stateMutability: "view",
  inputs: [{ name: "projectId", type: "uint256" }],
  outputs: [{ name: "ruleset", type: "tuple", components: [
    { name: "cycleNumber", type: "uint256" }, { name: "id", type: "uint256" }, { name: "basedOnId", type: "uint256" }, { name: "start", type: "uint256" },
    { name: "duration", type: "uint256" }, { name: "weight", type: "uint256" }, { name: "weightCutPercent", type: "uint256" }, { name: "approvalHook", type: "address" }, { name: "metadata", type: "uint256" },
  ] }, {
    name: "metadata", type: "tuple",
    components: [
      { name: "reservedPercent", type: "uint256" }, { name: "cashOutTaxRate", type: "uint256" }, { name: "baseCurrency", type: "uint256" }, { name: "pausePay", type: "bool" },
      { name: "pauseCreditTransfers", type: "bool" }, { name: "allowOwnerMinting", type: "bool" }, { name: "allowSetCustomToken", type: "bool" }, { name: "allowTerminalMigration", type: "bool" },
      { name: "allowSetTerminals", type: "bool" }, { name: "allowSetController", type: "bool" }, { name: "allowAddAccountingContext", type: "bool" }, { name: "allowAddPriceFeed", type: "bool" },
      { name: "ownerMustSendPayouts", type: "bool" }, { name: "holdFees", type: "bool" }, { name: "useTotalSurplusForCashOuts", type: "bool" }, { name: "useDataHookForPay", type: "bool" },
      { name: "useDataHookForCashOut", type: "bool" }, { name: "dataHook", type: "address" }, { name: "metadata", type: "uint256" },
    ],
  }],
}] as const;
const HOOK_STORE_ABI = [{ type: "function", name: "STORE", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
const HOOK_METADATA_ID_TARGET_ABI = [{ type: "function", name: "METADATA_ID_TARGET", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
const PRICING_CONTEXT_ABI = [{
  type: "function", name: "pricingContext", stateMutability: "view", inputs: [],
  outputs: [{ name: "currency", type: "uint256" }, { name: "decimals", type: "uint256" }],
}] as const;
const PRICE_PER_UNIT_ABI = [{
  type: "function", name: "pricePerUnitOf", stateMutability: "view",
  inputs: [{ name: "projectId", type: "uint256" }, { name: "pricingCurrency", type: "uint256" }, { name: "unitCurrency", type: "uint256" }, { name: "decimals", type: "uint256" }],
  outputs: [{ name: "price", type: "uint256" }],
}] as const;
const TIER_STORE_ABI = [{
  type: "function", name: "tiersOf", stateMutability: "view",
  inputs: [{ type: "address" }, { type: "uint256[]" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
  outputs: [{ type: "tuple[]", components: [
    { name: "id", type: "uint32" }, { name: "price", type: "uint104" }, { name: "remainingSupply", type: "uint32" }, { name: "initialSupply", type: "uint32" },
    { name: "votingUnits", type: "uint104" }, { name: "reserveFrequency", type: "uint16" }, { name: "reserveBeneficiary", type: "address" }, { name: "encodedIpfsUri", type: "bytes32" },
    { name: "category", type: "uint24" }, { name: "discountPercent", type: "uint8" },
    { name: "flags", type: "tuple", components: [{ name: "allowOwnerMint", type: "bool" }, { name: "transfersPausable", type: "bool" }, { name: "cantBeRemoved", type: "bool" }, { name: "cantIncreaseDiscountPercent", type: "bool" }, { name: "cantBuyWithCredits", type: "bool" }] },
    { name: "splitPercent", type: "uint32" }, { name: "resolvedUri", type: "string" },
  ] }],
}] as const;
const ERC20_ABI = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;
const PAY_ABI = [{
  type: "function", name: "pay", stateMutability: "payable",
  inputs: [{ name: "projectId", type: "uint256" }, { name: "token", type: "address" }, { name: "amount", type: "uint256" }, { name: "beneficiary", type: "address" }, { name: "minReturnedTokens", type: "uint256" }, { name: "memo", type: "string" }, { name: "metadata", type: "bytes" }],
  outputs: [{ name: "beneficiaryTokenCount", type: "uint256" }],
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

function chainRpcUrls(env: Env, chain: ChainSlug): string[] {
  const key = env.DWELLIR_API_KEY?.trim();
  if (!key) throw new Error("Blockchain RPC is not configured. Set the DWELLIR_API_KEY Worker secret.");
  const network = chain === "base" ? "mainnet" : "sepolia";
  return [`https://api-base-${network}-archive.n.dwellir.com/${key}`];
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

async function ethCall(env: Env, chain: ChainSlug, address: string, data: Hex): Promise<Hex> {
  let lastError: unknown;
  for (const rpcUrl of chainRpcUrls(env, chain)) {
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

async function rpcRequest<T>(env: Env, chain: ChainSlug, method: string, params: unknown[]): Promise<T> {
  let lastError: unknown;
  for (const rpcUrl of chainRpcUrls(env, chain)) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
      });
      const payload = await response.json() as { result?: T; error?: { message?: string } };
      if (!response.ok || payload.error || payload.result === undefined) throw new Error(payload.error?.message || `RPC ${method} failed (${response.status}).`);
      return payload.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`RPC ${method} failed.`);
}

type CheckoutTransaction = {
  chainId: number;
  from: string;
  to: string;
  data: Hex;
  value: Hex;
  purpose: string;
  hostRpcRequired: true;
};

type ShopTier = { tierId: number; price: bigint; remainingSupply: number; initialSupply: number };

function isZeroAddress(address: string): boolean {
  return /^0x0{40}$/i.test(address);
}

function tokenCurrency(address: string): bigint {
  return BigInt(address) & 0xffffffffn;
}

function rawPaymentAmount(pricingAmount: bigint, pricingDecimals: bigint, pricePerUnit: bigint): bigint {
  const denominator = 10n ** pricingDecimals;
  return (pricingAmount * pricePerUnit + denominator - 1n) / denominator;
}

function v6TierMetadata(idTarget: string, tierIds: number[]): Hex {
  const target = idTarget.slice(2, 10);
  const pay = keccak256(stringToHex("pay")).slice(2, 10);
  const metadataId = Array.from({ length: 4 }, (_, index) => (Number.parseInt(target.slice(index * 2, index * 2 + 2), 16) ^ Number.parseInt(pay.slice(index * 2, index * 2 + 2), 16)).toString(16).padStart(2, "0")).join("");
  const tierData = encodeAbiParameters([{ type: "bool" }, { type: "uint16[]" }], [true, tierIds]);
  return `0x${"00".repeat(32)}${metadataId}02${"00".repeat(27)}${tierData.slice(2)}` as Hex;
}

async function shopContext(env: Env, projectRoute: string) {
  const [chain, projectIdText] = projectRoute.split(":") as [ChainSlug, string];
  const projectId = BigInt(projectIdText);
  const chainConfig = CHAINS[chain];
  const controller = decodeFunctionResult({
    abi: CONTROLLER_OF_ABI, functionName: "controllerOf",
    data: await ethCall(env, chain, chainConfig.directory, encodeFunctionData({ abi: CONTROLLER_OF_ABI, functionName: "controllerOf", args: [projectId] })),
  });
  if (isZeroAddress(controller)) throw new Error(`No controller found for ${projectRoute}.`);
  const ruleset = decodeFunctionResult({
    abi: CURRENT_RULESET_ABI, functionName: "currentRulesetOf",
    data: await ethCall(env, chain, controller, encodeFunctionData({ abi: CURRENT_RULESET_ABI, functionName: "currentRulesetOf", args: [projectId] })),
  });
  const metadata = ruleset[1];
  if (!metadata.useDataHookForPay || isZeroAddress(metadata.dataHook)) throw new Error("The project has no active Juicebox pay data hook.");
  const hook = metadata.dataHook;
  const store = decodeFunctionResult({ abi: HOOK_STORE_ABI, functionName: "STORE", data: await ethCall(env, chain, hook, encodeFunctionData({ abi: HOOK_STORE_ABI, functionName: "STORE" })) });
  const idTarget = decodeFunctionResult({ abi: HOOK_METADATA_ID_TARGET_ABI, functionName: "METADATA_ID_TARGET", data: await ethCall(env, chain, hook, encodeFunctionData({ abi: HOOK_METADATA_ID_TARGET_ABI, functionName: "METADATA_ID_TARGET" })) });
  const pricing = decodeFunctionResult({ abi: PRICING_CONTEXT_ABI, functionName: "pricingContext", data: await ethCall(env, chain, hook, encodeFunctionData({ abi: PRICING_CONTEXT_ABI, functionName: "pricingContext" })) });
  const rawTiers = decodeFunctionResult({ abi: TIER_STORE_ABI, functionName: "tiersOf", data: await ethCall(env, chain, store, encodeFunctionData({ abi: TIER_STORE_ABI, functionName: "tiersOf", args: [hook, [], false, 0n, 200n] })) });
  const pricingCurrency = pricing[0];
  const decimals = pricing[1];
  const paymentCurrency = tokenCurrency(chainConfig.token);
  const pricePerUnit = paymentCurrency === pricingCurrency
    ? 10n ** 6n
    : decodeFunctionResult({ abi: PRICE_PER_UNIT_ABI, functionName: "pricePerUnitOf", data: await ethCall(env, chain, chainConfig.prices, encodeFunctionData({ abi: PRICE_PER_UNIT_ABI, functionName: "pricePerUnitOf", args: [projectId, paymentCurrency, pricingCurrency, 6n] })) });
  const tiers: ShopTier[] = rawTiers
    .filter((tier) => tier.initialSupply > 0)
    .map((tier) => ({ tierId: Number(tier.id), price: rawPaymentAmount(tier.price, decimals, pricePerUnit), remainingSupply: Number(tier.remainingSupply), initialSupply: Number(tier.initialSupply) }));
  return { chain, projectId, hook, idTarget, terminal: chainConfig.terminal, token: chainConfig.token, tiers };
}

async function projectContext(env: Env, requestedRoute?: string) {
  const projectRoute = resolveProjectRoute(env, requestedRoute);
  const [chain, projectIdText] = projectRoute.split(":") as [ChainSlug, string];
  const projectId = BigInt(projectIdText);
  const controller = decodeFunctionResult({
    abi: CONTROLLER_OF_ABI,
    functionName: "controllerOf",
    data: await ethCall(env, chain, CHAINS[chain].directory, encodeFunctionData({ abi: CONTROLLER_OF_ABI, functionName: "controllerOf", args: [projectId] })),
  });
  let metadataUri = controller && !/^0x0+$/i.test(controller)
    ? decodeFunctionResult({
      abi: URI_OF_ABI,
      functionName: "uriOf",
      data: await ethCall(env, chain, controller, encodeFunctionData({ abi: URI_OF_ABI, functionName: "uriOf", args: [projectId] })),
    })
    : "";
  if (!metadataUri) {
    const projects = decodeFunctionResult({
      abi: PROJECTS_OF_ABI,
      functionName: "PROJECTS",
      data: await ethCall(env, chain, CHAINS[chain].directory, encodeFunctionData({ abi: PROJECTS_OF_ABI, functionName: "PROJECTS" })),
    });
    metadataUri = decodeFunctionResult({
      abi: TOKEN_URI_ABI,
      functionName: "tokenURI",
      data: await ethCall(env, chain, projects, encodeFunctionData({ abi: TOKEN_URI_ABI, functionName: "tokenURI", args: [projectId] })),
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

function pageParameter(url: URL, name: string): number {
  const value = url.searchParams.get(name) || "1";
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1_000) {
    throw new Error(`${name} must be a positive page number.`);
  }
  return Number(value);
}

async function fplLeagueProxy(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const leagueId = requestUrl.searchParams.get("leagueId") || "";
  if (!/^\d{3,9}$/.test(leagueId)) return withCors(Response.json({ error: "Provide a valid FPL leagueId." }, { status: 400 }));
  try {
    const fplUrl = new URL(`${fplBase(env)}/leagues-classic/${leagueId}/standings/`);
    fplUrl.searchParams.set("page_standings", String(pageParameter(requestUrl, "page_standings")));
    fplUrl.searchParams.set("page_new_entries", String(pageParameter(requestUrl, "page_new_entries")));
    const response = Response.json(await fetchJson(fplUrl.toString()), { headers: { "Cache-Control": "public, max-age=60" } });
    return withCors(response);
  } catch (error) {
    return withCors(Response.json({ error: error instanceof Error ? error.message : "Could not load FPL standings." }, { status: 502 }));
  }
}

async function appHtml(env: Env): Promise<string> {
  const response = await env.ASSETS.fetch("https://assets.invalid/mcp-app.html");
  if (!response.ok) throw new Error("MCP app asset is unavailable. Run npm run build before deploying.");
  return response.text();
}

const GROUNDING_INSTRUCTIONS = `You are an FPL League Shop assistant. Before answering any question about a shop, league, manager, tier, price, inventory, or purchase transaction, call the relevant FPL League Shop tool to retrieve current data. Then reply only from the returned tool data. Do not guess, use remembered values, invent facts, or treat a previous response as live data. If the required data is unavailable or a requested identifier is missing, say that clearly and request the identifier or explain the limitation. Never claim that you made an API call unless you actually called a tool in this conversation. Treat transaction data as unsigned plans until the connected wallet has independently simulated and submitted it.`;

function createServer(env: Env): McpServer {
  const server = new McpServer(
    { name: "FPL League Shop", version: "0.5.0" },
    { instructions: GROUNDING_INSTRUCTIONS },
  );
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
    const standings = await loadStandings(env, project.leagueId, MAX_STANDINGS);
    return {
      content: [{ type: "text", text: `${project.projectRoute} resolved FPL league ${project.leagueId} from ${project.source}; ${standings.managers.length} manager rows loaded.` }],
      structuredContent: { ...standings, ...project },
    };
  });
  server.tool("fpl_standings", "Resolve a Juicebox project route to its FPL league and return public manager standings.", {
    projectRoute: projectRouteSchema.optional(), limit: z.coerce.number().int().min(1).max(MAX_STANDINGS).default(MAX_STANDINGS),
  }, async ({ projectRoute, limit }) => {
    const project = await projectContext(env, projectRoute);
    const standings = await loadStandings(env, project.leagueId, limit);
    return {
      content: [{ type: "text", text: `${project.projectRoute} resolved FPL league ${project.leagueId} from ${project.source}; ${standings.managers.length} manager rows returned.` }],
      structuredContent: { ...standings, ...project },
    };
  });
  server.tool("fpl_prepare_buy", "Prepare a manager-specific FPL purchase. Returns live tier choices and the fields required for a wallet-ready transaction plan; it never signs or sends a transaction.", {
    projectRoute: projectRouteSchema.optional(), entryId: z.coerce.number().int().positive(),
  }, async ({ projectRoute, entryId }) => {
    const project = await projectContext(env, projectRoute);
    const standings = await loadStandings(env, project.leagueId, MAX_STANDINGS);
    const manager = standings.managers.find((row) => row.entry === entryId);
    if (!manager) return { content: [{ type: "text", text: `FPL entry ${entryId} was not found in the first ${MAX_STANDINGS} standings for ${project.projectRoute}.` }], isError: true };
    const memo = `fpl:league=${project.leagueId};entry=${entryId}`;
    const warning = "The memo is evidence of the selected FPL entry, not proof that the buyer wallet controls that manager.";
    const shop = await shopContext(env, project.projectRoute);
    return {
      content: [{ type: "text", text: `Prepared ${memo}. Select one or more live tier IDs, get the connected wallet address, then call fpl_create_purchase_transaction. A wallet-capable connector must review and submit the returned transaction plan.` }],
      structuredContent: {
        ...project, entryId, entryName: manager.entryName, playerName: manager.playerName, memo, warning,
        payment: { chainId: CHAINS[shop.chain].chainId, asset: "USDC", token: shop.token },
        tiers: shop.tiers.filter((tier) => tier.remainingSupply !== 0).map((tier) => ({ tierId: tier.tierId, amountRaw: tier.price.toString(), amountUsdc: Number(tier.price) / 1_000_000, remainingSupply: tier.remainingSupply, initialSupply: tier.initialSupply })),
        required: ["tierIds", "buyerAddress"],
      },
    };
  });
  server.tool("fpl_create_purchase_transaction", "Build unsigned Base USDC approval and Juicebox pay calldata. The host wallet must check allowance, simulate, estimate gas and fees, then request approval before signing and broadcasting.", {
    projectRoute: projectRouteSchema.optional(),
    entryId: z.coerce.number().int().positive(),
    tierIds: z.array(z.coerce.number().int().min(1).max(65535)).min(1).max(20),
    buyerAddress: z.string().trim().regex(/^0x[a-fA-F0-9]{40}$/, "Provide the connected wallet address."),
  }, async ({ projectRoute, entryId, tierIds, buyerAddress }) => {
    const project = await projectContext(env, projectRoute);
    const standings = await loadStandings(env, project.leagueId, MAX_STANDINGS);
    const manager = standings.managers.find((row) => row.entry === entryId);
    if (!manager) return { content: [{ type: "text", text: `FPL entry ${entryId} was not found in the first ${MAX_STANDINGS} standings for ${project.projectRoute}.` }], isError: true };
    const shop = await shopContext(env, project.projectRoute);
    const selected = tierIds.map((tierId) => {
      const tier = shop.tiers.find((candidate) => candidate.tierId === tierId);
      if (!tier) throw new Error(`Tier ${tierId} is not active for ${project.projectRoute}.`);
      if (tier.remainingSupply === 0) throw new Error(`Tier ${tierId} is sold out.`);
      return tier;
    });
    const amount = selected.reduce((total, tier) => total + tier.price, 0n);
    if (amount <= 0n) throw new Error("Selected tiers have no payment amount.");
    const memo = `fpl:league=${project.leagueId};entry=${entryId}`;
    const buyer = buyerAddress as Hex;
    const token = shop.token as Hex;
    const terminal = shop.terminal as Hex;
    const approval: CheckoutTransaction = {
      chainId: CHAINS[shop.chain].chainId, from: buyerAddress, to: token,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [terminal, amount] }),
      value: "0x0" as Hex, purpose: "Approve USDC for Juicebox", hostRpcRequired: true,
    };
    const pay: CheckoutTransaction = {
      chainId: CHAINS[shop.chain].chainId, from: buyerAddress, to: terminal,
      data: encodeFunctionData({ abi: PAY_ABI, functionName: "pay", args: [shop.projectId, token, amount, buyer, 0n, memo, v6TierMetadata(shop.idTarget, tierIds)] }),
      value: "0x0" as Hex, purpose: "Buy selected FPL NFT tiers", hostRpcRequired: true,
    };
    return {
      content: [{ type: "text", text: "Prepared unsigned approval and pay calldata. The host wallet must use its own Base RPC to check allowance, simulate, estimate gas and fees; only submit approval if needed, wait for it to confirm, then simulate and submit pay after user approval." }],
      structuredContent: {
        ...project, entryId, entryName: manager.entryName, playerName: manager.playerName, buyerAddress, memo,
        amountRaw: amount.toString(), amountUsdc: Number(amount) / 1_000_000, tierIds,
        approval: { ...approval, optional: true, onlySubmitWhenAllowanceBelow: amount.toString() },
        pay,
        requiredHostRpcActions: ["Read USDC allowance for buyerAddress -> terminal.", "Simulate each transaction with eth_call.", "Populate nonce, gas, maxFeePerGas, and maxPriorityFeePerGas immediately before signing.", "Submit approval only when allowance is below amountRaw; wait for its confirmation before simulating and submitting pay."],
        nextStep: "The connected wallet must simulate and hydrate this plan through its own Base RPC, then ask the user to approve each required transaction.",
        warning: "This plan is unsigned and not simulated by the FPL Worker. The connected wallet is the signer, and the memo is only a weak claim linking that wallet payment to the selected FPL entry.",
      },
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
    if (url.pathname === "/api/fpl-league") {
      if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
      if (request.method !== "GET") return withCors(Response.json({ error: "Method not allowed." }, { status: 405 }));
      return fplLeagueProxy(request, env);
    }
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, MCP-Protocol-Version",
  });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  corsHeaders().forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
