/** Self-contained admin dashboard (login + transfers list + retry). */
export const ADMIN_UI_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>S3-SyncBridge Admin</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, sans-serif; margin: 0; padding: 1.5rem; max-width: 1100px; margin-inline: auto; }
    h1 { font-size: 1.3rem; }
    .row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
    input, button, select { padding: .5rem .6rem; font-size: .9rem; border-radius: 6px; border: 1px solid #8884; }
    button { cursor: pointer; background: #2563eb; color: #fff; border: none; }
    button.secondary { background: #6b7280; }
    button:disabled { opacity: .5; cursor: default; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: .85rem; }
    th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid #8883; white-space: nowrap; }
    td.wrap { white-space: normal; word-break: break-all; }
    .badge { padding: .1rem .4rem; border-radius: 999px; font-size: .75rem; font-weight: 600; }
    .SUCCESS { background: #16a34a22; color: #16a34a; }
    .FAILED { background: #dc262622; color: #dc2626; }
    .PENDING, .PROCESSING { background: #ca8a0422; color: #ca8a04; }
    #err { color: #dc2626; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <h1>S3-SyncBridge — Admin</h1>

  <section id="login">
    <div class="row">
      <input id="u" placeholder="username" autocomplete="username" />
      <input id="p" type="password" placeholder="password" autocomplete="current-password" />
      <button onclick="login()">Log in</button>
    </div>
    <p id="err"></p>
  </section>

  <section id="app" class="hidden">
    <div class="row">
      <select id="status">
        <option value="">all</option>
        <option>PENDING</option><option>PROCESSING</option>
        <option selected>SUCCESS</option><option>FAILED</option>
      </select>
      <button onclick="load()">Refresh</button>
      <button class="secondary" onclick="retryBatch()">Retry all FAILED</button>
      <span id="who" style="margin-left:auto;font-size:.8rem;opacity:.7"></span>
      <button class="secondary" onclick="logout()">Log out</button>
    </div>
    <table>
      <thead><tr><th>filename</th><th>status</th><th>attempts</th><th>bucket/key</th><th>updated</th><th></th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </section>

  <script>
    const $ = (id) => document.getElementById(id);
    let token = localStorage.getItem('sb_token') || '';
    let roles = JSON.parse(localStorage.getItem('sb_roles') || '[]');

    function show() {
      const authed = !!token;
      $('login').classList.toggle('hidden', authed);
      $('app').classList.toggle('hidden', !authed);
      if (authed) { $('who').textContent = 'roles: ' + roles.join(', '); load(); }
    }
    async function api(path, opts = {}) {
      const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers||{}) } });
      if (res.status === 401) { logout(); throw new Error('unauthorized'); }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.status === 204 ? null : res.json();
    }
    async function login() {
      $('err').textContent = '';
      try {
        const res = await fetch('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('u').value, password: $('p').value }) });
        if (!res.ok) throw new Error('invalid credentials');
        const data = await res.json();
        token = data.access_token; roles = data.roles || [];
        localStorage.setItem('sb_token', token); localStorage.setItem('sb_roles', JSON.stringify(roles));
        show();
      } catch (e) { $('err').textContent = e.message; }
    }
    function logout() { token=''; roles=[]; localStorage.removeItem('sb_token'); localStorage.removeItem('sb_roles'); show(); }
    const canRetry = () => roles.includes('admin') || roles.includes('operator');
    async function load() {
      const status = $('status').value;
      const data = await api('/v1/transfers?limit=50' + (status ? '&status=' + status : ''));
      $('rows').innerHTML = data.items.map((t) => \`
        <tr>
          <td class="wrap">\${t.filename}</td>
          <td><span class="badge \${t.status}">\${t.status}</span></td>
          <td>\${t.attempts}</td>
          <td class="wrap">\${t.bucket}/\${t.objectKey ?? ''}</td>
          <td>\${new Date(t.updatedAt).toLocaleString()}</td>
          <td>\${t.status === 'SUCCESS' ? \`<button class="secondary" onclick="dl('\${t.id}','\${t.filename}')">Download</button> \` : ''}\${t.status === 'FAILED' && canRetry() ? \`<button onclick="retryOne('\${t.id}')">Retry</button>\` : ''}</td>
        </tr>\`).join('') || '<tr><td colspan="6">no transfers</td></tr>';
    }
    async function retryOne(id) { await api('/v1/transfers/' + id + '/retry', { method: 'POST' }); load(); }
    async function dl(id, filename) {
      const res = await fetch('/v1/transfers/' + id + '/download', { headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) return alert('download failed: ' + res.status);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename; a.click();
      URL.revokeObjectURL(a.href);
    }
    async function retryBatch() {
      if (!canRetry()) return alert('requires operator/admin role');
      const r = await api('/v1/transfers/retry-batch', { method: 'POST', body: JSON.stringify({ status: 'FAILED' }) });
      alert('re-queued ' + r.requeued + ' transfer(s)'); load();
    }
    show();
  </script>
</body>
</html>`;
