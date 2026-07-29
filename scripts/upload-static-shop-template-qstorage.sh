#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUCKET="${QSTORAGE_BUCKET:-${1:-}}"
PREFIX="${QSTORAGE_PREFIX:-static-shop-template}"
ENDPOINT="${QSTORAGE_ENDPOINT:-https://qstorage.quilibrium.com}"
REGION="${QSTORAGE_REGION:-us-east-1}"
PUBLIC_BASE="${QSTORAGE_PUBLIC_BASE:-$ENDPOINT/$BUCKET}"

if [[ -z "$BUCKET" ]]; then
  echo "Usage: QSTORAGE_BUCKET=<bucket> scripts/upload-static-shop-template-qstorage.sh" >&2
  echo "   or: scripts/upload-static-shop-template-qstorage.sh <bucket>" >&2
  exit 2
fi

PREFIX="${PREFIX#/}"
PREFIX="${PREFIX%/}"
if [[ -z "$PREFIX" || "$PREFIX" == *".."* ]]; then
  echo "QSTORAGE_PREFIX must be a non-empty bucket-relative prefix." >&2
  exit 2
fi

if [[ -n "${QSTORAGE_ACCESS_KEY_ID:-}" ]]; then
  export AWS_ACCESS_KEY_ID="$QSTORAGE_ACCESS_KEY_ID"
fi

if [[ -n "${QSTORAGE_SECRET_ACCESS_KEY:-}" ]]; then
  export AWS_SECRET_ACCESS_KEY="$QSTORAGE_SECRET_ACCESS_KEY"
fi

aws s3 sync "$ROOT/static-shop-template/" "s3://$BUCKET/$PREFIX/" \
  --endpoint-url "$ENDPOINT" \
  --region "$REGION" \
  --cache-control "public, max-age=300" \
  --acl public-read \
  --delete

PUBLIC_BASE="${PUBLIC_BASE%/}"
URL="$PUBLIC_BASE/$PREFIX/index.html"

STATUS="$(curl -L -sS -o /dev/null -w "%{http_code}" "$URL")"
if [[ "$STATUS" != "200" ]]; then
  echo "Upload command finished, but public URL returned HTTP $STATUS:" >&2
  echo "$URL" >&2
  exit 1
fi

echo "qstorageUrl=$URL"
echo "routeExample=$URL#base:123/fpl/143466"
