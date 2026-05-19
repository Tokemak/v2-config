#!/usr/bin/env node
/**
 * Bundle the v2-config server for Nomad raw_exec.
 *
 * Produces a single self-contained `dist/v2-config.mjs` with:
 *   - server code
 *   - autopilot.json inlined (so the bundle is self-sufficient)
 *   - all node_modules deps inlined
 *
 * Deploy:
 *   pnpm build
 *   aws --profile 978324514660 --region us-east-1 \
 *     s3 cp dist/v2-config.mjs s3://tokemak-nomad-artifacts/v2-config/v2-config.mjs
 *   # Submit the Nomad job from v2-nomad-infra (job spec at jobs/tier0/v2-config.nomad.hcl)
 */

import { build } from 'esbuild';

const start = Date.now();

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/v2-config.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  loader: { '.json': 'json' },
  // ESM banner: some CommonJS deps reach for `require` / `__filename` /
  // `__dirname` at runtime. In ESM output those are undefined and the code
  // crashes ("Dynamic require of util is not supported"). We expose them via
  // createRequire(import.meta.url) to restore CJS-style globals.
  banner: {
    js: [
      "import { createRequire as __nomadCreateRequire } from 'module';",
      "import { fileURLToPath as __nomadFileURLToPath } from 'url';",
      "import { dirname as __nomadDirname } from 'path';",
      "const require = __nomadCreateRequire(import.meta.url);",
      "const __filename = __nomadFileURLToPath(import.meta.url);",
      "const __dirname = __nomadDirname(__filename);",
    ].join('\n'),
  },
  logLevel: 'info',
});

console.log(`✓ dist/v2-config.mjs built in ${Date.now() - start}ms`);
