"""Send plain-text email through SMTP. With SMTP_HOST unset, messages are written to backend/outbox/ as .eml files instead
(development mode: nothing is actually delivered)."""
import os
import smtplib
import time
from email.message import EmailMessage
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip().strip('"').strip("'")


def smtp_configured() -> bool:
    return bool(_env("SMTP_HOST"))


def _redacted_print(*args):
    """smtplib's debug output contains the base64 login (which is trivially reversible), so hide it."""
    import sys
    text = " ".join(str(a) for a in args)
    if text.startswith("send: 'AUTH") or (text.startswith("send: '") and text.rstrip().endswith("\\r\\n'") and "=" in text and " " not in text[7:-5]):
        text = "send: <login credentials hidden>"
    print(text, file=sys.stderr)


def _login_once(s, user, password):
    """Make exactly ONE login attempt. smtplib's login() tries every mechanism the server lists (CRAM-MD5, PLAIN, LOGIN),
    so a single wrong password counts as up to three bad attempts, which makes providers like Yahoo lock the account."""
    s.ehlo_or_helo_if_needed()
    if not s.has_extn("auth"):
        raise smtplib.SMTPNotSupportedError("The server does not offer login (AUTH).")
    s.user, s.password = user, password
    offered = s.esmtp_features["auth"].split()
    if "PLAIN" in offered:
        s.auth("PLAIN", s.auth_plain, initial_response_ok=True)
    elif "LOGIN" in offered:
        s.auth("LOGIN", s.auth_login)
    else:
        raise smtplib.SMTPNotSupportedError("The server offers no supported login method (needs PLAIN or LOGIN): " + " ".join(offered))


def send_email(to, subject, body):
    host, user = _env("SMTP_HOST"), _env("SMTP_USER")
    msg = EmailMessage()
    # Most providers (Gmail, Outlook, ...) only accept a From address that matches the authenticated account.
    msg["From"] = _env("MAIL_FROM") or user or "stormfront-alerts@localhost"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    if not host:
        out = Path(_env("OUTBOX_DIR") or Path(__file__).resolve().parents[1] / "outbox")
        out.mkdir(parents=True, exist_ok=True)
        path = out / f"{time.strftime('%Y%m%d-%H%M%S')}-{time.time_ns() % 10**8}.eml"
        path.write_text(msg.as_string(), encoding="utf-8")
        print(f"[mail] SMTP_HOST is not set: NOT sent. Saved to {path}")
        return
    port = int(_env("SMTP_PORT", "587"))
    try:
        # Name announced in EHLO. Python falls back to an IP literal like "[192.168.1.5]" when this computer has no
        # fully-qualified name, and some servers drop the connection for that. Use a plain hostname instead.
        import socket
        ehlo = _env("SMTP_EHLO") or (socket.getfqdn() if "." in socket.getfqdn() else "localhost")
        kw = {"timeout": 30, **({"local_hostname": ehlo} if ehlo else {})}
        with (smtplib.SMTP_SSL(**kw) if port == 465 else smtplib.SMTP(**kw)) as s:
            if _env("ALERT_DEBUG").lower() in ("1", "true", "yes"):
                s.set_debuglevel(1)   # prints the SMTP conversation; credentials are redacted below
                s._print_debug = _redacted_print
            s.connect(host, port)
            if port != 465 and _env("SMTP_STARTTLS", "1") == "1":
                s.starttls()
            if user:
                _login_once(s, user, _env("SMTP_PASS"))
            refused = s.send_message(msg)
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)
        print(f"[mail] sent '{subject}' via {host}:{port}")
    except Exception as e:
        print(f"[mail] FAILED via {host}:{port} as {user or '(no login)'}: {type(e).__name__}: {e}")
        raise


if __name__ == "__main__":
    # Test your SMTP settings:  python -m app.mailer you@example.com     (run from the backend folder)
    import sys
    to = sys.argv[1] if len(sys.argv) > 1 else _env("SMTP_USER")
    if not to:
        sys.exit("Usage: python -m app.mailer recipient@example.com")
    print(f"SMTP_HOST={_env('SMTP_HOST') or '(unset)'} SMTP_PORT={_env('SMTP_PORT', '587')} SMTP_USER={_env('SMTP_USER') or '(unset)'} "
          f"MAIL_FROM={_env('MAIL_FROM') or '(unset)'} password set: {bool(_env('SMTP_PASS'))}")
    send_email(to, "Stormfront SMTP test", "If you can read this, your SMTP settings work.")
    print("Done.")
