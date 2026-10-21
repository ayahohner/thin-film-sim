#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

worker="${SITES_PROJECT_ROOT}/dist/server/index.js"
hosting="${SITES_PROJECT_ROOT}/dist/.openai/hosting.json"

[[ -f "${worker}" ]] || {
  echo "Missing Sites Worker entry: dist/server/index.js" >&2
  exit 66
}
[[ -f "${hosting}" ]] || {
  echo "Missing packaged Sites manifest: dist/.openai/hosting.json" >&2
  exit 66
}

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { openWorkerArtifact } from "./scripts/worker-artifact.mjs";

const runtime = await openWorkerArtifact();
try {
  const response = await runtime.dispatchFetch("http://localhost/", {
    headers: { accept: "text/html" },
  });
  assert.equal(response.status, 200, "Sites Worker must serve the home page");
  await response.arrayBuffer();
} finally {
  await runtime.dispose();
}
NODE

echo "Validated Sites artifact: Worker serves requests in workerd and hosting manifest matches source."
