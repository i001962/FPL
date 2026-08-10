import { App } from "@modelcontextprotocol/ext-apps";
import "./styles.css";

type Manager = { rank: number; entry: number; entryName: string; playerName: string; total: number };
type Standings = { leagueId: number; leagueName: string; managers: Manager[]; hasMore: boolean; projectRoute?: string | null };
type PurchasePlan = { entryId: number; entryName: string; memo: string; checkoutUrl: string | null; warning: string };

const app = new App({ name: "FPL League Shop", version: "0.1.0" });
const standingsEl = document.querySelector<HTMLTableSectionElement>("#standings")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const leagueNameEl = document.querySelector<HTMLElement>("#league-name")!;
const leagueMetaEl = document.querySelector<HTMLElement>("#league-meta")!;
const leagueIdInput = document.querySelector<HTMLInputElement>("#league-id")!;
const projectRouteInput = document.querySelector<HTMLInputElement>("#project-route")!;
const reloadButton = document.querySelector<HTMLButtonElement>("#reload")!;
const purchaseEl = document.querySelector<HTMLElement>("#purchase")!;
const selectedManagerEl = document.querySelector<HTMLElement>("#selected-manager")!;
const memoEl = document.querySelector<HTMLElement>("#memo")!;
const checkoutEl = document.querySelector<HTMLAnchorElement>("#checkout")!;
let currentStandings: Standings | null = null;

function inputLeagueId(): number | null {
  const value = Number(leagueIdInput.value);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function showStatus(message: string, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function renderStandings(data: Standings) {
  currentStandings = data;
  leagueIdInput.value = String(data.leagueId);
  if (data.projectRoute) projectRouteInput.value = data.projectRoute;
  leagueNameEl.textContent = data.leagueName;
  leagueMetaEl.textContent = `League ${data.leagueId} · ${data.managers.length} managers${data.hasMore ? " shown" : ""}`;
  standingsEl.replaceChildren();
  for (const manager of data.managers) {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${manager.rank}</td><td></td><td></td><td class="points">${manager.total}</td><td></td>`;
    row.children[1].textContent = manager.playerName;
    row.children[2].textContent = manager.entryName;
    const action = document.createElement("button");
    action.type = "button";
    action.className = "select";
    action.textContent = "Buy";
    action.title = `Prepare a purchase for ${manager.entryName}`;
    action.addEventListener("click", () => preparePurchase(manager));
    row.children[4].appendChild(action);
    standingsEl.appendChild(row);
  }
}

async function loadStandings() {
  const leagueId = inputLeagueId();
  if (!leagueId) return showStatus("Enter a positive FPL league ID.", true);
  reloadButton.disabled = true;
  showStatus("Loading standings...");
  try {
    const result = await app.callServerTool({ name: "fpl_standings", arguments: { leagueId, limit: 100 } });
    const data = result.structuredContent as Standings | undefined;
    if (!data?.managers) throw new Error("The server returned no standings.");
    renderStandings(data);
    showStatus(data.hasMore ? "Showing the first 100 managers." : "Standings are current.");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Could not load standings.", true);
  } finally {
    reloadButton.disabled = false;
  }
}

async function preparePurchase(manager: Manager) {
  const leagueId = currentStandings?.leagueId ?? inputLeagueId();
  if (!leagueId) return;
  showStatus(`Preparing ${manager.entryName}...`);
  try {
    const result = await app.callServerTool({
      name: "fpl_prepare_buy",
      arguments: { leagueId, entryId: manager.entry, projectRoute: projectRouteInput.value.trim() || undefined },
    });
    const plan = result.structuredContent as PurchasePlan | undefined;
    if (!plan?.memo) throw new Error("The server returned no purchase plan.");
    selectedManagerEl.textContent = `${plan.entryName} (entry ${plan.entryId})`;
    memoEl.textContent = plan.memo;
    purchaseEl.hidden = false;
    checkoutEl.href = plan.checkoutUrl ?? "#";
    checkoutEl.classList.toggle("disabled", !plan.checkoutUrl);
    checkoutEl.setAttribute("aria-disabled", String(!plan.checkoutUrl));
    showStatus(plan.warning, !plan.checkoutUrl);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Could not prepare the purchase.", true);
  }
}

app.ontoolresult = (result) => {
  const data = result.structuredContent as Standings | undefined;
  if (data?.managers) {
    renderStandings(data);
    showStatus(data.hasMore ? "Showing the first 100 managers." : "Standings are current.");
  }
};
reloadButton.addEventListener("click", loadStandings);
leagueIdInput.addEventListener("change", loadStandings);
app.connect();
