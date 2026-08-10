import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { encodeFunctionData, getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";
import { z } from "zod";

export interface Env {
  FPL_API_BASE?: string;
  FPL_CACHE_TTL_SECONDS?: string;
  /** Comma-separated browser origins allowed to call this remote MCP endpoint. */
  ALLOWED_ORIGINS?: string;
  /** Wrangler secret. Used to sign short-lived wallet challenges and access tokens. */
  ACCESS_TOKEN_SECRET?: string;
}

type Json = Record<string, unknown>;
type Player = Json & { id: number; web_name: string; team: number; element_type: number };
type Team = Json & { id: number; name: string; short_name: string };
type Fixture = Json & { event: number | null; team_h: number; team_a: number; team_h_difficulty: number; team_a_difficulty: number };
type Bootstrap = { elements: Player[]; teams: Team[]; events: Json[] };

const USER_AGENT = "Mozilla/5.0 (compatible; FPL-Intelligence-MCP/0.1; +https://github.com/dohyung1/x402-fpl-api)";
const TEAM_ID = z.coerce.number().int().positive();
const LEAGUE_ID = z.coerce.number().int().positive();
const PLAYER_ID = z.coerce.number().int().positive();
const POSITION = ["GKP", "DEF", "MID", "FWD"] as const;
const BASE_CHAIN_ID = 8453;
const ELIGIBILITY_ASSET_TYPE = "eip155:8453/erc721:0x4669162aa53b9052f73f1ca12e43f4be57cf40bf";
const ELIGIBILITY_CONTRACT = "0x4669162aa53b9052f73f1ca12e43f4be57cf40bf" as Address;
const BASE_RPC_URLS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com"];
const CHALLENGE_TTL_SECONDS = 5 * 60;
const ACCESS_TTL_SECONDS = 60 * 60;
const FREE_ACCESS_TOOLS = new Set(["fpl_access_challenge", "fpl_verify_access", "fpl_purchase_instructions"]);
const JUICEBOX_TERMINAL = "0x130f5dd2bd8805443cf41755253d778a75a67f53" as Address;
const JUICEBOX_PROJECT_ID = 10n;
const PURCHASE_TOKEN = "0x253bA2F6570a90bC3c7C98e4F7f205B081EA9Ba3" as Address;
const PURCHASE_AMOUNT = 1_000_000_000_000_000_000_000n;
const PURCHASE_METADATA = "0x00000000000000000000000000000000000000000000000000000000000000005962def1020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002" as Hex;
const ERC20_APPROVE_ABI = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }] as const;
const JUICEBOX_PAY_ABI = [{ type: "function", name: "pay", stateMutability: "payable", inputs: [{ name: "projectId", type: "uint256" }, { name: "token", type: "address" }, { name: "amount", type: "uint256" }, { name: "beneficiary", type: "address" }, { name: "minReturnedTokens", type: "uint256" }, { name: "memo", type: "string" }, { name: "metadata", type: "bytes" }], outputs: [{ name: "beneficiaryTokenCount", type: "uint256" }] }] as const;

function number(value: unknown): number { const result = Number(value); return Number.isFinite(result) ? result : 0; }
function text(value: unknown): string { return typeof value === "string" ? value : String(value ?? ""); }
function currentGameweek(bootstrap: Bootstrap): number {
  const current = bootstrap.events.find((event) => event.is_current === true) ?? bootstrap.events.find((event) => event.is_next === true);
  return number(current?.id) || 1;
}
function nextGameweek(bootstrap: Bootstrap): number {
  return number(bootstrap.events.find((event) => event.is_next === true)?.id) || currentGameweek(bootstrap);
}
function fplBase(env: Env): string { return (env.FPL_API_BASE || "https://fantasy.premierleague.com/api").replace(/\/$/, ""); }
function cacheTtl(env: Env): number { return Math.max(0, Math.min(900, number(env.FPL_CACHE_TTL_SECONDS) || 120)); }

type ChallengePayload = { wallet: Address; expiresAt: number; nonce: string; assetType: typeof ELIGIBILITY_ASSET_TYPE };
type AccessPayload = { wallet: Address; expiresAt: number; assetType: typeof ELIGIBILITY_ASSET_TYPE };

function requiredAccessSecret(env: Env): string {
  if (!env.ACCESS_TOKEN_SECRET || env.ACCESS_TOKEN_SECRET.length < 32) throw new Error("Eligibility is not configured. The Worker owner must set ACCESS_TOKEN_SECRET.");
  return env.ACCESS_TOKEN_SECRET;
}
function base64UrlEncode(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecode(value: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoded access credential.");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signPayload<T extends object>(env: Env, payload: T): Promise<string> {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(requiredAccessSecret(env)), new TextEncoder().encode(encoded));
  return `${encoded}.${base64UrlEncode(new Uint8Array(signature))}`;
}
async function verifyPayload<T extends object>(env: Env, token: string): Promise<T> {
  const [encoded, signature, ...extra] = token.split(".");
  if (!encoded || !signature || extra.length) throw new Error("Invalid access credential.");
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(requiredAccessSecret(env)), base64UrlDecode(signature), new TextEncoder().encode(encoded));
  if (!valid) throw new Error("Invalid access credential.");
  const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)));
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid access credential.");
  return parsed as T;
}
function accessMessage(challenge: string, payload: ChallengePayload): string {
  return ["FPL Intelligence MCP access request", `Wallet: ${payload.wallet}`, `Chain: eip155:${BASE_CHAIN_ID}`, `Asset: ${payload.assetType}`, `Expires: ${new Date(payload.expiresAt * 1000).toISOString()}`, `Challenge: ${challenge}`].join("\n");
}
async function collectionBalance(wallet: Address): Promise<bigint> {
  const calldata = `0x70a08231${wallet.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
  let lastError: unknown;
  for (const rpcUrl of BASE_RPC_URLS) {
    try {
      const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(8_000), body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "eth_call", params: [{ to: ELIGIBILITY_CONTRACT, data: calldata }, "latest"] }) });
      const result = await response.json() as { result?: Hex; error?: { message?: string } };
      if (!response.ok || result.error || !result.result) throw new Error(result.error?.message || `Base RPC returned ${response.status}.`);
      return BigInt(result.result);
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not verify the Base NFT entitlement.");
}
async function issueChallenge(env: Env, walletInput: string) {
  if (!isAddress(walletInput)) throw new Error("Provide a valid EVM wallet address.");
  requiredAccessSecret(env);
  const payload: ChallengePayload = { wallet: getAddress(walletInput), expiresAt: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS, nonce: crypto.randomUUID(), assetType: ELIGIBILITY_ASSET_TYPE };
  const challenge = await signPayload(env, payload);
  return { challenge, message: accessMessage(challenge, payload), expiresAt: new Date(payload.expiresAt * 1000).toISOString(), wallet: payload.wallet, assetType: payload.assetType };
}
async function verifyChallengeAndIssueAccess(env: Env, walletInput: string, challenge: string, signature: Hex) {
  if (!isAddress(walletInput)) throw new Error("Provide a valid EVM wallet address.");
  const payload = await verifyPayload<ChallengePayload>(env, challenge);
  const wallet = getAddress(walletInput);
  if (payload.assetType !== ELIGIBILITY_ASSET_TYPE || payload.wallet.toLowerCase() !== wallet.toLowerCase() || payload.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("This wallet challenge is invalid or expired. Request a new challenge.");
  const validSignature = await verifyMessage({ address: wallet, message: accessMessage(challenge, payload), signature });
  if (!validSignature) throw new Error("Signature does not prove control of this wallet.");
  const balance = await collectionBalance(wallet);
  if (balance < 1n) return { eligible: false as const, wallet, balance: balance.toString(), assetType: ELIGIBILITY_ASSET_TYPE };
  const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS;
  const accessToken = await signPayload<AccessPayload>(env, { wallet, expiresAt, assetType: ELIGIBILITY_ASSET_TYPE });
  return { eligible: true as const, wallet, balance: balance.toString(), assetType: ELIGIBILITY_ASSET_TYPE, accessToken, expiresAt: new Date(expiresAt * 1000).toISOString() };
}
async function verifyAccessToken(env: Env, token: string): Promise<AccessPayload> {
  const payload = await verifyPayload<AccessPayload>(env, token);
  if (!isAddress(payload.wallet) || payload.assetType !== ELIGIBILITY_ASSET_TYPE || payload.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("Access token is invalid or expired. Verify ownership again.");
  if (await collectionBalance(getAddress(payload.wallet)) < 1n) throw new Error("The required NFT is no longer held by this wallet.");
  return payload;
}
function purchasePlan(walletInput: string) {
  if (!isAddress(walletInput)) throw new Error("Provide a valid EVM buyer address.");
  const buyer = getAddress(walletInput);
  return { chain: "Base", chainId: BASE_CHAIN_ID, contract: "JBMultiTerminal", address: JUICEBOX_TERMINAL, function: "pay", abi: "pay(uint256 projectId, address token, uint256 amount, address beneficiary, uint256 minReturnedTokens, string memo, bytes metadata) payable returns (uint256)", calldata: encodeFunctionData({ abi: JUICEBOX_PAY_ABI, functionName: "pay", args: [JUICEBOX_PROJECT_ID, PURCHASE_TOKEN, PURCHASE_AMOUNT, buyer, 0n, "", PURCHASE_METADATA] }), value: "0", erc20Approval: { token: PURCHASE_TOKEN, spender: JUICEBOX_TERMINAL, amount: PURCHASE_AMOUNT.toString(), calldata: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [JUICEBOX_TERMINAL, PURCHASE_AMOUNT] }) }, args: { projectId: JUICEBOX_PROJECT_ID.toString(), token: PURCHASE_TOKEN, amount: `${PURCHASE_AMOUNT} (1000 SLOPSHOP)`, beneficiary: buyer, minReturnedTokens: "0", memo: "", metadata: PURCHASE_METADATA } };
}

/** Fetches FPL's public API with a small edge cache; no user data is persisted. */
async function fpl<T>(env: Env, path: string, ttl = cacheTtl(env)): Promise<T> {
  const url = `${fplBase(env)}${path}`;
  const cacheKey = new Request(`https://fpl-cache.invalid/${encodeURIComponent(url)}`);
  const cache = await caches.open("fpl-api");
  if (ttl > 0) {
    const cached = await cache.match(cacheKey);
    if (cached) return await cached.json() as T;
  }
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
      if (response.ok) break;
      lastError = new Error(`FPL API returned ${response.status}.`);
    } catch (error) { lastError = error; }
  }
  if (!response?.ok) throw lastError instanceof Error ? lastError : new Error("FPL API request failed.");
  const data = await response.json() as T;
  if (ttl > 0) {
    const cacheResponse = new Response(JSON.stringify(data), { headers: { "content-type": "application/json", "cache-control": `max-age=${ttl}` } });
    await cache.put(cacheKey, cacheResponse);
  }
  return data;
}

async function core(env: Env): Promise<{ bootstrap: Bootstrap; fixtures: Fixture[]; current: number; next: number }> {
  const [bootstrap, fixtures] = await Promise.all([fpl<Bootstrap>(env, "/bootstrap-static/"), fpl<Fixture[]>(env, "/fixtures/")]);
  return { bootstrap, fixtures, current: currentGameweek(bootstrap), next: nextGameweek(bootstrap) };
}

function teamsById(bootstrap: Bootstrap): Map<number, Team> { return new Map(bootstrap.teams.map((team) => [team.id, team])); }
function playerPosition(player: Player): string { return POSITION[player.element_type - 1] || "UNK"; }
function fixturesFor(fixtures: Fixture[], team: number, gameweek: number, count = 1): { opponent: number; home: boolean; difficulty: number; gameweek: number }[] {
  return fixtures.filter((fixture) => fixture.event !== null && fixture.event >= gameweek && fixture.event < gameweek + count && (fixture.team_h === team || fixture.team_a === team))
    .map((fixture) => fixture.team_h === team
      ? { opponent: fixture.team_a, home: true, difficulty: number(fixture.team_h_difficulty), gameweek: number(fixture.event) }
      : { opponent: fixture.team_h, home: false, difficulty: number(fixture.team_a_difficulty), gameweek: number(fixture.event) });
}

function captainScore(player: Player, fixtures: Fixture[], gameweek: number): number {
  const next = fixturesFor(fixtures, player.team, gameweek, 1);
  const fixtureScore = next.length ? next.reduce((sum, fixture) => sum + (6 - fixture.difficulty) + (fixture.home ? 0.4 : 0), 0) / next.length : 0;
  return number(player.form) * 2 + number(player.points_per_game) + number(player.expected_goals_per_90) * 2.3 + number(player.expected_assists_per_90) * 1.2 + fixtureScore * 1.5 + (number(player.penalties_order) === 1 ? 1 : 0);
}

function captainPicks(bootstrap: Bootstrap, fixtures: Fixture[], gameweek: number, limit = 5) {
  const teams = teamsById(bootstrap);
  return bootstrap.elements.filter((player) => number(player.minutes) >= 180 && text(player.status || "a") === "a")
    .map((player) => {
      const next = fixturesFor(fixtures, player.team, gameweek, 1);
      return { playerId: player.id, name: player.web_name, team: teams.get(player.team)?.short_name || "?", position: playerPosition(player), score: Number(captainScore(player, fixtures, gameweek).toFixed(2)), form: number(player.form), expectedGoalsPer90: number(player.expected_goals_per_90), expectedAssistsPer90: number(player.expected_assists_per_90), fixture: next.map((fixture) => `${teams.get(fixture.opponent)?.short_name || "?"} (${fixture.home ? "H" : "A"})`).join(", ") || "TBC", fixtureDifficulty: next[0]?.difficulty ?? null };
    }).sort((a, b) => b.score - a.score).slice(0, limit);
}

function playerView(player: Player, bootstrap: Bootstrap, fixtures: Fixture[], gameweek: number) {
  const teams = teamsById(bootstrap);
  const next = fixturesFor(fixtures, player.team, gameweek, 5);
  return { playerId: player.id, name: player.web_name, team: teams.get(player.team)?.short_name || "?", position: playerPosition(player), price: number(player.now_cost) / 10, form: number(player.form), pointsPerGame: number(player.points_per_game), totalPoints: number(player.total_points), minutes: number(player.minutes), selectedByPercent: number(player.selected_by_percent), expectedGoalsPer90: number(player.expected_goals_per_90), expectedAssistsPer90: number(player.expected_assists_per_90), status: text(player.status || "a"), chanceOfPlayingNextRound: player.chance_of_playing_next_round ?? null, nextFixtures: next.map((fixture) => ({ gameweek: fixture.gameweek, opponent: teams.get(fixture.opponent)?.short_name || "?", home: fixture.home, difficulty: fixture.difficulty })) };
}

function errorResult(error: unknown) { return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Unexpected FPL service error." }], isError: true }; }

async function teamContext(env: Env, teamId: number, data?: Awaited<ReturnType<typeof core>>) {
  const app = data ?? await core(env);
  const [picks, history, profile] = await Promise.all([fpl<Json>(env, `/entry/${teamId}/event/${app.current}/picks/`, 60), fpl<Json>(env, `/entry/${teamId}/history/`, 120), fpl<Json>(env, `/entry/${teamId}/`, 120)]);
  return { ...app, picks, history, profile };
}

function transferSuggestions(context: Awaited<ReturnType<typeof teamContext>>, limit = 5) {
  const ids = new Set((context.picks.picks as Json[] || []).map((pick) => number(pick.element)));
  const players = context.bootstrap.elements;
  const owners = players.filter((player) => ids.has(player.id));
  const candidates = players.filter((player) => !ids.has(player.id) && text(player.status || "a") === "a" && number(player.minutes) >= 180)
    .map((player) => ({ player, score: captainScore(player, context.fixtures, context.next) + number(player.total_points) / 25 }))
    .sort((a, b) => b.score - a.score);
  const outs = owners.map((player) => ({ player, score: captainScore(player, context.fixtures, context.next) + number(player.form) + number(player.total_points) / 30 }))
    .sort((a, b) => a.score - b.score);
  return outs.slice(0, limit).map((out, index) => {
    const replacement = candidates.find((candidate) => candidate.player.element_type === out.player.element_type && number(candidate.player.now_cost) <= number(out.player.now_cost) + number(context.picks.entry_history && (context.picks.entry_history as Json).bank)) || candidates[index];
    return { out: playerView(out.player, context.bootstrap, context.fixtures, context.next), in: replacement ? playerView(replacement.player, context.bootstrap, context.fixtures, context.next) : null, rationale: "Ranks recent form, underlying attacking output, availability, and the next fixture." };
  });
}

function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "FPL Intelligence", version: "0.1.0" });
  server.tool("fpl_access_challenge", "Create the exact message an EVM wallet must sign to prove control before FPL Intelligence access is granted. The required Base ERC-721 collection is identified by CAIP-19 asset type.", { walletAddress: z.string().trim() }, async ({ walletAddress }) => {
    try {
      const challenge = await issueChallenge(env, walletAddress);
      return { content: [{ type: "text", text: "Sign this exact message with the specified wallet, then call fpl_verify_access with the returned challenge and signature. Do not sign a transaction." }], structuredContent: challenge };
    } catch (error) { return errorResult(error); }
  });
  server.tool("fpl_verify_access", "Verify a signed wallet challenge and require the signer to hold at least one NFT from the required Base ERC-721 collection. Returns a one-hour HTTP access token only for eligible holders.", { walletAddress: z.string().trim(), challenge: z.string().trim().min(20), signature: z.string().trim().regex(/^0x[0-9a-fA-F]{130}$/, "Provide a 65-byte EVM signature.") }, async ({ walletAddress, challenge, signature }) => {
    try {
      const result = await verifyChallengeAndIssueAccess(env, walletAddress, challenge, signature as Hex);
      if (!result.eligible) return { content: [{ type: "text", text: "This wallet does not hold the required NFT. Call fpl_purchase_instructions with the buyer wallet address to review the exact Juicebox approval and pay calldata before signing." }], structuredContent: result, isError: true };
      return { content: [{ type: "text", text: "Ownership verified. Include `Authorization: Bearer <accessToken>` on subsequent MCP HTTP requests. The token expires in one hour and access is rechecked against the collection on every protected tool call." }], structuredContent: result };
    } catch (error) { return errorResult(error); }
  });
  server.tool("fpl_purchase_instructions", "Show the exact Base Juicebox ERC-20 approval and pay transaction calldata required to mint the access NFT to the buyer address. This tool never signs, submits, or simulates a transaction.", { buyerAddress: z.string().trim() }, async ({ buyerAddress }) => {
    try {
      const plan = purchasePlan(buyerAddress);
      return { content: [{ type: "text", text: "This is the exact transaction that will be sent to your wallet. Review it before signing. It spends 1000 SLOPSHOP, first approves JBMultiTerminal, and mints the NFT to the supplied buyer address as beneficiary." }], structuredContent: { requiredAssetType: ELIGIBILITY_ASSET_TYPE, purchase: plan, instructions: ["Review the ERC-20 approval for 1000 SLOPSHOP to JBMultiTerminal.", "Review the Base JBMultiTerminal.pay transaction. Its beneficiary is your buyer wallet address.", "Submit the approval only if your current allowance is insufficient, wait for confirmation, then submit pay.", "After the NFT arrives, request a fresh fpl_access_challenge and verify ownership."] } };
    } catch (error) { return errorResult(error); }
  });
  server.tool("captain_pick", "Rank the best FPL captain picks using form, underlying attacking output, penalties, availability, and fixture difficulty.", { gameweek: z.coerce.number().int().min(1).max(38).optional() }, async ({ gameweek }) => {
    try { const app = await core(env); const gw = gameweek ?? app.next; const picks = captainPicks(app.bootstrap, app.fixtures, gw); return { content: [{ type: "text", text: `Top captain picks for GW${gw}: ${picks.map((pick) => pick.name).join(", ")}.` }], structuredContent: { gameweek: gw, picks } }; } catch (error) { return errorResult(error); }
  });
  server.tool("player_comparison", "Compare two to four FPL players across price, form, points, expected output, ownership, availability, and next five fixtures.", { playerIds: z.array(PLAYER_ID).min(2).max(4), gameweek: z.coerce.number().int().min(1).max(38).optional() }, async ({ playerIds, gameweek }) => {
    try { const app = await core(env); const players = playerIds.map((id) => app.bootstrap.elements.find((player) => player.id === id)).filter((player): player is Player => Boolean(player)); if (players.length !== playerIds.length) throw new Error("One or more FPL player IDs were not found."); const gw = gameweek ?? app.next; const comparisons = players.map((player) => ({ ...playerView(player, app.bootstrap, app.fixtures, gw), captainScore: Number(captainScore(player, app.fixtures, gw).toFixed(2)) })); return { content: [{ type: "text", text: `Compared ${comparisons.map((player) => player.name).join(" vs ")}.` }], structuredContent: { gameweek: gw, players: comparisons } }; } catch (error) { return errorResult(error); }
  });
  server.tool("differential_finder", "Find under-owned FPL players with form, expected output, and upcoming fixtures that support a differential pick.", { maxOwnershipPct: z.coerce.number().min(0).max(100).default(10), limit: z.coerce.number().int().min(1).max(20).default(10) }, async ({ maxOwnershipPct, limit }) => {
    try { const app = await core(env); const differentials = app.bootstrap.elements.filter((player) => number(player.selected_by_percent) <= maxOwnershipPct && number(player.minutes) >= 270 && text(player.status || "a") === "a").map((player) => ({ ...playerView(player, app.bootstrap, app.fixtures, app.next), score: Number(captainScore(player, app.fixtures, app.next).toFixed(2)) })).sort((a, b) => b.score - a.score).slice(0, limit); return { content: [{ type: "text", text: `Found ${differentials.length} differentials at or below ${maxOwnershipPct}% ownership.` }], structuredContent: { gameweek: app.next, maxOwnershipPct, differentials } }; } catch (error) { return errorResult(error); }
  });
  server.tool("fixture_outlook", "Rank teams by their upcoming fixture difficulty and list the players to target from the best runs.", { gameweeksAhead: z.coerce.number().int().min(1).max(10).default(5) }, async ({ gameweeksAhead }) => {
    try { const app = await core(env); const teams = teamsById(app.bootstrap); const outlook = app.bootstrap.teams.map((team) => { const run = fixturesFor(app.fixtures, team.id, app.next, gameweeksAhead); return { team: team.short_name, averageDifficulty: Number((run.reduce((sum, fixture) => sum + fixture.difficulty, 0) / Math.max(run.length, 1)).toFixed(2)), fixtures: run.map((fixture) => `${teams.get(fixture.opponent)?.short_name || "?"} (${fixture.home ? "H" : "A"})`) }; }).sort((a, b) => a.averageDifficulty - b.averageDifficulty); const targetTeams = new Set(outlook.slice(0, 5).map((team) => team.team)); const playersToTarget = app.bootstrap.elements.filter((player) => targetTeams.has(teams.get(player.team)?.short_name || "") && text(player.status || "a") === "a").sort((a, b) => captainScore(b, app.fixtures, app.next) - captainScore(a, app.fixtures, app.next)).slice(0, 15).map((player) => playerView(player, app.bootstrap, app.fixtures, app.next)); return { content: [{ type: "text", text: `Fixture outlook for the next ${gameweeksAhead} gameweeks.` }], structuredContent: { gameweek: app.next, teams: outlook, playersToTarget } }; } catch (error) { return errorResult(error); }
  });
  server.tool("price_predictions", "Flag likely FPL price risers and fallers from current net transfers. This is a heuristic, not an official price forecast.", {}, async () => {
    try { const app = await core(env); const ranked = app.bootstrap.elements.map((player) => ({ player, netTransfers: number(player.transfers_in_event) - number(player.transfers_out_event) })); const view = (item: typeof ranked[number]) => ({ ...playerView(item.player, app.bootstrap, app.fixtures, app.next), netTransfers: item.netTransfers }); const risers = [...ranked].sort((a, b) => b.netTransfers - a.netTransfers).slice(0, 15).map(view); const fallers = [...ranked].sort((a, b) => a.netTransfers - b.netTransfers).slice(0, 15).map(view); return { content: [{ type: "text", text: "Price-change heuristic based on current event transfer flow." }], structuredContent: { gameweek: app.next, disclaimer: "FPL does not publish price-change thresholds; treat this as a signal, not a guarantee.", likelyRisers: risers, likelyFallers: fallers } }; } catch (error) { return errorResult(error); }
  });
  server.tool("live_points", "Return live points, bonus and auto-sub-relevant details for an FPL team in a gameweek.", { teamId: TEAM_ID, gameweek: z.coerce.number().int().min(1).max(38).optional() }, async ({ teamId, gameweek }) => {
    try { const app = await core(env); const gw = gameweek ?? app.current; const [live, picks] = await Promise.all([fpl<Json>(env, `/event/${gw}/live/`, 30), fpl<Json>(env, `/entry/${teamId}/event/${gw}/picks/`, 30)]); const liveById = new Map((live.elements as Json[] || []).map((item) => [number(item.id), item])); const players = (picks.picks as Json[] || []).map((pick) => { const player = app.bootstrap.elements.find((candidate) => candidate.id === number(pick.element)); const stats = liveById.get(number(pick.element))?.stats as Json | undefined; return { playerId: number(pick.element), name: player?.web_name || "Unknown", starter: number(pick.position) <= 11, captain: pick.is_captain === true, viceCaptain: pick.is_vice_captain === true, points: number(stats?.total_points) * (pick.is_captain === true ? 2 : 1), minutes: number(stats?.minutes), bonus: number(stats?.bonus), autoSub: Boolean(pick.autosub) }; }); return { content: [{ type: "text", text: `Live points for team ${teamId}, GW${gw}.` }], structuredContent: { teamId, gameweek: gw, players, eventStatus: await fpl<Json>(env, "/event-status/", 60) } }; } catch (error) { return errorResult(error); }
  });
  server.tool("transfer_suggestions", "Suggest like-for-like FPL transfers from a manager's current public squad and bank.", { teamId: TEAM_ID, limit: z.coerce.number().int().min(1).max(10).default(5) }, async ({ teamId, limit }) => {
    try { const context = await teamContext(env, teamId); const suggestions = transferSuggestions(context, limit); return { content: [{ type: "text", text: `Transfer suggestions for ${text(context.profile.name) || `team ${teamId}`}.` }], structuredContent: { teamId, gameweek: context.next, bank: number((context.picks.entry_history as Json | undefined)?.bank) / 10, suggestions, disclaimer: "Check availability, position limits, and your exact free-transfer count before acting." } }; } catch (error) { return errorResult(error); }
  });
  server.tool("is_hit_worth_it", "Estimate whether a -4 hit is justified by comparing two players' short-horizon heuristic scores.", { playerOutId: PLAYER_ID, playerInId: PLAYER_ID, gameweeksAhead: z.coerce.number().int().min(1).max(10).default(5) }, async ({ playerOutId, playerInId, gameweeksAhead }) => {
    try { const app = await core(env); const out = app.bootstrap.elements.find((player) => player.id === playerOutId); const incoming = app.bootstrap.elements.find((player) => player.id === playerInId); if (!out || !incoming) throw new Error("Both FPL player IDs must exist."); const projection = (player: Player) => captainScore(player, app.fixtures, app.next) * gameweeksAhead / 2.5; const gain = projection(incoming) - projection(out) - 4; return { content: [{ type: "text", text: gain > 0 ? "The heuristic projects the hit to repay its -4." : "The heuristic does not project the hit to repay its -4." }], structuredContent: { playerOut: playerView(out, app.bootstrap, app.fixtures, app.next), playerIn: playerView(incoming, app.bootstrap, app.fixtures, app.next), gameweeksAhead, projectedNetGainAfterHit: Number(gain.toFixed(2)), verdict: gain > 0 ? "worth_considering" : "not_projected_to_pay_back", disclaimer: "This is a transparent heuristic, not a calibrated expected-points model." } }; } catch (error) { return errorResult(error); }
  });
  server.tool("chip_strategy", "Suggest gameweeks for remaining FPL chips based on doubles, blanks, fixture density, and squad fixtures.", { teamId: TEAM_ID }, async ({ teamId }) => {
    try { const context = await teamContext(env, teamId); const chips = (context.history.chips as Json[] || []).map((chip) => text(chip.name)); const all = ["wildcard", "bboost", "freehit", "3xc"]; const remaining = all.filter((chip) => !chips.includes(chip)); const opportunities = Array.from({ length: 10 }, (_, index) => context.next + index).filter((gameweek) => gameweek <= 38).map((gameweek) => ({ gameweek, fixtures: context.fixtures.filter((fixture) => fixture.event === gameweek).length, doubleGameweek: context.fixtures.filter((fixture) => fixture.event === gameweek).length > 10 })); return { content: [{ type: "text", text: `Chip strategy for team ${teamId}; ${remaining.length} unrecorded chip types remain.` }], structuredContent: { teamId, currentGameweek: context.current, remainingChips: remaining, opportunities, guidance: { tripleCaptain: "Prioritize a confirmed double gameweek with a reliable premium starter.", benchBoost: "Prioritize a confirmed double when all 15 players are likely to start.", freehit: "Reserve for a blank or highly asymmetric gameweek.", wildcard: "Use around a major fixture swing or when your squad needs several changes." } } }; } catch (error) { return errorResult(error); }
  });
  server.tool("squad_scout", "Deep-scout an FPL manager's public squad for availability, rotation risk, set pieces, expected points, and suspension risk.", { teamId: TEAM_ID }, async ({ teamId }) => {
    try { const context = await teamContext(env, teamId); const ids = new Set((context.picks.picks as Json[] || []).map((pick) => number(pick.element))); const squad = context.bootstrap.elements.filter((player) => ids.has(player.id)).map((player) => ({ ...playerView(player, context.bootstrap, context.fixtures, context.next), setPieceNotes: { penaltiesOrder: number(player.penalties_order) || null, cornersAndIndirectOrder: number(player.corners_and_indirect_freekicks_order) || null, directFreeKicksOrder: number(player.direct_freekicks_order) || null }, expectedPointsNext: number(player.ep_next), yellowCards: number(player.yellow_cards), news: text(player.news) })).sort((a, b) => b.expectedPointsNext - a.expectedPointsNext); return { content: [{ type: "text", text: `Deep squad scout for team ${teamId}.` }], structuredContent: { teamId, gameweek: context.next, squad, alerts: squad.filter((player) => player.status !== "a" || (player.chanceOfPlayingNextRound !== null && number(player.chanceOfPlayingNextRound) < 100)) } }; } catch (error) { return errorResult(error); }
  });
  server.tool("rival_tracker", "Compare a manager against the first page of a public classic mini-league. No private data or wallet identity is used.", { leagueId: LEAGUE_ID, teamId: TEAM_ID }, async ({ leagueId, teamId }) => {
    try { const [league, manager] = await Promise.all([fpl<Json>(env, `/leagues-classic/${leagueId}/standings/`, 120), fpl<Json>(env, `/entry/${teamId}/`, 120)]); const rows = ((league.standings as Json | undefined)?.results as Json[] || []).map((row) => ({ rank: number(row.rank), entryId: number(row.entry), entryName: text(row.entry_name), managerName: text(row.player_name), total: number(row.total) })); const mine = rows.find((row) => row.entryId === teamId); return { content: [{ type: "text", text: `League ${leagueId}: ${text((league.league as Json | undefined)?.name)}.` }], structuredContent: { leagueId, leagueName: text((league.league as Json | undefined)?.name), manager: { teamId, teamName: text(manager.name), standing: mine ?? null }, rivals: rows.filter((row) => row.entryId !== teamId).slice(0, 20), disclaimer: "Public standings alone cannot reliably predict rivals' transfers." } }; } catch (error) { return errorResult(error); }
  });
  server.tool("league_analyzer", "Summarize public classic-league standings and simple points-gap context; it does not claim calibrated win probabilities.", { leagueId: LEAGUE_ID, limit: z.coerce.number().int().min(2).max(50).default(20) }, async ({ leagueId, limit }) => {
    try { const league = await fpl<Json>(env, `/leagues-classic/${leagueId}/standings/`, 120); const rows = ((league.standings as Json | undefined)?.results as Json[] || []).slice(0, limit).map((row) => ({ rank: number(row.rank), entryId: number(row.entry), entryName: text(row.entry_name), managerName: text(row.player_name), total: number(row.total), eventTotal: number(row.event_total) })); const leader = rows[0]?.total || 0; return { content: [{ type: "text", text: `Public standings analysis for ${text((league.league as Json | undefined)?.name)}.` }], structuredContent: { leagueId, leagueName: text((league.league as Json | undefined)?.name), standings: rows.map((row) => ({ ...row, pointsBehindLeader: leader - row.total })), disclaimer: "This describes standings and gaps; a true win probability needs historical calibration and remaining-fixture simulation." } }; } catch (error) { return errorResult(error); }
  });
  server.tool("fpl_manager_hub", "Run a combined public FPL team report: captain, transfer, differential, fixture, price-risk, and squad-health signals.", { teamId: TEAM_ID, gameweeksAhead: z.coerce.number().int().min(1).max(10).default(5) }, async ({ teamId, gameweeksAhead }) => {
    try { const context = await teamContext(env, teamId); const ids = new Set((context.picks.picks as Json[] || []).map((pick) => number(pick.element))); const squad = context.bootstrap.elements.filter((player) => ids.has(player.id)); const captains = captainPicks(context.bootstrap, context.fixtures, context.next); const poorForm = squad.filter((player) => number(player.form) <= 2 && number(player.minutes) > 180).map((player) => player.web_name); const unavailable = squad.filter((player) => text(player.status || "a") !== "a").map((player) => ({ name: player.web_name, status: text(player.status), news: text(player.news) })); const priceRisks = squad.map((player) => ({ name: player.web_name, netTransfers: number(player.transfers_in_event) - number(player.transfers_out_event) })).filter((player) => player.netTransfers < -50_000).sort((a, b) => a.netTransfers - b.netTransfers); return { content: [{ type: "text", text: `FPL manager hub report for team ${teamId}.` }], structuredContent: { teamId, teamName: text(context.profile.name), currentGameweek: context.current, nextGameweek: context.next, gameweeksAhead, captainRecommendation: captains, transferSuggestions: transferSuggestions(context, 5), squadHealth: { unavailable, poorForm }, priceDropRisks: priceRisks, fixtureOutlook: "Use fixture_outlook for a full league-wide fixture table.", disclaimer: "All advice is derived from public FPL data and simple, inspectable heuristics." } }; } catch (error) { return errorResult(error); }
  });
  return server;
}

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : "";
}
function cors(request: Request, env: Env): Headers {
  const origin = allowedOrigin(request, env);
  const headers = new Headers({ "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, X-FPL-Access-Token, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name", Vary: "Origin" });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}
function withCors(response: Response, request: Request, env: Env): Response { const headers = new Headers(response.headers); cors(request, env).forEach((value, key) => headers.set(key, value)); return new Response(response.body, { status: response.status, statusText: response.statusText, headers }); }

async function accessGuard(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== "POST") return null;
  const contentLength = number(request.headers.get("content-length"));
  if (contentLength > 64_000) return Response.json({ error: "MCP request body is too large." }, { status: 413 });
  let payload: { method?: unknown; params?: { name?: unknown } };
  try { payload = await request.clone().json() as { method?: unknown; params?: { name?: unknown } }; } catch { return Response.json({ error: "MCP request must contain valid JSON." }, { status: 400 }); }
  if (payload.method !== "tools/call") return null;
  const toolName = typeof payload.params?.name === "string" ? payload.params.name : "";
  if (FREE_ACCESS_TOOLS.has(toolName)) return null;
  const authorization = request.headers.get("authorization") || request.headers.get("x-fpl-access-token") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : authorization.trim();
  if (!token) return Response.json({ error: "NFT access required. Call fpl_access_challenge, sign the returned message, call fpl_verify_access, then send Authorization: Bearer <accessToken>." }, { status: 401 });
  try { await verifyAccessToken(env, token); return null; } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "NFT access verification failed." }, { status: 403 }); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);
    if (request.headers.has("Origin") && !origin) return Response.json({ error: "Origin is not allowed." }, { status: 403 });
    if (url.pathname === "/health") return withCors(Response.json({ ok: true, service: "fpl-intelligence-mcp", payment: "disabled", eligibility: "not_configured" }), request, env);
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(request, env) });
    const denied = await accessGuard(request, env);
    if (denied) return withCors(denied, request, env);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createServer(env);
    await server.connect(transport);
    return withCors(await transport.handleRequest(request), request, env);
  },
};
