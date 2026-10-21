import assert from "node:assert/strict";
import test from "node:test";
import { openWorkerArtifact } from "../scripts/worker-artifact.mjs";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async (t) => {
  const runtime = await openWorkerArtifact();
  t.after(() => runtime.dispose());
  const response = await runtime.dispatchFetch("http://localhost/", {
    headers: { accept: "text/html" },
  });

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /aria-label="Bubble drag behavior"/);
  assert.match(html, />Perturb</);
  assert.match(html, />Rotate</);
  const script = html.match(/<script[^>]+src="([^"]+)"/);
  assert.ok(script, "Rendered page must reference its client bundle");
  const asset = await runtime.dispatchFetch(new URL(script[1], "http://localhost/"));
  assert.equal(asset.status, 200, "Client bundle must be available through ASSETS");
  await asset.arrayBuffer();
});
