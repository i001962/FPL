#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , leagueUrl, wallet] = process.argv;

if (!leagueUrl || !wallet) {
  console.error('Usage: node scripts/validate-fpl-shop-draft.mjs <fpl-league-url> <deployer-wallet>');
  process.exit(2);
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
const endpoint = `https://fc-footy.vercel.app/api/fpl-league?leagueId=${leagueId}`;
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

let league;
try {
  league = await response.json();
} catch (error) {
  console.error(`FPL league fetch returned malformed JSON: ${error.message}`);
  process.exit(1);
}

const leagueName = league?.league?.name;
const managerCount = Math.max(
  Number(league?.standings?.total || 0),
  Number(league?.new_entries?.total || 0),
  Number(league?.standings?.results?.length || 0),
  Number(league?.new_entries?.results?.length || 0),
);
if (!leagueName || !managerCount) {
  console.error('FPL league response did not include usable league name and manager data.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const draftPath = path.join(__dirname, '..', 'assets', 'fpl-insert-league-name-shop.jb');
const state = JSON.parse(fs.readFileSync(draftPath, 'utf8'));

state.details.name = `FPL ${leagueName} Shop`;
state.details.description = `This shop is a companion to Fantasy Premier League team #${leagueId} - ${leagueName}.`;
state.details.owner = wallet;
state.revOperator = wallet;

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
}

const projectMetadata = {
  name: state.details.name,
  description: state.details.description,
  logoUri: state.details.logoUri,
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
  ['projectMetadata.description', projectMetadata.description],
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
if (!tierNames.includes('Full Season')) tierFailures.push('missing Full Season tier');
if (!tierNames.includes('Game Week 1')) tierFailures.push('missing Game Week 1 tier');
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
  nfts: state.nfts.map((nft) => ({
    name: nft.name,
    price: nft.price,
    allowCredits: nft.flags.allowCredits,
    imageMatchesProject: nft.imageUri === state.details.logoUri,
  })),
}, null, 2));
