export default {
  async fetch(request, _env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/shops") {
      return discoverShops(request, ctx);
    }
    const path = url.pathname === "/" ? "/index.html" : url.pathname;

    const upstream = new URL(
      `https://qstorage.quilibrium.com/footy/static-shop-template${path}`,
    );
    upstream.search = url.search;

    return fetch(new Request(upstream, request));
  },
};

const BENDYSTRAW_ENDPOINTS = [
  "https://bendystraw.xyz/graphql",
  "https://testnet.bendystraw.xyz/graphql",
];

const PROJECT_FIELDS = `
  projectId chainId name description projectTagline logoUri metadataUri tags
  paymentsCount contributorsCount createdAt metadata
`;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}

function routeForProject(project) {
  const chain = Number(project.chainId) === 8453 ? "base" : Number(project.chainId) === 84532 ? "basesep" : "";
  return chain && project.projectId ? `#${chain}:${project.projectId}` : "";
}

function matchesLeague(project, leagueId) {
  return fplLeagueId(project) === leagueId;
}

function fplLeagueId(project) {
  const metadata = project?.metadata && typeof project.metadata === "object" ? project.metadata : {};
  const leagueId = String(metadata?.fpl?.leagueId || metadata?.leagueId || "").trim();
  return /^\d{3,9}$/.test(leagueId) ? leagueId : "";
}

function shopForProject(project) {
  const route = routeForProject(project);
  const leagueId = fplLeagueId(project);
  return route && leagueId ? { ...project, leagueId, route } : null;
}

async function queryBendystraw(endpoint, leagueId) {
  const query = `query FindFplShops($leagueTag: String!, $legacyText: String!) {
    tagged: projects(where: { version: 6, tags_has: $leagueTag }, limit: 50) {
      items { ${PROJECT_FIELDS} }
    }
    legacy: projects(where: { version: 6, description_contains_nocase: $legacyText }, limit: 100) {
      items { ${PROJECT_FIELDS} }
    }
  }`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query,
      variables: { leagueTag: `fpl-league:${leagueId}`, legacyText: "Fantasy Premier League" },
    }),
  });
  if (!response.ok) throw new Error(`Bendystraw returned ${response.status}`);
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join("; "));
  return [...(body.data?.tagged?.items || []), ...(body.data?.legacy?.items || [])];
}

async function queryAllFplProjects(endpoint) {
  const query = `query ListFplShops($fplTag: String!, $legacyText: String!) {
    tagged: projects(where: { version: 6, tags_has: $fplTag }, limit: 100) {
      items { ${PROJECT_FIELDS} }
    }
    legacy: projects(where: { version: 6, description_contains_nocase: $legacyText }, limit: 100) {
      items { ${PROJECT_FIELDS} }
    }
  }`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { fplTag: "fpl", legacyText: "Fantasy Premier League" } }),
  });
  if (!response.ok) throw new Error(`Bendystraw returned ${response.status}`);
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join("; "));
  return [...(body.data?.tagged?.items || []), ...(body.data?.legacy?.items || [])];
}

function uniqueShops(projects, leagueId = "") {
  const unique = new Map();
  projects.forEach((project) => {
    if (leagueId && !matchesLeague(project, leagueId)) return;
    const shop = shopForProject(project);
    if (shop) unique.set(shop.route, shop);
  });
  return [...unique.values()].sort((a, b) => {
    const mainnetFirst = Number(Number(b.chainId) === 8453) - Number(Number(a.chainId) === 8453);
    return mainnetFirst || Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });
}

async function discoverShops(request, ctx) {
  const url = new URL(request.url);
  const leagueId = String(url.searchParams.get("leagueId") || "").trim();
  if (leagueId && !/^\d{3,9}$/.test(leagueId)) {
    return jsonResponse({ error: "leagueId must be a numeric FPL classic league ID." }, 400);
  }

  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  const query = leagueId ? (endpoint) => queryBendystraw(endpoint, leagueId) : queryAllFplProjects;
  const settled = await Promise.allSettled(BENDYSTRAW_ENDPOINTS.map(query));
  const projects = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const shops = uniqueShops(projects, leagueId);
  const response = jsonResponse({ leagueId: leagueId || null, shops });
  ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}
