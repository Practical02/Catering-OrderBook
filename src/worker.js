// Order Book API. Static files in /public are served by the assets binding;
// this Worker only handles /api/*.

const DELIVERY = ['Srishti', 'DH', 'Auto', 'Delivery', 'Serving'];
const NEEDS_ADDRESS = ['Auto', 'Delivery', 'Serving'];
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Custom'];
const STATUSES = ['new', 'confirmed', 'prepared', 'delivered', 'cancelled'];
const KITCHEN_STATUSES = ['prepared', 'delivered'];
const ROLES = ['owner', 'taker', 'kitchen'];
const canWrite = (u) => u.role === 'owner' || u.role === 'taker';
const ITERATIONS = 100000;
const SESSION_DAYS = 30;
const MEAL_ORDER = `CASE o.meal WHEN 'Breakfast' THEN 1 WHEN 'Lunch' THEN 2 WHEN 'Dinner' THEN 3 ELSE 4 END`;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
const b64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }
  });
}

async function hashPin(pin, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: ITERATIONS },
    key,
    256
  );
  return hex(bits);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const hmacKey = (secret) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

async function makeToken(env, uid) {
  const payload = b64u(enc.encode(JSON.stringify({ uid, exp: Date.now() + SESSION_DAYS * 864e5 })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(payload));
  return payload + '.' + b64u(sig);
}

async function readToken(env, token) {
  const [payload, sig] = (token || '').split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(env.SESSION_SECRET),
      fromB64u(sig),
      enc.encode(payload)
    );
    if (!ok) return null;
    const data = JSON.parse(dec.decode(fromB64u(payload)));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function sessionCookie(value, maxAge, url) {
  return `sid=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`;
}

async function currentUser(req, env) {
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.get('Cookie') || '');
  const data = m && (await readToken(env, m[1]));
  if (!data) return null;
  const u = await env.DB.prepare('SELECT id, name, role FROM users WHERE id = ? AND active = 1').bind(data.uid).first();
  return u || null;
}

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Invalid request');
  }
}

const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const int = (v) => (Number.isInteger(v) ? v : /^\d+$/.test(String(v ?? '')) ? Number(v) : NaN);

function validateOrder(b, withMoney) {
  const o = {};
  o.order_date = String(b.order_date || '');
  if (!isDate(o.order_date)) throw new HttpError(400, 'Enter the order date.');
  o.meal = String(b.meal || '');
  if (!MEALS.includes(o.meal)) throw new HttpError(400, 'Choose breakfast, lunch, dinner or custom.');
  o.custom_time = null;
  if (o.meal === 'Custom') {
    o.custom_time = String(b.custom_time || '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(o.custom_time)) throw new HttpError(400, 'Set the custom time.');
  }
  o.customer_name = clean(b.customer_name, 100);
  if (!o.customer_name) throw new HttpError(400, 'Enter the customer name.');
  o.mobile = clean(b.mobile, 30);
  const digits = o.mobile.replace(/\D/g, '');
  if (!/^\+?[\d\s\-().]+$/.test(o.mobile) || digits.length < 6 || digits.length > 15) {
    throw new HttpError(400, 'Enter a valid phone number, 6 to 15 digits.');
  }
  o.delivery_type = String(b.delivery_type || '');
  if (!DELIVERY.includes(o.delivery_type)) throw new HttpError(400, 'Choose a delivery type.');
  o.address = '';
  if (NEEDS_ADDRESS.includes(o.delivery_type)) {
    o.address = clean(b.address, 300);
    if (!o.address) throw new HttpError(400, 'Enter the address.');
  }
  o.misc = String(b.misc ?? '').trim().slice(0, 500);
  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 50) {
    throw new HttpError(400, 'Add at least one item with its count.');
  }
  o.items = b.items.map((i) => {
    const name = clean(i && i.name, 100);
    const qty = int(i && i.qty);
    if (!name || !Number.isInteger(qty) || qty < 1 || qty > 100000) {
      throw new HttpError(400, 'Each item needs a name and a whole number of 1 or more.');
    }
    return { name, qty };
  });
  o.total_amount = 0;
  if (withMoney && b.total_amount !== undefined && b.total_amount !== '' && b.total_amount !== null) {
    o.total_amount = int(b.total_amount);
    if (!Number.isInteger(o.total_amount) || o.total_amount < 0 || o.total_amount > 10000000) {
      throw new HttpError(400, 'Enter a valid total amount.');
    }
  }
  return o;
}

const itemInsert = (env, orderId, it) =>
  env.DB.prepare('INSERT INTO order_items (order_id, name, qty) VALUES (?, ?, ?)').bind(orderId, it.name, it.qty);

const esc = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);

async function attachItems(env, orders) {
  if (!orders.length) return orders;
  const ids = orders.map((o) => o.id);
  const rows = (
    await env.DB.prepare(
      `SELECT order_id, name, qty FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`
    )
      .bind(...ids)
      .all()
  ).results;
  const by = {};
  rows.forEach((r) => (by[r.order_id] ||= []).push({ name: r.name, qty: r.qty }));
  orders.forEach((o) => (o.items = by[o.id] || []));
  return orders;
}

function shape(o, showMoney) {
  if (showMoney) {
    const paid = o.paid || 0;
    const total = o.total_amount || 0;
    o.balance = Math.max(0, total - paid);
    o.payment_status =
      total === 0
        ? 'zero'
        : paid >= total
        ? 'paid'
        : paid > 0
        ? 'partial'
        : 'unpaid';
  } else {
    delete o.total_amount;
    delete o.paid;
  }
  return o;
}

async function listOrders(env, url, user) {
  const p = url.searchParams;
  const showMoney = canWrite(user);
  const where = ['1=1'];
  const args = [];
  const q = clean(p.get('q'), 60);
  if (q) {
    const like = `%${esc(q)}%`;
    where.push(
      `(o.customer_name LIKE ? ESCAPE '\\' OR o.mobile LIKE ? ESCAPE '\\' OR o.address LIKE ? ESCAPE '\\' OR o.misc LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.name LIKE ? ESCAPE '\\'))`
    );
    args.push(like, like, like, like, like);
  }
  const today = p.get('today');
  const when = p.get('when');
  let order = `o.order_date DESC, ${MEAL_ORDER}, o.id DESC`;
  if (isDate(today || '') && when === 'upcoming') {
    where.push('o.order_date >= ?');
    args.push(today);
    order = `o.order_date ASC, ${MEAL_ORDER}, o.custom_time, o.id`;
  } else if (isDate(today || '') && when === 'past') {
    where.push('o.order_date < ?');
    args.push(today);
  }
  if (isDate(p.get('date') || '')) {
    where.push('o.order_date = ?');
    args.push(p.get('date'));
  }
  if (isDate(p.get('from') || '')) {
    where.push('o.order_date >= ?');
    args.push(p.get('from'));
  }
  if (isDate(p.get('to') || '')) {
    where.push('o.order_date <= ?');
    args.push(p.get('to'));
  }
  if (MEALS.includes(p.get('meal'))) {
    where.push('o.meal = ?');
    args.push(p.get('meal'));
  }
  const deliveryType = p.get('delivery_type');
  if (DELIVERY.includes(deliveryType)) {
    where.push('o.delivery_type = ?');
    args.push(deliveryType);
  }
  if (STATUSES.includes(p.get('status'))) {
    where.push('o.status = ?');
    args.push(p.get('status'));
  }
  const paidSql = '(SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.order_id = o.id)';
  const payment = p.get('payment');
  if (payment) {
    if (payment === 'balance') {
      where.push(`o.total_amount > ${paidSql}`);
    } else if (payment === 'paid') {
      where.push(`o.total_amount > 0 AND ${paidSql} >= o.total_amount`);
    } else if (payment === 'partial') {
      where.push(`o.total_amount > ${paidSql} AND ${paidSql} > 0`);
    } else if (payment === 'unpaid') {
      where.push(`o.total_amount > 0 AND ${paidSql} = 0`);
    } else if (payment === 'zero') {
      where.push(`o.total_amount = 0`);
    }
  }
  const rows = (
    await env.DB.prepare(
      `SELECT o.*, ${paidSql} AS paid
       FROM orders o WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 300`
    )
      .bind(...args)
      .all()
  ).results;
  await attachItems(env, rows);
  return rows.map((o) => shape(o, showMoney));
}

async function getOrder(env, id, user) {
  const showMoney = canWrite(user);
  const o = await env.DB.prepare(
    `SELECT o.*, (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.order_id = o.id) AS paid,
            (SELECT name FROM users WHERE id = o.created_by) AS created_by_name
     FROM orders o WHERE o.id = ?`
  )
    .bind(id)
    .first();
  if (!o) throw new HttpError(404, 'Order not found.');
  await attachItems(env, [o]);
  if (showMoney) {
    o.payments = (
      await env.DB.prepare(
        `SELECT p.id, p.amount, p.note, p.created_at, (SELECT name FROM users WHERE id = p.created_by) AS by_name
         FROM payments p WHERE p.order_id = ? ORDER BY p.id`
      )
        .bind(id)
        .all()
    ).results;
  }
  return shape(o, showMoney);
}

const needOwner = (user) => {
  if (user.role !== 'owner') throw new HttpError(403, 'Only the owner can do this.');
};
const needWriter = (user) => {
  if (!canWrite(user)) throw new HttpError(403, 'This login cannot enter or change orders.');
};

async function login(req, env, url) {
  const b = await readBody(req);
  const name = clean(b.name, 60);
  const pin = String(b.pin ?? '');
  if (!name || !pin) throw new HttpError(400, 'Enter your name and password.');
  const now = Date.now();
  await env.DB.prepare('DELETE FROM login_fails WHERE ts < ?').bind(now - 3600e3).run();
  const fails = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_fails WHERE name = ? AND ts > ?')
    .bind(name.toLowerCase(), now - 600e3)
    .first();
  if (fails.n >= 5) throw new HttpError(429, 'Too many wrong tries. Wait 10 minutes and try again.');
  const u = await env.DB.prepare('SELECT * FROM users WHERE name = ? AND active = 1').bind(name).first();
  const computed = await hashPin(pin, u ? u.salt : '00'.repeat(16));
  if (!u || !safeEqual(computed, u.pin_hash)) {
    await env.DB.prepare('INSERT INTO login_fails (name, ts) VALUES (?, ?)').bind(name.toLowerCase(), now).run();
    throw new HttpError(401, 'Wrong name or password.');
  }
  await env.DB.prepare('DELETE FROM login_fails WHERE name = ?').bind(name.toLowerCase()).run();
  const token = await makeToken(env, u.id);
  return json({ user: { id: u.id, name: u.name, role: u.role } }, 200, {
    'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400, url)
  });
}

function csvCell(v, phone = false) {
  let s = String(v ?? '');
  // Stop spreadsheet formulas from running; phone numbers may legitimately start with +
  if (phone ? /^[=@\t\r]/.test(s) : /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  if (!env.SESSION_SECRET) throw new HttpError(500, 'Server is not set up: SESSION_SECRET is missing.');
  if (method !== 'GET' && method !== 'HEAD' && req.headers.get('X-Requested-With') !== 'order-book') {
    throw new HttpError(403, 'Bad request');
  }

  if (path === '/api/login' && method === 'POST') return login(req, env, url);
  if (path === '/api/logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0, url) });

  const user = await currentUser(req, env);
  if (path === '/api/me') return json({ user });
  if (!user) throw new HttpError(401, 'Sign in required.');
  let m;

  // ---- orders
  if (path === '/api/orders' && method === 'GET') return json({ orders: await listOrders(env, url, user) });

  if (path === '/api/orders' && method === 'POST') {
    needWriter(user);
    const b = await readBody(req);
    const o = validateOrder(b, true);
    const advance = b.advance === undefined || b.advance === '' || b.advance === null ? 0 : int(b.advance);
    if (!Number.isInteger(advance) || advance < 0 || advance > 10000000) throw new HttpError(400, 'Enter a valid advance amount.');
    const row = await env.DB.prepare(
      `INSERT INTO orders (order_date, meal, custom_time, customer_name, mobile, delivery_type, address, misc, total_amount, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
      .bind(o.order_date, o.meal, o.custom_time, o.customer_name, o.mobile, o.delivery_type, o.address, o.misc, o.total_amount, user.id)
      .first();
    try {
      const stmts = o.items.map((it) => itemInsert(env, row.id, it));
      if (advance > 0) {
        stmts.push(
          env.DB.prepare('INSERT INTO payments (order_id, amount, note, created_by) VALUES (?, ?, ?, ?)').bind(row.id, advance, 'Advance', user.id)
        );
      }
      await env.DB.batch(stmts);
    } catch (e) {
      await env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(row.id).run();
      throw e;
    }
    return json({ id: row.id }, 201);
  }

  if ((m = path.match(/^\/api\/orders\/(\d+)$/))) {
    const id = Number(m[1]);
    if (method === 'GET') return json({ order: await getOrder(env, id, user) });
    if (method === 'PUT') {
      needWriter(user);
      const b = await readBody(req);
      const o = validateOrder(b, true);
      const exists = await env.DB.prepare('SELECT id FROM orders WHERE id = ?').bind(id).first();
      if (!exists) throw new HttpError(404, 'Order not found.');
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE orders SET order_date = ?, meal = ?, custom_time = ?, customer_name = ?, mobile = ?, delivery_type = ?,
             address = ?, misc = ?, total_amount = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(o.order_date, o.meal, o.custom_time, o.customer_name, o.mobile, o.delivery_type, o.address, o.misc, o.total_amount, id),
        env.DB.prepare('DELETE FROM order_items WHERE order_id = ?').bind(id),
        ...o.items.map((it) => itemInsert(env, id, it))
      ]);
      return json({ id });
    }
  }

  if ((m = path.match(/^\/api\/orders\/(\d+)\/status$/)) && method === 'POST') {
    const b = await readBody(req);
    const status = String(b.status || '');
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Unknown status.');
    if (!canWrite(user) && !KITCHEN_STATUSES.includes(status)) throw new HttpError(403, 'Kitchen logins can only mark prepared or delivered.');
    const r = await env.DB.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, Number(m[1])).run();
    if (!r.meta.changes) throw new HttpError(404, 'Order not found.');
    return json({ ok: true });
  }

  if ((m = path.match(/^\/api\/orders\/(\d+)\/payments$/)) && method === 'POST') {
    needWriter(user);
    const b = await readBody(req);
    const amount = int(b.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 10000000) throw new HttpError(400, 'Enter a valid amount.');
    const exists = await env.DB.prepare('SELECT id FROM orders WHERE id = ?').bind(Number(m[1])).first();
    if (!exists) throw new HttpError(404, 'Order not found.');
    await env.DB.prepare('INSERT INTO payments (order_id, amount, note, created_by) VALUES (?, ?, ?, ?)')
      .bind(Number(m[1]), amount, clean(b.note, 100), user.id)
      .run();
    return json({ ok: true }, 201);
  }

  if ((m = path.match(/^\/api\/payments\/(\d+)$/)) && method === 'DELETE') {
    needOwner(user);
    await env.DB.prepare('DELETE FROM payments WHERE id = ?').bind(Number(m[1])).run();
    return json({ ok: true });
  }

  // ---- prep sheet (everyone)
  if (path === '/api/prep' && method === 'GET') {
    let from = url.searchParams.get('from') || '';
    let to = url.searchParams.get('to') || '';
    const date = url.searchParams.get('date') || '';
    if (!from && !to && isDate(date)) {
      from = date;
      to = date;
    }
    if (!from && isDate(to)) from = to;
    if (!to && isDate(from)) to = from;
    if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'Pick a date or date range.');
    if (from > to) {
      const temp = from; from = to; to = temp;
    }

    const meal = url.searchParams.get('meal') || '';
    const dateClause = from === to ? 'o.order_date = ?' : 'o.order_date BETWEEN ? AND ?';
    const baseArgs = from === to ? [from] : [from, to];

    let mealSql = '';
    const mealArgs = [...baseArgs];
    if (MEALS.includes(meal)) {
      mealSql = 'AND o.meal = ?';
      mealArgs.push(meal);
    }

    // Consolidated grocery / item totals across the whole date range
    const total_items = (
      await env.DB.prepare(
        `SELECT MIN(i.name) AS name, SUM(i.qty) AS qty, COUNT(DISTINCT o.id) AS orders
         FROM order_items i JOIN orders o ON o.id = i.order_id
         WHERE ${dateClause} AND o.status != 'cancelled' ${mealSql}
         GROUP BY LOWER(TRIM(i.name))
         ORDER BY qty DESC, name`
      )
        .bind(...mealArgs)
        .all()
    ).results;

    // Items grouped by meal
    const items = (
      await env.DB.prepare(
        `SELECT o.meal, MIN(i.name) AS name, SUM(i.qty) AS qty, COUNT(DISTINCT o.id) AS orders
         FROM order_items i JOIN orders o ON o.id = i.order_id
         WHERE ${dateClause} AND o.status != 'cancelled' ${mealSql}
         GROUP BY o.meal, LOWER(TRIM(i.name))
         ORDER BY ${MEAL_ORDER}, qty DESC, name`
      )
        .bind(...mealArgs)
        .all()
    ).results;

    // Orders count grouped by meal
    const counts = (
      await env.DB.prepare(
        `SELECT o.meal, COUNT(*) AS orders FROM orders o
         WHERE ${dateClause} AND o.status != 'cancelled' ${mealSql} GROUP BY o.meal ORDER BY ${MEAL_ORDER}`
      )
        .bind(...mealArgs)
        .all()
    ).results;

    const totalOrdersRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM orders o WHERE ${dateClause} AND o.status != 'cancelled' ${mealSql}`
    )
      .bind(...mealArgs)
      .first();

    return json({
      date: from === to ? from : '',
      from,
      to,
      isRange: from !== to,
      total_orders: totalOrdersRow ? totalOrdersRow.n : 0,
      total_items,
      items,
      counts
    });
  }

  // ---- money and reports (family only)
  if (path === '/api/outstanding' && method === 'GET') {
    needOwner(user);
    const rows = (
      await env.DB.prepare(
        `SELECT * FROM (
           SELECT o.id, o.order_date, o.meal, o.customer_name, o.mobile, o.delivery_type, o.address, o.status, o.total_amount,
                  (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.order_id = o.id) AS paid
           FROM orders o WHERE o.status != 'cancelled'
         ) WHERE total_amount > paid ORDER BY order_date, id LIMIT 300`
      ).all()
    ).results;
    return json({ orders: rows });
  }

  if (path === '/api/reports' && method === 'GET') {
    needOwner(user);
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'Pick a date range.');

    const paidSql = '(SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.order_id = o.id)';
    const where = ['o.order_date BETWEEN ? AND ?'];
    const args = [from, to];

    const deliveryType = url.searchParams.get('delivery_type');
    if (DELIVERY.includes(deliveryType)) {
      where.push('o.delivery_type = ?');
      args.push(deliveryType);
    }
    const meal = url.searchParams.get('meal');
    if (MEALS.includes(meal)) {
      where.push('o.meal = ?');
      args.push(meal);
    }
    const status = url.searchParams.get('status');
    if (STATUSES.includes(status)) {
      where.push('o.status = ?');
      args.push(status);
    } else {
      where.push("o.status != 'cancelled'");
    }
    const payment = url.searchParams.get('payment');
    if (payment === 'balance') {
      where.push(`o.total_amount > ${paidSql}`);
    } else if (payment === 'paid') {
      where.push(`o.total_amount > 0 AND ${paidSql} >= o.total_amount`);
    } else if (payment === 'partial') {
      where.push(`o.total_amount > ${paidSql} AND ${paidSql} > 0`);
    } else if (payment === 'unpaid') {
      where.push(`o.total_amount > 0 AND ${paidSql} = 0`);
    } else if (payment === 'zero') {
      where.push(`o.total_amount = 0`);
    }

    const baseWhere = where.join(' AND ');

    // 1. Delivery type wise breakdown
    const by_delivery = (
      await env.DB.prepare(
        `SELECT o.delivery_type, COUNT(*) AS orders,
                COALESCE(SUM(o.total_amount), 0) AS billed,
                COALESCE(SUM(${paidSql}), 0) AS collected,
                COALESCE(SUM(CASE WHEN o.total_amount > ${paidSql} THEN o.total_amount - ${paidSql} ELSE 0 END), 0) AS balance
         FROM orders o WHERE ${baseWhere}
         GROUP BY o.delivery_type
         ORDER BY orders DESC, o.delivery_type`
      )
        .bind(...args)
        .all()
    ).results;

    // 2. Day-wise breakdown
    const by_day = (
      await env.DB.prepare(
        `SELECT o.order_date AS date, COUNT(*) AS orders,
                COALESCE(SUM(o.total_amount), 0) AS billed,
                COALESCE(SUM(${paidSql}), 0) AS collected,
                COALESCE(SUM(CASE WHEN o.total_amount > ${paidSql} THEN o.total_amount - ${paidSql} ELSE 0 END), 0) AS balance
         FROM orders o WHERE ${baseWhere}
         GROUP BY o.order_date ORDER BY o.order_date`
      )
        .bind(...args)
        .all()
    ).results;

    // 3. Top items
    const top_items = (
      await env.DB.prepare(
        `SELECT MIN(i.name) AS name, SUM(i.qty) AS qty
         FROM order_items i JOIN orders o ON o.id = i.order_id
         WHERE ${baseWhere}
         GROUP BY LOWER(TRIM(i.name)) ORDER BY qty DESC LIMIT 20`
      )
        .bind(...args)
        .all()
    ).results;

    // Cancelled count within date range and matching filters
    const cancelledWhere = ['o.order_date BETWEEN ? AND ?', "o.status = 'cancelled'"];
    const cancelledArgs = [from, to];
    if (DELIVERY.includes(deliveryType)) {
      cancelledWhere.push('o.delivery_type = ?');
      cancelledArgs.push(deliveryType);
    }
    if (MEALS.includes(meal)) {
      cancelledWhere.push('o.meal = ?');
      cancelledArgs.push(meal);
    }
    const cancelled = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM orders o WHERE ${cancelledWhere.join(' AND ')}`
    )
      .bind(...cancelledArgs)
      .first();

    const totals = by_day.reduce(
      (t, d) => ({
        orders: t.orders + d.orders,
        billed: t.billed + (d.billed || 0),
        collected: t.collected + (d.collected || 0),
        balance: t.balance + (d.balance || 0)
      }),
      { orders: 0, billed: 0, collected: 0, balance: 0 }
    );

    return json({ totals, by_delivery, by_day, top_items, cancelled: cancelled ? cancelled.n : 0 });
  }

  if (path === '/api/export.csv' && method === 'GET') {
    needOwner(user);
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'Pick a date range.');

    const paidSql = '(SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.order_id = o.id)';
    const where = ['o.order_date BETWEEN ? AND ?'];
    const args = [from, to];

    const deliveryType = url.searchParams.get('delivery_type');
    if (DELIVERY.includes(deliveryType)) {
      where.push('o.delivery_type = ?');
      args.push(deliveryType);
    }
    const meal = url.searchParams.get('meal');
    if (MEALS.includes(meal)) {
      where.push('o.meal = ?');
      args.push(meal);
    }
    const status = url.searchParams.get('status');
    if (STATUSES.includes(status)) {
      where.push('o.status = ?');
      args.push(status);
    }
    const payment = url.searchParams.get('payment');
    if (payment === 'balance') {
      where.push(`o.total_amount > ${paidSql}`);
    } else if (payment === 'paid') {
      where.push(`o.total_amount > 0 AND ${paidSql} >= o.total_amount`);
    } else if (payment === 'partial') {
      where.push(`o.total_amount > ${paidSql} AND ${paidSql} > 0`);
    } else if (payment === 'unpaid') {
      where.push(`o.total_amount > 0 AND ${paidSql} = 0`);
    } else if (payment === 'zero') {
      where.push(`o.total_amount = 0`);
    }

    const rows = (
      await env.DB.prepare(
        `SELECT o.*, ${paidSql} AS paid
         FROM orders o WHERE ${where.join(' AND ')} ORDER BY o.order_date, ${MEAL_ORDER}, o.id`
      )
        .bind(...args)
        .all()
    ).results;
    await attachItems(env, rows);
    const head = ['Order', 'Date', 'Meal', 'Custom time', 'Name', 'Mobile', 'Items', 'Delivery', 'Address', 'Misc', 'Status', 'Total', 'Paid', 'Balance', 'Payment Status'];
    const lines = [head.join(',')].concat(
      rows.map((o) => {
        const bal = Math.max(0, o.total_amount - o.paid);
        const payStatus = o.total_amount === 0 ? 'No price' : o.paid >= o.total_amount ? 'Fully Paid' : o.paid > 0 ? 'Partial' : 'Unpaid';
        return [
          o.id, o.order_date, o.meal, o.custom_time || '', o.customer_name, o.mobile,
          o.items.map((i) => `${i.name} x ${i.qty}`).join('; '),
          o.delivery_type, o.address || '', o.misc, o.status, o.total_amount, o.paid, bal, payStatus
        ].map((v, i) => csvCell(v, i === 5)).join(',');
      })
    );
    return new Response('\ufeff' + lines.join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="orders-${from}-to-${to}.csv"`,
        'Cache-Control': 'no-store'
      }
    });
  }

  // ---- users (family only)
  if (path === '/api/users' && method === 'GET') {
    needOwner(user);
    const rows = (await env.DB.prepare('SELECT id, name, role, active FROM users ORDER BY id').all()).results;
    return json({ users: rows });
  }
  if (path === '/api/users' && method === 'POST') {
    needOwner(user);
    const b = await readBody(req);
    const name = clean(b.name, 60);
    const pin = String(b.pin ?? '');
    const role = b.role === undefined ? 'kitchen' : b.role;
    if (!ROLES.includes(role)) throw new HttpError(400, 'Unknown access level.');
    if (!name) throw new HttpError(400, 'Enter a name.');
    if (pin.length < 6) throw new HttpError(400, 'Use at least 6 characters for the password.');
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    try {
      await env.DB.prepare('INSERT INTO users (name, salt, pin_hash, role) VALUES (?, ?, ?, ?)')
        .bind(name, salt, await hashPin(pin, salt), role)
        .run();
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw new HttpError(409, 'That name is already taken.');
      throw e;
    }
    return json({ ok: true }, 201);
  }
  if ((m = path.match(/^\/api\/users\/(\d+)$/)) && method === 'PUT') {
    needOwner(user);
    const id = Number(m[1]);
    const b = await readBody(req);
    const sets = [];
    const args = [];
    if (b.pin !== undefined) {
      if (String(b.pin).length < 6) throw new HttpError(400, 'Use at least 6 characters for the password.');
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      sets.push('salt = ?', 'pin_hash = ?');
      args.push(salt, await hashPin(String(b.pin), salt));
    }
    if (b.active !== undefined) {
      if (id === user.id && !b.active) throw new HttpError(400, 'You cannot switch off your own login.');
      sets.push('active = ?');
      args.push(b.active ? 1 : 0);
    }
    if (b.role !== undefined) {
      if (!ROLES.includes(b.role)) throw new HttpError(400, 'Unknown access level.');
      if (id === user.id && b.role !== 'owner') throw new HttpError(400, 'You cannot change your own access.');
      sets.push('role = ?');
      args.push(b.role);
    }
    if (!sets.length) throw new HttpError(400, 'Nothing to change.');
    await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id).run();
    return json({ ok: true });
  }

  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(req, env) {
    try {
      return await handle(req, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong. Try again.' }, 500);
    }
  }
};
