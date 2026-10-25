"""SQLite store for email alert subscribers.

One row per email address (case-insensitive). A row is created with verified = 0; the owner clicks the emailed
link to set verified = 1. Once an address is in the table, in either state, it is never sent another
verification email. Verified subscribers get at most one alert per day, tracked by last_sent_date.
"""
import secrets
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  address TEXT NOT NULL,
  premise_idx INTEGER NOT NULL,
  premise_id TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  verify_token TEXT,
  unsub_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT,
  last_sent_date TEXT
);
"""


def connect(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute(SCHEMA)
    cols = {r["name"] for r in con.execute("PRAGMA table_info(subscribers)")}
    for col in ("verify_token", "unsub_token"):   # databases made by an earlier version
        if col not in cols:
            con.execute(f"ALTER TABLE subscribers ADD COLUMN {col} TEXT")
    for r in con.execute("SELECT id FROM subscribers WHERE verify_token IS NULL OR unsub_token IS NULL").fetchall():
        con.execute("UPDATE subscribers SET verify_token = ?, unsub_token = ? WHERE id = ?", (new_token(), new_token(), r["id"]))
    con.commit()
    return con


def new_token():
    """Random, unguessable link token. It is stored with the row, so no signing secret (or secret file) is needed."""
    return secrets.token_urlsafe(32)


def add_subscriber(con, email, address, premise_idx, premise_id):
    """Insert an unverified subscriber. Returns the new id, or None if the email is already in the table."""
    try:
        cur = con.execute("INSERT INTO subscribers (email, address, premise_idx, premise_id, verify_token, unsub_token) VALUES (?, ?, ?, ?, ?, ?)",
                          (email, address, premise_idx, premise_id, new_token(), new_token()))
        con.commit()
        return cur.lastrowid
    except sqlite3.IntegrityError:
        return None


def delete(con, sub_id):
    con.execute("DELETE FROM subscribers WHERE id = ?", (sub_id,))
    con.commit()


def get(con, sub_id):
    return con.execute("SELECT * FROM subscribers WHERE id = ?", (sub_id,)).fetchone()


def mark_verified(con, sub_id):
    cur = con.execute("UPDATE subscribers SET verified = 1, verified_at = COALESCE(verified_at, datetime('now')) WHERE id = ?", (sub_id,))
    con.commit()
    return cur.rowcount == 1


def verified_due(con, today):
    """Verified subscribers who have not been emailed on `today`."""
    return con.execute("SELECT * FROM subscribers WHERE verified = 1 AND (last_sent_date IS NULL OR last_sent_date != ?)", (today,)).fetchall()


def claim_today(con, sub_id, today):
    """Atomically reserve today's single alert. True if this caller got it (so concurrent workers cannot double-send)."""
    cur = con.execute("UPDATE subscribers SET last_sent_date = ? WHERE id = ? AND verified = 1 AND (last_sent_date IS NULL OR last_sent_date != ?)",
                      (today, sub_id, today))
    con.commit()
    return cur.rowcount == 1


def release_claim(con, sub_id, previous):
    con.execute("UPDATE subscribers SET last_sent_date = ? WHERE id = ?", (previous, sub_id))
    con.commit()
