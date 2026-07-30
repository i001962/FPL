# FPL League NFT Shop Deployer

This repo contains a Codex skill for preparing signer-reviewable Juicebox deploy txlinks for FPL league NFT shops.

The frontend template is intentionally separate from the skill:

- Skill workflow: generate and validate deploy state, metadata, calldata, simulation, and txlink.
- Static frontend: `static-shop-template/index.html`, a copyable project-specific buyer page template.

The skill and the buyer app have different FPL data requirements:

- Agents using the skill should read Fantasy Premier League data directly from FPL APIs when possible.
- The browser app uses a CORS-capable league endpoint, defaulting to `https://fc-footy.vercel.app/api/fpl-league`.

## Static Frontend QStorage Upload

QStorage is S3-compatible. Upload the copyable template with QConsole/QStorage credentials in the environment:

```sh
set -a
source /path/to/footy/.env
set +a
scripts/upload-static-shop-template-qstorage.sh
```

The script uploads `static-shop-template/` through the configured S3-compatible `QSTORAGE_ENDPOINT`.

After uploading, copy the returned `qstorageUrl` into `SKILL.md` under `Frontend Template`.

Example app route:

```text
https://qstorage.quilibrium.com/footy/static-shop-template/index.html#basesep:19
```

The FC-Footy league API, or any replacement `apiBase`, must allow browser reads from QStorage. Add `Access-Control-Allow-Origin: *` to `GET /api/fpl-league` responses.
