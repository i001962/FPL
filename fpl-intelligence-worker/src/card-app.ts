import { App } from "@modelcontextprotocol/ext-apps";
import "./card-styles.css";

// Cloudflare's Worker types also declare an HTMLRewriter `Element`; restore the
// browser DOM append overload for this client-side bundle.
declare global {
  interface Element {
    append(...nodes: (Node | string)[]): void;
  }
}

type JsonRecord = Record<string, unknown>;
type CardPayload = { cardKind?: string; sourceTool?: string; data?: JsonRecord };

const root = document.querySelector<HTMLElement>("#app")!;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item) => Object.keys(item).length > 0) : [];
}

function str(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initials(value: string): string {
  const parts = value.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] || ""}` : value.slice(0, 2)).toUpperCase();
}

function safePortraitUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "resources.premierleague.com" ? url.toString() : null;
  } catch {
    return null;
  }
}

function portrait(name: string, imageUrl: unknown): HTMLElement {
  const frame = element("div", "portrait-frame");
  const fallback = element("div", "portrait-fallback", initials(name));
  frame.append(fallback);
  const safeUrl = safePortraitUrl(imageUrl);
  if (safeUrl) {
    const image = element("img", "player-photo");
    image.src = safeUrl;
    image.alt = `${name} player portrait`;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.remove());
    frame.append(image);
  }
  return frame;
}

function metric(label: string, value: string, tone?: string): HTMLElement {
  const item = element("div", `metric${tone ? ` metric-${tone}` : ""}`);
  item.append(element("span", "metric-value", value), element("span", "metric-label", label));
  return item;
}

function formatDecimal(value: unknown, digits = 1): string {
  return num(value).toFixed(digits).replace(/\.0$/, "");
}

function formatPrice(value: unknown): string {
  return value === undefined || value === null ? "—" : `£${formatDecimal(value)}m`;
}

function playerMetrics(player: JsonRecord): Array<[string, string, string?]> {
  const candidates: Array<[string, unknown, (value: unknown) => string, string?]> = [
    ["Card score", player.score ?? player.captainScore, (value) => formatDecimal(value, 2), "accent"],
    ["Live pts", player.points, (value) => String(num(value)), "accent"],
    ["Price", player.price, formatPrice],
    ["Form", player.form, (value) => formatDecimal(value)],
    ["Pts / match", player.pointsPerGame, (value) => formatDecimal(value)],
    ["Ownership", player.selectedByPercent, (value) => `${formatDecimal(value)}%`],
    ["xG / 90", player.expectedGoalsPer90, (value) => formatDecimal(value, 2)],
    ["xA / 90", player.expectedAssistsPer90, (value) => formatDecimal(value, 2)],
    ["Next xPts", player.expectedPointsNext, (value) => formatDecimal(value)],
    ["Minutes", player.minutes, (value) => String(num(value))],
    ["Bonus", player.bonus, (value) => String(num(value))],
  ];
  return candidates.filter(([, value]) => value !== undefined && value !== null).slice(0, 4).map(([label, value, formatter, tone]) => [label, formatter(value), tone]);
}

function fixtureStrip(player: JsonRecord): HTMLElement | null {
  const fixtures = records(player.nextFixtures);
  const strip = element("div", "fixture-strip");
  if (fixtures.length) {
    for (const fixture of fixtures.slice(0, 5)) {
      const difficulty = Math.max(1, Math.min(5, num(fixture.difficulty, 3)));
      const chip = element("span", `fixture-chip difficulty-${difficulty}`);
      chip.append(element("b", "", str(fixture.opponent)), document.createTextNode(fixture.home === true ? " H" : " A"));
      strip.append(chip);
    }
    return strip;
  }
  if (typeof player.fixture === "string") {
    strip.append(element("span", `fixture-chip difficulty-${Math.max(1, Math.min(5, num(player.fixtureDifficulty, 3)))}`, player.fixture));
    return strip;
  }
  return null;
}

function playerCard(playerValue: unknown, rank?: number, compact = false): HTMLElement {
  const player = record(playerValue);
  const name = str(player.name, "Unknown player");
  const card = element("article", `player-card${compact ? " compact" : ""}${rank === 1 ? " card-featured" : ""}`);
  const foil = element("div", "foil", "FPL INTELLIGENCE");
  if (rank !== undefined) foil.append(element("span", "rank-badge", `#${rank}`));
  const visual = element("div", "card-visual");
  visual.append(portrait(name, player.imageUrl));
  const identity = element("div", "player-identity");
  identity.append(element("span", "player-meta", `${str(player.team, "FPL")} · ${str(player.position, player.starter === false ? "BENCH" : "XI")}`));
  identity.append(element("h3", "player-name", name));
  if (player.captain === true) identity.append(element("span", "captain-ribbon", "CAPTAIN ×2"));
  else if (player.viceCaptain === true) identity.append(element("span", "vice-ribbon", "VICE CAPTAIN"));
  visual.append(identity);
  card.append(foil, visual);

  const metrics = playerMetrics(player);
  if (metrics.length) {
    const grid = element("div", "metric-grid");
    for (const [label, value, tone] of metrics) grid.append(metric(label, value, tone));
    card.append(grid);
  }
  const fixtures = fixtureStrip(player);
  if (fixtures) card.append(fixtures);
  if (player.autoSub === true) card.append(element("div", "card-note", "Autosub active"));
  if (str(player.status, "a") !== "a") card.append(element("div", "card-note warning", str(player.news, "Availability alert")));
  return card;
}

function heading(eyebrow: string, title: string, subtitle: string): HTMLElement {
  const header = element("header", "app-header");
  const copy = element("div");
  copy.append(element("p", "eyebrow", eyebrow), element("h1", "app-title", title), element("p", "app-subtitle", subtitle));
  header.append(copy, element("span", "season-stamp", "26/27"));
  return header;
}

function disclaimer(textValue: unknown): HTMLElement | null {
  return typeof textValue === "string" && textValue ? element("p", "disclaimer", textValue) : null;
}

function emptyState(message: string): HTMLElement {
  return element("div", "empty-state", message);
}

function collection(players: JsonRecord[], compact = false): HTMLElement {
  const rail = element("div", "card-rail");
  players.forEach((player, index) => rail.append(playerCard(player, index + 1, compact)));
  return rail;
}

function transferPair(suggestionValue: unknown, index: number): HTMLElement {
  const suggestion = record(suggestionValue);
  const pair = element("section", "transfer-pair");
  pair.append(element("div", "pair-label", `MOVE ${String(index + 1).padStart(2, "0")}`));
  const cards = element("div", "pair-cards");
  const outWrap = element("div", "pair-card-wrap");
  outWrap.append(element("span", "move-tag move-out", "OUT"), playerCard(suggestion.out, undefined, true));
  const arrow = element("div", "transfer-arrow", "→");
  const inWrap = element("div", "pair-card-wrap");
  inWrap.append(element("span", "move-tag move-in", "IN"), playerCard(suggestion.in, undefined, true));
  cards.append(outWrap, arrow, inWrap);
  pair.append(cards);
  if (typeof suggestion.rationale === "string") pair.append(element("p", "pair-rationale", suggestion.rationale));
  return pair;
}

function renderPlayerDecision(payload: CardPayload): HTMLElement {
  const data = record(payload.data);
  const source = str(payload.sourceTool, "player_comparison");
  const titles: Record<string, string> = {
    captain_pick: "Captain contenders",
    player_comparison: "Player head-to-head",
    differential_finder: "Differential collection",
    transfer_suggestions: "Transfer matchups",
    is_hit_worth_it: "The −4 decision",
  };
  const page = element("section", "card-app-shell");
  page.append(heading("PLAYER DECISION SERIES", titles[source] || "Player cards", `GW${num(data.gameweek, num(data.currentGameweek, 0)) || "—"} · live FPL data`));

  if (source === "transfer_suggestions") {
    const list = records(data.suggestions);
    const stack = element("div", "pair-stack");
    list.forEach((suggestion, index) => stack.append(transferPair(suggestion, index)));
    page.append(list.length ? stack : emptyState("No transfer suggestions were returned."));
  } else if (source === "is_hit_worth_it") {
    const verdict = str(data.verdict).replaceAll("_", " ");
    const verdictBox = element("div", `verdict ${data.verdict === "worth_considering" ? "positive" : "caution"}`);
    verdictBox.append(element("span", "verdict-kicker", "NET AFTER HIT"), element("strong", "verdict-score", `${num(data.projectedNetGainAfterHit) > 0 ? "+" : ""}${formatDecimal(data.projectedNetGainAfterHit, 2)}`), element("span", "verdict-copy", verdict));
    const pair = element("div", "hit-pair");
    pair.append(playerCard(data.playerOut, undefined, true), element("div", "transfer-arrow", "→"), playerCard(data.playerIn, undefined, true));
    page.append(verdictBox, pair);
  } else {
    const players = records(source === "captain_pick" ? data.picks : source === "differential_finder" ? data.differentials : data.players);
    page.append(players.length ? collection(players) : emptyState("No player cards were returned."));
  }
  const note = disclaimer(data.disclaimer);
  if (note) page.append(note);
  return page;
}

function managerHero(data: JsonRecord, subtitle: string): HTMLElement {
  const teamName = str(data.teamName, `Team ${num(data.teamId) || "—"}`);
  const hero = element("article", "manager-hero");
  hero.append(element("div", "manager-foil", "MANAGER EDITION"));
  const avatar = element("div", "manager-avatar");
  avatar.append(element("span", "manager-initials", initials(teamName)), element("span", "manager-crown", "♛"));
  const copy = element("div", "manager-copy");
  copy.append(element("span", "player-meta", subtitle), element("h2", "manager-name", teamName), element("p", "manager-id", `FPL entry #${num(data.teamId) || "—"}`));
  hero.append(avatar, copy);
  return hero;
}

function panel(title: string, content: HTMLElement, tone = ""): HTMLElement {
  const section = element("section", `data-panel${tone ? ` ${tone}` : ""}`);
  section.append(element("h2", "panel-title", title), content);
  return section;
}

function textList(values: unknown[], emptyText: string): HTMLElement {
  const list = element("ul", "signal-list");
  if (!values.length) list.append(element("li", "signal-good", emptyText));
  for (const value of values) {
    const item = record(value);
    list.append(element("li", "", typeof value === "string" ? value : `${str(item.name)}${item.news ? ` — ${str(item.news)}` : ""}`));
  }
  return list;
}

function renderManager(payload: CardPayload): HTMLElement {
  const data = record(payload.data);
  const source = str(payload.sourceTool, "fpl_manager_hub");
  const titles: Record<string, string> = {
    fpl_manager_hub: "Manager gameweek dossier",
    squad_scout: "Squad card collection",
    chip_strategy: "Chip strategy deck",
    price_predictions: "Market movers",
  };
  const page = element("section", "card-app-shell");
  const gameweek = num(data.nextGameweek, num(data.gameweek, num(data.currentGameweek)));
  page.append(heading("MANAGER EDITION", titles[source] || "Manager card", `Team intelligence · GW${gameweek || "—"}`));

  if (source !== "price_predictions") page.append(managerHero(data, gameweek ? `GAMEWEEK ${gameweek}` : "FPL MANAGER"));

  if (source === "fpl_manager_hub") {
    const grid = element("div", "manager-grid");
    const captains = records(data.captainRecommendation);
    grid.append(panel("Captain board", captains.length ? collection(captains.slice(0, 3), true) : emptyState("No captain recommendation."), "wide"));
    const transferStack = element("div", "mini-transfer-stack");
    records(data.transferSuggestions).slice(0, 3).forEach((suggestion, index) => transferStack.append(transferPair(suggestion, index)));
    grid.append(panel("Priority moves", transferStack.children.length ? transferStack : emptyState("No transfer signals."), "wide"));
    const health = record(data.squadHealth);
    grid.append(panel("Squad alerts", textList([...records(health.unavailable), ...(Array.isArray(health.poorForm) ? health.poorForm : [])], "All clear"), "alert-panel"));
    const priceItems = records(data.priceDropRisks).map((risk) => `${str(risk.name)} · ${num(risk.netTransfers).toLocaleString()} net transfers`);
    grid.append(panel("Price watch", textList(priceItems, "No major drop risk")));
    page.append(grid);
  } else if (source === "squad_scout") {
    const squad = records(data.squad);
    page.append(squad.length ? collection(squad) : emptyState("No squad cards were returned."));
    const alerts = records(data.alerts);
    page.append(panel("Medical & availability report", textList(alerts, "No active availability alerts"), "alert-panel"));
  } else if (source === "chip_strategy") {
    const chips = Array.isArray(data.remainingChips) ? data.remainingChips.map((chip) => str(chip)) : [];
    const deck = element("div", "chip-deck");
    for (const chip of chips) deck.append(element("article", "chip-card", chip.replaceAll("_", " ").toUpperCase()));
    page.append(panel("Chips in hand", deck.children.length ? deck : emptyState("No remaining chip types recorded.")));
    const timeline = element("div", "gw-timeline");
    for (const opportunity of records(data.opportunities)) {
      const item = element("div", `gw-node${opportunity.doubleGameweek === true ? " double" : ""}`);
      item.append(element("strong", "", `GW${num(opportunity.gameweek)}`), element("span", "", opportunity.doubleGameweek === true ? "DOUBLE" : `${num(opportunity.fixtures)} fixtures`));
      timeline.append(item);
    }
    page.append(panel("Ten-week window", timeline));
  } else if (source === "price_predictions") {
    const risers = records(data.likelyRisers).slice(0, 8);
    const fallers = records(data.likelyFallers).slice(0, 8);
    page.append(panel("Risers", risers.length ? collection(risers, true) : emptyState("No risers returned."), "market-up"));
    page.append(panel("Fallers", fallers.length ? collection(fallers, true) : emptyState("No fallers returned."), "market-down"));
  }
  const note = disclaimer(data.disclaimer);
  if (note) page.append(note);
  return page;
}

function managerStandingCard(rowValue: unknown, highlighted = false): HTMLElement {
  const row = record(rowValue);
  const managerName = str(row.managerName, str(row.entryName, "Unknown manager"));
  const card = element("article", `standing-card${highlighted ? " highlighted" : ""}`);
  const rank = num(row.rank);
  card.append(element("div", "standing-rank", rank ? `#${rank}` : "—"));
  const avatar = element("div", "standing-avatar", initials(managerName));
  const copy = element("div", "standing-copy");
  copy.append(element("strong", "", managerName), element("span", "", str(row.entryName, `Entry ${num(row.entryId)}`)));
  const score = element("div", "standing-score");
  score.append(element("strong", "", String(num(row.total))), element("span", "", row.eventTotal !== undefined ? `GW ${num(row.eventTotal)}` : row.pointsBehindLeader !== undefined ? `${num(row.pointsBehindLeader)} back` : "points"));
  card.append(avatar, copy, score);
  return card;
}

function renderLiveLeague(payload: CardPayload): HTMLElement {
  const data = record(payload.data);
  const source = str(payload.sourceTool, "league_analyzer");
  const page = element("section", "card-app-shell");
  const title = source === "live_points" ? "Live gameweek collection" : source === "rival_tracker" ? "Rival watch" : str(data.leagueName, "League standings");
  page.append(heading("LIVE LEAGUE SERIES", title, source === "live_points" ? `Team ${num(data.teamId)} · GW${num(data.gameweek)}` : str(data.leagueName, `League ${num(data.leagueId)}`)));

  if (source === "live_points") {
    const players = records(data.players);
    const total = players.reduce((sum, player) => sum + num(player.points), 0);
    page.append(managerHero({ teamId: data.teamId, teamName: `Live total · ${total} pts` }, `GW${num(data.gameweek)} SCORECARD`));
    page.append(players.length ? collection(players) : emptyState("No live player cards were returned."));
  } else {
    const board = element("div", "standings-board");
    if (source === "rival_tracker") {
      const manager = record(data.manager);
      const mine = record(manager.standing);
      if (Object.keys(mine).length) board.append(managerStandingCard(mine, true));
      records(data.rivals).forEach((row) => board.append(managerStandingCard(row)));
    } else {
      records(data.standings).forEach((row) => board.append(managerStandingCard(row)));
    }
    page.append(board.children.length ? board : emptyState("No manager standings were returned."));
  }
  const note = disclaimer(data.disclaimer);
  if (note) page.append(note);
  return page;
}

function render(payloadValue: unknown): void {
  const payload = record(payloadValue) as CardPayload;
  root.replaceChildren();
  if (payload.cardKind === "manager_gameweek") root.append(renderManager(payload));
  else if (payload.cardKind === "live_league") root.append(renderLiveLeague(payload));
  else root.append(renderPlayerDecision(payload));
}

const previewMode = new URLSearchParams(window.location.search).get("preview");
if (previewMode) {
  const imageUrl = "https://resources.premierleague.com/premierleague/photos/players/250x250/p154561.png";
  const samplePlayer = { name: "Raya", imageUrl, team: "ARS", position: "GKP", price: 5.5, form: 6.4, pointsPerGame: 5.8, selectedByPercent: 28.4, nextFixtures: [{ opponent: "LEE", home: true, difficulty: 2 }, { opponent: "LIV", home: false, difficulty: 5 }, { opponent: "NFO", home: true, difficulty: 2 }] };
  if (previewMode === "manager") render({ cardKind: "manager_gameweek", sourceTool: "fpl_manager_hub", data: { teamId: 1962, teamName: "North Bank Analytics", currentGameweek: 2, nextGameweek: 3, captainRecommendation: [{ ...samplePlayer, name: "Saka", position: "MID", score: 19.42 }, { ...samplePlayer, name: "Haaland", team: "MCI", position: "FWD", score: 18.77 }], transferSuggestions: [{ out: { ...samplePlayer, name: "Sample Out" }, in: { ...samplePlayer, name: "Sample In", form: 8.1 }, rationale: "Stronger form and next fixture." }], squadHealth: { unavailable: [], poorForm: ["Sample Player"] }, priceDropRisks: [{ name: "Sample Player", netTransfers: -72000 }], disclaimer: "Preview data." } });
  else if (previewMode === "league") render({ cardKind: "live_league", sourceTool: "league_analyzer", data: { leagueId: 1962, leagueName: "Codex Invitational", standings: Array.from({ length: 8 }, (_, index) => ({ rank: index + 1, entryId: index + 10, entryName: `Squad ${index + 1}`, managerName: ["Ada Lovelace", "Grace Hopper", "Alan Turing", "Katherine Johnson", "Margaret Hamilton", "Edsger Dijkstra", "Barbara Liskov", "Donald Knuth"][index], total: 145 - index * 6, eventTotal: 62 - index, pointsBehindLeader: index * 6 })) } });
  else render({ cardKind: "player_decision", sourceTool: "player_comparison", data: { gameweek: 3, players: [{ ...samplePlayer, captainScore: 18.2 }, { ...samplePlayer, name: "Saka", team: "ARS", position: "MID", price: 10.0, form: 7.2, captainScore: 19.4 }, { ...samplePlayer, name: "Haaland", team: "MCI", position: "FWD", price: 14.0, form: 8.3, captainScore: 20.1 }] } });
} else {
  const app = new App({ name: "FPL Intelligence Cards", version: "1.0.0" });
  app.ontoolresult = (result) => render(result.structuredContent);
  void app.connect().catch(() => {
    root.replaceChildren(emptyState("The card host did not provide a tool result."));
  });
}
