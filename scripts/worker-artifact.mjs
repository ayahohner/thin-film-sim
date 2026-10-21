import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

// Validate the deployed modules in workerd: vinext uses cloudflare: imports
// that cannot be loaded by Node's ESM loader.
export async function openWorkerArtifact() {
  const readJson = async (path) =>
    JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
  const source = await readJson("../.openai/hosting.json");
  const packaged = await readJson("../dist/.openai/hosting.json");
  assert.deepEqual(
    packaged, source, "Packaged hosting configuration must match source",
  );
  const config = await readJson("../dist/server/wrangler.json");
  const modulesRoot = fileURLToPath(new URL("../dist/server", import.meta.url));
  const modules = {};
  for (const path of await readdir(modulesRoot, { recursive: true })) {
    if (/\.m?js$/.test(path)) {
      modules[path] = {
        type: "esm",
        contents: await readFile(join(modulesRoot, path), "utf8"),
      };
    }
  }
  const runtime = new Miniflare({
    workers: [{
      config: {
        name: config.name,
        compatibilityDate: config.compatibility_date,
        compatibilityFlags: config.compatibility_flags,
        manifest: { mainModule: "index.js", modulesRoot, modules },
        env: { ASSETS: { type: "assets" } },
        assets: {
          directory: fileURLToPath(new URL("../dist/client", import.meta.url)),
          hasUserWorker: true,
        },
      },
    }],
  });
  try {
    await runtime.ready;
    return runtime;
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
