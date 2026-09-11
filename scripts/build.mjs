import esbuild from "esbuild"
import path from "node:path"
import fs from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")
const outDir = path.resolve(rootDir, "dist")
const outFile = path.join(outDir, "index.js")

// 1. Clean
if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true, force: true })
}
fs.mkdirSync(outDir, { recursive: true })

// 2. esbuild bundle
await esbuild.build({
  entryPoints: [path.join(rootDir, "index.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "esm",
  sourcemap: "inline",
  target: "node20",
  treeShaking: true,
})

// 3. tsc declarations
const { execSync } = await import("node:child_process")
const _require = createRequire(import.meta.url)
const tscPath = _require.resolve("typescript/bin/tsc")
execSync(`node ${JSON.stringify(tscPath)} --project ${JSON.stringify(path.join(rootDir, "tsconfig.json"))} --outDir ${JSON.stringify(outDir)}`, {
  stdio: "inherit",
  cwd: rootDir,
})

// 4. Write package.json for consumers
const srcPkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf-8"))
fs.writeFileSync(
  path.join(outDir, "package.json"),
  JSON.stringify(
    {
      name: "@evixor/evixor-runtime",
      version: srcPkg.version,
      type: "module",
      main: "./index.js",
      types: "./index.d.ts",
    },
    null,
    2,
  ),
)

console.log("[evixor] Build complete:", outFile)
