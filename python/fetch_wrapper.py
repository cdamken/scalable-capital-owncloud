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
import traceback
from http.cookiejar import LoadError
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


def _run(argv: list[str] | None = None) -> int:
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
            SessionExpired, MissingSessionCookies, InvalidSessionCookie,
            DiscoveryError, ApiError,
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
                    # A malformed value raises InvalidSessionCookie, caught below
                    # as session-dead (re-login). We deliberately do NOT swallow
                    # it here: a bug of ours parsing it should NOT trigger a push.
                    prof.person_id = _cookies.parse_session_cookie(session_cookie)

            if prof.person_id:
                client = ScalableClient.from_profile(prof)
                # Probe with a cheap call — if cookies are dead this raises
                # SessionExpired and we fall through to login_flow().
                _ = identity.discover(client)
        # Re-login (and therefore the 2FA push to Carlos's phone) ONLY when
        # there is evidence the session is dead: an expired/invalid/missing
        # session cookie, or a cookies.txt we cannot parse. Everything else — a
        # transport blip, a 5xx/429, a non-JSON reply, or a bug of ours — must
        # NOT trigger a push; it ends with a clear exit code and leaves the
        # cookies intact so the next run can still use them.
        except (SessionExpired, MissingSessionCookies, InvalidSessionCookie) as e:
            _log(f"re-login because session is dead: {type(e).__name__}: {e}")
            client = None
        except LoadError as e:
            # cookies.txt is corrupt/empty/truncated (http.cookiejar.LoadError is
            # a subclass of OSError, so it MUST be caught before OSError). That is
            # evidence of no usable session, and a fresh login rewrites the file —
            # so re-login and self-heal, don't dead-end on a config error.
            _log(f"re-login because session is dead: unreadable cookie file: {type(e).__name__}: {e}")
            client = None
        except OSError as e:
            # A real filesystem error (PermissionError, IsADirectoryError, …), not
            # a bad-format LoadError. A fresh login would hit it again on save.
            _log(f"cookies.txt filesystem error (no re-login): {type(e).__name__}: {e}")
            return EXIT_CONFIG_ERROR
        except (ApiError, DiscoveryError) as e:
            # Transport / 5xx / 429 / non-JSON (client wraps 401/403 as
            # SessionExpired, so these are NOT session death). No push.
            _log(f"cookie probe transport/API error (no re-login): {type(e).__name__}: {e}")
            return EXIT_API_ERROR
        except Exception as e:
            # A bug of ours (KeyError/AttributeError/TypeError…) must not punish
            # the user with a needless push. Surface it as an API error instead.
            # Full traceback first so the server log keeps the line number; the
            # one-line summary stays LAST (ApiController shows the last stderr line).
            sys.stderr.write(traceback.format_exc())
            _log(f"cookie probe unexpected error (no re-login): {type(e).__name__}: {e}")
            return EXIT_API_ERROR

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
            _log("discovery: session expired mid-run — push approval needed")
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
        _write_json(data_dir / "crypto_positions.json", snap.get("crypto_positions", []))
        _write_json(data_dir / "pending_orders.json", {"count": snap["pending_orders"]})

        wl = sc_api.portfolio.watchlist(client, portfolio_id=portfolio_id)
        _write_json(data_dir / "watchlist.json", wl)

        # Always fetch the COMPLETE ledger (paginated via cursor). Every
        # reader — orders.js, ledger.js, dividends.js, analytics.js and
        # IngestService — consumes a top-level `transactions` array, so we
        # normalise to exactly that shape. The previous non-full path wrote a
        # single `fetch_page` of 100 (silently dropping older history), and the
        # `--full` path wrapped the flat list under `items`, which none of the
        # readers look at (the ledger/orders/dividends pages came up empty).
        # `--full` is still accepted for API symmetry; with no incremental
        # cursor persisted yet, both modes fetch everything.
        tx_items = sc_api.transactions.fetch_all(
            client, portfolio_id=portfolio_id, page_size=100, max_pages=1000,
        )
        tx_payload = {"transactions": tx_items, "total": len(tx_items)}
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
        _log("fetch: session expired mid-run — push approval needed")
        return EXIT_MFA_REQUIRED
    except ApiError as e:
        _log(f"api error: {e}")
        return EXIT_API_ERROR


def main(argv: list[str] | None = None) -> int:
    """Top-level guard so no uncaught exception leaks out as a bare traceback
    (exit 1), which ApiController maps to a generic HTTP 500. Known exit codes
    returned by _run() pass through unchanged; only genuinely uncaught errors
    land here and get classified: filesystem problems (e.g. data_dir.mkdir,
    _write_json) as EXIT_CONFIG_ERROR, everything else as EXIT_API_ERROR."""
    try:
        return _run(argv)
    except SystemExit:
        raise  # argparse --help / bad-args exit code stays as-is
    except (ConnectionError, TimeoutError) as e:
        # These are OSError subclasses but mean "upstream unreachable", not a
        # local filesystem problem — classify as an API error (502), not config.
        _log(f"network error: {type(e).__name__}: {e}")
        return EXIT_API_ERROR
    except OSError as e:
        _log(f"filesystem error: {type(e).__name__}: {e}")
        return EXIT_CONFIG_ERROR
    except Exception as e:
        # Full traceback first; one-line summary LAST (ApiController surfaces
        # only the last stderr line).
        sys.stderr.write(traceback.format_exc())
        _log(f"unexpected error: {type(e).__name__}: {e}")
        return EXIT_API_ERROR


def _write_json(path: Path, data) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str),
                   encoding="utf-8")
    os.replace(tmp, path)


if __name__ == "__main__":
    raise SystemExit(main())
