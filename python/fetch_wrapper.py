"""ownCloud-side Python wrapper around sc-api.

Invoked by `ScalableService::runFetch()` via proc_open. Per-user paths and
encrypted credentials reach us via:

    argv:  --email <email> --data-dir <abs path> [--full]
    env:   SC_EMAIL=<email>    (mirror of argv, for sc_api callers)
           SC_PASSWORD=<pwd>   (decrypted from ICrypto by ScalableService)
           HOME=/tmp           (sc_api never touches ~)

We pass --email on argv too so it shows up in `ps -ef` (no secret in argv),
but the password is env-only.

Auth model — no two-step MFA call out to PHP. The push 2FA approval happens
INSIDE this wrapper, while it polls Scalable's validate2faOnLogin GraphQL:

    1. Try loading cookies.txt from data-dir
    2. Probe /cockpit/graphql with a cheap query
    3. If alive → fetch data, exit 0
    4. If dead → run sc_api.auth.login_flow(email, password):
         a. Auth0 password POST
         b. start2faOnLogin → push hits user's phone
         c. poll validate2faOnLogin every 2s
            i.   SUCCESS → save cookies, fetch data, exit 0
            ii.  DENY    → exit 11 (mfa_invalid)
            iii. TIMEOUT → exit 11 (mfa_invalid)
    5. If email/password rejected → exit 12 (auth_failed)

Exit codes (canonical, mirrored from tr-api/gbm-mx-api wrappers via
TR-GBM-Project/TECHNICAL-PATTERNS.md #2):

    0  EXIT_OK
   10  EXIT_MFA_REQUIRED   — cookies dead AND no credentials in env
   11  EXIT_MFA_INVALID    — push denied / timed out
   12  EXIT_AUTH_FAILED    — email/password rejected
   20  EXIT_API_ERROR
   30  EXIT_CONFIG_ERROR   — lib missing / paths wrong
"""
from __future__ import annotations

import argparse
import json
import os
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
    # ISO-8601 UTC prefix so fetch.log's stderr section reads as a timeline
    # and timestamps line up with owncloud.log (also UTC on the server).
    ts = time.strftime("%H:%M:%SZ", time.gmtime())
    print(f"[fetch_wrapper {ts}] {msg}", file=sys.stderr, flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--full", action="store_true")
    args = parser.parse_args(argv)

    data_dir = Path(args.data_dir)
    cookies_path = data_dir / "cookies.txt"
    meta_file = data_dir / "meta.json"
    data_dir.mkdir(parents=True, exist_ok=True)

    password = os.environ.get("SC_PASSWORD", "")
    _log(
        f"start: email={args.email} full={args.full} "
        f"cookies={'present' if cookies_path.is_file() else 'none'} "
        f"creds={'yes' if password else 'no'}"
    )

    try:
        import sc_api
        from sc_api import ScalableClient, profiles, identity, cookies as _cookies
        from sc_api.auth import login_flow
        from sc_api.exceptions import (
            SessionExpired, MissingSessionCookies, ApiError,
            InvalidCredentials, PushDenied, PushTimeout, PushSetupError, LoginError,
        )
    except ImportError as e:
        _log(f"sc-api not installed: {e}")
        return EXIT_CONFIG_ERROR

    # ----- per-invocation profile scoped to per-user dir -------------
    class _ScopedProfile(profiles.Profile):
        @property
        def dir(self):  # type: ignore[override]
            return data_dir
        @property
        def meta_file(self):  # type: ignore[override]
            return meta_file
        @property
        def cookies_file(self):  # type: ignore[override]
            return cookies_path

    prof = _ScopedProfile(email=args.email)

    # Load persisted identity if it exists.
    if meta_file.is_file():
        try:
            saved = json.loads(meta_file.read_text(encoding="utf-8"))
            prof.person_id = saved.get("person_id")
            prof.portfolio_ids = saved.get("portfolio_ids") or []
            prof.savings_ids = saved.get("savings_ids") or []
        except (json.JSONDecodeError, OSError) as e:
            _log(f"meta.json unreadable, will rediscover: {e}")

    # ----- try existing cookies first --------------------------------
    client = None
    if cookies_path.is_file():
        try:
            jar = _cookies.load_from_file(cookies_path)
            if not prof.person_id:
                session_cookie = next(
                    (c.value for c in jar if c.name == _cookies.REQUIRED_COOKIE),
                    None,
                )
                if session_cookie:
                    try:
                        prof.person_id = _cookies.parse_session_cookie(session_cookie)
                    except Exception:
                        pass

            if prof.person_id:
                client = ScalableClient.from_profile(prof)
                # Probe with a cheap call — if cookies are dead this raises
                # SessionExpired and we fall through to login_flow().
                _ = identity.discover(client)
        except (SessionExpired, MissingSessionCookies):
            _log("Cookies expired/missing — will try programmatic login.")
            client = None
        except Exception as e:
            _log(f"Cookie probe failed: {e}")
            client = None

    # ----- fallback: programmatic login (push 2FA) -------------------
    if client is None:
        if not password:
            _log("No password in env and cookies invalid — credentials needed.")
            return EXIT_MFA_REQUIRED
        try:
            _log("Triggering push 2FA approval on user's phone...")
            result = login_flow(email=args.email, password=password)
            _cookies.save_jar_to_file(result.cookies, cookies_path)
            prof.person_id = result.user_id
            client = ScalableClient.from_profile(prof)
            _log("Login successful, cookies persisted.")
        except InvalidCredentials as e:
            _log(f"Auth failed: {e}")
            return EXIT_AUTH_FAILED
        except (PushDenied, PushTimeout) as e:
            _log(f"Push not approved: {e}")
            return EXIT_MFA_INVALID
        except (PushSetupError, LoginError) as e:
            _log(f"Login flow error: {e}")
            return EXIT_MFA_INVALID
        except Exception as e:
            _log(f"Unexpected login failure: {e}")
            return EXIT_API_ERROR

    # ----- discovery + fetch ----------------------------------------
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

        if args.full:
            tx_items = sc_api.transactions.fetch_all(
                client, portfolio_id=portfolio_id, max_pages=100,
            )
            tx_payload = {"items": tx_items, "page_info": {"total": len(tx_items)}}
        else:
            tx_payload = sc_api.transactions.fetch_page(
                client, portfolio_id=portfolio_id, page_size=100,
            )
        _write_json(data_dir / "transactions.json", tx_payload)

        # Wealth — Scalable's roboadvisor side. Carlos's killer feature.
        try:
            wealth_detail = sc_api.wealth.fetch_all_detail(client)
            _write_json(data_dir / "wealth_detail.json", wealth_detail)
            # Lightweight overview = detail without the heavy history arrays;
            # the wealth list page (wealth.json) uses just id/name/value/status.
            overview = [{
                "portfolioId": w.get("portfolioId") or w.get("id"),
                "name":        w.get("name"),
                "status":      w.get("status"),
                "currentValue": w.get("currentValue") or w.get("value"),
            } for w in (wealth_detail or []) if isinstance(w, dict)]
            _write_json(data_dir / "wealth.json", overview)
        except (AttributeError, ApiError) as e:
            _log(f"wealth fetch skipped: {e}")

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
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        _write_json(data_dir / "last_update.json", {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })
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
