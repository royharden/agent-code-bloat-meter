# Bolt handoff — inspection/preparation only

Target: **No database**. Static React + TypeScript + Vite viewer; local Node CLI performs analysis and later gated evaluation. No Bolt project or GitHub remote is configured. Source construction is not deployment readiness.

| Resource | Inventory / status |
|---|---|
| Frontend | src/viewer/, index.html, vite.config.ts; static public/data/ JSON |
| Local analysis | cli/analyze.ts; scripts/demo.ts; Node >= 20 declared (Normal-mode compatibility check pending) |
| Data boundary | Engineering demo only public; independent corpus and held-out custody stay outside the browser bundle |
| supabase-js / database | Not required |
| Migrations / edge functions | Not required |
| Auth / storage / Realtime | Not required |
| Secrets / workers / schedules | Not required; no live provider adapter |
| Dependencies | package.json candidate pins; install/lockfile deferred by Dirty Mode |
| Build / output | npm run build → dist/ intended, never executed |
| Validation | docs/DEFERRED-VALIDATION.md; no test/build/runtime success asserted |
| Publication | Not authorized; no push, remote, import or provisioning performed |

Later owner-authorized preparation prompt:

> Inspect this static Vite app at the authorized revision. Preserve its product, local CLI and independent-corpus boundaries. First report install, lockfile, typecheck, lint and build gaps. Do not provision a database, auth, storage, functions, secrets or background services: none are required. Public viewer data must contain engineering demo analysis and an honest not-yet-measured placeholder until an authorized measured artifact exists. Never import sealed or private corpus files into public/data or the browser. Do not fabricate results, add a remote or publish. Any later import/publication requires owner authorization and an actual successful build.
