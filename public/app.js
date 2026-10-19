(function () {
  'use strict';

  var app = document.getElementById('app');
  var toastEl = document.getElementById('toast');
  var me = null;
  var MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Custom'];
  var DELIVERY = ['Srishti', 'DH', 'Auto', 'Delivery', 'Serving'];
  var NEEDS_ADDRESS = ['Auto', 'Delivery', 'Serving'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SEED_ITEMS = ['Sadhya kit', 'Chicken biriyani', 'Veg meals', 'Porotta', 'Beef curry'];
  var ROLE_LABEL = { owner: 'Owner', taker: 'Order taker', kitchen: 'Kitchen' };
  function isOwner() { return me && me.role === 'owner'; }
  function canWrite() { return me && (me.role === 'owner' || me.role === 'taker'); }
  function homeHash() { return canWrite() ? '#/new' : '#/orders'; }
  var listState = {
    tab: 'upcoming',
    q: '',
    meal: '',
    delivery_type: '',
    status: '',
    payment: '',
    from: '',
    to: '',
    showFilters: false
  };
  var reportState = {
    from: '',
    to: '',
    delivery_type: '',
    meal: '',
    payment: '',
    status: ''
  };
  var prepState = {
    from: '',
    to: '',
    meal: ''
  };

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return iso(new Date()); }
  function parseISO(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function fmtDate(s) {
    var d = parseISO(s);
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ', ' + DAYS[d.getDay()];
  }
  function fmtShort(s) { var d = parseISO(s); return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function relDay(s) {
    var diff = Math.round((parseISO(s) - parseISO(today())) / 864e5);
    return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : '';
  }
  function fmtTime(t) { var p = t.split(':').map(Number); return (p[0] % 12 || 12) + ':' + pad(p[1]) + ' ' + (p[0] >= 12 ? 'PM' : 'AM'); }
  function mealText(o) { return o.meal === 'Custom' ? 'Custom, ' + fmtTime(o.custom_time || '00:00') : o.meal; }
  function money(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { toastEl.hidden = true; }, 4000);
  }
  function learned() { try { return JSON.parse(localStorage.getItem('ob-items') || '[]'); } catch (e) { return []; } }
  function learn(items) {
    try {
      var list = learned();
      items.forEach(function (it) {
        list = list.filter(function (x) { return x.toLowerCase() !== it.name.toLowerCase(); });
        list.unshift(it.name);
      });
      localStorage.setItem('ob-items', JSON.stringify(list.slice(0, 80)));
    } catch (e) {}
  }
  function waText(o) {
    var lines = [
      'Date: ' + fmtDate(o.order_date),
      'Time: ' + mealText(o),
      'Name: ' + o.customer_name,
      'Mobile: ' + o.mobile,
      'Items:'
    ].concat(o.items.map(function (it, i) { return (i + 1) + '. ' + it.name + ' – ' + it.qty; }));
    lines.push('Delivery type: ' + o.delivery_type);
    if (o.address) lines.push('Address: ' + o.address);
    lines.push('Misc: ' + (o.misc ? o.misc : '-'));
    return lines.join('\n');
  }
  function copyText(text, okMsg) {
    var fallback = function () { toast('Could not copy. Select the text and copy it by hand.'); };
    try { navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback); } catch (e) { fallback(); }
  }

  function api(path, opts) {
    opts = opts || {};
    var o = { method: opts.method || 'GET', headers: { 'X-Requested-With': 'order-book' }, credentials: 'same-origin' };
    if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
    return fetch('/api' + path, o).then(
      function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          if (res.status === 401 && path !== '/login') {
            me = null;
            location.hash = '#/login';
            throw new Error('Please sign in again.');
          }
          if (!res.ok) throw new Error((data && data.error) || 'Something went wrong.');
          return data;
        });
      },
      function () { throw new Error('No connection. Check the internet and try again.'); }
    );
  }

  /* ---------- shell ---------- */
  function shell(active, html) {
    var items = [];
    if (canWrite()) items.push(['new', '#/new', 'New order']);
    items.push(['orders', '#/orders', 'Orders'], ['prep', '#/prep', 'Prep sheet']);
    if (isOwner()) items.push(['reports', '#/reports', 'Reports'], ['users', '#/users', 'Users']);
    app.innerHTML =
      '<main class="wrap">' + html + '</main>' +
      '<nav class="bar" aria-label="Main"><div class="in">' +
      items.map(function (i) {
        return '<a href="' + i[1] + '"' + (i[0] === active ? ' aria-current="page"' : '') + '>' + i[2] + '</a>';
      }).join('') + '</div></nav>';
  }
  function header(kicker, title, extra) {
    return '<div class="top"><p class="kicker">' + esc(kicker) + '</p>' + (extra || '') + '</div><h1>' + esc(title) + '</h1>';
  }
  function loading(active, kicker, title) { shell(active, header(kicker, title) + '<p class="muted">Loading…</p>'); }
  function failed(active, e) {
    shell(active, '<p class="err" role="alert">' + esc(e.message) + '</p><a class="btn" href="' + esc(location.hash) + '">Try again</a>');
  }

  /* ---------- login ---------- */
  function viewLogin() {
    app.innerHTML =
      '<main class="wrap plain login"><div class="top"><p class="kicker">Catering</p></div><h1>Order Book</h1>' +
      '<form class="card" id="lf" autocomplete="on">' +
      '<div class="field"><label class="label" for="ln">Name</label><input id="ln" autocomplete="username" autocapitalize="words"></div>' +
      '<div class="field"><label class="label" for="lp">Password</label><input id="lp" type="password" autocomplete="current-password"></div>' +
      '<p class="err" id="le" role="alert" hidden></p>' +
      '<button class="btn primary" id="lb" type="submit">Sign in</button></form></main>';
    $('#ln').focus();
    $('#lf').addEventListener('submit', function (e) {
      e.preventDefault();
      var b = $('#lb'), er = $('#le');
      b.disabled = true; er.hidden = true;
      api('/login', { method: 'POST', body: { name: $('#ln').value, pin: $('#lp').value } }).then(function (r) {
        me = r.user;
        location.hash = homeHash();
      }, function (err) {
        er.textContent = err.message; er.hidden = false; b.disabled = false;
      });
    });
  }

  /* ---------- order form (new + edit) ---------- */
  function seg(name, values) {
    return values.map(function (v) {
      return '<label class="opt"><input type="radio" name="' + name + '" value="' + v + '"><span>' + v + '</span></label>';
    }).join('');
  }
  function viewForm(id) {
    if (!canWrite()) { location.hash = '#/orders'; return; }
    loading('new', id ? 'Edit order' : 'Order book entry', id ? 'Edit order' : 'New order');
    (id ? api('/orders/' + id) : Promise.resolve(null)).then(function (r) { renderForm(id, r && r.order); }, function (e) { failed('new', e); });
  }
  function renderForm(id, o) {
    var dl = '';
    var seen = {};
    learned().concat(SEED_ITEMS).forEach(function (n) {
      if (!seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; dl += '<option value="' + esc(n) + '">'; }
    });
    shell('new',
      header(id ? 'Editing #' + id : 'Order book entry', id ? 'Edit order' : 'New order') +
      '<form class="card" id="of" novalidate autocomplete="off">' +
      '<div class="field"><label class="label" for="f-date">Date</label><input type="date" id="f-date"></div>' +
      '<div class="field"><span class="label" id="tl">Time</span><div class="seg" id="f-meal" role="radiogroup" aria-labelledby="tl">' + seg('meal', MEALS) + '</div>' +
      '<div id="f-cwrap" hidden><label class="label" for="f-time">Custom time</label><input type="time" id="f-time"></div></div>' +
      '<div class="field"><label class="label" for="f-name">Name</label><input id="f-name" placeholder="Customer name" autocapitalize="words"></div>' +
      '<div class="field"><label class="label" for="f-mobile">Mobile</label><input id="f-mobile" type="tel" inputmode="tel" placeholder="Mobile number"></div>' +
      '<div class="field"><span class="label">Items</span><div class="rowhead" aria-hidden="true"><span>Item</span><span>Nos</span><span></span></div>' +
      '<div class="rows" id="rows"></div><button type="button" class="add" id="add">+ Add item</button><datalist id="dl">' + dl + '</datalist></div>' +
      '<div class="field"><span class="label" id="dtl">Delivery type</span><div class="seg" id="f-del" role="radiogroup" aria-labelledby="dtl">' + seg('delivery', DELIVERY) + '</div>' +
      '<div id="f-awrap" hidden><label class="label" for="f-addr">Address</label><textarea id="f-addr" placeholder="Full auto, delivery, or serving address" rows="2"></textarea></div></div>' +
      '<div class="field"><label class="label" for="f-misc">Misc</label><textarea id="f-misc" placeholder="Less spicy, disposable plates, landmark"></textarea></div>' +
      '<div class="pair"><div class="field"><label class="label" for="f-total">Total amount (₹)</label><input id="f-total" type="number" inputmode="numeric" min="0" step="1" placeholder="0"></div>' +
      (id ? '' : '<div class="field"><label class="label" for="f-adv">Advance paid (₹)</label><input id="f-adv" type="number" inputmode="numeric" min="0" step="1" placeholder="0"></div>') + '</div>' +
      '<p class="err" id="f-err" role="alert" hidden></p>' +
      '<div class="actions"><button class="btn primary" id="save" type="submit">Save order</button>' +
      '<button type="button" class="btn" id="reset">' + (id ? 'Cancel' : 'Clear all fields') + '</button></div></form>');

    var rowsEl = $('#rows');
    function updRm() { var one = rowsEl.children.length < 2; $$('.rm', rowsEl).forEach(function (b) { b.disabled = one; }); }
    function addRow(name, qty, focus) {
      var r = document.createElement('div');
      r.className = 'row';
      r.innerHTML = '<input class="in-item" list="dl" placeholder="e.g. Chicken biriyani" aria-label="Item name">' +
        '<input class="in-nos" type="number" inputmode="numeric" min="1" step="1" placeholder="50" aria-label="Number of items">' +
        '<button type="button" class="rm" aria-label="Remove this item">×</button>';
      $('.in-item', r).value = name || '';
      $('.in-nos', r).value = qty || '';
      rowsEl.appendChild(r);
      updRm();
      if (focus) $('.in-item', r).focus();
    }
    function fill(o) {
      $('#f-date').value = o ? o.order_date : '';
      $$('input[name="meal"]').forEach(function (r) { r.checked = !!o && r.value === o.meal; });
      $('#f-time').value = (o && o.custom_time) || '';
      $('#f-name').value = o ? o.customer_name : '';
      $('#f-mobile').value = o ? o.mobile : '';
      rowsEl.innerHTML = '';
      if (o && o.items.length) o.items.forEach(function (it) { addRow(it.name, it.qty); }); else addRow();
      $$('input[name="delivery"]').forEach(function (r) { r.checked = !!o && r.value === o.delivery_type; });
      $('#f-addr').value = o ? (o.address || '') : '';
      $('#f-misc').value = o ? o.misc : '';
      $('#f-total').value = o && o.total_amount ? o.total_amount : '';
      if ($('#f-adv')) $('#f-adv').value = '';
      showMeal();
      showDel();
    }
    function showMeal() { var m = $('input[name="meal"]:checked'); $('#f-cwrap').hidden = !(m && m.value === 'Custom'); }
    function showDel() { var d = val('delivery'); $('#f-awrap').hidden = NEEDS_ADDRESS.indexOf(d) === -1; }
    function val(name) { var c = $('input[name="' + name + '"]:checked'); return c ? c.value : ''; }
    function err(msg, el) {
      var e = $('#f-err'); e.textContent = msg; e.hidden = false;
      if (el) el.focus();
    }
    /* Mark a .field ancestor as having an error */
    function markField(el, msg) {
      var f = el.closest('.field');
      if (!f || f.classList.contains('field-error')) return;
      f.classList.add('field-error', 'field-shake');
      var m = document.createElement('p');
      m.className = 'field-error-msg';
      m.textContent = msg;
      f.appendChild(m);
      f.addEventListener('animationend', function () { f.classList.remove('field-shake'); }, { once: true });
    }
    function clearFieldErrors() {
      $$('.field-error', $('#of')).forEach(function (f) {
        f.classList.remove('field-error', 'field-shake');
        $$('.field-error-msg', f).forEach(function (m) { m.remove(); });
      });
    }
    function collect() {
      return {
        order_date: $('#f-date').value, meal: val('meal'), custom_time: $('#f-time').value,
        customer_name: $('#f-name').value, mobile: $('#f-mobile').value,
        items: $$('.row', rowsEl).map(function (r) {
          return { name: $('.in-item', r).value.trim(), qty: $('.in-nos', r).value.trim() };
        }).filter(function (i) { return i.name || i.qty; }),
        delivery_type: val('delivery'), address: $('#f-addr').value.trim(), misc: $('#f-misc').value,
        total_amount: $('#f-total').value, advance: $('#f-adv') ? $('#f-adv').value : ''
      };
    }
    /** Returns array of [message, element] pairs for every invalid field */
    function checkAll(d) {
      var errors = [];
      if (!d.order_date) errors.push(['Enter the order date.', $('#f-date')]);
      if (!d.meal) errors.push(['Choose a meal time.', $('input[name="meal"]')]);
      if (d.meal === 'Custom' && !d.custom_time) errors.push(['Set the custom time.', $('#f-time')]);
      if (!d.customer_name.trim()) errors.push(['Enter the customer name.', $('#f-name')]);
      var digits = d.mobile.replace(/\D/g, '');
      if (!d.mobile.trim()) errors.push(['Enter the mobile number.', $('#f-mobile')]);
      else if (!/^\+?[\d\s\-().]+$/.test(d.mobile.trim()) || digits.length < 6 || digits.length > 15) errors.push(['Enter a valid phone number.', $('#f-mobile')]);
      var rawItems = $$('.row', rowsEl).map(function (r) {
        return { name: $('.in-item', r).value.trim(), qty: $('.in-nos', r).value.trim(), row: r };
      });
      var hasAnyItem = false;
      rawItems.forEach(function (it) {
        var n = Number(it.qty);
        if (it.name || it.qty) {
          hasAnyItem = true;
          if (!it.name) errors.push(['Enter an item name.', $('.in-item', it.row)]);
          if (!Number.isInteger(n) || n < 1) errors.push(['Enter a valid count (1 or more).', $('.in-nos', it.row)]);
        }
      });
      if (!hasAnyItem || !d.items || !d.items.length) {
        errors.push(['Add at least one item.', $('.in-item', rowsEl) || $('#add')]);
      }
      if (!d.delivery_type) errors.push(['Choose a delivery type.', $('input[name="delivery"]')]);
      if (NEEDS_ADDRESS.indexOf(d.delivery_type) !== -1 && !d.address) errors.push(['Enter the address.', $('#f-addr')]);
      return errors;
    }

    fill(o);
    $('#of').addEventListener('input', function () { $('#f-err').hidden = true; clearFieldErrors(); });
    $('#of').addEventListener('change', function () { $('#f-err').hidden = true; clearFieldErrors(); });
    $('#f-meal').addEventListener('change', showMeal);
    $('#f-del').addEventListener('change', showDel);
    $('#add').addEventListener('click', function () { addRow('', '', true); });
    rowsEl.addEventListener('click', function (e) {
      var b = e.target.closest('.rm');
      if (b && rowsEl.children.length > 1) { b.parentNode.remove(); updRm(); }
    });
    rowsEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var t = e.target, row = t.parentNode;
      if (t.classList.contains('in-item')) $('.in-nos', row).focus();
      else if (t.classList.contains('in-nos') && t.value && $('.in-item', row).value) {
        if (row === rowsEl.lastElementChild) addRow('', '', true); else $('.in-item', row.nextElementSibling).focus();
      }
    });
    $('#reset').addEventListener('click', function () {
      if (id) { location.hash = '#/order/' + id; return; }
      fill(null); $('#f-err').hidden = true; clearFieldErrors(); window.scrollTo(0, 0);
    });
    $('#of').addEventListener('submit', function (e) {
      e.preventDefault();
      clearFieldErrors();
      var d = collect(), errors = checkAll(d);
      if (errors.length) {
        errors.forEach(function (pair) { if (pair[1]) markField(pair[1], pair[0]); });
        err(errors.length === 1 ? errors[0][0] : errors.length + ' fields need your attention.', errors[0][1]);
        return;
      }
      $('#f-err').hidden = true;
      var b = $('#save');
      b.disabled = true; b.textContent = 'Saving…';
      api(id ? '/orders/' + id : '/orders', { method: id ? 'PUT' : 'POST', body: d }).then(function (r) {
        learn(d.items);
        location.hash = '#/order/' + (r.id || id) + (id ? '' : '?new=1');
      }, function (ex) {
        err(ex.message); b.disabled = false; b.textContent = 'Save order';
      });
    });
  }

  /* ---------- orders list ---------- */
  function orderCard(o, admin) {
    var rel = relDay(o.order_date);
    var summary = o.items.map(function (i) { return i.name + ' × ' + i.qty; }).join(', ');
    var money_ = '';
    if (admin) {
      if (o.status === 'cancelled') {
        money_ = '<span class="pill cancelled">Cancelled</span>';
      } else if (o.total_amount === 0) {
        money_ = '<span class="pill-pay zero">No price</span>';
      } else if (o.paid >= o.total_amount) {
        money_ = '<span class="pill-pay paid">✓ Paid ' + money(o.paid) + '</span>';
      } else if (o.paid > 0) {
        var due = o.total_amount - o.paid;
        money_ = '<span class="pill-pay partial">' + money(due) + ' due <span class="sub">(Paid ' + money(o.paid) + ')</span></span>';
      } else {
        money_ = '<span class="pill-pay unpaid">' + money(o.total_amount) + ' unpaid</span>';
      }
    }
    return '<a class="order" href="#/order/' + o.id + '">' +
      '<div class="l1"><span class="when">' + esc((rel ? rel + ' · ' : '') + fmtShort(o.order_date) + ' · ' + mealText(o)) + '</span><span class="pill ' + o.status + '">' + o.status + '</span></div>' +
      '<div class="who">' + esc(o.customer_name) + '</div><div class="what">' + esc(summary) + '</div>' +
      '<div class="l3"><span class="del-tag">' + esc(o.delivery_type) + '</span>' + money_ + '</div></a>';
  }

  function viewOrders() {
    var admin = canWrite();
    function countActive() {
      var n = 0;
      if (listState.delivery_type) n++;
      if (listState.payment) n++;
      if (listState.meal) n++;
      if (listState.status) n++;
      if (listState.from || listState.to) n++;
      return n;
    }

    function renderChips() {
      var chips = [];
      if (listState.delivery_type) {
        chips.push('<span class="chip">Delivery: ' + esc(listState.delivery_type) + ' <button type="button" data-clear="delivery_type" aria-label="Remove delivery filter">×</button></span>');
      }
      if (listState.payment) {
        var pLabels = { balance: 'Balance due', paid: 'Fully paid', partial: 'Partial payment', unpaid: 'Unpaid', zero: 'No price set' };
        chips.push('<span class="chip">Payment: ' + esc(pLabels[listState.payment] || listState.payment) + ' <button type="button" data-clear="payment" aria-label="Remove payment filter">×</button></span>');
      }
      if (listState.meal) {
        chips.push('<span class="chip">Meal: ' + esc(listState.meal) + ' <button type="button" data-clear="meal" aria-label="Remove meal filter">×</button></span>');
      }
      if (listState.status) {
        chips.push('<span class="chip">Status: ' + esc(listState.status) + ' <button type="button" data-clear="status" aria-label="Remove status filter">×</button></span>');
      }
      if (listState.from || listState.to) {
        var dr = (listState.from ? 'From ' + fmtShort(listState.from) : '') + (listState.to ? ' To ' + fmtShort(listState.to) : '');
        chips.push('<span class="chip">Date: ' + esc(dr) + ' <button type="button" data-clear="date" aria-label="Remove date filter">×</button></span>');
      }
      if (chips.length) {
        chips.push('<button type="button" class="chip clear-all" id="f-clear-all">Clear all filters</button>');
        return '<div class="chips">' + chips.join('') + '</div>';
      }
      return '';
    }

    var nActive = countActive();
    shell('orders',
      header('Order book', 'Orders') +
      '<div class="field"><label class="sr label" for="q">Search</label><input id="q" type="search" placeholder="Search name, phone, item, address, note…"></div>' +
      '<div class="tabs" id="tabs">' +
        '<button type="button" data-t="upcoming">Upcoming</button>' +
        '<button type="button" data-t="past">Past</button>' +
        '<button type="button" data-t="all">All</button>' +
      '</div>' +
      '<div class="filter-bar">' +
        '<button type="button" class="filter-toggle-btn" id="f-toggle" aria-expanded="' + String(listState.showFilters) + '">' +
          '<span>Filters</span>' +
          (nActive ? '<span class="filter-badge">' + nActive + '</span>' : '') +
        '</button>' +
        '<div class="orders-meta"><span id="order-count">Loading…</span></div>' +
      '</div>' +
      '<div id="chips-container">' + renderChips() + '</div>' +
      '<div class="filter-panel" id="f-panel"' + (listState.showFilters ? '' : ' hidden') + '>' +
        '<div class="filter-grid">' +
          '<div class="field"><label class="label" for="fd">Delivery</label>' +
            '<select id="fd"><option value="">All delivery types</option>' + DELIVERY.map(function (d) { return '<option value="' + d + '"' + (listState.delivery_type === d ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select></div>' +
          (admin ? '<div class="field"><label class="label" for="fp">Payment</label>' +
            '<select id="fp"><option value="">All payment statuses</option>' +
              '<option value="balance"' + (listState.payment === 'balance' ? ' selected' : '') + '>Balance due</option>' +
              '<option value="paid"' + (listState.payment === 'paid' ? ' selected' : '') + '>Fully paid</option>' +
              '<option value="partial"' + (listState.payment === 'partial' ? ' selected' : '') + '>Partial payment</option>' +
              '<option value="unpaid"' + (listState.payment === 'unpaid' ? ' selected' : '') + '>Unpaid (₹0 paid)</option>' +
              '<option value="zero"' + (listState.payment === 'zero' ? ' selected' : '') + '>No price set</option>' +
            '</select></div>' : '') +
          '<div class="field"><label class="label" for="fm">Meal</label>' +
            '<select id="fm"><option value="">All meals</option>' + MEALS.map(function (m) { return '<option value="' + m + '"' + (listState.meal === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label class="label" for="fs">Status</label>' +
            '<select id="fs"><option value="">All statuses</option>' + ['new', 'confirmed', 'prepared', 'delivered', 'cancelled'].map(function (s) { return '<option value="' + s + '"' + (listState.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>' +
        '</div>' +
        '<div class="pair">' +
          '<div class="field"><label class="label" for="ffrom">From date</label><input type="date" id="ffrom" value="' + esc(listState.from) + '"></div>' +
          '<div class="field"><label class="label" for="fto">To date</label><input type="date" id="fto" value="' + esc(listState.to) + '"></div>' +
        '</div>' +
        '<div class="presets">' +
          '<button type="button" class="preset-btn" data-pre="today">Today</button>' +
          '<button type="button" class="preset-btn" data-pre="tomorrow">Tomorrow</button>' +
          '<button type="button" class="preset-btn" data-pre="next7">Next 7 days</button>' +
          '<button type="button" class="preset-btn" data-pre="clear-dates">Clear dates</button>' +
        '</div>' +
      '</div>' +
      '<div class="list" id="list"></div>');

    $('#q').value = listState.q;

    var seq = 0;
    function load() {
      var my = ++seq;
      var hasCustomDate = !!(listState.from || listState.to);
      $$('#tabs button').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.dataset.t === listState.tab && !listState.q && !hasCustomDate));
      });
      var p = new URLSearchParams();
      p.set('today', today());
      p.set('when', (listState.q || hasCustomDate) ? 'all' : listState.tab);
      if (listState.q) p.set('q', listState.q);
      if (listState.delivery_type) p.set('delivery_type', listState.delivery_type);
      if (listState.payment) p.set('payment', listState.payment);
      if (listState.meal) p.set('meal', listState.meal);
      if (listState.status) p.set('status', listState.status);
      if (listState.from) p.set('from', listState.from);
      if (listState.to) p.set('to', listState.to);

      var n = countActive();
      var toggleBtn = $('#f-toggle');
      if (toggleBtn) {
        toggleBtn.innerHTML = '<span>Filters</span>' + (n ? '<span class="filter-badge">' + n + '</span>' : '');
      }
      var cc = $('#chips-container');
      if (cc) {
        cc.innerHTML = renderChips();
        bindChips();
      }

      api('/orders?' + p.toString()).then(function (r) {
        if (my !== seq) return;
        var countEl = $('#order-count');
        if (countEl) countEl.textContent = r.orders.length + (r.orders.length === 1 ? ' order' : ' orders');
        $('#list').innerHTML = r.orders.length
          ? r.orders.map(function (o) { return orderCard(o, admin); }).join('')
          : '<p class="empty">No orders matching the filters.</p>';
      }, function (e) {
        if (my === seq) $('#list').innerHTML = '<p class="err">' + esc(e.message) + '</p>';
      });
    }

    function bindChips() {
      $$('[data-clear]').forEach(function (b) {
        b.addEventListener('click', function () {
          var k = b.dataset.clear;
          if (k === 'date') { listState.from = ''; listState.to = ''; if ($('#ffrom')) $('#ffrom').value = ''; if ($('#fto')) $('#fto').value = ''; }
          else { listState[k] = ''; var el = $('#f' + (k === 'delivery_type' ? 'd' : k === 'payment' ? 'p' : k === 'meal' ? 'm' : 's')); if (el) el.value = ''; }
          load();
        });
      });
      var clearAll = $('#f-clear-all');
      if (clearAll) {
        clearAll.addEventListener('click', function () {
          listState.delivery_type = ''; listState.payment = ''; listState.meal = ''; listState.status = ''; listState.from = ''; listState.to = '';
          if ($('#fd')) $('#fd').value = '';
          if ($('#fp')) $('#fp').value = '';
          if ($('#fm')) $('#fm').value = '';
          if ($('#fs')) $('#fs').value = '';
          if ($('#ffrom')) $('#ffrom').value = '';
          if ($('#fto')) $('#fto').value = '';
          load();
        });
      }
    }

    var t;
    $('#q').addEventListener('input', function (e) { listState.q = e.target.value.trim(); clearTimeout(t); t = setTimeout(load, 250); });
    $('#tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      listState.tab = b.dataset.t; listState.q = ''; listState.from = ''; listState.to = '';
      $('#q').value = '';
      if ($('#ffrom')) $('#ffrom').value = '';
      if ($('#fto')) $('#fto').value = '';
      load();
    });
    $('#f-toggle').addEventListener('click', function () {
      listState.showFilters = !listState.showFilters;
      var p = $('#f-panel');
      if (p) p.hidden = !listState.showFilters;
      this.setAttribute('aria-expanded', String(listState.showFilters));
    });
    if ($('#fd')) $('#fd').addEventListener('change', function (e) { listState.delivery_type = e.target.value; load(); });
    if ($('#fp')) $('#fp').addEventListener('change', function (e) { listState.payment = e.target.value; load(); });
    if ($('#fm')) $('#fm').addEventListener('change', function (e) { listState.meal = e.target.value; load(); });
    if ($('#fs')) $('#fs').addEventListener('change', function (e) { listState.status = e.target.value; load(); });
    if ($('#ffrom')) $('#ffrom').addEventListener('change', function (e) { listState.from = e.target.value; load(); });
    if ($('#fto')) $('#fto').addEventListener('change', function (e) { listState.to = e.target.value; load(); });
    $$('.preset-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pre = btn.dataset.pre;
        var td = new Date();
        if (pre === 'today') {
          listState.from = today(); listState.to = today();
        } else if (pre === 'tomorrow') {
          var tm = new Date(td.getTime() + 864e5);
          listState.from = iso(tm); listState.to = iso(tm);
        } else if (pre === 'next7') {
          var n7 = new Date(td.getTime() + 7 * 864e5);
          listState.from = today(); listState.to = iso(n7);
        } else if (pre === 'clear-dates') {
          listState.from = ''; listState.to = '';
        }
        if ($('#ffrom')) $('#ffrom').value = listState.from;
        if ($('#fto')) $('#fto').value = listState.to;
        load();
      });
    });
    bindChips();
    load();
  }

  /* ---------- order detail ---------- */
  function viewOrder(id, isNew) {
    loading('orders', 'Order #' + id, 'Order');
    api('/orders/' + id).then(function (r) { renderOrder(r.order, isNew); }, function (e) { failed('orders', e); });
  }
  function renderOrder(o, isNew) {
    var admin = canWrite();
    var text = waText(o);
    var statuses = admin ? ['new', 'confirmed', 'prepared', 'delivered'] : ['prepared', 'delivered'];
    var html = header('Order #' + o.id, o.customer_name, '<span class="pill ' + o.status + '">' + o.status + '</span>');
    if (isNew) html += '<div class="banner">Order saved. Send it to the WhatsApp group now.</div>';
    html += '<section class="card"><span class="label">Message for the group</span><div class="msg" id="msg">' + esc(text) + '</div>' +
      '<div class="actions"><a class="btn primary" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=' + encodeURIComponent(text) + '">Send on WhatsApp</a>' +
      '<button class="btn" id="copy" type="button">Copy</button></div></section>';
    html += '<section class="card"><dl class="kv">' +
      '<dt>Date</dt><dd>' + esc(fmtDate(o.order_date)) + '</dd><dt>Time</dt><dd>' + esc(mealText(o)) + '</dd>' +
      '<dt>Mobile</dt><dd><a href="tel:' + esc(o.mobile.replace(/[^\d+]/g, '')) + '">' + esc(o.mobile) + '</a></dd>' +
      '<dt>Delivery</dt><dd>' + esc(o.delivery_type) + '</dd>' +
      (o.address ? '<dt>Address</dt><dd>' + esc(o.address) + '</dd>' : '') +
      '<dt>Misc</dt><dd>' + (o.misc ? esc(o.misc) : '-') + '</dd>' +
      '<dt>Entered by</dt><dd>' + esc(o.created_by_name || '-') + '</dd></dl>' +
      '<div class="scroll"><table><tbody>' + o.items.map(function (i) { return '<tr><td>' + esc(i.name) + '</td><td class="n">' + i.qty + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
    html += '<section class="card"><span class="label">Status</span><div class="seg" id="st">' +
      statuses.map(function (s) { return '<button type="button" class="btn sm ' + (o.status === s ? 'primary' : '') + '" data-s="' + s + '"' + (o.status === s ? ' aria-pressed="true"' : '') + '>' + s + '</button>'; }).join('') + '</div></section>';
    if (admin) {
      var due = o.total_amount - o.paid;
      var bannerHtml = '';
      if (o.total_amount === 0) {
        bannerHtml = '<div class="pay-banner muted">Price not yet set for this order. Edit order to add total amount.</div>';
      } else if (due <= 0) {
        bannerHtml = '<div class="pay-banner ok">✓ Order is fully paid (' + money(o.paid) + ')</div>';
      } else if (o.paid > 0) {
        bannerHtml = '<div class="pay-banner warn">⚠ Balance due: <b>' + money(due) + '</b> (Paid ' + money(o.paid) + ' of ' + money(o.total_amount) + ')</div>';
      } else {
        bannerHtml = '<div class="pay-banner due-ban">✕ No payment received yet · <b>' + money(due) + '</b> balance due</div>';
      }
      html += '<section class="card"><span class="label">Payments & Balance Tracking</span>' + bannerHtml +
        '<div class="tiles">' +
        '<div class="tile"><span class="small muted">Total</span><b>' + money(o.total_amount) + '</b></div>' +
        '<div class="tile"><span class="small muted">Paid</span><b>' + money(o.paid) + '</b></div>' +
        '<div class="tile"><span class="small muted">Balance</span><b class="' + (due > 0 ? 'due' : 'paidup') + '">' + money(Math.max(due, 0)) + '</b></div></div>';
      if (o.payments.length) {
        html += '<div class="scroll"><table><tbody>' + o.payments.map(function (p) {
          return '<tr><td>' + esc(p.created_at.slice(0, 10)) + '<br><span class="small muted">' + esc(p.note || '') + '</span></td><td class="n">' + money(p.amount) +
            '</td><td class="n">' + (isOwner() ? '<button class="linkbtn" data-del="' + p.id + '" type="button">Remove</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      }
      html += '<form id="pf" class="pair" novalidate><div class="field"><label class="label" for="pa">Amount received (₹)</label><input id="pa" type="number" inputmode="numeric" min="1" step="1"></div>' +
        '<div class="field"><label class="label" for="pn">Note</label><input id="pn" placeholder="UPI, cash"></div>' +
        '<button class="btn primary" type="submit">Add payment</button>' +
        (due > 0 ? '<button class="btn" type="button" id="full">Received full balance (' + money(due) + ')</button>' : '') + '</form></section>';
      html += '<div class="actions"><a class="btn" href="#/edit/' + o.id + '">Edit order</a>' +
        (o.status !== 'cancelled' ? '<button class="btn danger" id="cancel" type="button">Cancel order</button>' : '') + '</div>';
    }
    shell('orders', html);

    $('#copy').addEventListener('click', function () { copyText(text, 'Copied. Paste it into the WhatsApp group.'); });
    function setStatus(s) {
      api('/orders/' + o.id + '/status', { method: 'POST', body: { status: s } }).then(function () { viewOrder(o.id, false); }, function (e) { toast(e.message); });
    }
    $('#st').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (b && b.dataset.s !== o.status) setStatus(b.dataset.s);
    });
    if (admin) {
      var addPay = function (amount, note) {
        api('/orders/' + o.id + '/payments', { method: 'POST', body: { amount: amount, note: note } }).then(function () { viewOrder(o.id, false); }, function (e) { toast(e.message); });
      };
      $('#pf').addEventListener('submit', function (e) { e.preventDefault(); addPay($('#pa').value, $('#pn').value); });
      if ($('#full')) $('#full').addEventListener('click', function () { addPay(o.total_amount - o.paid, $('#pn').value); });
      $$('[data-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Remove this payment?')) return;
          api('/payments/' + b.dataset.del, { method: 'DELETE' }).then(function () { viewOrder(o.id, false); }, function (e) { toast(e.message); });
        });
      });
      if ($('#cancel')) $('#cancel').addEventListener('click', function () { if (confirm('Cancel this order? It will drop off the prep sheet.')) setStatus('cancelled'); });
    }
  }

  /* ---------- prep sheet ---------- */
  function viewPrep() {
    if (!prepState.from) prepState.from = today();
    if (!prepState.to) prepState.to = today();

    shell('prep', header('Kitchen', 'Prep sheet & Groceries') +
      '<section class="card">' +
        '<span class="label">Date Range & Meal</span>' +
        '<div class="pair">' +
          '<div class="field"><label class="label" for="pf">From date</label><input type="date" id="pf" value="' + esc(prepState.from) + '"></div>' +
          '<div class="field"><label class="label" for="pt">To date</label><input type="date" id="pt" value="' + esc(prepState.to) + '"></div>' +
        '</div>' +
        '<div class="presets">' +
          '<button type="button" class="preset-btn" data-pp="today">Today</button>' +
          '<button type="button" class="preset-btn" data-pp="tomorrow">Tomorrow</button>' +
          '<button type="button" class="preset-btn" data-pp="next7">Next 7 days</button>' +
          '<button type="button" class="preset-btn" data-pp="this-week">This week</button>' +
          '<button type="button" class="preset-btn" data-pp="next-week">Next week</button>' +
        '</div>' +
        '<div class="field" style="margin-top:4px">' +
          '<label class="label" for="pm">Meal</label>' +
          '<select id="pm"><option value="">All meals</option>' + MEALS.map(function (m) { return '<option value="' + m + '"' + (prepState.meal === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select>' +
        '</div>' +
      '</section>' +
      '<div id="pout"></div>');

    var groceryText = '';
    var mealText = '';

    function load() {
      var f = prepState.from, t = prepState.to, m = prepState.meal, out = $('#pout');
      if (!f || !t) { out.innerHTML = '<p class="empty">Pick both dates.</p>'; return; }

      var p = new URLSearchParams();
      p.set('from', f);
      p.set('to', t);
      if (m) p.set('meal', m);

      api('/prep?' + p.toString()).then(function (r) {
        if (!r.total_items || !r.total_items.length) {
          out.innerHTML = '<p class="empty">No active orders found for this period.</p>';
          groceryText = ''; mealText = '';
          return;
        }

        var isMulti = r.isRange;
        var dateLabel = isMulti
          ? fmtShort(r.from) + ' – ' + fmtShort(r.to)
          : (relDay(r.from) ? relDay(r.from) + ', ' : '') + fmtDate(r.from);

        // 1. Consolidated Grocery List text for copying
        var gLines = ['🛒 Grocery / Prep List: ' + dateLabel];
        gLines.push('Total Orders: ' + r.total_orders + (m ? ' (' + m + ')' : ''));
        gLines.push('-------------------------');
        r.total_items.forEach(function (it, idx) {
          gLines.push((idx + 1) + '. ' + it.name + ' – ' + it.qty + (it.orders > 1 ? ' (' + it.orders + ' orders)' : ''));
        });
        groceryText = gLines.join('\n');

        // 2. Meal breakdown text for copying
        var counts = {}; (r.counts || []).forEach(function (c) { counts[c.meal] = c.orders; });
        var byMeal = {}, mealOrder = [];
        (r.items || []).forEach(function (it) {
          if (!byMeal[it.meal]) { byMeal[it.meal] = []; mealOrder.push(it.meal); }
          byMeal[it.meal].push(it);
        });

        var mLines = ['Prep by Meal: ' + dateLabel];
        mealOrder.forEach(function (ml) {
          mLines.push('', ml + ' (' + (counts[ml] || 0) + ' orders):');
          byMeal[ml].forEach(function (it) { mLines.push('• ' + it.name + ' – ' + it.qty); });
        });
        mealText = mLines.join('\n');

        // Consolidated Grocery Card HTML
        var groceryHtml = '<section class="card" style="margin-top:16px">' +
          '<div class="top"><h2>Total Grocery & Prep List</h2><span class="muted small">' + r.total_items.length + ' items · ' + r.total_orders + ' orders</span></div>' +
          '<div class="scroll"><table><thead><tr><th>Item</th><th class="n">Total Needed</th><th class="n">Orders</th></tr></thead><tbody>' +
          r.total_items.map(function (it) {
            return '<tr><td><b>' + esc(it.name) + '</b></td><td class="n"><b style="font-size:17px;color:var(--accent)">' + it.qty + '</b></td><td class="n muted small">' + it.orders + '</td></tr>';
          }).join('') +
          '</tbody></table></div>' +
          '<button class="btn primary" id="gcopy" type="button" style="margin-top:14px;width:100%">Copy grocery list for WhatsApp / supplier</button>' +
        '</section>';

        // By Meal HTML (if viewing all meals or multiple meals)
        var mealBreakdownHtml = '';
        if (mealOrder.length > 1 || (mealOrder.length === 1 && !m)) {
          mealBreakdownHtml = '<h2 style="margin-top:20px;font-size:18px">Breakdown by Meal</h2>' +
            mealOrder.map(function (ml) {
              return '<section class="card" style="margin-top:10px">' +
                '<div class="top"><h2>' + esc(ml) + '</h2><span class="muted small">' + counts[ml] + (counts[ml] === 1 ? ' order' : ' orders') + '</span></div>' +
                '<div class="scroll"><table><tbody>' + byMeal[ml].map(function (it) {
                  return '<tr><td>' + esc(it.name) + '</td><td class="n"><b>' + it.qty + '</b></td></tr>';
                }).join('') + '</tbody></table></div></section>';
            }).join('') +
            '<button class="btn" id="mcopy" type="button" style="margin-top:12px;width:100%">Copy meal breakdown as text</button>';
        }

        out.innerHTML =
          '<div class="tiles">' +
            '<div class="tile"><span class="small muted">Orders</span><b>' + r.total_orders + '</b></div>' +
            '<div class="tile"><span class="small muted">Distinct items</span><b>' + r.total_items.length + '</b></div>' +
            '<div class="tile"><span class="small muted">Period</span><b style="font-size:16px;padding-top:4px">' + esc(isMulti ? fmtShort(r.from) + ' to ' + fmtShort(r.to) : fmtShort(r.from)) + '</b></div>' +
          '</div>' +
          groceryHtml +
          mealBreakdownHtml;

        var gc = $('#gcopy');
        if (gc) gc.addEventListener('click', function () { copyText(groceryText, 'Grocery list copied. Paste it into WhatsApp or notes.'); });
        var mc = $('#mcopy');
        if (mc) mc.addEventListener('click', function () { copyText(mealText, 'Meal breakdown copied.'); });
      }, function (e) { out.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
    }

    $('#pf').addEventListener('change', function (e) { prepState.from = e.target.value; load(); });
    $('#pt').addEventListener('change', function (e) { prepState.to = e.target.value; load(); });
    $('#pm').addEventListener('change', function (e) { prepState.meal = e.target.value; load(); });

    $$('[data-pp]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = btn.dataset.pp;
        var td = new Date();
        if (p === 'today') {
          prepState.from = today(); prepState.to = today();
        } else if (p === 'tomorrow') {
          var tm = new Date(td.getTime() + 864e5);
          prepState.from = iso(tm); prepState.to = iso(tm);
        } else if (p === 'next7') {
          prepState.from = today(); prepState.to = iso(new Date(td.getTime() + 6 * 864e5));
        } else if (p === 'this-week') {
          var day = td.getDay();
          var diffToMon = td.getDate() - (day === 0 ? 6 : day - 1);
          var mon = new Date(td.getFullYear(), td.getMonth(), diffToMon);
          var sun = new Date(td.getFullYear(), td.getMonth(), diffToMon + 6);
          prepState.from = iso(mon); prepState.to = iso(sun);
        } else if (p === 'next-week') {
          var day2 = td.getDay();
          var diffToNextMon = td.getDate() - (day2 === 0 ? 6 : day2 - 1) + 7;
          var nMon = new Date(td.getFullYear(), td.getMonth(), diffToNextMon);
          var nSun = new Date(td.getFullYear(), td.getMonth(), diffToNextMon + 6);
          prepState.from = iso(nMon); prepState.to = iso(nSun);
        }
        $('#pf').value = prepState.from;
        $('#pt').value = prepState.to;
        load();
      });
    });

    load();
  }

  /* ---------- reports ---------- */
  function viewReports() {
    if (!isOwner()) { location.hash = homeHash(); return; }
    var now = new Date();
    if (!reportState.from) reportState.from = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    if (!reportState.to) reportState.to = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    shell('reports', header('Owner only', 'Reports') +
      '<section class="card">' +
        '<span class="label">Report Filters</span>' +
        '<div class="pair">' +
          '<div class="field"><label class="label" for="rf">From date</label><input type="date" id="rf" value="' + esc(reportState.from) + '"></div>' +
          '<div class="field"><label class="label" for="rt">To date</label><input type="date" id="rt" value="' + esc(reportState.to) + '"></div>' +
        '</div>' +
        '<div class="presets">' +
          '<button type="button" class="preset-btn" data-rp="this-month">This month</button>' +
          '<button type="button" class="preset-btn" data-rp="last-month">Last month</button>' +
          '<button type="button" class="preset-btn" data-rp="today">Today</button>' +
          '<button type="button" class="preset-btn" data-rp="next7">Next 7 days</button>' +
          '<button type="button" class="preset-btn" data-rp="all-time">All time</button>' +
        '</div>' +
        '<div class="filter-grid" style="margin-top:6px">' +
          '<div class="field"><label class="label" for="rd">Delivery type</label>' +
            '<select id="rd"><option value="">All delivery types</option>' + DELIVERY.map(function (d) { return '<option value="' + d + '"' + (reportState.delivery_type === d ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label class="label" for="rp">Payment status</label>' +
            '<select id="rp"><option value="">All payment statuses</option>' +
              '<option value="balance"' + (reportState.payment === 'balance' ? ' selected' : '') + '>Balance due / pending</option>' +
              '<option value="paid"' + (reportState.payment === 'paid' ? ' selected' : '') + '>Fully paid</option>' +
              '<option value="partial"' + (reportState.payment === 'partial' ? ' selected' : '') + '>Partial payment</option>' +
              '<option value="unpaid"' + (reportState.payment === 'unpaid' ? ' selected' : '') + '>Unpaid (₹0 paid)</option>' +
            '</select></div>' +
          '<div class="field"><label class="label" for="rm">Meal</label>' +
            '<select id="rm"><option value="">All meals</option>' + MEALS.map(function (m) { return '<option value="' + m + '"' + (reportState.meal === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label class="label" for="rs">Status</label>' +
            '<select id="rs"><option value="">Active orders (excl cancelled)</option>' +
              ['new', 'confirmed', 'prepared', 'delivered', 'cancelled'].map(function (s) { return '<option value="' + s + '"' + (reportState.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
            '</select></div>' +
        '</div>' +
      '</section>' +
      '<div id="rout"></div>' +
      '<section class="card" style="margin-top:16px">' +
        '<div class="top"><h2>Money still to collect</h2><span class="muted small" id="ocount"></span></div>' +
        '<div id="oout"><p class="muted">Loading…</p></div>' +
      '</section>');

    function buildQuery() {
      var p = new URLSearchParams();
      p.set('from', reportState.from);
      p.set('to', reportState.to);
      if (reportState.delivery_type) p.set('delivery_type', reportState.delivery_type);
      if (reportState.payment) p.set('payment', reportState.payment);
      if (reportState.meal) p.set('meal', reportState.meal);
      if (reportState.status) p.set('status', reportState.status);
      return p.toString();
    }

    function load() {
      var f = reportState.from, t = reportState.to, out = $('#rout');
      if (!f || !t) { out.innerHTML = '<p class="empty">Pick both dates.</p>'; return; }
      var q = buildQuery();
      api('/reports?' + q).then(function (r) {
        var totBal = r.totals.balance !== undefined ? r.totals.balance : Math.max(0, r.totals.billed - r.totals.collected);
        var delHtml = '';
        if (r.by_delivery && r.by_delivery.length) {
          delHtml = '<section class="card" style="margin-top:16px"><div class="top"><h2>By delivery type</h2><span class="muted small">' + r.by_delivery.length + ' types</span></div>' +
            '<div class="scroll"><table><thead><tr><th>Delivery</th><th class="n">Orders</th><th class="n">Billed</th><th class="n">Collected</th><th class="n">Balance</th></tr></thead><tbody>' +
            r.by_delivery.map(function (d) {
              var pct = r.totals.orders ? Math.round((d.orders / r.totals.orders) * 100) : 0;
              return '<tr><td><span class="del-tag">' + esc(d.delivery_type) + '</span><br><span class="small muted">' + pct + '% of orders</span></td>' +
                '<td class="n">' + d.orders + '</td>' +
                '<td class="n">' + money(d.billed) + '</td>' +
                '<td class="n">' + money(d.collected) + '</td>' +
                '<td class="n ' + (d.balance > 0 ? 'due' : 'paidup') + '">' + money(d.balance) + '</td></tr>';
            }).join('') +
            '</tbody><tfoot><tr><td>Total</td><td class="n">' + r.totals.orders + '</td><td class="n">' + money(r.totals.billed) + '</td><td class="n">' + money(r.totals.collected) + '</td><td class="n ' + (totBal > 0 ? 'due' : 'paidup') + '">' + money(totBal) + '</td></tr></tfoot></table></div></section>';
        } else {
          delHtml = '<section class="card" style="margin-top:16px"><h2>By delivery type</h2><p class="muted">No orders matching the filters.</p></section>';
        }

        out.innerHTML =
          '<div class="tiles">' +
            '<div class="tile"><span class="small muted">Orders</span><b>' + r.totals.orders + '</b></div>' +
            '<div class="tile"><span class="small muted">Billed</span><b>' + money(r.totals.billed) + '</b></div>' +
            '<div class="tile"><span class="small muted">Collected</span><b style="color:var(--ok)">' + money(r.totals.collected) + '</b></div>' +
            '<div class="tile"><span class="small muted">Balance due</span><b class="' + (totBal > 0 ? 'due' : 'paidup') + '">' + money(totBal) + '</b></div>' +
            '<div class="tile"><span class="small muted">Cancelled</span><b>' + r.cancelled + '</b></div>' +
          '</div>' +
          delHtml +
          '<section class="card" style="margin-top:16px"><h2>By day</h2>' + (r.by_day.length ? '<div class="scroll"><table><thead><tr><th>Date</th><th class="n">Orders</th><th class="n">Billed</th><th class="n">Collected</th><th class="n">Balance</th></tr></thead><tbody>' +
            r.by_day.map(function (d) {
              return '<tr><td>' + esc(fmtShort(d.date)) + '</td><td class="n">' + d.orders + '</td><td class="n">' + money(d.billed) + '</td><td class="n">' + money(d.collected) + '</td><td class="n ' + (d.balance > 0 ? 'due' : 'paidup') + '">' + money(d.balance) + '</td></tr>';
            }).join('') + '</tbody></table></div>' : '<p class="muted">No orders in this range.</p>') + '</section>' +
          '<section class="card" style="margin-top:16px"><h2>Top items</h2>' + (r.top_items.length ? '<div class="scroll"><table><tbody>' +
            r.top_items.map(function (i) { return '<tr><td>' + esc(i.name) + '</td><td class="n"><b>' + i.qty + '</b></td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">Nothing yet.</p>') + '</section>' +
          '<a class="btn" style="margin-top:16px;width:100%" href="/api/export.csv?' + q + '">Download filtered range as spreadsheet (CSV)</a>';
      }, function (e) { out.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
    }

    $('#rf').addEventListener('change', function (e) { reportState.from = e.target.value; load(); });
    $('#rt').addEventListener('change', function (e) { reportState.to = e.target.value; load(); });
    $('#rd').addEventListener('change', function (e) { reportState.delivery_type = e.target.value; load(); });
    $('#rp').addEventListener('change', function (e) { reportState.payment = e.target.value; load(); });
    $('#rm').addEventListener('change', function (e) { reportState.meal = e.target.value; load(); });
    $('#rs').addEventListener('change', function (e) { reportState.status = e.target.value; load(); });

    $$('[data-rp]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = btn.dataset.rp;
        var td = new Date();
        if (p === 'this-month') {
          reportState.from = iso(new Date(td.getFullYear(), td.getMonth(), 1));
          reportState.to = iso(new Date(td.getFullYear(), td.getMonth() + 1, 0));
        } else if (p === 'last-month') {
          reportState.from = iso(new Date(td.getFullYear(), td.getMonth() - 1, 1));
          reportState.to = iso(new Date(td.getFullYear(), td.getMonth(), 0));
        } else if (p === 'today') {
          reportState.from = today(); reportState.to = today();
        } else if (p === 'next7') {
          reportState.from = today(); reportState.to = iso(new Date(td.getTime() + 7 * 864e5));
        } else if (p === 'all-time') {
          reportState.from = '2024-01-01'; reportState.to = '2030-12-31';
        }
        $('#rf').value = reportState.from;
        $('#rt').value = reportState.to;
        load();
      });
    });

    load();

    api('/outstanding').then(function (r) {
      var countEl = $('#ocount');
      if (countEl) countEl.textContent = r.orders.length + (r.orders.length === 1 ? ' order with balance' : ' orders with balance');
      $('#oout').innerHTML = r.orders.length ? '<div class="scroll"><table><thead><tr><th>Customer / Order</th><th>Delivery</th><th class="n">Total</th><th class="n">Paid</th><th class="n">Balance due</th><th></th></tr></thead><tbody>' +
        r.orders.map(function (o) {
          var bal = o.total_amount - o.paid;
          return '<tr><td><a href="#/order/' + o.id + '"><b>' + esc(o.customer_name) + '</b></a><br><span class="small muted">' + esc(fmtShort(o.order_date) + ' · ' + o.meal) + '</span>' +
            '<br><a class="small" href="tel:' + esc(o.mobile) + '">' + esc(o.mobile) + '</a></td>' +
            '<td><span class="del-tag">' + esc(o.delivery_type) + '</span></td>' +
            '<td class="n">' + money(o.total_amount) + '</td>' +
            '<td class="n">' + money(o.paid) + '</td>' +
            '<td class="n due"><b>' + money(bal) + '</b></td>' +
            '<td class="n"><a class="btn sm" href="#/order/' + o.id + '">Collect</a></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="paidup">✓ Everything is paid up!</p>';
    }, function (e) { $('#oout').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }

  /* ---------- users ---------- */
  function viewUsers() {
    if (!isOwner()) { location.hash = homeHash(); return; }
    loading('users', 'Owner only', 'Users');
    api('/users').then(function (r) {
      shell('users', header('Owner only', 'Users') +
        '<section class="card">' + r.users.map(function (u) {
          return '<div class="urow"><div><b>' + esc(u.name) + '</b><br><span class="small muted">' + (ROLE_LABEL[u.role] || u.role) + (u.active ? '' : ' · switched off') + '</span></div>' +
            '<div class="actions">' +
            (u.id !== me.id ? '<select class="sm-select" data-role="' + u.id + '" aria-label="Access for ' + esc(u.name) + '">' +
              ['owner', 'taker', 'kitchen'].map(function (r) { return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + ROLE_LABEL[r] + '</option>'; }).join('') + '</select>' : '') +
            '<button class="btn sm" data-pw="' + u.id + '" type="button">New password</button>' +
            (u.id !== me.id ? '<button class="btn sm" data-act="' + u.id + '" data-on="' + (u.active ? 0 : 1) + '" type="button">' + (u.active ? 'Switch off' : 'Switch on') + '</button>' : '') + '</div></div>';
        }).join('<hr style="border:0;border-top:1px solid var(--line);width:100%">') + '</section>' +
        '<form class="card" id="uf" novalidate autocomplete="off"><h2>Add a login</h2>' +
        '<div class="field"><label class="label" for="un">Name</label><input id="un"></div>' +
        '<div class="field"><label class="label" for="up">Password (6+ characters)</label><input id="up" type="text" autocomplete="off"></div>' +
        '<div class="field"><span class="label" id="url">Access</span><div class="seg" role="radiogroup" aria-labelledby="url">' +
        '<label class="opt"><input type="radio" name="role" value="kitchen" checked><span>Kitchen</span></label>' +
        '<label class="opt"><input type="radio" name="role" value="taker"><span>Order taker</span></label>' +
        '<label class="opt"><input type="radio" name="role" value="owner"><span>Owner</span></label></div></div>' +
        '<p class="err" id="ue" role="alert" hidden></p><button class="btn primary" type="submit">Add login</button>' +
        '<div class="small muted" style="display:grid;gap:6px"><div><b>Owner:</b> everything, including reports, the CSV download, removing payments and managing logins.</div>' +
        '<div><b>Order taker:</b> enters and edits orders, amounts and payments, and sets any status. No reports or logins.</div>' +
        '<div><b>Kitchen:</b> views orders and the prep sheet, and marks orders prepared or delivered. No amounts.</div></div></form>' +
        '<button class="btn" id="out" type="button">Sign out</button>');
      $$('[data-pw]').forEach(function (b) {
        b.addEventListener('click', function () {
          var pw = prompt('New password (6 or more characters):');
          if (pw === null) return;
          api('/users/' + b.dataset.pw, { method: 'PUT', body: { pin: pw } }).then(function () { toast('Password changed.'); }, function (e) { toast(e.message); });
        });
      });
      $$('[data-role]').forEach(function (sel) {
        sel.addEventListener('change', function () {
          api('/users/' + sel.dataset.role, { method: 'PUT', body: { role: sel.value } }).then(function () { toast('Access changed.'); viewUsers(); }, function (e) { toast(e.message); viewUsers(); });
        });
      });
      $$('[data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          api('/users/' + b.dataset.act, { method: 'PUT', body: { active: b.dataset.on === '1' } }).then(viewUsers, function (e) { toast(e.message); });
        });
      });
      $('#uf').addEventListener('submit', function (e) {
        e.preventDefault();
        var er = $('#ue'); er.hidden = true;
        api('/users', { method: 'POST', body: { name: $('#un').value, pin: $('#up').value, role: $('input[name="role"]:checked').value } })
          .then(viewUsers, function (ex) { er.textContent = ex.message; er.hidden = false; });
      });
      $('#out').addEventListener('click', signOut);
    }, function (e) { failed('users', e); });
  }
  function signOut() {
    api('/logout', { method: 'POST' }).then(function () { me = null; location.hash = '#/login'; }, function () { me = null; location.hash = '#/login'; });
  }

  /* ---------- router ---------- */
  function route() {
    var parts = (location.hash || '').split('?');
    var h = parts[0], query = parts[1] || '', m;
    window.scrollTo(0, 0);
    var go = function () {
      if (!me) { if (h !== '#/login') { location.hash = '#/login'; return; } return viewLogin(); }
      if (h === '#/login') { location.hash = homeHash(); return; }
      if (h === '#/new') return viewForm(null);
      if ((m = h.match(/^#\/edit\/(\d+)$/))) return viewForm(Number(m[1]));
      if ((m = h.match(/^#\/order\/(\d+)$/))) return viewOrder(Number(m[1]), query === 'new=1');
      if (h === '#/prep') return viewPrep();
      if (h === '#/reports') return viewReports();
      if (h === '#/users') return viewUsers();
      return viewOrders();
    };
    if (me !== null || h === '#/login-check') return go();
    api('/me').then(function (r) { me = r.user; go(); }, function () { app.innerHTML = '<main class="wrap plain"><p class="err">No connection. Check the internet and reload.</p></main>'; });
  }
  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
