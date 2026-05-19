/**
 * v2-config — HTTP API serving the Tokemak autopilot configuration.
 *
 * The `autopilot.json` source-of-truth (at the repo root) is **embedded into
 * the bundle at build time** (see `scripts/build.mjs`). One commit on this
 * repo = one new bundle = one S3 upload = config in prod. No runtime dependency
 * on GitHub.
 *
 * Endpoints
 *   GET /api/systems  → returns the `systems[]` array (matches the legacy
 *                       CF Worker `v2-config.tokemaklabs.com/api/systems`
 *                       contract that `@packages/tokemak-config` consumes).
 *   GET /api/full     → returns the full autopilot.json (escape hatch).
 *   GET /health       → liveness probe for Nomad consul check.
 *
 * Logs are emitted as JSON lines on stdout for Vector to ship to ClickStack:
 *   - INFO  on boot   → "v2-config listening on …" with systemsCount + chains
 *   - INFO  per request → method/path/status/duration_ms/remote_addr
 *   - WARN  on 4xx       → same shape, severity escalated
 *   - ERROR on 5xx       → same shape + error message
 *   - INFO  on shutdown  → "received SIGTERM, shutting down"
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import autopilot from '../autopilot.json' with { type: 'json' };

const SERVICE_NAME = 'v2-config';

function log(
  severity: 'INFO' | 'WARN' | 'ERROR',
  body: string,
  extra: Record<string, unknown> = {},
): void {
  const out = JSON.stringify({
    severity,
    service: SERVICE_NAME,
    body,
    timestamp: new Date().toISOString(),
    ...extra,
  });
  if (severity === 'ERROR') console.error(out);
  else console.log(out);
}

const app = new Hono();

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
);

// Access log — one structured line per request.
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration_ms = Date.now() - start;
  const status = c.res.status;
  const severity = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
  // Nomad runs the service behind the host network; the real caller IP comes
  // from X-Forwarded-For if a reverse proxy is in front, otherwise from the
  // socket. Both are best-effort.
  const remote_addr =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown';
  log(severity, `${c.req.method} ${c.req.path} ${status} in ${duration_ms}ms`, {
    method: c.req.method,
    path: c.req.path,
    status,
    duration_ms,
    remote_addr,
  });
});

// Global error handler — catch unhandled throws so they surface as ERROR logs.
app.onError((err, c) => {
  log('ERROR', `Unhandled error on ${c.req.method} ${c.req.path}`, {
    method: c.req.method,
    path: c.req.path,
    error: err.message,
    stack: err.stack,
  });
  return c.json({ error: 'Internal Server Error' }, 500);
});

app.get('/health', (c) => c.text('ok'));
app.get('/api/systems', (c) => c.json(autopilot.systems));
app.get('/api/full', (c) => c.json(autopilot));

const PORT = Number(process.env.PORT ?? 4001);

const server = serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' });

log('INFO', `${SERVICE_NAME} listening on 0.0.0.0:${PORT}`, {
  systemsCount: autopilot.systems.length,
  chains: autopilot.systems.map((s) => s.chainName),
});

// Graceful shutdown for clean Nomad redeploys.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    log('INFO', `received ${sig}, shutting down`);
    server.close(() => process.exit(0));
  });
}
