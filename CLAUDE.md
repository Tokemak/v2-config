# v2-config

Offchain address book for Autopilot — the `autopilot.json` served to every backend.
Consumers must not read this repo directly: they call the config API (`TOKEMAK_CONFIG_URL`, the in-cluster `v2-config` service, or
https://v2-config.tokemaklabs.com/ outside the cluster). Editing an address here changes behaviour across the whole fleet on the next deploy.


<!-- nomad-deploy-pointer -->
## Deployment — this repo ships to the Nomad cluster

Job on the cluster: `v2-config`.

- **Build:** `pnpm build` on branch `nomad`
- **Procedure + secrets:** `v2-nomad-infra/docs/deploy/runbook.md`
- **Per-job facts:** `v2-nomad-infra/docs/deploy/registry.json`, or `node .claude/skills/deploy/resolve.mjs <job>` from that repo
- **Skill:** `/deploy <job>` — run it from **v2-nomad-infra**, where the HCLs live
<!-- /nomad-deploy-pointer -->

<!-- tokemak-conventions -->
## Tokemak conventions

Shared across every backend repo. Source of truth:
`v2-nomad-infra/docs/conventions/tokemak-conventions.md` — edit there, then run
`python3 scripts/sync-claude-md.py`. Do not edit this block in place; it is overwritten.

### Chains

Ethereum 1 · Base 8453 · Arbitrum 42161 · Sonic 146 · Plasma 9745 · Linea 59144 · Monad 143

### Code rules

- **No swallowed errors.** Never `try/catch` to silently ignore, or to log and continue.
  Let errors propagate; the only place to catch is the top-level boundary (cron entry
  point, HTTP route handler). If something fails mid-flow it should fail the whole run.
  Any exception needs a comment saying why the catch is necessary.
- **Enums, never magic strings.** Every log event, span, metric, attribute and severity
  goes through a TypeScript enum. Rename the enum and the compiler finds every call site;
  ClickHouse then keeps stable names across releases instead of drifting per app.
- **One source of truth.** Never fix a display or reporting problem by duplicating state.
  If you are tempted to copy a value to make something render, the bug is upstream.

### RPC — `rpc-proxy` only

Every backend reaches chain RPC through the in-cluster `rpc-proxy` service
(`:4000`, route `/{chainId}/{purpose}`, `Authorization: Bearer $RPC_PROXY_API_KEY`).

Never a hardcoded Alchemy/Infura URL in app code or in an HCL, and never eRPC — that was
reserved for the SubQuery indexers and is parked with them. `rpc-proxy` owns the per-chain
provider URLs so the keys live in exactly one place. On Nomad the URL is injected by Consul
template; locally, point `RPC_PROXY_URL` at a tunnel.

Infura's **Gas API** (`gas.api.infura.io`, used for gas estimation) is a different product
and is not covered by this rule — it legitimately takes its own key.

### Telemetry

Three signals, one sink — everything lands in ClickStack/HyperDX:

| Signal | How the app emits | Transport |
|---|---|---|
| Logs | `log.info() / warn() / error()` writing JSON to stdout | Vector tails the Nomad alloc → OTLP |
| Metrics | `meter.counter() / gauge() / histogram()` | OTLP HTTP direct |
| Traces | `tracer.run(name, async (span) => …)` | OTLP HTTP direct |

Apps never import `@opentelemetry/*` directly — the vendor SDK stays wrapped in the
telemetry package. `postLogReport()` to v2-log-reports belongs to the legacy Lambda path
and must not be used in Nomad-hosted code.

**Reading logs is not done through the Nomad API.** It garbage-collects the alloc
reference while the files stay on disk. Read them on the instance:
`/opt/nomad/data/alloc/*/alloc/logs/*.stdout.*` over SSM. Legacy Lambda logs are in that
account's CloudWatch.

### Alerts

All alerting lives in `v2-nomad-infra/alerting/` — coded alerts over ClickHouse data.
The HyperDX rules were deleted 2026-06-12: never create a HyperDX rule or run
`pnpm alerts:apply`. App-side `alerts.ts` files are historical specs, nothing applies them.

### AWS

One SSO session covers every account: `aws sso login --sso-session tokemak`. The profile
name **is** the account id (`AWS_PROFILE=247562657424`). Region is `us-east-1` everywhere.

Signing keys are never copied between accounts. The Nomad EC2 role is granted `kms:Sign`
on the key in its own account, out of band — see
`v2-nomad-infra/docs/deploy/kms-cross-account.md`. A `cdk deploy` on
TokemakNomadStack would **replace the production instance**; the stack has drifted.

### Branches

The `nomad` branch carries the Nomad-hosted variant of the code: no Lambda handler, no
CDK, no `@packages/aws-*`, telemetry instead of log reports. `main` stays on whatever
legacy host that repo still has. Check which branch you are on before building — several
repos ship a bundle whose artifact is shared by many jobs.
<!-- /tokemak-conventions -->
