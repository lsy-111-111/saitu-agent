import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

let installed = false;
/** CLI-only source loader. Uses the same server modules, including budget guards. */
export function installSourceLoader(root = process.cwd()) {
  if (installed) return;
  installed = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
      const local = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2))
        : specifier.startsWith(".") && context.parentURL?.startsWith("file:")
          ? fileURLToPath(new URL(specifier, context.parentURL)) : null;
      if (local) {
        const resolved = [local, local + ".ts", local + ".tsx", local + ".mjs", local + ".json", path.join(local, "index.ts")]
          .find(name => /\.(ts|tsx|mjs|json)$/.test(name) && existsSync(name));
        if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      // Match TypeScript resolveJsonModule semantics for source CLIs. JSON is
      // parsed as data, including a literal __proto__ key, never injected code.
      if (url.startsWith("file:") && url.endsWith(".json")) {
        const raw = readFileSync(fileURLToPath(url), "utf8");
        JSON.parse(raw);
        return { format: "module", shortCircuit: true, source: `export default JSON.parse(${JSON.stringify(raw)});` };
      }
      if (url.startsWith("file:") && /\.(ts|tsx)$/.test(url)) {
        return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
          fileName: fileURLToPath(url), compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
        }).outputText };
      }
      return nextLoad(url, context);
    },
  });
}
