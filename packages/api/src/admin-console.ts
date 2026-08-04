/**
 * The operator console, as one static page.
 *
 * Served by the API rather than built into the player app, for one reason that
 * matters: no operator code, field name or endpoint should ever be shipped to a
 * player's device. A hidden route in the player bundle is not hidden — it is
 * one "view source" away from telling an attacker exactly what to attack.
 *
 * It is hand-written HTML with no build step and no dependencies. A console
 * that needs a bundler is a console that stops working the day the bundler
 * does, and this is the page you need most on the day things are going wrong.
 */

export const ADMIN_CONSOLE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Juwa 3.0 — Operator</title>
<style>
  :root {
    --bg: #08070E; --panel: #13111C; --raised: #1C1929; --border: #2A2539;
    --text: #EEEBF4; --muted: #7B7591; --cyan: #2FE3D6; --brass: #C8A44D;
    --good: #3FD68A; --bad: #FF6B6B;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  header {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 14px 20px; border-bottom: 1px solid var(--border); background: var(--panel);
    position: sticky; top: 0; z-index: 2;
  }
  h1 { font-size: 17px; margin: 0; letter-spacing: .04em; text-transform: uppercase; }
  main { padding: 20px; max-width: 1200px; margin: 0 auto; }
  section { margin-bottom: 32px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--border); }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  td.num, th.num { text-align: right; }
  input, button { font: inherit; }
  input {
    background: var(--bg); color: var(--text); border: 1px solid var(--border);
    border-radius: 8px; padding: 8px 10px; width: 100%;
  }
  input[type=number] { width: 110px; }
  button {
    background: var(--cyan); color: #08070E; border: 0; border-radius: 999px;
    padding: 9px 16px; font-weight: 700; cursor: pointer;
  }
  button.ghost { background: transparent; color: var(--cyan); border: 1px solid var(--border); }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
  .login { max-width: 380px; margin: 8vh auto; display: grid; gap: 12px; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .err { color: var(--bad); min-height: 20px; }
  .ok { color: var(--good); }
  .drift { color: var(--bad); font-weight: 700; }
  .hint { color: var(--muted); font-size: 13px; }
  .off { opacity: .45; }
  .wrap { overflow-x: auto; }
</style>
</head>
<body>
<div id="app"></div>

<script>
// Session token lives in memory only. Persisting it would leave operator access
// sitting in storage on a shared machine long after the tab was closed.
let token = null;

const $ = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const app = document.getElementById('app');
const pct = (v) => v == null ? '—' : (v * 100).toFixed(2) + '%';
const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status));
  return data;
}

function renderLogin(message) {
  app.innerHTML = '';
  const form = $(\`<form class="login card">
    <h1>Juwa 3.0 — Operator</h1>
    <label>Email<input name="email" type="email" autocomplete="username" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <label>Authenticator code<input name="code" inputmode="numeric" autocomplete="one-time-code" required></label>
    <button type="submit">Sign in</button>
    <div class="err"></div>
    <p class="hint">Two-factor is required. There is no "remember this device".</p>
  </form>\`);
  if (message) form.querySelector('.err').textContent = message;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      const result = await api('/admin/login', { method: 'POST', body: JSON.stringify(data) });
      token = result.token;
      renderPanel();
    } catch (error) {
      form.querySelector('.err').textContent = error.message;
    }
  });
  app.append(form);
}

async function renderPanel() {
  let games, audit, operator;
  try {
    const result = await api('/admin/games');
    games = result.games;
    operator = result.operator;
    audit = (await api('/admin/audit?limit=40')).entries;
  } catch (error) {
    token = null;
    renderLogin(error.message);
    return;
  }

  app.innerHTML = '';
  app.append($(\`<header>
    <h1>Juwa 3.0 — Operator</h1>
    <div class="row"><span class="hint">\${operator.email}</span>
    <button class="ghost" id="out">Sign out</button></div>
  </header>\`));

  const main = $('<main></main>');

  const totals = games.reduce((a, g) => ({
    rounds: a.rounds + g.rounds,
    wagered: a.wagered + g.coinsWagered,
    paid: a.paid + g.coinsPaid,
  }), { rounds: 0, wagered: 0, paid: 0 });

  main.append($(\`<section class="card">
    <h2>All games</h2>
    <div class="row">
      <div><div class="hint">Spins</div><strong>\${num(totals.rounds)}</strong></div>
      <div style="margin-left:24px"><div class="hint">Coins wagered</div><strong>\${num(totals.wagered)}</strong></div>
      <div style="margin-left:24px"><div class="hint">Coins paid</div><strong>\${num(totals.paid)}</strong></div>
      <div style="margin-left:24px"><div class="hint">Observed RTP</div><strong>\${totals.wagered ? pct(totals.paid / totals.wagered) : '—'}</strong></div>
    </div>
  </section>\`));

  const table = $(\`<section><h2>Games</h2><div class="wrap"><table>
    <thead><tr>
      <th>Game</th><th class="num">Measured RTP</th><th class="num">Observed</th>
      <th class="num">Spins</th><th class="num">Hit rate</th>
      <th class="num">Max win ×</th><th class="num">Min bet</th><th class="num">Max bet</th>
      <th>Enabled</th><th></th>
    </tr></thead><tbody></tbody></table></div>
    <p class="hint">Return to player is measured by simulation and published — it is not a
    setting, and there is no field for it. A persistent gap between measured and observed
    means the deployed code is not the code that was measured. Observed figures need a few
    thousand spins before they mean anything.</p>
  </section>\`);

  const tbody = table.querySelector('tbody');
  for (const game of games) {
    // Flag drift only once there are enough spins for the number to mean
    // something. Shouting about a 40% gap after nine spins trains people to
    // ignore the column.
    const drift = game.observedRtp != null && game.rounds >= 2000 &&
      Math.abs(game.observedRtp - game.measuredRtp) > 0.05;

    const row = $(\`<tr class="\${game.enabled ? '' : 'off'}">
      <td>\${game.name}<div class="hint">\${game.id}</div></td>
      <td class="num">\${pct(game.measuredRtp)}</td>
      <td class="num \${drift ? 'drift' : ''}">\${pct(game.observedRtp)}</td>
      <td class="num">\${num(game.rounds)}</td>
      <td class="num">\${pct(game.hitRate)}</td>
      <td class="num"><input type="number" step="0.01" min="0" name="maxWinMultiplier" value="\${game.maxWinMultiplier ?? ''}" placeholder="none"></td>
      <td class="num"><input type="number" min="1" name="minBet" value="\${game.minBet}"></td>
      <td class="num"><input type="number" min="1" name="maxBet" value="\${game.maxBet}"></td>
      <td><input type="checkbox" name="enabled" \${game.enabled ? 'checked' : ''} style="width:auto"></td>
      <td><button class="ghost">Save</button></td>
    </tr>\`);

    row.querySelector('button').addEventListener('click', async (event) => {
      const button = event.target;
      button.disabled = true;
      const value = (name) => row.querySelector('[name=' + name + ']').value;
      const patch = {
        enabled: row.querySelector('[name=enabled]').checked,
        maxWinMultiplier: value('maxWinMultiplier') === '' ? null : Number(value('maxWinMultiplier')),
        minBet: Number(value('minBet')),
        maxBet: Number(value('maxBet')),
      };
      try {
        await api('/admin/games/' + encodeURIComponent(game.id), {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
        button.textContent = 'Saved';
        setTimeout(renderPanel, 600);
      } catch (error) {
        button.textContent = error.message;
        button.disabled = false;
      }
    });
    tbody.append(row);
  }
  main.append(table);

  const log = $(\`<section><h2>Audit log</h2><div class="wrap"><table>
    <thead><tr><th>When</th><th>Who</th><th>What</th><th>From</th><th>To</th></tr></thead>
    <tbody></tbody></table></div>
    <p class="hint">Written by a database trigger and append-only. A change made outside this
    panel still appears here, attributed to nobody.</p></section>\`);
  const logBody = log.querySelector('tbody');
  for (const entry of audit) {
    logBody.append($(\`<tr>
      <td>\${new Date(entry.at).toLocaleString()}</td>
      <td>\${entry.operator}</td>
      <td>\${entry.target}<div class="hint">\${entry.field}</div></td>
      <td>\${entry.old_value ?? '—'}</td>
      <td>\${entry.new_value ?? '—'}</td>
    </tr>\`));
  }
  if (!audit.length) logBody.append($('<tr><td colspan="5" class="hint">No changes yet.</td></tr>'));
  main.append(log);

  app.append(main);
  document.getElementById('out').addEventListener('click', async () => {
    try { await api('/admin/logout', { method: 'POST' }); } catch {}
    token = null;
    renderLogin();
  });
}

renderLogin();
</script>
</body>
</html>`;
