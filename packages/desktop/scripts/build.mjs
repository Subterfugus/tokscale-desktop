import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
await mkdir(path.join(root, "dist-renderer"), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["renderer/main.jsx"],
  outfile: "dist-renderer/main.js",
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "iife",
  platform: "browser",
  target: "chrome144",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".svg": "dataurl", ".png": "dataurl" },
});
await copyFile(
  path.join(root, "renderer/index.html"),
  path.join(root, "dist-renderer/index.html"),
);
const html = await readFile(
  path.join(root, "dist-renderer/index.html"),
  "utf8",
);
if (!html.includes("Content-Security-Policy"))
  throw new Error("Renderer must declare a Content-Security-Policy");
console.log("Built offline desktop renderer.");
