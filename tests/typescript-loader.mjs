/*
 * Tiny test-only loader for Node's built-in test runner.
 *
 * Production is bundled by Vite. Tests intentionally execute the same TypeScript
 * source instead of copying solver formulas into a second implementation.
 */
import { access, readFile } from "node:fs/promises";
import ts from "typescript";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith(".") || /\.[cm]?[jt]sx?$/.test(specifier)) {
      throw error;
    }
    const url = new URL(`${specifier}.ts`, context.parentURL);
    await access(url);
    return { url: url.href, shortCircuit: true };
  }
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".ts")) return nextLoad(url, context);
  const source = await readFile(new URL(url), "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
    },
    fileName: new URL(url).pathname,
  });
  return { format: "module", source: result.outputText, shortCircuit: true };
}
