import esbuild from "esbuild"
import path from "node:path"
import fs from "node:fs"
import { execSync } from "node:child_process"
import { createRequire } from "node:module"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")
const outDir = path.resolve(rootDir, "dist")
const outFile = path.join(outDir, "index.js")

async function ask(query) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(query, (ans) => { rl.close(); resolve(ans.trim().toLowerCase()) })
  })
}

// 1. Read version
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf-8"))
console.log(`\nPreparing to publish @evixor/evixor-runtime v${pkg.version}\n`)

// 2. Check git status
try {
  const status = execSync("git status --porcelain", { cwd: rootDir, encoding: "utf-8" }).trim()
  const dirty = status.split("\n").filter(l => l && !l.startsWith("??")).length > 0
  if (dirty) {
    console.error("Error: Working directory is not clean. Commit or stash changes first.")
    process.exit(1)
  }
} catch {
  console.error("Error: Not a git repository or git not available.")
  process.exit(1)
}

// 3. Confirm
const ans = await ask(`Publish v${pkg.version}? (y/N) `)
if (ans !== "y" && ans !== "yes") {
  console.log("Aborted.")
  process.exit(0)
}

// 4. Clean
if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true, force: true })
}
fs.mkdirSync(outDir, { recursive: true })

// 5. esbuild bundle (production)
console.log("Building with esbuild (production)...")
await esbuild.build({
  entryPoints: [path.join(rootDir, "index.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node20",
  treeShaking: true,
  minify: true,
})

// 6. terser post-process
console.log("Minifying with terser...")
const { minify } = await import("terser")
const code = fs.readFileSync(outFile, "utf-8")
const result = await minify(code, {
  compress: {
    drop_console: true,
    passes: 2,
    unsafe: true,
  },
  mangle: {
    toplevel: false,
  },
  output: {
    comments: false,
  },
})
fs.writeFileSync(outFile, result.code, "utf-8")

// 7. tsc declarations
console.log("Generating type declarations...")
const _require = createRequire(import.meta.url)
const tscPath = _require.resolve("typescript/bin/tsc")
execSync(`node ${JSON.stringify(tscPath)} --project ${JSON.stringify(path.join(rootDir, "tsconfig.json"))} --outDir ${JSON.stringify(outDir)}`, {
  stdio: "inherit",
  cwd: rootDir,
})

// 8. Write package.json for consumers
fs.writeFileSync(
  path.join(outDir, "package.json"),
  JSON.stringify(
    {
      name: "@evixor/evixor-runtime",
      version: pkg.version,
      type: "module",
      main: "./index.js",
      types: "./index.d.ts",
    },
    null,
    2,
  ),
)

// 9. Dry-run or publish
const action = await ask('Type "publish" to confirm and publish, or press Enter for dry-run: ')
const isPublish = action === "publish"
const publishArgs = isPublish ? [] : ["--dry-run"]
console.log(`Running npm publish ${publishArgs.join(" ")}...`)
execSync(`npm publish --ignore-scripts --access public ${publishArgs.join(" ")}`, { stdio: "inherit", cwd: rootDir })

if (isPublish) {
  console.log(`\nDone. Published @evixor/evixor-runtime v${pkg.version}`)
}
