import { App } from "@modelcontextprotocol/ext-apps";
import "./styles.css";

type Manager = { rank: number | null; entry: number; entryName: string; playerName: string; total: number };
type Standings = {
  projectRoute: string;
  projectName: string;
  leagueId: number;
  leagueName: string;
  source: string;
  managers: Manager[];
  hasMore: boolean;
};
type PurchasePlan = { entryId: number; entryName: string; memo: string; checkoutUrl: string; warning: string };
type AppLaunch = { inputRequired?: boolean; projectRoute?: string };

const app = new App({ name: "FPL League Shop", version: "0.2.0" });
const standingsEl = document.querySelector<HTMLTableSectionElement>("#standings")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const leagueNameEl = document.querySelector<HTMLElement>("#league-name")!;
const leagueMetaEl = document.querySelector<HTMLElement>("#league-meta")!;
const projectRouteInput = document.querySelector<HTMLInputElement>("#project-route")!;
const reloadButton = document.querySelector<HTMLButtonElement>("#reload")!;
const purchaseEl = document.querySelector<HTMLElement>("#purchase")!;
const selectedManagerEl = document.querySelector<HTMLElement>("#selected-manager")!;
const memoEl = document.querySelector<HTMLElement>("#memo")!;
const checkoutEl = document.querySelector<HTMLAnchorElement>("#checkout")!;
let currentStandings: Standings | null = null;

function inputProjectRoute(): string | null {
  const value = projectRouteInput.value.trim();
  return /^(base|basesep):[1-9]\d*$/.test(value) ? value : null;
}

function showStatus(message: string, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function renderStandings(data: Standings) {
  currentStandings = data;
  projectRouteInput.value = data.projectRoute;
  leagueNameEl.textContent = data.leagueName;
  leagueMetaEl.textContent = `${data.projectRoute} · FPL league ${data.leagueId} from ${data.source}`;
  standingsEl.replaceChildren();
  for (const manager of data.managers) {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${manager.rank ?? "—"}</td><td></td><td></td><td class="points">${manager.total}</td><td></td>`;
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
  const projectRoute = inputProjectRoute();
  if (!projectRoute) return showStatus("Enter a Juicebox project route such as base:9.", true);
  reloadButton.disabled = true;
  showStatus("Resolving project metadata and loading standings...");
  try {
    const result = await app.callServerTool({ name: "fpl_standings", arguments: { projectRoute, limit: 100 } });
    const data = result.structuredContent as Standings | undefined;
    if (!data?.projectRoute) throw new Error("The server returned no project context.");
    renderStandings(data);
    showStatus(data.managers.length ? (data.hasMore ? "Showing the first 100 managers." : "Standings are current.") : "No published manager standings are available for this league yet.");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Could not resolve the project.", true);
  } finally {
    reloadButton.disabled = false;
  }
}

async function preparePurchase(manager: Manager) {
  const projectRoute = currentStandings?.projectRoute ?? inputProjectRoute();
  if (!projectRoute) return;
  showStatus(`Preparing ${manager.entryName}...`);
  try {
    const result = await app.callServerTool({ name: "fpl_prepare_buy", arguments: { projectRoute, entryId: manager.entry } });
    const plan = result.structuredContent as PurchasePlan | undefined;
    if (!plan?.memo) throw new Error("The server returned no purchase plan.");
    selectedManagerEl.textContent = `${plan.entryName} (entry ${plan.entryId})`;
    memoEl.textContent = plan.memo;
    purchaseEl.hidden = false;
    checkoutEl.href = plan.checkoutUrl;
    showStatus(plan.warning);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Could not prepare the purchase.", true);
  }
}

app.ontoolresult = (result) => {
  const data = result.structuredContent as Standings | AppLaunch | undefined;
  if (data && "inputRequired" in data && data.inputRequired) {
    showStatus("Enter a Juicebox project route such as base:9.");
    return;
  }
  if (data?.projectRoute) {
    const standings = data as Standings;
    renderStandings(standings);
    showStatus(standings.managers.length ? (standings.hasMore ? "Showing the first 100 managers." : "Standings are current.") : "No published manager standings are available for this league yet.");
  }
};
reloadButton.addEventListener("click", loadStandings);
projectRouteInput.addEventListener("change", loadStandings);
app.connect();
