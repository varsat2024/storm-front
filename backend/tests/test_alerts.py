"""Run from the backend folder:  python -m unittest tests.test_alerts"""
import asyncio
import os
import tempfile
import unittest

os.environ["ALERT_SECRET"] = "test-secret"
os.environ["PUBLIC_URL"] = "http://x.test"

from app import alerts_db as db          # noqa: E402
from app import alerts_service as svc    # noqa: E402


def run(c):
    return asyncio.run(c)


class AlertsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.con = db.connect(os.path.join(self.dir.name, "a.sqlite"))
        self.sent = []

    def tearDown(self):
        self.con.close()
        self.dir.cleanup()

    def send(self, to, subject, body):
        self.sent.append((to, subject, body))

    def resolve(self, address):
        if "columbus" in address.lower():
            raise svc.OutOfArea(address)
        if "nowhere" in address.lower():
            raise ValueError("No geocode match")
        return 5, "P-0006"

    def sub(self, email="a@b.com", address="123 Main St, Roanoke, VA"):
        return run(svc.subscribe(self.con, email, address, self.resolve, send=self.send))

    def test_new_signup_is_unverified_and_emails_once(self):
        self.assertEqual(self.sub()[0], 200)
        row = self.con.execute("SELECT * FROM subscribers").fetchone()
        self.assertEqual(row["verified"], 0)
        self.assertEqual(len(self.sent), 1)
        self.assertIn("/alerts/verify?id=", self.sent[0][2])
        # same email again (any case), unverified: no second email
        self.sub("A@B.com")
        self.assertEqual(len(self.sent), 1)
        # verified: still no verification email
        db.mark_verified(self.con, row["id"])
        self.sub()
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.con.execute("SELECT COUNT(*) FROM subscribers").fetchone()[0], 1)

    def test_validation_and_bad_address(self):
        self.assertEqual(self.sub("not-an-email")[0], 400)
        self.assertEqual(self.sub(address="x")[0], 400)
        self.assertEqual(self.sub(address="9 Nowhere Rd, Roanoke, VA")[0], 404)
        self.assertEqual(self.sub(address="1 High St, Columbus, OH 43215")[0], 422)
        self.assertEqual(self.con.execute("SELECT COUNT(*) FROM subscribers").fetchone()[0], 0)
        self.assertEqual(self.sent, [])

    def test_failed_verification_email_removes_row(self):
        def boom(*a):
            raise RuntimeError("smtp down")
        self.assertEqual(run(svc.subscribe(self.con, "c@d.com", "123 Main St, Roanoke, VA", self.resolve, send=boom))[0], 502)
        self.assertEqual(self.con.execute("SELECT COUNT(*) FROM subscribers").fetchone()[0], 0)

    def test_tokens(self):
        self.sub()
        row = db.get(self.con, 1)
        # tokens are random per-row values stored in the database (the module no longer signs them)
        self.assertTrue(svc.token_ok("verify", row, row["verify_token"]))
        self.assertTrue(svc.token_ok("unsub", row, row["unsub_token"]))
        self.assertFalse(svc.token_ok("verify", row, row["unsub_token"]))
        self.assertFalse(svc.token_ok("verify", row, "bad"))
        self.assertFalse(svc.token_ok("verify", None, "bad"))

    def test_daily_alert_rules(self):
        self.sub()
        prob = {"P": 0.30}

        async def get(idx):
            return prob["P"]
        # unverified: never alerted
        self.assertEqual(run(svc.run_check(self.con, get, send=self.send, today="2026-01-01")), 0)
        db.mark_verified(self.con, 1)
        self.sent.clear()
        prob["P"] = 0.2499
        self.assertEqual(run(svc.run_check(self.con, get, send=self.send, today="2026-01-01")), 0)
        prob["P"] = 0.25
        self.assertEqual(run(svc.run_check(self.con, get, send=self.send, today="2026-01-01")), 1)
        self.assertEqual(run(svc.run_check(self.con, get, send=self.send, today="2026-01-01")), 0)   # once per day
        self.assertEqual(run(svc.run_check(self.con, get, send=self.send, today="2026-01-02")), 1)   # next day
        self.assertEqual(len(self.sent), 2)
        self.assertEqual(db.get(self.con, 1)["last_sent_date"], "2026-01-02")
        self.assertIn("/alerts/unsubscribe?id=", self.sent[0][2])

    def test_failed_alert_send_does_not_use_up_the_day(self):
        self.sub()
        db.mark_verified(self.con, 1)

        async def get(idx):
            return 0.5

        def boom(*a):
            raise RuntimeError("smtp down")
        self.assertEqual(run(svc.run_check(self.con, get, send=boom, today="2026-01-01")), 0)
        self.assertIsNone(db.get(self.con, 1)["last_sent_date"])
        self.assertEqual(run(svc.run_check(self.con, get, send=self.send, today="2026-01-01")), 1)


if __name__ == "__main__":
    unittest.main()
