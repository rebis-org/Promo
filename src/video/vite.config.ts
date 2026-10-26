import { type Plugin, defineConfig, normalizePath } from "vite";
import { cpSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname);
const assetDirs = ["audio", "data"];

function repoAssets(): Plugin {
  return {
    name: "repo-assets",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (assetDirs.some((dir) => req.url?.startsWith(`/${dir}/`))) {
          req.url = `/@fs/${encodeURI(normalizePath(repoRoot))}${req.url}`;
        }
        next();
      });
    },
    writeBundle(options) {
      if (!options.dir) {
        return;
      }
      for (const dir of assetDirs) {
        cpSync(path.join(repoRoot, dir), path.join(options.dir, dir), {
          recursive: true,
        });
      }
    },
  };
}

export default defineConfig({
  root: ".",
  publicDir: "public",
  plugins: [repoAssets()],
  server: {
    port: 5173,
    strictPort: false,
    hmr: process.env.PDOOM_NO_HMR ? false : undefined,
    fs: { allow: [repoRoot] },
  },
  build: { target: "esnext", assetsInlineLimit: 0 },
});
