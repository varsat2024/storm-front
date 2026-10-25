"""Simulate the 25% alert without waiting for real weather.

Run from the backend folder:
    python -m app.simulate_alert you@example.com            # pretend the outage chance is 30% and send the alert now
    python -m app.simulate_alert you@example.com --p 0.2    # 20% is below the threshold, so nothing is sent
    python -m app.simulate_alert you@example.com --reset    # also clear today's "already sent" mark first, to test again

The subscriber must already be in the database and verified (click the link in the confirmation email first, or pass
--verify to mark it verified here for testing). The normal once-per-day rule still applies unless you use --reset.
"""
import argparse
import asyncio

from app import alerts_db as db
from app import alerts_service as svc


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("email", help="a subscriber's email address")
    ap.add_argument("--p", type=float, default=0.30, help="outage probability to pretend (default 0.30)")
    ap.add_argument("--reset", action="store_true", help="clear last_sent_date so today's alert can be sent again")
    ap.add_argument("--verify", action="store_true", help="mark the subscriber verified (testing only)")
    a = ap.parse_args()

    con = db.connect(svc.db_path())
    row = con.execute("SELECT * FROM subscribers WHERE email = ?", (a.email.strip(),)).fetchone()
    if not row:
        raise SystemExit(f"{a.email} is not in the database. Sign up on the page first.")
    if a.verify:
        db.mark_verified(con, row["id"])
    if a.reset:
        con.execute("UPDATE subscribers SET last_sent_date = NULL WHERE id = ?", (row["id"],))
        con.commit()
    row = db.get(con, row["id"])
    print(f"{row['email']}: verified={row['verified']} last_sent_date={row['last_sent_date']} premise={row['premise_id']}")
    if not row["verified"]:
        raise SystemExit("Not verified yet: open the link in the confirmation email (or re-run with --verify).")

    async def fake_probability(_premise_idx):
        return a.p

    sent = asyncio.run(svc.run_check(con, fake_probability, only_email=row["email"]))
    limit = svc.alert_threshold()
    if sent:
        print(f"Sent the alert (pretend probability {a.p:.0%} >= threshold {limit:.0%}).")
    elif a.p < limit:
        print(f"Nothing sent: {a.p:.0%} is below the {limit:.0%} threshold.")
    else:
        print("Nothing sent: an alert was already sent today. Re-run with --reset to test again.")


if __name__ == "__main__":
    main()
