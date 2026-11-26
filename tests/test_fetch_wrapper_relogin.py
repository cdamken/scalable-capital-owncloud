"""
Cookie-probe re-login policy for python/fetch_wrapper.py.

The wrapper must trigger a programmatic login (and therefore a 2FA push to the
user's phone) ONLY when there is evidence the session is dead. A transport
blip, a 5xx/429, a non-JSON reply or a bug of ours must NOT cause a push; they
end with a clear exit code and leave the cookies intact.

These tests install a fake `sc_api` in sys.modules (the wrapper imports it
lazily inside _run, so no real library is needed) and spy on login_flow to
assert, per exception class, whether a re-login was attempted.

Run with:  python3 -m unittest discover -s tests/
"""
import importlib.util
import json
import os
import sys
import types
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WRAPPER_PATH = REPO_ROOT / "python" / "fetch_wrapper.py"

EXIT_MFA_REQUIRED = 10
EXIT_MFA_INVALID = 11
EXIT_API_ERROR = 20
EXIT_CONFIG_ERROR = 30


def _load_wrapper():
    """Import python/fetch_wrapper.py as a module (it imports sc_api lazily,
    so this works without the real library installed)."""
    spec = importlib.util.spec_from_file_location("fetch_wrapper_under_test", WRAPPER_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---- fake sc_api exception hierarchy (names + inheritance must match real) --
class ScApiError(Exception):
    pass


class CookieError(ScApiError):
    pass


class MissingSessionCookies(CookieError):
    pass


class InvalidSessionCookie(CookieError):
    pass


class DiscoveryError(ScApiError):
    pass


class AuthError(ScApiError):
    pass


class SessionExpired(AuthError):
    pass


class LoginError(AuthError):
    pass


class InvalidCredentials(LoginError):
    pass


class PushDenied(LoginError):
    pass


class PushTimeout(LoginError):
    pass


class PushSetupError(LoginError):
    pass


class ApiError(ScApiError):
    pass


class _Profile:
    """Minimal stand-in for sc_api.profiles.Profile (subclassed by the wrapper
    as _ScopedProfile, which overrides dir/meta_file/cookies_file)."""

    def __init__(self, email=None):
        self.email = email
        self.person_id = None
        self.portfolio_ids = []
        self.savings_ids = []


def _install_fake_sc_api(discover_raises=None, load_behavior=None):
    """Build a fake sc_api whose identity.discover raises `discover_raises`, and
    whose auth.login_flow records that it was called then raises PushTimeout
    (so the wrapper exits 11 cleanly). Returns a dict with the call spy.

    load_behavior controls cookies.load_from_file:
      None            -> returns an empty jar (the default, probe reaches discover)
      an Exception    -> raised as-is (e.g. PermissionError)
      "real"          -> runs the REAL http.cookiejar loader on the file, so a
                         garbage/empty cookies.txt produces a genuine LoadError.
    """
    spy = {"login_flow_called": False}

    exceptions = types.ModuleType("sc_api.exceptions")
    for name, cls in {
        "ScApiError": ScApiError, "CookieError": CookieError,
        "MissingSessionCookies": MissingSessionCookies,
        "InvalidSessionCookie": InvalidSessionCookie,
        "DiscoveryError": DiscoveryError, "AuthError": AuthError,
        "SessionExpired": SessionExpired, "LoginError": LoginError,
        "InvalidCredentials": InvalidCredentials, "PushDenied": PushDenied,
        "PushTimeout": PushTimeout, "PushSetupError": PushSetupError,
        "ApiError": ApiError,
    }.items():
        setattr(exceptions, name, cls)

    identity = types.ModuleType("sc_api.identity")

    def _discover(client):
        raise discover_raises
    identity.discover = _discover

    cookies = types.ModuleType("sc_api.cookies")
    cookies.REQUIRED_COOKIE = "sc_session"

    def _load_from_file(path):
        if load_behavior is None:
            return []
        if load_behavior == "real":
            # Run the REAL loader on the real tmp file so a garbage/empty
            # cookies.txt raises a genuine http.cookiejar.LoadError.
            from http.cookiejar import MozillaCookieJar
            jar = MozillaCookieJar(str(path))
            jar.load(ignore_discard=True, ignore_expires=True)
            return jar
        raise load_behavior  # an Exception instance, e.g. PermissionError
    cookies.load_from_file = _load_from_file
    cookies.parse_session_cookie = lambda v: "person-xyz"
    cookies.save_jar_to_file = lambda jar, path: None

    auth = types.ModuleType("sc_api.auth")

    def _login_flow(email=None, password=None):
        spy["login_flow_called"] = True
        raise PushTimeout("push timed out (test)")
    auth.login_flow = _login_flow

    profiles = types.ModuleType("sc_api.profiles")
    profiles.Profile = _Profile

    class _ScalableClient:
        @classmethod
        def from_profile(cls, prof):
            return cls()
    identity_client = _ScalableClient

    sc_api = types.ModuleType("sc_api")
    sc_api.__version__ = "0.0.0-test"
    sc_api.ScalableClient = identity_client
    sc_api.profiles = profiles
    sc_api.identity = identity
    sc_api.cookies = cookies
    sc_api.auth = auth
    sc_api.exceptions = exceptions
    # Attributes only reached on the success path (not in these tests), stubbed
    # so an accidental reach fails loudly rather than ImportError-ing.
    for name in ("portfolio", "transactions", "wealth", "savings"):
        setattr(sc_api, name, types.ModuleType(f"sc_api.{name}"))

    sys.modules["sc_api"] = sc_api
    sys.modules["sc_api.exceptions"] = exceptions
    sys.modules["sc_api.auth"] = auth
    sys.modules["sc_api.identity"] = identity
    sys.modules["sc_api.cookies"] = cookies
    sys.modules["sc_api.profiles"] = profiles
    return spy


class TestCookieProbeReloginPolicy(unittest.TestCase):
    def setUp(self):
        self._saved_modules = {k: sys.modules.get(k) for k in (
            "sc_api", "sc_api.exceptions", "sc_api.auth",
            "sc_api.identity", "sc_api.cookies", "sc_api.profiles",
        )}
        self._saved_pw = os.environ.get("SC_PASSWORD")
        os.environ["SC_PASSWORD"] = "test-password"
        self._tmp = Path(__import__("tempfile").mkdtemp())
        # cookies.txt present + meta.json with a person_id => the wrapper builds
        # a client and probes identity.discover (the branch under test).
        (self._tmp / "cookies.txt").write_text("# netscape cookie jar\n")
        (self._tmp / "meta.json").write_text(json.dumps({
            "person_id": "person-xyz", "portfolio_ids": ["pf1"], "savings_ids": [],
        }))

    def tearDown(self):
        for k, v in self._saved_modules.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v
        if self._saved_pw is None:
            os.environ.pop("SC_PASSWORD", None)
        else:
            os.environ["SC_PASSWORD"] = self._saved_pw
        __import__("shutil").rmtree(self._tmp, ignore_errors=True)

    def _run_with(self, discover_raises=None, load_behavior=None):
        spy = _install_fake_sc_api(discover_raises=discover_raises, load_behavior=load_behavior)
        wrapper = _load_wrapper()
        rc = wrapper.main(["--email", "nobody@example.com", "--data-dir", str(self._tmp)])
        return rc, spy["login_flow_called"]

    # --- session is dead => MUST re-login (push) ---
    def test_session_expired_relogins(self):
        rc, called = self._run_with(SessionExpired("dead"))
        self.assertTrue(called, "SessionExpired must trigger re-login")
        self.assertEqual(rc, EXIT_MFA_INVALID)  # login_flow spy raises PushTimeout

    def test_missing_cookies_relogins(self):
        rc, called = self._run_with(MissingSessionCookies("gone"))
        self.assertTrue(called, "MissingSessionCookies must trigger re-login")
        self.assertEqual(rc, EXIT_MFA_INVALID)

    def test_invalid_cookie_relogins(self):
        rc, called = self._run_with(InvalidSessionCookie("garbled"))
        self.assertTrue(called, "InvalidSessionCookie must trigger re-login")
        self.assertEqual(rc, EXIT_MFA_INVALID)

    # --- NOT session death => must NOT push ---
    def test_api_error_does_not_relogin(self):
        rc, called = self._run_with(ApiError("502 upstream"))
        self.assertFalse(called, "ApiError (transport/5xx) must NOT push")
        self.assertEqual(rc, EXIT_API_ERROR)

    def test_discovery_error_does_not_relogin(self):
        rc, called = self._run_with(DiscoveryError("batch failed"))
        self.assertFalse(called, "DiscoveryError must NOT push")
        self.assertEqual(rc, EXIT_API_ERROR)

    def test_unexpected_bug_does_not_relogin(self):
        rc, called = self._run_with(KeyError("inventory"))
        self.assertFalse(called, "a bug of ours must NOT push")
        self.assertEqual(rc, EXIT_API_ERROR)

    def test_permission_error_does_not_relogin(self):
        # A real filesystem error reading cookies.txt (NOT a LoadError) stays a
        # config error and must not push.
        rc, called = self._run_with(load_behavior=PermissionError("denied"))
        self.assertFalse(called, "PermissionError must NOT push")
        self.assertEqual(rc, EXIT_CONFIG_ERROR)

    # --- corrupt/empty/truncated cookies.txt => session dead => MUST re-login --
    # http.cookiejar.LoadError is an OSError subclass; it must be classified as
    # "no usable session" (re-login self-heals the file), NOT a config dead-end.
    def test_corrupt_cookie_file_relogins(self):
        (self._tmp / "cookies.txt").write_text("this is not a netscape cookie jar\n")
        rc, called = self._run_with(load_behavior="real")
        self.assertTrue(called, "corrupt cookies.txt must trigger re-login")
        self.assertEqual(rc, EXIT_MFA_INVALID)

    def test_empty_cookie_file_relogins(self):
        (self._tmp / "cookies.txt").write_text("")
        rc, called = self._run_with(load_behavior="real")
        self.assertTrue(called, "empty cookies.txt must trigger re-login")
        self.assertEqual(rc, EXIT_MFA_INVALID)

    def test_truncated_cookie_file_relogins(self):
        # Valid Netscape header then a truncated/garbage data line.
        (self._tmp / "cookies.txt").write_text(
            "# Netscape HTTP Cookie File\n.scalable.capital\tTRUE\t/\n"
        )
        rc, called = self._run_with(load_behavior="real")
        self.assertTrue(called, "truncated cookies.txt must trigger re-login")
        self.assertEqual(rc, EXIT_MFA_INVALID)

    def test_non_utf8_cookie_file_relogins(self):
        # Non-UTF-8 bytes make MozillaCookieJar.load raise UnicodeDecodeError
        # (from the magic-header readline, outside the stdlib loader's try). It
        # must be treated as an unusable session, not a permanent 502.
        (self._tmp / "cookies.txt").write_bytes(
            b"# Netscape HTTP Cookie File\n\xff\xfe\x00garbage\x80\x81\n"
        )
        rc, called = self._run_with(load_behavior="real")
        self.assertTrue(called, "non-UTF-8 cookies.txt must trigger re-login")
        self.assertEqual(rc, EXIT_MFA_INVALID)


if __name__ == "__main__":
    unittest.main()
