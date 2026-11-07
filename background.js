const DASHBOARD_URL = 'https://rewards.bing.com/';
const EARN_URL = 'https://rewards.bing.com/earn';
const HOME_URL = 'https://www.bing.com/';
const POINTS_PER_SEARCH = 3;
const RESULT_HOLD_MIN = 3000;
const RESULT_HOLD_MAX = 3800;
const PAGE_TIMEOUT = 20000;
const READ_DEADLINE = 25000;
const DIRECT_TIMEOUT = 12000;
const SETTLE_MS = 1500;
const LOGIN_GRACE_MS = 15000;
const ABOUT_GRACE_MS = 4000;
const MAX_FAILURES = 3;
const ACTIVE_PHASES = ['fetchingStartPoints', 'checkingLimit', 'searching', 'fetchingEndPoints'];
const COOLDOWN_STALL = 3;
const MAX_COOLDOWNS = 6;

let flowToken = 0;
let flowActive = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => min + Math.random() * (max - min);
const store = obj => chrome.storage.local.set(obj);
const load = keys => chrome.storage.local.get(keys);
const isCurrent = token => token === flowToken;

function parseUrl(url) {
  try { return new URL(url); } catch { return null; }
}
const onBing = u => !!u && /(^|\.)bing\.com$/.test(u.hostname);
const isBingHome = url => { const u = parseUrl(url); return onBing(u) && u.pathname === '/'; };
const isBingSearch = url => { const u = parseUrl(url); return onBing(u) && u.pathname.startsWith('/search'); };
const isRewards = url => { const u = parseUrl(url); return !!u && u.hostname === 'rewards.bing.com'; };
const isLogin = url => { const u = parseUrl(url); return !!u && /(^|\.)(login\.live\.com|login\.microsoftonline\.com)$/.test(u.hostname); };

const TREND_GEOS = ['US', 'GB', 'CA', 'AU', 'IN'];
const TOPIC_TIMEOUT = 8000;
const SUGGEST_CONCURRENCY = 6;
const BLOCKED_QUERY = /\b(log ?in|sign ?in|password|porn|xxx|nude|sex)\b/i;

const pickOne = arr => arr[Math.floor(Math.random() * arr.length)];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function decodeXml(s) {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

const FILLER = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'as',
  'is', 'are', 'was', 'were', 'be', 'vs', 'after', 'over', 'into', 'its', 'his', 'her', 'their',
  'but', 'that', 'this', 'will', 'has', 'have', 'why', 'how', 'what', 'who', '&'
]);
const isFiller = w => FILLER.has(w.toLowerCase().replace(/[^\p{L}\p{N}&]/gu, ''));

function cleanQuery(q) {
  const s = String(q || '')
    .replace(/['’]s\b/gi, '')
    .replace(/(\p{L})['’](\p{L})/gu, '$1$2')
    .replace(/[“”"‘’'`()[\]{}:;!?…|,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (s.length < 3 || s.length > 70) return null;
  if (!/^[\p{Script=Latin}\p{N}\s&.,+#/-]+$/u.test(s)) return null;
  if (BLOCKED_QUERY.test(s) || /^\S+\.(com|net|org|io|co|gov|edu)(\/\S*)?$/.test(s)) return null;
  return s;
}

function headlineToQuery(headline) {
  const main = headline.split(/\s+[-–—|]\s+/)[0];
  let words = main.split(/\s+/).filter(Boolean);
  if (words.length > 7) words = words.slice(0, 3 + Math.floor(Math.random() * 4));
  while (words.length && isFiller(words[words.length - 1])) words.pop();
  while (words.length && isFiller(words[0])) words.shift();
  return words.filter(w => !isFiller(w)).length >= 2 ? words.join(' ') : '';
}

function randomPrefix() {
  const consonants = 'bcdfghjklmnprstvw';
  const vowels = 'aeiou';
  let p = pickOne(consonants) + pickOne(vowels);
  if (Math.random() < 0.6) p += pickOne(consonants + vowels);
  return p;
}

async function fetchTextAnon(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TOPIC_TIMEOUT);
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: ctrl.signal });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTrends() {
  const feeds = await Promise.all(
    TREND_GEOS.map(geo => fetchTextAnon(`https://trends.google.com/trending/rss?geo=${geo}`))
  );
  const terms = [];
  const headlines = [];
  for (const xml of feeds) {
    if (!xml) continue;
    for (const m of xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)) terms.push(decodeXml(m[1]));
    for (const m of xml.matchAll(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/g)) headlines.push(decodeXml(m[1]));
  }
  return { terms, headlines };
}

async function fetchSuggestions(seed) {
  const text = await fetchTextAnon(`https://www.bing.com/osjson.aspx?query=${encodeURIComponent(seed)}`);
  try {
    const data = JSON.parse(text);
    return Array.isArray(data[1]) ? data[1].filter(s => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

async function suggestionsFor(seeds) {
  const out = [];
  for (let i = 0; i < seeds.length; i += SUGGEST_CONCURRENCY) {
    const batch = await Promise.all(seeds.slice(i, i + SUGGEST_CONCURRENCY).map(fetchSuggestions));
    for (const list of batch) out.push(...list);
  }
  return out;
}

async function buildQueries(count, usedList) {
  const used = new Set(usedList || []);
  const seen = new Set();
  const queries = [];
  const add = raw => {
    const q = cleanQuery(raw);
    if (!q || seen.has(q) || used.has(q)) return;
    seen.add(q);
    queries.push(q);
  };

  const { terms, headlines } = await fetchTrends();
  const trendSeeds = shuffle(terms).slice(0, 8);
  const prefixSeeds = Array.from({ length: Math.ceil(count / 5) + 4 }, randomPrefix);
  const suggestions = await suggestionsFor([...trendSeeds, ...prefixSeeds]);

  const pools = [
    { items: shuffle(terms), weight: 0.3 },
    { items: shuffle(headlines.map(headlineToQuery)), weight: 0.2 },
    { items: shuffle(suggestions), weight: 0.5 }
  ];
  while (queries.length < count && pools.some(p => p.items.length)) {
    const live = pools.filter(p => p.items.length);
    let r = Math.random() * live.reduce((s, p) => s + p.weight, 0);
    const pool = live.find(p => (r -= p.weight) <= 0) || live[live.length - 1];
    add(pool.items.shift());
  }

  for (let round = 0; queries.length < count && round < 3; round++) {
    const more = await suggestionsFor(Array.from({ length: Math.ceil((count - queries.length) / 4) + 3 }, randomPrefix));
    shuffle(more).forEach(add);
  }

  const result = queries.slice(0, count);
  return {
    queries: result,
    usedWords: [...used, ...result].slice(-1000),
    trendCount: terms.length
  };
}

function directSearchUrl(query) {
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}&form=QBLH`;
}

function waitForTab(tabId, test, timeout, checkNow) {
  return new Promise(resolve => {
    let done = false;
    const finish = tab => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      resolve(tab);
    };
    const onUpdated = (id, info, tab) => {
      if (id === tabId && tab.status === 'complete' && test(tab.url)) finish(tab);
    };
    const onRemoved = id => { if (id === tabId) finish(null); };
    const timer = setTimeout(() => {
      chrome.tabs.get(tabId).then(finish, () => finish(null));
    }, timeout);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    if (checkNow) {
      chrome.tabs.get(tabId).then(
        tab => { if (tab.status === 'complete' && test(tab.url)) finish(tab); },
        () => finish(null)
      );
    }
  });
}

async function getTab(key) {
  const data = await load([key]);
  if (data[key] == null) return null;
  try { return await chrome.tabs.get(data[key]); } catch { return null; }
}

async function goto(key, url, test) {
  const existing = await getTab(key);
  if (!existing) {
    const tab = await chrome.tabs.create({ url, active: false });
    await store({ [key]: tab.id });
    try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch {}
    return waitForTab(tab.id, test, PAGE_TIMEOUT, true);
  }
  const loaded = waitForTab(existing.id, test, PAGE_TIMEOUT, false);
  await chrome.tabs.update(existing.id, { url });
  return loaded;
}

async function closeTab(key) {
  const data = await load([key]);
  if (data[key] != null) {
    try { await chrome.tabs.remove(data[key]); } catch {}
  }
  await store({ [key]: null });
}

let lastInjectError = null;

async function inject(tabId, func, args) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args: args || [] });
    lastInjectError = null;
    return res ? res.result : null;
  } catch (err) {
    lastInjectError = err && err.message ? err.message : String(err);
    return null;
  }
}

async function readAvailablePoints() {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const num = s => {
    const n = parseInt(String(s).replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };
  const findKey = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 6) return null;
    if (typeof o.availablePoints === 'number') return o.availablePoints;
    for (const v of Object.values(o)) {
      const r = findKey(v, depth + 1);
      if (r !== null) return r;
    }
    return null;
  };
  const fromApi = async () => {
    try {
      const res = await fetch('/api/getuserinfo?type=1', { credentials: 'include', cache: 'no-store', redirect: 'error' });
      if (!res.ok) return null;
      return findKey(await res.json(), 0);
    } catch {
      return null;
    }
  };
  const isNumber = t => /^\d[\d,.\s  ]{0,12}$/.test(t);
  const fromCard = () => {
    const scopes = [];
    const icon = document.querySelector('img[alt="Available points" i]');
    if (icon && icon.parentElement) scopes.push(icon.parentElement);
    for (const el of document.querySelectorAll('p, span, h2, h3, div')) {
      if (el.children.length === 0 && /^\s*available points\s*$/i.test(el.textContent)) {
        const card = el.parentElement && el.parentElement.parentElement;
        if (card) scopes.push(card);
      }
    }
    for (const scope of scopes) {
      const big = scope.querySelector('.text-pageHeader');
      if (big && isNumber(big.textContent.trim())) return num(big.textContent);
      for (const leaf of scope.querySelectorAll('p, span, div')) {
        const t = leaf.textContent.trim();
        if (leaf.children.length === 0 && isNumber(t)) return num(t);
      }
    }
    return null;
  };
  const fromData = () => {
    const html = document.documentElement.innerHTML;
    for (const re of [/\\?"availablePoints\\?"\s*:\s*(\d+)/, /\\?"balance\\?"\s*:\s*(\d+)/]) {
      const m = html.match(re);
      if (m) return num(m[1]);
    }
    return null;
  };
  const fromText = () => {
    const body = document.body;
    if (!body) return null;
    for (const t of [body.innerText, body.textContent]) {
      const m = (t || '').match(/Available points?[^\dA-Za-z]{0,24}(\d[\d,.  ]*)/i);
      if (m) return num(m[1]);
    }
    for (const sel of ['.mee-rewards-user-status-balance', '#balanceToolTipDiv .pointsValue', '.pointsValue']) {
      for (const el of document.querySelectorAll(sel)) {
        const t = el.textContent.trim();
        if (/^[\d,.\s]{1,9}$/.test(t)) return num(t);
      }
    }
    return null;
  };

  let sawZero = false;
  for (let i = 0; i < 12; i++) {
    if (i % 4 === 0) {
      const api = await fromApi();
      if (api !== null && api > 0) return { ok: true, points: api };
    }
    for (const v of [fromCard(), fromData(), fromText()]) {
      if (v !== null && v > 0) return { ok: true, points: v };
      if (v === 0) sawZero = true;
    }
    await wait(1000);
  }
  if (sawZero) return { ok: true, points: 0 };
  const text = document.body ? document.body.innerText : '';
  const html = document.documentElement.innerHTML;
  const at = text.search(/points/i);
  return {
    ok: false,
    signedOut: /\bsign in\b/i.test(text) && !/available points/i.test(text),
    diag: {
      page: location.pathname,
      title: document.title,
      visible: document.visibilityState,
      keys: (html.match(/\\?"(availablePoints|balance|points|pointsBalance|userStatus)\\?"\s*:\s*[^,}\]]{0,20}/g) || []).slice(0, 6),
      text: text.slice(Math.max(0, at - 120), at + 180).replace(/\s+/g, ' ')
    }
  };
}

async function readSearchBreakdown() {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const num = s => parseInt(String(s).replace(/\D/g, ''), 10);
  const pick = (a, b) => {
    const progress = num(a);
    const max = num(b);
    return Number.isFinite(progress) && Number.isFinite(max) && max > 0 ? { progress, max } : null;
  };
  const fromText = () => {
    const body = document.body;
    if (!body) return null;
    for (const t of [body.innerText, body.textContent]) {
      const m = (t || '').match(/(?:Bing|PC)\s+search[^\dA-Za-z]{0,12}(\d[\d,.]*)\s*\/\s*(\d[\d,.]*)/i);
      if (m) {
        const r = pick(m[1], m[2]);
        if (r) return r;
      }
    }
    return null;
  };
  const fromModel = () => {
    const clean = document.documentElement.innerHTML.replace(/\\\\"/g, '"').replace(/\\"/g, '"');
    const block = clean.match(/"pointsCounters"\s*:\s*\{[\s\S]{0,600}?"(?:pc|pcSearch|combined|combinedSearch|search)"\s*:\s*\{([^{}]*)\}/);
    if (!block) return null;
    const max = block[1].match(/"max"\s*:\s*(\d+)/);
    const progress = block[1].match(/"progress"\s*:\s*(\d+)/);
    return max && progress ? pick(progress[1], max[1]) : null;
  };
  const fromRow = () => {
    for (const el of document.querySelectorAll('p, span, div, td, th')) {
      if (el.children.length > 0 || !/^\s*(bing|pc) search\s*$/i.test(el.textContent)) continue;
      const cell = el.parentElement && el.parentElement.children.length === 1 && el.parentElement.tagName !== 'TR'
        ? el.parentElement
        : el;
      let sib = cell.nextElementSibling;
      for (let n = 0; sib && n < 2; n++, sib = sib.nextElementSibling) {
        const m = sib.textContent.match(/(\d[\d,.]*)\s*\/\s*(\d[\d,.]*)/);
        if (m) {
          const r = pick(m[1], m[2]);
          if (r) return r;
        }
      }
    }
    return null;
  };
  const fromData = () => {
    const seg = document.documentElement.innerHTML.match(/\\?"pcSearch\\?"\s*:\s*\[[\s\S]{0,800}?\]/);
    if (!seg) return null;
    const p = seg[0].match(/\\?"pointProgress\\?"\s*:\s*(\d+)/);
    const m = seg[0].match(/\\?"pointProgressMax\\?"\s*:\s*(\d+)/);
    return p && m ? pick(p[1], m[1]) : null;
  };
  const fromApi = async () => {
    try {
      const res = await fetch('/api/getuserinfo?type=1', { credentials: 'include', cache: 'no-store', redirect: 'error' });
      if (!res.ok) return null;
      const data = await res.json();
      const list = data && data.dashboard && data.dashboard.userStatus &&
        data.dashboard.userStatus.counters && data.dashboard.userStatus.counters.pcSearch;
      if (!Array.isArray(list) || !list.length) return null;
      const progress = list.reduce((s, c) => s + (c.pointProgress || 0), 0);
      const max = list.reduce((s, c) => s + (c.pointProgressMax || 0), 0);
      return max > 0 ? { progress, max } : null;
    } catch {
      return null;
    }
  };
  const findTrigger = () => {
    const clickable = document.querySelectorAll('a, button, [role="button"], [role="link"]');
    for (const el of clickable) {
      if (/points breakdown/i.test((el.innerText || el.textContent || '').trim())) return el;
    }
    for (const el of document.querySelectorAll('span, div, p')) {
      if (/^\s*points breakdown\s*$/i.test(el.textContent || '')) {
        return el.closest('a, button, [role="button"], [role="link"]') || el;
      }
    }
    for (const el of clickable) {
      const t = (el.innerText || '').trim();
      if (/today['’]s points/i.test(t) && t.length < 120) return el;
    }
    return null;
  };
  const press = el => {
    const rect = el.getBoundingClientRect();
    const base = {
      bubbles: true, cancelable: true, composed: true, view: window, button: 0,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
    };
    const ptr = Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 }, base);
    el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ buttons: 1, pressure: 0.5 }, ptr)));
    el.dispatchEvent(new MouseEvent('mousedown', Object.assign({ buttons: 1, detail: 1 }, base)));
    el.dispatchEvent(new PointerEvent('pointerup', Object.assign({ buttons: 0, pressure: 0 }, ptr)));
    el.dispatchEvent(new MouseEvent('mouseup', Object.assign({ buttons: 0, detail: 1 }, base)));
    el.dispatchEvent(new MouseEvent('click', Object.assign({ buttons: 0, detail: 1 }, base)));
  };
  const isOpen = el =>
    !!document.querySelector('[role="dialog"], [aria-modal="true"]') ||
    (el && el.getAttribute('aria-expanded') === 'true');
  const activate = (el, mode) => {
    if (mode === 0) {
      press(el);
    } else if (mode === 1) {
      try { el.focus({ preventScroll: true }); } catch {}
      for (const type of ['keydown', 'keyup']) {
        el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      }
    } else {
      el.click();
    }
  };
  let clicked = false;
  let attempts = 0;
  let lastAttempt = -10;
  for (let i = 0; i < 20; i++) {
    const r = fromModel() || fromRow() || fromText() || fromData();
    if (r) return { ok: true, search: r };
    if (document.readyState !== 'loading' && attempts < 6 && i - lastAttempt >= 3) {
      const el = findTrigger();
      if (el && !isOpen(el)) {
        const laidOut = el.getBoundingClientRect().width > 0;
        if (laidOut || i >= 8) {
          activate(el, laidOut ? attempts % 3 : 1);
          clicked = true;
          attempts++;
          lastAttempt = i;
        }
      }
    }
    if (i === 12) {
      const api = await fromApi();
      if (api) return { ok: true, search: api };
    }
    await wait(1000);
  }
  const text = document.body ? document.body.innerText : '';
  const at = text.search(/today['’]s activity|bing search/i);
  return {
    ok: false,
    diag: {
      page: location.pathname,
      title: document.title,
      clicked,
      text: (at >= 0 ? text.slice(at, at + 220) : text.slice(0, 220)).replace(/\s+/g, ' ')
    }
  };
}

function typeAndSubmit(query) {
  const box = ['#sb_form_q', 'textarea[name="q"]', 'input[name="q"]']
    .map(sel => document.querySelector(sel))
    .find(el => el && !el.disabled && !el.readOnly);
  if (!box) return { ok: false };
  box.focus();
  box.value = '';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  for (const ch of query) {
    let inserted = false;
    try { inserted = document.execCommand('insertText', false, ch); } catch {}
    if (!inserted) {
      box.value += ch;
      box.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
    }
  }
  if (box.value !== query) {
    box.value = query;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const form = box.form || box.closest('form');
  setTimeout(() => {
    if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
    else if (form) form.submit();
    else location.href = '/search?q=' + encodeURIComponent(query) + '&form=QBLH';
  }, 200);
  return { ok: true };
}

const pathStarts = (url, prefix) => {
  const u = parseUrl(url);
  return !!u && u.pathname.toLowerCase().startsWith(prefix);
};

async function openOrNavigate(key, url) {
  const existing = await getTab(key);
  if (existing) {
    await chrome.tabs.update(existing.id, { url });
    return existing.id;
  }
  const tab = await chrome.tabs.create({ url, active: false });
  await store({ [key]: tab.id });
  try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch {}
  return tab.id;
}

async function waitForSettled(tabId, deadline) {
  let lastUrl = null;
  let stableSince = 0;
  while (Date.now() < deadline) {
    let tab;
    try { tab = await chrome.tabs.get(tabId); } catch { return null; }
    if (tab.status === 'complete' && tab.url) {
      if (tab.url !== lastUrl) {
        lastUrl = tab.url;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= SETTLE_MS) {
        return tab;
      }
    } else {
      lastUrl = null;
    }
    await sleep(400);
  }
  try { return await chrome.tabs.get(tabId); } catch { return null; }
}

async function readRewardsPage(url, onTarget, reader, token) {
  const deadline = Date.now() + READ_DEADLINE;
  const tabId = await openOrNavigate('rewardsTabId', url);
  let loginSince = 0;
  let aboutSince = 0;
  let renavs = 0;
  let last = null;
  await sleep(800);

  while (Date.now() < deadline && isCurrent(token)) {
    const tab = await waitForSettled(tabId, deadline);
    if (!tab) break;

    if (isLogin(tab.url)) {
      loginSince = loginSince || Date.now();
      if (Date.now() - loginSince > LOGIN_GRACE_MS) return { ok: false, signedOut: true };
      await sleep(1000);
      continue;
    }
    loginSince = 0;

    if (isRewards(tab.url) && pathStarts(tab.url, '/about')) {
      aboutSince = aboutSince || Date.now();
      if (Date.now() - aboutSince > ABOUT_GRACE_MS) return { ok: false, signedOut: true };
      await sleep(1000);
      continue;
    }
    aboutSince = 0;

    if (!isRewards(tab.url) || !onTarget(tab.url)) {
      if (renavs >= 2) break;
      renavs++;
      await chrome.tabs.update(tabId, { url });
      await sleep(800);
      continue;
    }

    last = await inject(tabId, reader);
    if (last && (last.ok || last.signedOut)) return last;
    await sleep(1000);
  }
  let finalUrl = null;
  try { finalUrl = (await chrome.tabs.get(tabId)).url; } catch {}
  const result = last || { ok: false };
  if (!result.ok) {
    result.diag = Object.assign(
      { target: url, tabUrl: finalUrl, injectError: lastInjectError },
      result.diag || { note: 'page never became readable' }
    );
    console.warn('[Rewards Automator] Could not read', result.diag);
  }
  return result;
}

const decodePayload = html => html.replace(/\\\\"/g, '"').replace(/\\"/g, '"');

function parseBalance(html) {
  const clean = decodePayload(html);
  let m = clean.match(/"(?:availablePoints|balance)"\s*:\s*(\d+)/);
  if (m) return parseInt(m[1], 10);
  m = html.match(/Available points<\/p>[\s\S]{0,600}?text-pageHeader[^>]*>\s*([\d,.  ]+)\s*</i);
  if (m) {
    const n = parseInt(m[1].replace(/\D/g, ''), 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseSearchCounter(html) {
  const clean = decodePayload(html);
  const block = clean.match(/"pointsCounters"\s*:\s*\{[\s\S]{0,600}?"(?:pc|pcSearch|combined|combinedSearch|search)"\s*:\s*\{([^{}]*)\}/);
  if (!block) return null;
  const max = block[1].match(/"max"\s*:\s*(\d+)/);
  const progress = block[1].match(/"progress"\s*:\s*(\d+)/);
  if (!max || !progress) return null;
  const result = { progress: parseInt(progress[1], 10), max: parseInt(max[1], 10) };
  return result.max > 0 ? result : null;
}

async function fetchRewardsPage(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DIRECT_TIMEOUT);
  try {
    const res = await fetch('https://rewards.bing.com' + path, {
      credentials: 'include',
      cache: 'no-store',
      signal: ctrl.signal
    });
    const html = await res.text();
    return { ok: res.ok, status: res.status, url: res.url, html };
  } catch (err) {
    return { ok: false, status: 0, url: null, html: '', error: err.name === 'AbortError' ? 'timed out' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

const fetchInfo = r => ({ status: r.status, url: r.url, error: r.error || null, bytes: r.html.length });

async function directPoints() {
  const r = await fetchRewardsPage('/dashboard');
  return { points: r.ok ? parseBalance(r.html) : null, info: fetchInfo(r) };
}

async function directToday() {
  const r = await fetchRewardsPage('/earn');
  return {
    today: r.ok ? parseSearchCounter(r.html) : null,
    activities: r.ok ? todayActivitiesFrom(r.html) : null,
    info: fetchInfo(r)
  };
}

function todayActivitiesFrom(html) {
  const list = parseActivities(html)
    .filter(a => a.enabled && a.id !== 'bing')
    .map(({ id, name, done, total, unit }) => ({ id, name, done, total, unit }));
  const keep = keepEarningSummary(parseKeepEarning(html));
  if (keep) list.push(keep);
  return list;
}

function parseKeepEarning(html) {
  const clean = decodePayload(html);
  const at = clean.indexOf('"activityCards"');
  if (at < 0) return null;
  const open = clean.indexOf('[', at);
  if (open < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = open; i < clean.length && i < open + 60000; i++) {
    if (clean[i] === '[') depth++;
    else if (clean[i] === ']' && --depth === 0) { end = i; break; }
  }
  if (end < 0) return null;
  const objs = [];
  let level = 0;
  let from = -1;
  for (let i = open + 1; i < end; i++) {
    const ch = clean[i];
    if (ch === '{') { if (level++ === 0) from = i; }
    else if (ch === '}' && level > 0 && --level === 0) objs.push(clean.slice(from, i + 1));
  }
  return objs.map(obj => {
    const str = re => { const m = obj.match(re); return m ? m[1] : null; };
    return {
      title: (str(/"title"\s*:\s*"([^"]*)"/) || 'Activity').replace(/\s+/g, ' ').trim(),
      points: Number(str(/"points"\s*:\s*(\d+)/)) || 0,
      done: /"isCompleted"\s*:\s*true/.test(obj),
      locked: /"isLocked"\s*:\s*true/.test(obj)
    };
  }).filter(c => !c.locked);
}

function keepEarningSummary(cards) {
  if (!cards || !cards.length) return null;
  const total = cards.reduce((s, c) => s + c.points, 0);
  const done = cards.filter(c => c.done).reduce((s, c) => s + c.points, 0);
  const left = cards.filter(c => !c.done).map(c => ({ title: c.title, points: c.points }));
  if (!total) {
    return { id: 'keepearning', name: 'Keep earning', done: cards.length - left.length, total: cards.length, unit: '', left };
  }
  return { id: 'keepearning', name: 'Keep earning', done, total, unit: 'pts', left };
}

const DEFAULT_SETTINGS = {
  defaultCount: 30,
  pace: 'normal',
  autoStop: true,
  reminderPerDay: 3,
  reminderGapHours: 2,
  reminderFrom: '08:00',
  reminderTo: '23:00',
  reminderSeconds: 5,
  reduceMotion: false,
  cooldownAware: true,
  cooldownMinutes: 15
};

async function getSettings() {
  const { settings } = await load(['settings']);
  return Object.assign({}, DEFAULT_SETTINGS, settings || {});
}

function holdRange(settings) {
  return settings.pace === 'relaxed' ? [5000, 7500] : [RESULT_HOLD_MIN, RESULT_HOLD_MAX];
}

function describeFailure(diag) {
  if (!diag) return '';
  if (diag.injectError) return ' Edge blocked page access: ' + diag.injectError;
  if (diag.direct && diag.direct.error) return ' Network: ' + diag.direct.error;
  if (diag.tabUrl) return ' Last page: ' + diag.tabUrl.replace(/^https?:\/\//, '');
  return '';
}

async function readPointsFromDashboard(token) {
  const direct = await directPoints();
  if (direct.points !== null) return { points: direct.points, signedOut: false, diag: null };
  if (!isCurrent(token)) return { points: null, signedOut: false, diag: null };
  const r = await readRewardsPage(DASHBOARD_URL, url => !pathStarts(url, '/earn'), readAvailablePoints, token);
  return {
    points: r.ok ? r.points : null,
    signedOut: !!r.signedOut,
    diag: r.ok ? null : Object.assign({ direct: direct.info }, r.diag)
  };
}

async function readTodaySearch(token) {
  const direct = await directToday();
  if (direct.activities) await store({ todayActivities: direct.activities, todayCheckedAt: Date.now() });
  if (direct.today) return { today: direct.today, live: true };
  if (!isCurrent(token)) return { today: null, live: false };
  const r = await readRewardsPage(EARN_URL, url => pathStarts(url, '/earn'), readSearchBreakdown, token);
  if (!r.ok && r.diag) await store({ diagLimit: Object.assign({ direct: direct.info }, r.diag) });
  return { today: r.ok ? r.search : null, live: false };
}

async function refreshToday() {
  const { running } = await load(['running']);
  if (running) return;
  const { today, activities } = await directToday();
  const update = { todayCheckedAt: Date.now() };
  if (today) update.todaySearch = today;
  if (activities) update.todayActivities = activities;
  await store(update);
}

async function runFlow(token) {
  flowActive = true;
  try {
    let { phase } = await load(['phase']);

    if (phase === 'fetchingStartPoints') {
      const res = await readPointsFromDashboard(token);
      if (!isCurrent(token)) return;
      if (res.signedOut) {
        await closeTab('rewardsTabId');
        await finishWithError('Sign in to Microsoft Rewards (rewards.bing.com) in this browser, then press Start again.');
        return;
      }
      const known = res.points !== null;
      await store({
        startPoints: known ? res.points : 0,
        startKnown: known,
        warning: known ? null : 'Could not read your starting points.' + describeFailure(res.diag),
        diag: known ? null : res.diag,
        phase: 'checkingLimit'
      });
    }

    ({ phase } = await load(['phase']));
    if (phase === 'checkingLimit') {
      const { today, live } = await readTodaySearch(token);
      await closeTab('rewardsTabId');
      if (!isCurrent(token)) return;
      const maxed = !!(today && today.progress >= today.max);
      await store({ todaySearch: today, todayStart: today, liveCheck: live, searchMaxedAtStart: maxed });
      if (maxed) {
        await finishLimitReached();
        return;
      } else {
        await store({ phase: 'searching' });
      }
    }

    ({ phase } = await load(['phase']));
    if (phase === 'searching') {
      await ensureQueue(token);
      if (!isCurrent(token)) return;
      await searchLoop(token);
      if (!isCurrent(token)) return;
      if ((await load(['phase'])).phase === 'cooldown') return;
      await store({ phase: 'fetchingEndPoints' });
    }

    ({ phase } = await load(['phase']));
    if (phase === 'fetchingEndPoints') {
      await finishRun(token);
    }
  } catch (err) {
    if (!isCurrent(token)) return;
    await closeTab('searchTabId');
    await closeTab('rewardsTabId');
    await finishWithError('Run stopped: ' + err.message);
  } finally {
    if (isCurrent(token)) flowActive = false;
  }
}

async function finishLimitReached() {
  const { startPoints, todaySearch } = await load(['startPoints', 'todaySearch']);
  await closeTab('searchTabId');
  await store({
    todayStart: todaySearch,
    endPoints: startPoints,
    finalEarned: 0,
    earnedIsEstimate: false,
    currentQuery: null,
    phase: 'limitReached',
    running: false
  });
  chrome.alarms.clear('watchdog');
}

async function enterCooldown(settings) {
  const { cooldownCycles } = await load(['cooldownCycles']);
  const cycles = (cooldownCycles || 0) + 1;
  if (cycles > MAX_COOLDOWNS) {
    await store({ cooldownGaveUp: true });
    return false;
  }
  const waitMs = Math.max(5, Number(settings.cooldownMinutes) || 15) * 60 * 1000;
  const until = Date.now() + waitMs;
  await store({ phase: 'cooldown', cooldownUntil: until, cooldownWaitMs: waitMs, cooldownCycles: cycles, currentQuery: null });
  chrome.alarms.create('cooldownEnd', { when: until });
  return true;
}

async function endCooldown() {
  const st = await load(['running', 'phase']);
  if (!st.running || st.phase !== 'cooldown') return;
  chrome.alarms.clear('cooldownEnd');
  await store({ phase: 'searching', cooldownUntil: null });
  chrome.alarms.create('watchdog', { periodInMinutes: 0.5 });
  if (!flowActive) runFlow(++flowToken);
}

async function searchLoop(token) {
  let failures = 0;
  let stalled = 0;
  let lastProgress = null;
  {
    const { todaySearch } = await load(['todaySearch']);
    if (todaySearch && typeof todaySearch.progress === 'number') lastProgress = todaySearch.progress;
  }
  while (isCurrent(token)) {
    const st = await load(['currentSearch', 'totalSearch', 'searchQueue', 'stopRequested']);
    const current = st.currentSearch || 0;
    if (st.stopRequested || current >= st.totalSearch) return;

    const query = st.searchQueue && st.searchQueue[current];
    if (!query) return;
    await store({ currentQuery: query });

    const home = await goto('searchTabId', HOME_URL, isBingHome);
    if (!isCurrent(token)) return;
    if ((await load(['stopRequested'])).stopRequested) return;

    let searched = false;

    if (home && isBingHome(home.url)) {
      const typed = await inject(home.id, typeAndSubmit, [query]);
      if (typed && typed.ok) {
        const result = await waitForTab(home.id, isBingSearch, PAGE_TIMEOUT, true);
        searched = !!result && isBingSearch(result.url);
      }
    }
    if (!isCurrent(token)) return;

    if (!searched) {
      const result = await goto('searchTabId', directSearchUrl(query), isBingSearch);
      searched = !!result && isBingSearch(result.url);
    }
    if (!isCurrent(token)) return;

    if (!searched) {
      failures++;
      if (failures >= MAX_FAILURES) throw new Error('Bing is not responding. Check your connection.');
      continue;
    }

    failures = 0;
    await store({ currentSearch: current + 1, lastActivity: Date.now() });
    const settings = await getSettings();
    const [holdMin, holdMax] = holdRange(settings);
    await sleep(rand(holdMin, holdMax));
    if (!isCurrent(token)) return;

    if ((await load(['liveCheck'])).liveCheck) {
      const { today, activities } = await directToday();
      if (!isCurrent(token)) return;
      if (activities) await store({ todayActivities: activities });
      if (today) {
        await store({ todaySearch: today });
        if (today.progress >= today.max && settings.autoStop) {
          await store({ stoppedEarly: true });
          return;
        }
        const noGain = lastProgress !== null && today.progress <= lastProgress && today.progress < today.max;
        stalled = noGain ? stalled + 1 : 0;
        lastProgress = today.progress;
        if (settings.cooldownAware && stalled >= COOLDOWN_STALL) {
          await enterCooldown(settings);
          return;
        }
      }
    }
  }
}

function estimateEarned(searches, todayStart) {
  const est = searches * POINTS_PER_SEARCH;
  return todayStart ? Math.min(est, Math.max(0, todayStart.max - todayStart.progress)) : est;
}

async function finishRun(token) {
  await closeTab('searchTabId');
  const st = await load(['startPoints', 'startKnown', 'currentSearch', 'totalSearch', 'todaySearch', 'todayStart']);
  const searches = st.currentSearch || 0;
  const start = st.startPoints || 0;

  await sleep(2000);
  let res = await readPointsFromDashboard(token);
  if (!isCurrent(token)) return;
  if (st.startKnown && searches > 0 && res.points !== null && res.points <= start) {
    await sleep(4000);
    const retry = await readPointsFromDashboard(token);
    if (!isCurrent(token)) return;
    if (retry.points !== null) res = retry;
  }
  const finalCheck = await directToday();
  if (finalCheck.activities) await store({ todayActivities: finalCheck.activities, todayCheckedAt: Date.now() });
  const finalToday = finalCheck.today || st.todaySearch || null;
  await closeTab('rewardsTabId');
  if (!isCurrent(token)) return;

  const exact = st.startKnown && res.points !== null;
  let earned;
  if (exact) {
    earned = Math.max(0, res.points - start);
  } else if (st.todayStart && finalToday) {
    earned = Math.max(0, finalToday.progress - st.todayStart.progress);
  } else {
    earned = estimateEarned(searches, st.todayStart);
  }
  const endPoints = res.points !== null ? res.points : start + earned;

  await store({
    endPoints,
    finalEarned: earned,
    earnedIsEstimate: !exact,
    todaySearch: finalToday,
    lastRun: { at: Date.now(), searches, total: st.totalSearch, start, end: endPoints, earned, estimate: !exact },
    currentQuery: null,
    cooldownUntil: null,
    phase: 'completed',
    running: false,
    stopRequested: false
  });
  chrome.alarms.clear('watchdog');
  chrome.alarms.clear('cooldownEnd');
}

async function finishWithError(message) {
  await store({ phase: 'error', running: false, stopRequested: false, error: message });
  chrome.alarms.clear('watchdog');
}

let queuePromise = null;

async function prepareQueue(token, count) {
  const { usedWords } = await load(['usedWords']);
  const built = await buildQueries(count, usedWords);
  if (isCurrent(token) && built.queries.length) {
    await store({
      searchQueue: built.queries,
      usedWords: built.usedWords,
      totalSearch: Math.min(count, built.queries.length)
    });
  }
  return built;
}

async function ensureQueue(token) {
  const hasQueue = async () => {
    const { searchQueue } = await load(['searchQueue']);
    return Array.isArray(searchQueue) && searchQueue.length > 0;
  };
  if (await hasQueue()) return;
  if (queuePromise) await queuePromise;
  if (await hasQueue()) return;
  const { totalSearch } = await load(['totalSearch']);
  await prepareQueue(token, totalSearch || 30);
  if (!(await hasQueue())) throw new Error('Could not load search topics. Check your internet connection.');
}

async function handleStart(count) {
  if (flowActive) return;
  const token = ++flowToken;
  flowActive = true;
  try {
    await closeTab('searchTabId');
    await closeTab('rewardsTabId');
    await store({
      running: true,
      phase: 'fetchingStartPoints',
      stopRequested: false,
      currentSearch: 0,
      totalSearch: count,
      searchQueue: [],
      currentQuery: null,
      startPoints: 0,
      startKnown: false,
      endPoints: 0,
      finalEarned: 0,
      earnedIsEstimate: false,
      todaySearch: null,
      todayStart: null,
      liveCheck: false,
      stoppedEarly: false,
      searchMaxedAtStart: false,
      cooldownUntil: null,
      cooldownCycles: 0,
      cooldownGaveUp: false,
      error: null,
      warning: null,
      diag: null,
      diagLimit: null,
      lastActivity: Date.now()
    });
    chrome.alarms.create('watchdog', { periodInMinutes: 0.5 });
    queuePromise = prepareQueue(token, count).catch(() => null);
    await runFlow(token);
  } catch (err) {
    if (isCurrent(token)) await finishWithError('Start failed: ' + err.message);
  } finally {
    if (isCurrent(token)) flowActive = false;
  }
}

async function handleStop() {
  const { phase, running } = await load(['phase', 'running']);
  if (!running) return;

  if (phase === 'searching') {
    await store({ stopRequested: true });
    resumeIfNeeded();
    return;
  }
  if (phase === 'cooldown') {
    chrome.alarms.clear('cooldownEnd');
    await store({ phase: 'fetchingEndPoints', stopRequested: true, cooldownUntil: null });
    chrome.alarms.create('watchdog', { periodInMinutes: 0.5 });
    resumeIfNeeded();
    return;
  }
  if (phase === 'fetchingEndPoints') return;

  flowToken++;
  flowActive = false;
  chrome.alarms.clear('watchdog');
  await closeTab('searchTabId');
  await closeTab('rewardsTabId');
  await store({ running: false, phase: 'idle', stopRequested: false, searchQueue: [], currentQuery: null });
}

// A run whose last sign of life is this old was cut off by the browser closing.
// Don't pick it up again on the next launch: it would start searching by itself
// with yesterday's start balance.
const STALE_RUN_MS = 30 * 60 * 1000;

async function resumeIfNeeded() {
  if (flowActive) return;
  const st = await load(['running', 'phase', 'cooldownUntil', 'lastActivity']);
  if (flowActive) return;
  if (st.running && Date.now() - Math.max(st.lastActivity || 0, st.cooldownUntil || 0) > STALE_RUN_MS) {
    flowToken++;
    chrome.alarms.clear('watchdog');
    chrome.alarms.clear('cooldownEnd');
    await closeTab('searchTabId');
    await closeTab('rewardsTabId');
    await store({ searchQueue: [], currentQuery: null, cooldownUntil: null });
    await finishWithError('The last run was cut off (the browser was closed or the PC went to sleep). Press Start to run again.');
    return;
  }
  if (st.running && st.phase === 'cooldown') {
    if (Date.now() >= (st.cooldownUntil || 0)) endCooldown();
    return;
  }
  if (st.running && ACTIVE_PHASES.includes(st.phase)) {
    runFlow(++flowToken);
  } else {
    chrome.alarms.clear('watchdog');
  }
}

const REMINDER_ARM_MS = 20 * 60 * 1000;
const REMINDER_TICK_MINUTES = 30;
const ALL_SITES = { origins: ['<all_urls>'] };
let reminderBusy = false;

const todayKey = () => new Date().toLocaleDateString('en-CA');

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2])) : null;
}

function inActiveHours(settings, now = new Date()) {
  const from = toMinutes(settings.reminderFrom);
  const to = toMinutes(settings.reminderTo);
  if (from === null || to === null || from === to) return true;
  const cur = now.getHours() * 60 + now.getMinutes();
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

function ensureReminderTick() {
  chrome.alarms.get('reminderTick', alarm => {
    if (!alarm) chrome.alarms.create('reminderTick', { periodInMinutes: REMINDER_TICK_MINUTES });
  });
}
const isRegularPage = url => { const u = parseUrl(url); return !!u && (u.protocol === 'https:' || u.protocol === 'http:'); };

function parseActivities(html) {
  const clean = decodePayload(html);
  const label = key => { const m = clean.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]{1,40})"')); return m ? m[1] : null; };
  const out = [];
  const seen = new Set();
  for (const m of clean.matchAll(/"streak"\s*:\s*\{/g)) {
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (let i = end; i < clean.length && i < end + 4000; i++) {
      if (clean[i] === '{') depth++;
      else if (clean[i] === '}' && --depth === 0) { end = i; break; }
    }
    const seg = clean.slice(m.index, end + 1);
    const num = k => { const x = seg.match(new RegExp('"' + k + '"\\s*:\\s*(\\d+)')); return x ? Number(x[1]) : null; };
    const str = k => { const x = seg.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]*)"')); return x ? x[1] : null; };
    const bool = k => { const x = seg.match(new RegExp('"' + k + '"\\s*:\\s*(true|false)')); return x ? x[1] === 'true' : null; };
    const titleKey = str('activityTitle');
    const done = num('activitiesCompleted');
    const total = num('activitiesTotal');
    if (!titleKey || seen.has(titleKey) || done === null || !total) continue;
    seen.add(titleKey);
    out.push({
      id: str('partner') || titleKey,
      name: label(titleKey) || titleKey.replace(/_activityTitle$/, ''),
      done: Math.min(done, total),
      total,
      unit: /^Minutes/.test(str('activitiesLabel') || '') ? 'min' : '',
      enabled: bool('isEnabled') !== false
    });
  }
  return out;
}

async function reminderPayload() {
  const r = await fetchRewardsPage('/earn');
  if (!r.ok) return null;
  const search = parseSearchCounter(r.html);
  const acts = parseActivities(r.html);
  const keep = keepEarningSummary(parseKeepEarning(r.html));
  if (!search && !acts.length && !keep) return null;
  let items = [];
  if (search) items.push({ id: 'search', name: 'Bing search', done: search.progress, total: search.max, unit: 'pts' });
  for (const a of acts) {
    if (a.enabled && a.id !== 'bing') items.push({ id: a.id, name: a.name, done: a.done, total: a.total, unit: a.unit });
  }
  items = keep ? [...items.slice(0, 4), keep] : items.slice(0, 5);
  const { uiTheme } = await load(['uiTheme']);
  const settings = await getSettings();
  return {
    items,
    left: items.filter(i => i.done < i.total).length,
    theme: uiTheme || null,
    duration: Math.min(30, Math.max(3, Number(settings.reminderSeconds) || 5)) * 1000,
    reduceMotion: !!settings.reduceMotion
  };
}

function showRewardsToast(data) {
  const ID = 'rewards-automator-toast';
  const old = document.getElementById(ID);
  if (old) old.remove();
  const dark = data.theme ? data.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const duration = data.duration || 5000;
  const calm = data.reduceMotion ? '.t,.r,.tm i{animation:none}.b i{transition:none}' : '';
  const host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'all:initial;position:fixed;top:16px;right:16px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  const css = `
    .t{--bg:${dark ? '#1A1A1F' : '#fff'};--fg:${dark ? '#ECEDEE' : '#11181C'};--mu:${dark ? '#9BA1A6' : '#687076'};
       --bd:${dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)'};--tr:${dark ? '#2A2A31' : '#E8ECF2'};
       --chip:${dark ? 'rgba(59,130,246,.16)' : '#EEF4FF'};--ac:${dark ? '#60A5FA' : '#0066FF'};--hv:${dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.05)'};
       width:320px;font:13px/1.4 'Segoe UI Variable','Segoe UI',system-ui,sans-serif;color:var(--fg);background:var(--bg);
       border:1px solid var(--bd);border-radius:16px;overflow:hidden;cursor:pointer;transform-origin:top right;
       box-shadow:0 14px 36px rgba(0,0,0,${dark ? '.45' : '.18'}),0 2px 6px rgba(0,0,0,.08);
       animation:in .55s cubic-bezier(.22,1.25,.36,1) both}
    .t.out{animation:out .26s ease-in both}
    @keyframes in{from{opacity:0;transform:translateX(28px) scale(.95)}to{opacity:1;transform:none}}
    @keyframes out{to{opacity:0;transform:translateX(28px) scale(.95)}}
    .h{display:flex;align-items:center;gap:10px;padding:14px 12px 10px 14px}
    .lg{width:30px;height:30px;border-radius:9px;flex-shrink:0;display:grid;place-items:center;color:#fff;
        background:linear-gradient(135deg,#0066FF,#00AAFF);box-shadow:0 3px 10px rgba(0,102,255,.35)}
    .tt{flex:1;min-width:0}.k{font-size:11px;font-weight:600;color:var(--mu)}.ti{font-size:14px;font-weight:700}
    .x{all:unset;width:26px;height:26px;border-radius:8px;display:grid;place-items:center;color:var(--mu);cursor:pointer}
    .x:hover{background:var(--hv);color:var(--fg)}.x:focus-visible{outline:2px solid var(--ac)}
    .rs{display:flex;flex-direction:column;gap:10px;padding:2px 14px 14px}
    .r{display:grid;grid-template-columns:24px 1fr auto;align-items:center;column-gap:10px;row-gap:5px;animation:in .5s cubic-bezier(.22,1,.36,1) both}
    .ic{grid-row:span 2;width:24px;height:24px;border-radius:7px;background:var(--chip);color:var(--ac);display:grid;place-items:center}
    .n{font-weight:600;font-size:12.5px}.v{font-size:12px;font-weight:700;color:var(--mu);font-variant-numeric:tabular-nums}
    .b{grid-column:2/4;height:4px;border-radius:99px;background:var(--tr);overflow:hidden}
    .b i{display:block;height:100%;width:0;border-radius:inherit;background:linear-gradient(90deg,#0066FF,#00AAFF);transition:width .9s cubic-bezier(.22,1,.36,1)}
    .xl{grid-column:2/4;display:flex;flex-direction:column;gap:3px;margin-top:2px}
    .xi{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--mu)}
    .xi::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--ac);flex-shrink:0;opacity:.75}
    .xi span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .xi b{font-weight:700;color:var(--ac);font-variant-numeric:tabular-nums}
    .xi.m::before{background:transparent}
    .r.d .b i{background:#22C55E}.r.d .v{color:#16A34A}.r.d .ic{color:#16A34A;background:${dark ? 'rgba(34,197,94,.14)' : '#E7F8EE'}}
    .tm{height:3px;background:var(--tr)}.tm i{display:block;height:100%;transform-origin:left;background:linear-gradient(90deg,#0066FF,#00AAFF);animation:cd ${duration}ms linear forwards}
    .t:hover .tm i{animation-play-state:paused}@keyframes cd{to{transform:scaleX(0)}}
    @media (prefers-reduced-motion:reduce){.t,.r,.tm i{animation:none}.b i{transition:none}}${calm}`;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const st = document.createElement('style');
    st.textContent = css;
    root.appendChild(st);
  }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const icon = paths => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '14'); s.setAttribute('height', '14');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2.2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    for (const d of paths) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.appendChild(p); }
    return s;
  };
  const ICONS = {
    search: ['M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z', 'M15.5 15.5L20 20'],
    dailyset: ['M7 4h10v14H7z', 'M4 7v13h11'],
    bingapp: ['M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5z', 'M11 18.5h2'],
    visualsearch: ['M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8', 'M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8', 'M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16', 'M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16', 'M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z'],
    done: ['M5 12.5l4.5 4.5L19 7.5'],
    keepearning: ['M4 10h16v10H4z', 'M3 6.5h18V10H3z', 'M12 6.5V20', 'M12 6.5C10.5 3 7 3.5 7.5 5.5 8 6.5 12 6.5 12 6.5z', 'M12 6.5c1.5-3.5 5-3 4.5-1-.5 1-4.5 1-4.5 1z'],
    other: ['M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z']
  };

  const toast = el('div', 't');
  toast.setAttribute('role', 'status');
  const head = el('div', 'h');
  const logo = el('div', 'lg');
  const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  mark.setAttribute('viewBox', '0 0 128 128');
  mark.setAttribute('width', '20');
  mark.setAttribute('height', '20');
  const svgEl = (tag, attrs) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  mark.append(
    svgEl('circle', { cx: 52, cy: 52, r: 18, fill: '#FBBF24' }),
    svgEl('circle', { cx: 52, cy: 52, r: 29, fill: 'none', stroke: '#fff', 'stroke-width': 13 }),
    svgEl('path', { d: 'M73 73L96 96', stroke: '#fff', 'stroke-width': 16, 'stroke-linecap': 'round' })
  );
  logo.appendChild(mark);
  const titles = el('div', 'tt');
  titles.append(el('div', 'k', 'Microsoft Rewards'),
    el('div', 'ti', data.left ? `${data.left} left today` : 'All done today — nice work!'));
  const close = el('button', 'x');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.appendChild(icon(['M6 6l12 12', 'M18 6L6 18']));
  head.append(logo, titles, close);

  const rows = el('div', 'rs');
  const bars = [];
  data.items.forEach((it, i) => {
    const doneRow = it.done >= it.total;
    const row = el('div', 'r' + (doneRow ? ' d' : ''));
    row.style.animationDelay = `${140 + i * 70}ms`;
    const ic = el('div', 'ic');
    ic.appendChild(icon(doneRow ? ICONS.done : (ICONS[it.id] || ICONS.other)));
    const bar = el('div', 'b');
    const fill = el('i');
    bar.appendChild(fill);
    bars.push([fill, Math.round((it.done / it.total) * 100)]);
    row.append(ic, el('div', 'n', it.name), el('div', 'v', `${it.done}/${it.total}${it.unit ? ' ' + it.unit : ''}`), bar);
    const open = !doneRow && Array.isArray(it.left) ? it.left : [];
    if (open.length) {
      const list = el('div', 'xl');
      const shown = open.length > 3 ? open.slice(0, 2) : open;
      for (const c of shown) {
        const line = el('div', 'xi');
        line.append(el('span', null, c.title), el('b', null, c.points ? `+${c.points}` : ''));
        list.appendChild(line);
      }
      if (open.length > shown.length) {
        const more = open.slice(shown.length).reduce((s, c) => s + (c.points || 0), 0);
        const line = el('div', 'xi m');
        line.append(el('span', null, `${open.length - shown.length} more`), el('b', null, more ? `+${more}` : ''));
        list.appendChild(line);
      }
      row.appendChild(list);
    }
    rows.appendChild(row);
  });
  const timer = el('div', 'tm');
  timer.appendChild(el('i'));
  toast.append(head, rows, timer);
  root.appendChild(toast);
  document.documentElement.appendChild(host);
  setTimeout(() => bars.forEach(([f, pct]) => { f.style.width = pct + '%'; }), 200);

  let remaining = duration;
  let started = Date.now();
  let timerId = null;
  const dismiss = () => {
    clearTimeout(timerId);
    toast.classList.add('out');
    setTimeout(() => host.remove(), 280);
  };
  const run = () => { started = Date.now(); timerId = setTimeout(dismiss, remaining); };
  toast.addEventListener('mouseenter', () => { clearTimeout(timerId); remaining -= Date.now() - started; });
  toast.addEventListener('mouseleave', run);
  close.addEventListener('click', e => { e.stopPropagation(); dismiss(); });
  toast.addEventListener('click', () => {
    try { chrome.runtime.sendMessage({ type: 'openEarn' }); } catch {}
    dismiss();
  });
  run();
  return true;
}

async function injectToast(tabId, payload) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: showRewardsToast, args: [payload] });
    return !!(res && res.result);
  } catch {
    return false;
  }
}

async function armReminder() {
  const { reminderEnabled } = await load(['reminderEnabled']);
  if (reminderEnabled) await store({ reminderArmedUntil: Date.now() + REMINDER_ARM_MS });
}

async function maybeShowReminder(tab) {
  if (reminderBusy || !tab || !tab.active || tab.incognito || !isRegularPage(tab.url) || previewTabs.has(tab.id)) return;
  reminderBusy = true;
  try {
    const st = await load(['reminderEnabled', 'reminderArmedUntil', 'reminderLog', 'running', 'searchTabId', 'rewardsTabId']);
    if (!st.reminderEnabled || !st.reminderArmedUntil || Date.now() > st.reminderArmedUntil) return;
    if (st.running || tab.id === st.searchTabId || tab.id === st.rewardsTabId) return;
    const settings = await getSettings();
    if (!inActiveHours(settings)) return;
    const perDay = Math.min(10, Math.max(1, Number(settings.reminderPerDay) || 3));
    const gap = Math.max(0.5, Number(settings.reminderGapHours) || 2) * 60 * 60 * 1000;
    const log = st.reminderLog && st.reminderLog.date === todayKey() ? st.reminderLog : { date: todayKey(), count: 0, last: 0 };
    if (log.count >= perDay || Date.now() - log.last < gap) {
      await store({ reminderArmedUntil: 0 });
      return;
    }
    if (!(await chrome.permissions.contains(ALL_SITES))) return;
    const payload = await reminderPayload();
    if (!payload || payload.left === 0) {
      await store({ reminderArmedUntil: 0 });
      return;
    }
    if (await injectToast(tab.id, payload)) {
      await store({ reminderArmedUntil: 0, reminderLog: { date: log.date, count: log.count + 1, last: Date.now() } });
    }
  } finally {
    reminderBusy = false;
  }
}

async function previewReminder(tabId) {
  let tab = null;
  if (tabId != null) {
    try { tab = await chrome.tabs.get(tabId); } catch {}
  }
  if (!tab) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const payload = await reminderPayload();
  if (!payload) return { ok: false, reason: 'rewards' };
  payload.duration = Math.max(payload.duration, 6000);
  if (tab && isRegularPage(tab.url) && await chrome.permissions.contains(ALL_SITES) && await injectToast(tab.id, payload)) {
    return { ok: true };
  }
  return (await previewOnBingTab(payload, tab)) ? { ok: true, opened: true } : { ok: false, reason: 'blocked' };
}

async function previewTopic() {
  const timeout = new Promise(r => setTimeout(() => r(null), 3500));
  const live = (async () => {
    const { terms } = await fetchTrends();
    if (terms.length) return pickOne(terms);
    return pickOne(await fetchSuggestions(randomPrefix()));
  })().catch(() => null);
  return cleanQuery((await Promise.race([live, timeout])) || '') || cleanQuery(randomPrefix() + randomPrefix()) || 'weather';
}

const previewTabs = new Set();

async function previewOnBingTab(payload, fromTab) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(await previewTopic())}`;
  const created = await chrome.tabs.create(Object.assign(
    { url, active: true },
    fromTab ? { windowId: fromTab.windowId, index: fromTab.index + 1 } : {}
  ));
  previewTabs.add(created.id);
  try {
    const tab = await waitForSettled(created.id, Date.now() + READ_DEADLINE);
    if (!tab || !isRegularPage(tab.url)) return false;
    await sleep(400);
    for (let i = 0; i < 3; i++) {
      if (await injectToast(created.id, payload)) return true;
      await sleep(800);
    }
    return false;
  } finally {
    setTimeout(() => previewTabs.delete(created.id), 60000);
  }
}

chrome.runtime.onStartup.addListener(() => { ensureReminderTick(); armReminder(); });
chrome.windows.onCreated.addListener(w => {
  if (w.type !== 'normal') return;
  armReminder();
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') maybeShowReminder(tab);
});
chrome.permissions.onAdded.addListener(p => {
  if (p.origins && p.origins.includes('<all_urls>')) store({ reminderEnabled: true });
});
chrome.permissions.onRemoved.addListener(p => {
  if (p.origins && p.origins.includes('<all_urls>')) store({ reminderEnabled: false });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'start') {
    const count = Math.min(Math.max(parseInt(msg.count, 10) || 1, 1), 150);
    handleStart(count);
  } else if (msg.type === 'stop') {
    handleStop();
  } else if (msg.type === 'openEarn') {
    chrome.tabs.create({ url: EARN_URL, active: true });
  } else if (msg.type === 'previewReminder') {
    previewReminder(msg.tabId)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, reason: 'error', message: err.message }));
    return true;
  } else if (msg.type === 'refreshToday') {
    refreshToday();
  }
  sendResponse({ ok: true });
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'watchdog') resumeIfNeeded();
  else if (alarm.name === 'cleanUsedWords') store({ usedWords: [] });
  else if (alarm.name === 'reminderTick') armReminder();
  else if (alarm.name === 'cooldownEnd') endCooldown();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('cleanUsedWords', { periodInMinutes: 1440 });
  ensureReminderTick();
});

chrome.alarms.clear('scheduledRun');
chrome.alarms.clear('autoDailySet');
ensureReminderTick();
resumeIfNeeded();
