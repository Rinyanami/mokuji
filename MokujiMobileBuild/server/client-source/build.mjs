import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(root, '..', 'web', 'assets');
if (fs.existsSync(assetsDir)) {
  for (const name of fs.readdirSync(assetsDir)) {
    if (/\.(?:js|css)$/i.test(name)) {
      try { fs.unlinkSync(path.join(assetsDir, name)); } catch {}
    }
  }
}

await build({
  root,
  configFile: false,
  base: '/',
  publicDir: false,
  resolve: { alias: { '@': root } },
  build: {
    outDir: path.join(root, '..', 'web'),
    emptyOutDir: false,
    sourcemap: false,
    reportCompressedSize: true,
  },
});
