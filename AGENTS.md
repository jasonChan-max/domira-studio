# Domira website maintenance

## Canonical source and publication

- This GitHub repository, branch `v2.0`, is the canonical source for the website. Fetch and fast-forward before editing; preserve concurrent user changes.
- Every authorized website change must be committed and pushed to `v2.0`, then the `Sync website to Cloudflare` workflow must complete successfully. Pull requests targeting `v2.0` run checks; merge them before production publication.
- Keep GitHub source, Cloudflare `domira` frontend, and `domira-api` backend on the same source commit. Verify `/deployment-info.json`, `/api/version`, and all asset hashes with `node scripts/verify-cloudflare.mjs` before reporting synchronization complete.
- For an urgent local deployment, build from the pushed commit and deploy both Workers with `--keep-vars`, then verify. Do not leave an unpushed dashboard-only change as the final result.
- Never copy Cloudflare OAuth credentials or application API keys into this repository or CI logs. CI uses the repository Actions secret `CLOUDFLARE_API_TOKEN`; model/render credentials stay in Worker Secrets.
- Preserve current D1/AI bindings, domain origins and existing runtime variables. Do not reset the database or recreate customer credentials while deploying code.
- `main` is preserved as a legacy branch. The GitHub default and production branch is `v2.0`.

## Verification

Use Node.js 24. Run `npm ci`, `npm test`, `npm run build`, `npm run validate`, `npm run build:cloudflare`, and `node scripts/check-v2-bundles.mjs`. Source in `src/` generates the matching public domain modules. Keep build output and local credentials out of Git. Real device XR measurements still need hardware acceptance; never replace a failed test with fabricated success.
