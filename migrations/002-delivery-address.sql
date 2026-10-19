-- Safe migration to add Serving delivery type and address column without cascade deleting items or payments.
PRAGMA foreign_keys = OFF;

CREATE TABLE orders_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_date TEXT NOT NULL,
  meal TEXT NOT NULL CHECK (meal IN ('Breakfast', 'Lunch', 'Dinner', 'Custom')),
  custom_time TEXT,
  customer_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  delivery_type TEXT NOT NULL CHECK (delivery_type IN ('Srishti', 'DH', 'Auto', 'Delivery', 'Serving')),
  address TEXT NOT NULL DEFAULT '',
  misc TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'prepared', 'delivered', 'cancelled')),
  total_amount INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO orders_new (id, order_date, meal, custom_time, customer_name, mobile, delivery_type, address, misc, status, total_amount, created_by, created_at, updated_at)
SELECT id, order_date, meal, custom_time, customer_name, mobile, delivery_type, COALESCE(address, ''), misc, status, total_amount, created_by, created_at, updated_at
FROM orders;

DROP TABLE orders;

ALTER TABLE orders_new RENAME TO orders;

CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);

PRAGMA foreign_keys = ON;

