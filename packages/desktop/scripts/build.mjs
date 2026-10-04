import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
await mkdir(path.join(root, "dist-renderer"), { recursive: true });
for (const [entry, name] of [
  ["renderer/main.jsx", "main"],
  ["renderer/mini.jsx", "mini"],
])
  await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: `dist-renderer/${name}.js`,
    bundle: true,
    minify: true,
    sourcemap: false,
    format: "iife",
    platform: "browser",
    target: "chrome144",
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "file" },
    assetNames: "[name]",
  });
for (const page of ["index.html", "mini.html"]) {
  await copyFile(
    path.join(root, "renderer", page),
    path.join(root, "dist-renderer", page),
  );
  const html = await readFile(path.join(root, "dist-renderer", page), "utf8");
  if (!html.includes("Content-Security-Policy"))
    throw new Error(`${page} must declare a Content-Security-Policy`);
}
console.log("Built offline desktop renderer.");
