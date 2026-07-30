#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , leagueUrl, wallet, ...optionArgs] = process.argv;

if (!leagueUrl || !wallet) {
  console.error('Usage: node scripts/validate-fpl-shop-draft.mjs <fpl-league-url> <deployer-wallet> [--tier-price "Tier Name=Price"]');
  process.exit(2);
}

const tierPriceOverrides = new Map();
for (let index = 0; index < optionArgs.length; index += 1) {
  const arg = optionArgs[index];
  if (arg !== '--tier-price') {
    console.error(`Unknown option: ${arg}`);
    process.exit(2);
  }
  const value = optionArgs[index + 1];
  index += 1;
  if (!value || !value.includes('=')) {
    console.error('--tier-price must be formatted as "Tier Name=Price"');
    process.exit(2);
  }
  const separatorIndex = value.lastIndexOf('=');
  const tierName = value.slice(0, separatorIndex).trim();
  const price = value.slice(separatorIndex + 1).trim();
  if (!tierName || !/^\d+(\.\d+)?$/.test(price)) {
    console.error('--tier-price must include a tier name and non-negative numeric price');
    process.exit(2);
  }
  tierPriceOverrides.set(tierName, price);
}

function shopNameForLeague(name) {
  const trimmed = String(name || '').trim();
  const withoutShop = trimmed.replace(/\s+shop$/i, '').trim();
  return /^fpl\b/i.test(withoutShop) ? `${withoutShop} Shop` : `FPL ${withoutShop} Shop`;
}

const leagueIdMatch = String(leagueUrl).match(/\/leagues\/(\d+)\/standings\/c\b/);
if (!leagueIdMatch) {
  console.error(`Could not parse classic league ID from URL: ${leagueUrl}`);
  process.exit(1);
}

if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  console.error(`Invalid deployer wallet address: ${wallet}`);
  process.exit(1);
}

const leagueId = Number(leagueIdMatch[1]);
async function fetchLeaguePage(page) {
  const endpoint = `https://fantasy.premierleague.com/api/leagues-classic/${leagueId}/standings/?page_standings=${page}`;
  let response;
  try {
    response = await fetch(endpoint);
  } catch (error) {
    console.error(`FPL league fetch failed: ${error.message}`);
    process.exit(1);
  }
  if (!response.ok) {
    console.error(`FPL league fetch failed: ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  try {
    return await response.json();
  } catch (error) {
    console.error(`FPL league fetch returned malformed JSON: ${error.message}`);
    process.exit(1);
  }
}

const league = await fetchLeaguePage(1);

function managerCountForPage(leaguePage) {
  return Number(leaguePage?.standings?.results?.length || 0)
    + Number(leaguePage?.new_entries?.results?.length || 0);
}

function pageHasNext(leaguePage) {
  return Boolean(leaguePage?.standings?.has_next || leaguePage?.new_entries?.has_next);
}

const leagueName = league?.league?.name;
let managerCount = managerCountForPage(league);
let page = Math.max(Number(league?.standings?.page || 1), Number(league?.new_entries?.page || 1));
let hasNext = pageHasNext(league);
while (hasNext && page < 50) {
  page += 1;
  const nextLeague = await fetchLeaguePage(page);
  managerCount += managerCountForPage(nextLeague);
  hasNext = pageHasNext(nextLeague);
}
if (!leagueName || !managerCount) {
  console.error('FPL league response did not include usable league name and manager data.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const draftPath = path.join(__dirname, '..', 'assets', 'fpl-insert-league-name-shop.jb');
const state = JSON.parse(fs.readFileSync(draftPath, 'utf8'));

state.details.name = shopNameForLeague(leagueName);
state.details.ticker = `FPL-${leagueId}`;
state.details.description = `This shop is a companion to Fantasy Premier League team #${leagueId} - ${leagueName}.`;
state.details.tags = Array.from(new Set([...(state.details.tags || []), 'fpl', `fpl-league:${leagueId}`]));
state.details.owner = wallet;
state.revOperator = wallet;
state.collection = state.collection || {};
state.collection.name = state.details.name;
state.collection.symbol = state.details.ticker;
state.collection.nameTouched = true;
state.collection.symbolTouched = true;

for (const stage of state.stages || []) {
  stage.tokenMode = 'none';
  stage.weight = '0';
}

state.collection = state.collection || {};
state.collection.issueTokensForSplits = false;

for (const nft of state.nfts || []) {
  nft.flags = nft.flags || {};
  nft.flags.allowCredits = false;
  nft.imageUri = state.details.logoUri;
  if (nft.splitOn && Array.isArray(nft.splitRecipients)) {
    for (const recipient of nft.splitRecipients) {
      if (/^\d+$/.test(String(recipient.recip || '')) && Number(recipient.recip) === 12) {
        recipient.benef = state.revOperator || state.details.owner;
      }
    }
  }
}

for (const [tierName, price] of tierPriceOverrides) {
  const tier = (state.nfts || []).find((nft) => nft.name === tierName);
  if (!tier) {
    console.error(`Cannot apply tier price override; tier not found: ${tierName}`);
    process.exit(1);
  }
  tier.price = price;
}

const projectMetadata = {
  name: state.details.name,
  symbol: state.details.ticker,
  projectTagline: state.details.tagline || '',
  description: state.details.description,
  logoUri: state.details.logoUri,
  payDisclosure: state.details.payDisclosure || '',
  infoUri: state.details.website || '',
  twitter: state.details.twitter || '',
  discord: state.details.discord || '',
  telegram: state.details.telegram || '',
  tags: state.details.tags || [],
  fpl: {
    leagueId: String(leagueId),
  },
};

const nftMetadata = (state.nfts || []).map((nft) => ({
  name: nft.name,
  description: nft.description,
  image: nft.imageUri,
}));

const fields = [
  ['state.details.name', state.details.name],
  ['state.details.description', state.details.description],
  ['projectMetadata.name', projectMetadata.name],
  ['projectMetadata.projectTagline', projectMetadata.projectTagline],
  ['projectMetadata.description', projectMetadata.description],
  ['projectMetadata.payDisclosure', projectMetadata.payDisclosure],
  ['projectMetadata.infoUri', projectMetadata.infoUri],
  ['projectMetadata.twitter', projectMetadata.twitter],
  ['projectMetadata.discord', projectMetadata.discord],
  ['projectMetadata.telegram', projectMetadata.telegram],
  ['projectMetadata.fpl.leagueId', projectMetadata.fpl.leagueId],
  ...nftMetadata.flatMap((metadata, index) => [
    [`nfts[${index}].metadata.name`, metadata.name],
    [`nfts[${index}].metadata.description`, metadata.description],
  ]),
];

const placeholderPattern = /\[|\]|insert|placeholder|FPL \[insert league name\] Shop/i;
const placeholderFailures = fields.filter(([, value]) => placeholderPattern.test(String(value)));
if (placeholderFailures.length) {
  console.error('Placeholder preflight failed:');
  for (const [field, value] of placeholderFailures) console.error(`${field}: ${value}`);
  process.exit(1);
}

const tierNames = (state.nfts || []).map((nft) => nft.name);
const tierFailures = [];
const expectedCategories = ['Buy-ins', 'Contests', 'Collectibles', 'Rewards'];
if (!tierNames.includes('Full Season')) tierFailures.push('missing Full Season tier');
if (!projectMetadata.payDisclosure.trim()) tierFailures.push('payment disclosure is blank');
if (JSON.stringify(state.storeCategories || []) !== JSON.stringify(expectedCategories)) {
  tierFailures.push(`store categories must be ${expectedCategories.join(', ')}`);
}
if ((state.nfts || []).some((nft) => !Number.isInteger(nft.category) || nft.category < 0 || nft.category >= expectedCategories.length)) {
  tierFailures.push('at least one NFT tier has no valid store category');
}
const fullSeasonTier = (state.nfts || []).find((nft) => nft.name === 'Full Season');
const expectedOperator = state.revOperator || state.details.owner;
const fullSeasonSplit = fullSeasonTier?.splitRecipients?.[0];
if (!fullSeasonTier?.splitOn
  || (fullSeasonTier.splitRecipients || []).length !== 1
  || String(fullSeasonSplit?.pct) !== '1'
  || String(fullSeasonSplit?.recip) !== '12'
  || String(fullSeasonSplit?.benef || '').toLowerCase() !== String(expectedOperator || '').toLowerCase()) {
  tierFailures.push('Full Season tier must route a 1% sale split to project 12 with the operator as beneficiary');
}
if ((state.nfts || []).some((nft) => nft.flags?.allowCredits !== false)) {
  tierFailures.push('at least one NFT tier allows credit purchases');
}
if ((state.nfts || []).some((nft) => nft.imageUri !== state.details.logoUri)) {
  tierFailures.push('at least one NFT tier image does not match the project logo');
}
if ((state.stages || []).some((stage) => stage.tokenMode !== 'none' || stage.weight !== '0')) {
  tierFailures.push('project is configured to issue tokens when paid');
}
if (state.collection.issueTokensForSplits !== false) {
  tierFailures.push('split recipients are configured to receive project tokens');
}
if (tierFailures.length) {
  console.error(`Draft validation failed: ${tierFailures.join('; ')}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  leagueId,
  leagueName,
  managerCount,
  metadata: projectMetadata,
  owner: state.details.owner,
  operator: state.revOperator,
  appliedTierPriceOverrides: Object.fromEntries(tierPriceOverrides),
  nfts: state.nfts.map((nft) => ({
    name: nft.name,
    price: nft.price,
    category: expectedCategories[nft.category] || null,
    allowCredits: nft.flags.allowCredits,
    splitOn: nft.splitOn,
    splitRecipients: nft.splitRecipients?.length || 0,
    imageMatchesProject: nft.imageUri === state.details.logoUri,
  })),
}, null, 2));
