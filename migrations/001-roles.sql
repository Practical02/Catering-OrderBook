-- Run once on a database created before the three-role change.
-- admin -> owner, staff -> kitchen. Safe to retry: if it fails, nothing is changed.
PRAGMA defer_foreign_keys = on;

CREATE TABLE users_backup AS SELECT * FROM users;

DROP TABLE users;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'taker', 'kitchen')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users (id, name, salt, pin_hash, role, active, created_at)
SELECT id, name, salt, pin_hash,
       CASE role WHEN 'admin' THEN 'owner' WHEN 'staff' THEN 'kitchen' ELSE role END,
       active, created_at
FROM users_backup;

DROP TABLE users_backup;
