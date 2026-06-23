# Admin performance audit

This suite tests a dedicated synthetic staging database. It intentionally does not optimize application code.

## Safety

The seed and cleanup commands refuse any database whose name does not contain `perf`, `performance`, `loadtest`, or `benchmark`. Seeding also requires `PERF_ALLOW_SEED=true`; dropping requires both `PERF_ALLOW_SEED=true` and `PERF_ALLOW_DROP=true`.

## Run

1. Copy `.env.performance.example` values into the process environment without committing credentials.
2. Create a fresh staging database and run `npm run perf:seed`.
3. Point the staging backend at that database and deploy the current backend/admin builds.
4. Run `PERF_RUN_FULL=true npm run perf:audit`.
5. Review `artifacts/admin-performance/admin-performance-audit.pdf` and the JSON evidence.
6. When evidence is safely exported, run `npm run perf:cleanup` with `PERF_ALLOW_DROP=true`.

Use reduced `PERF_*` counts only for harness smoke tests. A reduced run cannot produce a production-ready verdict.
