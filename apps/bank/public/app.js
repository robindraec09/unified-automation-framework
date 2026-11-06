// Harbourline Bank UI. Plain browser JS, no build step. Pages call /api/v1 with the session cookie.
'use strict';

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const fmtMoney = (n) => aud.format(n);
const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });

/** Fetch JSON from the API; throws { status, error, message } on non-2xx. */
async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (res.status === 401) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    throw { status: 401, message: 'Session expired' };
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw { status: res.status, ...(body || { message: 'Unexpected error' }) };
  return body;
}

/** Build an element: el('td', { class: 'num' }, 'text', child). Text is never parsed as HTML. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(String(c ?? '')));
  return node;
}

function show(selector, message) {
  const box = document.querySelector(selector);
  if (!box) return;
  box.textContent = message || '';
  box.hidden = !message;
}

const errorText = (e) => {
  const details =
    Array.isArray(e.details) && e.details.length ? `: ${e.details.map((d) => d.message).join('; ')}` : '';
  return `${e.message || 'Something went wrong'}${details}`;
};

async function renderHeader(active) {
  const host = document.getElementById('app-header');
  if (!host) return;
  const link = (href, text, key) => el('a', { href, 'aria-current': key === active ? 'page' : null }, text);
  const name = el('span', { 'data-testid': 'customer-name' });
  const logout = el(
    'button',
    {
      class: 'btn btn-link',
      type: 'button',
      onclick: async () => {
        await api('/web/logout', { method: 'POST' });
        location.href = '/login';
      },
    },
    'Log out',
  );
  host.replaceChildren(
    el('div', { class: 'demo-banner' }, 'Demo bank for test automation. Not a real financial institution.'),
    el(
      'header',
      { class: 'topbar' },
      el(
        'div',
        { class: 'topbar-inner' },
        el(
          'a',
          { class: 'brand', href: '/accounts' },
          el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'H'),
          'Harbourline Bank',
        ),
        el(
          'nav',
          { class: 'nav', 'aria-label': 'Main' },
          link('/accounts', 'Accounts', 'accounts'),
          link('/transfer', 'Transfer & pay', 'transfer'),
          link('/payees', 'Payees', 'payees'),
        ),
        el('div', { class: 'who' }, name, logout),
      ),
    ),
  );
  const me = await api('/api/v1/me');
  name.textContent = me.fullName;
}

// ---- Pages ----

async function loginPage() {
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    show('[data-testid="login-error"]', '');
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password)
      return show('[data-testid="login-error"]', 'Enter your customer ID and password');
    try {
      const res = await fetch('/web/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json();
      if (!res.ok) return show('[data-testid="login-error"]', body.message);
      const next = new URLSearchParams(location.search).get('next');
      location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/accounts';
    } catch {
      show('[data-testid="login-error"]', 'Unable to reach Harbourline Bank. Please try again.');
    }
  });
}

async function accountsPage() {
  await renderHeader('accounts');
  const list = document.querySelector('[data-testid="account-list"]');
  const accounts = await api('/api/v1/accounts');
  list.replaceChildren(
    ...accounts.map((a) =>
      el(
        'a',
        {
          class: 'account-card',
          href: `/accounts/${a.id}`,
          'data-testid': 'account-card',
          'data-account-id': a.id,
        },
        el('span', { class: 'account-name', 'data-testid': 'account-name' }, a.name),
        el(
          'span',
          { class: `money big ${a.balance < 0 ? 'neg' : ''}`, 'data-testid': 'account-balance' },
          fmtMoney(a.balance),
        ),
        el('span', { class: 'account-meta' }, `BSB ${a.bsb}  Acc ${a.accountNumber}`),
        el(
          'span',
          { class: 'account-meta', 'data-testid': 'account-available' },
          `Available ${fmtMoney(a.availableBalance)}`,
        ),
      ),
    ),
  );
  list.setAttribute('aria-busy', 'false');
  const net = accounts.reduce((s, a) => s + Math.round(a.balance * 100), 0) / 100;
  document.querySelector('[data-testid="net-position"]').textContent = fmtMoney(net);
}

async function accountPage() {
  await renderHeader('accounts');
  const id = location.pathname.split('/').pop();
  try {
    const [account, txns] = await Promise.all([
      api(`/api/v1/accounts/${id}`),
      api(`/api/v1/accounts/${id}/transactions?limit=50`),
    ]);
    document.title = `${account.name} | Harbourline Bank`;
    document.querySelector('[data-testid="account-name"]').textContent = account.name;
    document.querySelector('[data-testid="account-number"]').textContent =
      `BSB ${account.bsb}  Acc ${account.accountNumber}`;
    document.querySelector('[data-testid="account-balance"]').textContent = fmtMoney(account.balance);
    document.querySelector('[data-testid="account-available"]').textContent =
      `Available ${fmtMoney(account.availableBalance)}`;
    document
      .querySelector('[data-testid="transactions"] tbody')
      .replaceChildren(
        ...txns.map((t) =>
          el(
            'tr',
            { 'data-testid': 'transaction-row' },
            el('td', {}, fmtDate(t.postedAt)),
            el('td', {}, t.description),
            el('td', { class: `num ${t.amount < 0 ? 'neg' : ''}` }, fmtMoney(t.amount)),
            el('td', { class: 'num' }, fmtMoney(t.balanceAfter)),
          ),
        ),
      );
  } catch (e) {
    show('[data-testid="page-error"]', e.status === 404 ? 'Account not found' : errorText(e));
  }
}

async function transferPage() {
  const form = document.getElementById('transfer-form');
  // Swallow submits until the handler below is attached (no native GET with the amount in the URL)
  const early = (ev) => ev.preventDefault();
  form.addEventListener('submit', early);
  const [, accounts, payees] = await Promise.all([
    renderHeader('transfer'),
    api('/api/v1/accounts'),
    api('/api/v1/payees'),
  ]);
  const option = (value, text) => el('option', { value }, text);
  const acctLabel = (a) => `${a.name} (${a.accountNumber}) ${fmtMoney(a.availableBalance)} available`;
  form.from.replaceChildren(...accounts.map((a) => option(a.id, acctLabel(a))));
  form.to.replaceChildren(...accounts.map((a) => option(a.id, acctLabel(a))));
  if (accounts.length > 1) form.to.selectedIndex = 1;
  form.payee.replaceChildren(...payees.map((p) => option(p.id, `${p.name} (${p.bsb} ${p.accountNumber})`)));

  const toggle = () => {
    const toPayee = form.destination.value === 'payee';
    document.getElementById('to-account-group').hidden = toPayee;
    document.getElementById('payee-group').hidden = !toPayee;
  };
  form.querySelectorAll('input[name="destination"]').forEach((r) => r.addEventListener('change', toggle));

  // One key per form view: double-clicking Transfer can never pay twice
  let idempotencyKey = crypto.randomUUID();
  form.removeEventListener('submit', early);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    show('[data-testid="transfer-error"]', '');
    const amountText = form.amount.value.trim().replace(/[$,]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(amountText) || Number(amountText) <= 0)
      return show(
        '[data-testid="transfer-error"]',
        'Enter an amount greater than $0.00 with up to 2 decimal places',
      );
    const toPayee = form.destination.value === 'payee';
    const body = {
      fromAccountId: Number(form.from.value),
      amount: Number(amountText),
      description: form.description.value.trim(),
      ...(toPayee ? { payeeId: Number(form.payee.value) } : { toAccountId: Number(form.to.value) }),
    };
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const t = await api('/api/v1/transfers', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(body),
      });
      const target = toPayee
        ? payees.find((p) => p.id === body.payeeId).name
        : accounts.find((a) => a.id === body.toAccountId).name;
      document.querySelector('[data-testid="receipt-id"]').textContent = t.id;
      document.querySelector('[data-testid="receipt-summary"]').textContent =
        `${fmtMoney(t.amount)} sent to ${target}`;
      form.closest('section').hidden = true;
      document.querySelector('[data-testid="transfer-receipt"]').hidden = false;
      idempotencyKey = crypto.randomUUID();
    } catch (e) {
      show('[data-testid="transfer-error"]', errorText(e));
    } finally {
      button.disabled = false;
    }
  });
}

async function payeesPage() {
  // Attach the submit handler before any await: a fast submit must never fall back to a native GET
  const form = document.getElementById('payee-form');
  const tbody = document.querySelector('[data-testid="payee-table"] tbody');
  const load = async () => {
    const payees = await api('/api/v1/payees');
    tbody.replaceChildren(
      ...payees.map((p) =>
        el(
          'tr',
          { 'data-testid': 'payee-row' },
          el('td', {}, p.name),
          el('td', {}, p.bsb),
          el('td', {}, p.accountNumber),
          el('td', {}, p.nickname || ''),
          el(
            'td',
            {},
            el(
              'button',
              {
                class: 'btn btn-danger',
                type: 'button',
                'aria-label': `Delete payee ${p.name}`,
                onclick: async () => {
                  if (!confirm(`Delete ${p.name}?`)) return;
                  await api(`/api/v1/payees/${p.id}`, { method: 'DELETE' });
                  show('[data-testid="payee-success"]', `${p.name} deleted`);
                  await load();
                },
              },
              'Delete',
            ),
          ),
        ),
      ),
    );
  };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    show('[data-testid="payee-error"]', '');
    show('[data-testid="payee-success"]', '');
    const body = {
      // form.name is the form's own name attribute, so read the field through elements
      name: form.elements.namedItem('name').value.trim(),
      bsb: form.bsb.value.trim(),
      accountNumber: form.accountNumber.value.trim(),
      ...(form.nickname.value.trim() ? { nickname: form.nickname.value.trim() } : {}),
    };
    try {
      const p = await api('/api/v1/payees', { method: 'POST', body: JSON.stringify(body) });
      form.reset();
      show('[data-testid="payee-success"]', `${p.name} added`);
      await load();
    } catch (e) {
      show('[data-testid="payee-error"]', errorText(e));
    }
  });

  await Promise.all([renderHeader('payees'), load()]);
}

const pages = {
  login: loginPage,
  accounts: accountsPage,
  account: accountPage,
  transfer: transferPage,
  payees: payeesPage,
};
const run = pages[document.body.dataset.page];
if (run) run().catch((e) => show('[data-testid="page-error"]', errorText(e)));
