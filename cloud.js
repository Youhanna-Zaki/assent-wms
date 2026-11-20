// Cloud layer for the Assent Fasteners Store Visual WMS.
// - Sign-in (Supabase Auth, email + password)
// - A localStorage look-alike that also saves the four data collections to the cloud (table kv_store)
// - CloudDocs: original scanned PDFs in Supabase Storage (bucket "scans")
// - window.claude.use('sample'): AI page reading through the "scan" edge function
(function () {
  const KEYS = [
    'ASSENT_WMS_INVENTORY_DATA_V1',
    'ASSENT_WMS_TRANSACTIONS_V1',
    'ASSENT_WMS_RECEIPTS_V1',
    'ASSENT_WMS_DELIVERY_NOTES_V1'
  ];
  const cfg = window.WMS_CONFIG || {};
  const clientId = 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const state = { sb: null, user: null, versions: {}, pending: {}, timers: {}, inflight: {}, dirty: {}, blocked: false, saving: 0, lastSaved: null, error: null, remote: false };
  const listeners = [];
  const emit = () => listeners.forEach((f) => { try { f(state); } catch (e) {} });

  const configured = () => cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !/PASTE_YOUR/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY);

  function init() {
    state.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    return state.sb;
  }

  async function session() {
    const { data } = await state.sb.auth.getSession();
    state.user = data && data.session ? data.session.user : null;
    return data ? data.session : null;
  }
  async function signIn(email, password) {
    const { data, error } = await state.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    state.user = data.user;
    return data;
  }
  async function signOut() { try { await state.sb.auth.signOut(); } catch (e) {} location.reload(); }

  // Load the cloud copy of the four collections into the local cache that the app reads at start.
  async function hydrate() {
    const { data, error } = await state.sb.from('kv_store').select('key,value,version');
    if (error) throw error;
    const byKey = {};
    (data || []).forEach((r) => { byKey[r.key] = r; });
    KEYS.forEach((k) => {
      const r = byKey[k];
      if (r) state.versions[k] = r.version;
      try {
        if (r && r.value !== null && r.value !== undefined) window.localStorage.setItem(k, JSON.stringify(r.value));
        else window.localStorage.removeItem(k);
      } catch (e) {}
    });
  }

  function queue(k, v) {
    if (state.blocked) return;
    state.pending[k] = v;
    clearTimeout(state.timers[k]);
    state.timers[k] = setTimeout(() => flush(k), 700);
    emit();
  }

  async function flush(k) {
    if (state.blocked || !(k in state.pending)) return;
    if (state.inflight[k]) { state.dirty[k] = true; return; }
    const raw = state.pending[k];
    delete state.pending[k];
    let value = null;
    try { value = raw === null ? null : JSON.parse(raw); } catch (e) { return; }
    state.inflight[k] = true; state.saving++; state.error = null; emit();
    try {
      const base = state.versions[k];
      const now = new Date().toISOString();
      if (base === undefined) {
        const { error } = await state.sb.from('kv_store').insert({ key: k, value, version: 1, updated_by: clientId, updated_at: now });
        if (error) { if (error.code === '23505') return conflict(); throw error; }
        state.versions[k] = 1;
      } else {
        const { data, error } = await state.sb.from('kv_store')
          .update({ value, version: base + 1, updated_by: clientId, updated_at: now })
          .eq('key', k).eq('version', base).select('version');
        if (error) throw error;
        if (!data || !data.length) return conflict();
        state.versions[k] = base + 1;
      }
      state.lastSaved = new Date();
    } catch (e) {
      state.error = (e && e.message) || String(e);
      // retry later with the newest pending value (or this one if nothing newer arrived)
      if (!(k in state.pending)) state.pending[k] = raw;
      state.timers[k] = setTimeout(() => flush(k), 5000);
    } finally {
      state.inflight[k] = false; state.saving--; emit();
      if (state.dirty[k]) { state.dirty[k] = false; flush(k); }
    }
  }

  function conflict() {
    state.blocked = true; state.pending = {};
    emit();
  }

  function flushAll() { KEYS.forEach((k) => { clearTimeout(state.timers[k]); flush(k); }); }

  // localStorage look-alike handed to the app
  const storage = {
    getItem(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    setItem(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} if (KEYS.indexOf(k) >= 0) queue(k, v); },
    removeItem(k) { try { window.localStorage.removeItem(k); } catch (e) {} if (KEYS.indexOf(k) >= 0) queue(k, null); }
  };

  function watchRemote() {
    try {
      state.sb.channel('kv-watch')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'kv_store' }, (p) => {
          const row = p.new || {};
          if (row.updated_by && row.updated_by === clientId) return;
          state.remote = true; emit();
        })
        .subscribe();
    } catch (e) {}
  }

  // ---------- original documents ----------
  const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');
  const CloudDocs = {
    async put(id, files) {
      const base = safe(id);
      const manifest = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const path = base + '/' + i + '_' + safe(f.name || 'file');
        const blob = f.blob || f;
        const { error } = await state.sb.storage.from('scans').upload(path, blob, { upsert: true, contentType: f.type || blob.type || 'application/octet-stream' });
        if (error) throw error;
        manifest.push({ path, name: f.name || 'file', type: f.type || blob.type || '' });
      }
      const mb = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
      const { error } = await state.sb.storage.from('scans').upload(base + '/manifest.json', mb, { upsert: true, contentType: 'application/json' });
      if (error) throw error;
      return true;
    },
    async get(id) {
      const base = safe(id);
      const m = await state.sb.storage.from('scans').download(base + '/manifest.json');
      if (m.error || !m.data) return null;
      const manifest = JSON.parse(await m.data.text());
      const out = [];
      for (const e of manifest) {
        const d = await state.sb.storage.from('scans').download(e.path);
        if (d.error || !d.data) continue;
        const blob = new Blob([d.data], { type: e.type || d.data.type });
        out.push({ name: e.name, type: e.type, blob });
      }
      return out.length ? out : null;
    }
  };

  // ---------- AI reading (replaces the claude.ai hosted sampling) ----------
  const blobToB64 = (b) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); res({ media_type: (b && b.type) || 'image/jpeg', data: s.slice(s.indexOf(',') + 1) }); };
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
  const sample = {
    async limits() { return { images: { maxCount: 4 } }; },
    async json(prompt, opts) {
      const imgs = await Promise.all(((opts && opts.images) || []).map(blobToB64));
      const { data: s } = await state.sb.auth.getSession();
      const token = s && s.session ? s.session.access_token : null;
      if (!token) throw { code: 'session_expired' };
      let resp;
      try {
        resp = await fetch(cfg.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: cfg.SUPABASE_ANON_KEY },
          body: JSON.stringify({ prompt, images: imgs })
        });
      } catch (e) { throw { code: 'sampling_disabled', message: 'Scan function unreachable' }; }
      if (resp.status === 401) throw { code: 'session_expired' };
      if (resp.status === 429) throw { code: 'rate_limited' };
      if (resp.status === 404 || resp.status === 503) throw { code: 'sampling_disabled' };
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw { code: 'scan_error', message: body.error || resp.statusText };
      return body.result;
    }
  };
  window.claude = { use: async (name) => (name === 'sample' ? sample : null) };
  window.CloudDocs = CloudDocs;

  window.WMSCloud = { KEYS, state, configured, init, session, signIn, signOut, hydrate, storage, watchRemote, flushAll, onChange: (f) => listeners.push(f) };
})();
