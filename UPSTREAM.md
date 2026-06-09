# Divergences from upstream

> Format mirrors `trade-republic-owncloud/UPSTREAM.md` and
> `gbm-owncloud`. Every intentional difference between this ownCloud
> app and `Scalable-Capital-Dashboard` goes here with a stated reason.
> If it's not listed AND it's not one of the 9 allowed patches in
> [`../TR-GBM-Project/OWNCLOUD-PATCHES.md`](../TR-GBM-Project/OWNCLOUD-PATCHES.md),
> it's a bug.

## Currently tracked divergences

_None yet — scaffold only._

## Expected near-term divergences (when implementation starts)

- **MFA modal copy** — Dashboard says "Approve the push on your phone";
  ownCloud might need a slightly different wording for multi-user clarity
  (e.g. "Approve the Scalable push notification on your linked phone").
  Trivial UX, will be documented if applied.

- **Session storage path** — Dashboard uses `~/.sc-api/session.json`
  (per-machine). ownCloud uses `{datadir}/<uid>/scalable_capital/session.json`
  (per-user). This is patch #5 (data dir) from OWNCLOUD-PATCHES.md, not
  a real divergence.
