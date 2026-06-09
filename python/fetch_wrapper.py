"""ownCloud-side Python wrapper around sc-api.

Invoked by `ScalableService::runFetch()` via `proc_open`. Per-user paths
are passed in as arguments — the wrapper never discovers them, so one
user's invocation cannot leak into another's storage.

Exit codes (mirrored from sc_fetch.py and tr-api/gbm-mx-api wrappers):

    0  EXIT_OK
   10  EXIT_MFA_REQUIRED   — cookies dead; user must re-import in Chrome
   12  EXIT_AUTH_FAILED
   20  EXIT_API_ERROR
   21  EXIT_TIMEOUT        — emitted by the PHP side, not by us
   30  EXIT_CONFIG_ERROR

Per-user paths:
   $1 --email   <email>        Scalable login email (profile key)
   $2 --data-dir <abs path>    {datadir}/<uid>/scalable_capital/
   $3 --cookies <abs path>     {datadir}/<uid>/scalable_capital/cookies.txt
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

EXIT_OK = 0
EXIT_MFA_REQUIRED = 10
EXIT_MFA_INVALID = 11
EXIT_AUTH_FAILED = 12
EXIT_API_ERROR = 20
EXIT_CONFIG_ERROR = 30


def _log(msg: str) -> None:
    print(f"[fetch_wrapper] {msg}", file=sys.stderr, flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--cookies", required=True)
    args = parser.parse_args(argv)

    data_dir = Path(args.data_dir)
    cookies_path = Path(args.cookies)
    data_dir.mkdir(parents=True, exist_ok=True)

    if not cookies_path.is_file():
        _log(f"No cookies at {cookies_path}. User must upload them.")
        return EXIT_MFA_REQUIRED

    try:
        import sc_api
        from sc_api import ScalableClient, profiles, identity, cookies as _cookies
        from sc_api.exceptions import (
            SessionExpired, MissingSessionCookies, ApiError,
        )
    except ImportError as e:
        _log(f"sc-api not installed: {e}")
        return EXIT_CONFIG_ERROR

    # ----- per-invocation profile -----------------------------------
    # The wrapper writes a synthetic profile inside the user's data dir
    # instead of touching ~/.sc-api/ (HOME is /tmp in our env anyway).
    # This means each ownCloud user's profile lives entirely under
    # {datadir}/<uid>/scalable_capital/.
    profile_dir = data_dir
    profile = profiles.Profile(email=args.email)

    # Override the profile's path-properties to point at the per-user dir.
    # `Profile.dir` is a @property — we override via monkey-patch since
    # rewriting Profile would mean a public-surface change in sc-api.
    class _ScopedProfile(profiles.Profile):
        @property
        def dir(self):  # type: ignore[override]
            return profile_dir
        @property
        def meta_file(self):  # type: ignore[override]
            return profile_dir / "meta.json"
        @property
        def cookies_file(self):  # type: ignore[override]
            return cookies_path

    prof = _ScopedProfile(email=args.email)

    # Load persisted identity (person_id, portfolio_ids) if it exists,
    # else parse the session cookie and discover.
    meta_file = profile_dir / "meta.json"
    if meta_file.is_file():
        try:
            saved = json.loads(meta_file.read_text(encoding="utf-8"))
            prof.person_id = saved.get("person_id")
            prof.portfolio_ids = saved.get("portfolio_ids") or []
            prof.savings_ids = saved.get("savings_ids") or []
        except (json.JSONDecodeError, OSError) as e:
            _log(f"meta.json unreadable, will rediscover: {e}")

    if not prof.person_id:
        try:
            jar = _cookies.load_from_file(cookies_path)
            session_cookie = next(
                (c.value for c in jar if c.name == _cookies.REQUIRED_COOKIE),
                None,
            )
            if not session_cookie:
                _log("No `session` cookie in cookies.txt")
                return EXIT_MFA_REQUIRED
            prof.person_id = _cookies.parse_session_cookie(session_cookie)
        except Exception as e:
            _log(f"failed to parse session cookie: {e}")
            return EXIT_MFA_REQUIRED

    # ----- client + discovery + fetch -------------------------------
    try:
        client = ScalableClient.from_profile(prof)
    except MissingSessionCookies as e:
        _log(str(e))
        return EXIT_MFA_REQUIRED

    if not prof.portfolio_ids:
        try:
            ident = identity.discover(client)
            prof.portfolio_ids = ident.portfolio_ids
            prof.savings_ids = ident.savings_ids
        except SessionExpired:
            return EXIT_MFA_REQUIRED
        except ApiError as e:
            _log(f"discovery: {e}")
            return EXIT_API_ERROR

    portfolio_id = prof.portfolio_ids[0] if prof.portfolio_ids else None
    if not portfolio_id:
        _log("No portfolio after discovery")
        return EXIT_API_ERROR

    try:
        snap = sc_api.portfolio.snapshot(client, portfolio_id=portfolio_id)
        _write_json(data_dir / "inventory.json", snap["inventory"])
        _write_json(data_dir / "cash.json", snap["cash"])
        _write_json(data_dir / "interest.json", snap["interest"])
        _write_json(data_dir / "crypto.json", snap["crypto"])
        _write_json(data_dir / "pending_orders.json", {"count": snap["pending_orders"]})

        wl = sc_api.portfolio.watchlist(client, portfolio_id=portfolio_id)
        _write_json(data_dir / "watchlist.json", wl)

        tx_page = sc_api.transactions.fetch_page(
            client, portfolio_id=portfolio_id, page_size=100,
        )
        _write_json(data_dir / "transactions.json", tx_page)

        if prof.savings_ids:
            try:
                _write_json(data_dir / "savings.json",
                            sc_api.savings.overview(client))
                _write_json(data_dir / "savings_transactions.json",
                            sc_api.savings.transactions(client))
            except ApiError as e:
                _log(f"savings fetch failed (non-fatal): {e}")

        # Persist identity for next run.
        meta_file.write_text(
            json.dumps({
                "email": prof.email,
                "person_id": prof.person_id,
                "portfolio_ids": prof.portfolio_ids,
                "savings_ids": prof.savings_ids,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00",
                                            time.gmtime()),
            }, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        (data_dir / "last_update.date").write_text(
            time.strftime("%Y-%m-%d %H:%M:%S\n"), encoding="utf-8",
        )
        _log("OK")
        return EXIT_OK

    except SessionExpired:
        return EXIT_MFA_REQUIRED
    except ApiError as e:
        _log(f"api error: {e}")
        return EXIT_API_ERROR


def _write_json(path: Path, data) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str),
                   encoding="utf-8")
    os.replace(tmp, path)


if __name__ == "__main__":
    raise SystemExit(main())
