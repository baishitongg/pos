-- PostgreSQL schema for production (the prototype uses data/db.json).
-- Money is stored as integer cents. Every table carries outlet_id so one
-- deployment can serve several restaurants/branches.

CREATE TABLE outlets (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  currency      char(3) NOT NULL DEFAULT 'MYR',
  timezone      text NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  service_rate  numeric(5,4) NOT NULL DEFAULT 0.10,
  tax_rate      numeric(5,4) NOT NULL DEFAULT 0.06,
  menu_version  integer NOT NULL DEFAULT 1
);

CREATE TABLE categories (
  outlet_id  text NOT NULL REFERENCES outlets(id),
  id         text NOT NULL,
  name       jsonb NOT NULL,             -- {"en": "...", "zh": "..."}
  sort       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (outlet_id, id)
);

CREATE TABLE menu_items (
  outlet_id     text NOT NULL REFERENCES outlets(id),
  id            text NOT NULL,
  category_id   text NOT NULL,
  name          jsonb NOT NULL,
  description   jsonb NOT NULL DEFAULT '{}',
  price_cents   integer NOT NULL CHECK (price_cents >= 0),
  emoji         text,
  image_url     text,
  tags          text[] NOT NULL DEFAULT '{}',
  option_groups jsonb NOT NULL DEFAULT '[]',   -- [{id,name,min,max,options:[{id,name,price}]}]
  available     boolean NOT NULL DEFAULT true,
  sort          integer NOT NULL DEFAULT 0,
  PRIMARY KEY (outlet_id, id),
  FOREIGN KEY (outlet_id, category_id) REFERENCES categories(outlet_id, id)
);

CREATE TABLE dining_tables (
  outlet_id   text NOT NULL REFERENCES outlets(id),
  id          text NOT NULL,
  name        text NOT NULL,
  qr_version  integer NOT NULL DEFAULT 1,   -- bump to invalidate printed QR codes
  active      boolean NOT NULL DEFAULT true,
  session_id  text,                          -- current open dining session
  PRIMARY KEY (outlet_id, id)
);

CREATE TABLE orders (
  id              text PRIMARY KEY,
  outlet_id       text NOT NULL REFERENCES outlets(id),
  business_day    date NOT NULL,
  order_no        integer NOT NULL,          -- daily running number shown to guests
  table_id        text NOT NULL,
  session_id      text NOT NULL,
  status          text NOT NULL CHECK (status IN ('new','preparing','ready','served','cancelled')),
  payment_method  text NOT NULL DEFAULT 'counter',
  paid            boolean NOT NULL DEFAULT false,
  subtotal_cents  integer NOT NULL,
  service_cents   integer NOT NULL,
  tax_cents       integer NOT NULL,
  total_cents     integer NOT NULL,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outlet_id, business_day, order_no),
  UNIQUE (outlet_id, table_id, idempotency_key)   -- duplicate-submit protection
);
CREATE INDEX orders_active_idx  ON orders (outlet_id, created_at) WHERE status IN ('new','preparing','ready');
CREATE INDEX orders_session_idx ON orders (session_id);
CREATE INDEX orders_day_idx     ON orders (outlet_id, business_day);

CREATE TABLE order_lines (
  order_id         text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_no          smallint NOT NULL,
  item_id          text NOT NULL,
  item_name        jsonb NOT NULL,           -- snapshot, so menu edits never change history
  qty              smallint NOT NULL CHECK (qty BETWEEN 1 AND 50),
  unit_price_cents integer NOT NULL,
  options          jsonb NOT NULL DEFAULT '[]',
  note             varchar(140) NOT NULL DEFAULT '',
  line_total_cents integer NOT NULL,
  PRIMARY KEY (order_id, line_no)
);

CREATE TABLE order_events (                  -- audit trail of status changes
  id         bigserial PRIMARY KEY,
  order_id   text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     text NOT NULL,
  actor      text,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id);

CREATE TABLE service_requests (
  id          text PRIMARY KEY,
  outlet_id   text NOT NULL REFERENCES outlets(id),
  table_id    text NOT NULL,
  type        text NOT NULL CHECK (type IN ('waiter','bill','water')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX service_requests_open_idx ON service_requests (outlet_id) WHERE resolved_at IS NULL;

CREATE TABLE staff_users (
  id            text PRIMARY KEY,
  outlet_id     text NOT NULL REFERENCES outlets(id),
  username      citext UNIQUE NOT NULL,      -- requires: CREATE EXTENSION citext;
  role          text NOT NULL CHECK (role IN ('admin','kitchen')),
  password_hash text NOT NULL,               -- scrypt$salt$hash
  created_at    timestamptz NOT NULL DEFAULT now()
);
