document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const body = document.body;
  const main = $('main');
  const btnAction = $('btn-action');
  const actionLabel = $('btn-action-label');
  const countInput = $('count');
  const themeBtn = $('theme-toggle');
  const ring = document.querySelector('.progress-ring');
  const arc = $('progress-arc');
  const progressText = $('progress-text');
  const progressSub = $('progress-sub');
  const statusEl = $('status');
  const statusText = $('status-text');
  const startEl = $('start-points');
  const currentEl = $('end-points');
  const earnedEl = $('earned-points');
  const earnedLabel = $('earned-label');
  const daily = $('daily');
  const dailyValue = $('daily-value');
  const dailyFill = $('daily-fill');
  const dailyHint = $('daily-hint');
  const notice = $('notice');
  const noticeTitle = $('notice-title');
  const noticeBody = $('notice-body');
  const noticeCopy = $('notice-copy');
  const errorBanner = $('error-banner');
  const errorText = $('error-text');

  const ARC_LENGTH = 2 * Math.PI * 52;
  const POINTS_PER_SEARCH = 3;
  const ALL_SITES = { origins: ['<all_urls>'] };
  const TODAY_REFRESH_MS = 5 * 60 * 1000;
  const KEYS = [
    'phase', 'running', 'currentSearch', 'totalSearch', 'startPoints', 'startKnown',
    'endPoints', 'finalEarned', 'earnedIsEstimate', 'todaySearch', 'error', 'warning', 'stopRequested',
    'diag', 'diagLimit', 'todayStart', 'liveCheck', 'stoppedEarly', 'currentQuery', 'todayActivities',
    'cooldownUntil', 'cooldownWaitMs', 'cooldownCycles', 'cooldownGaveUp', 'searchMaxedAtStart'
  ];
  const DEFAULTS = {
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
  const MAX_COOLDOWNS = 6;
  const SPIN_LABEL = {
    fetchingStartPoints: 'please wait',
    checkingLimit: 'please wait',
    fetchingEndPoints: 'please wait'
  };
  const STATUS = {
    idle: ['Ready', 'stopped'],
    fetchingStartPoints: ['Reading points', 'running'],
    checkingLimit: ['Checking today', 'running'],
    searching: ['Searching', 'running'],
    cooldown: ['Bing cooldown', 'cooldown'],
    fetchingEndPoints: ['Finalizing', 'running'],
    completed: ['Completed', 'completed'],
    limitReached: ['Limit reached', 'completed'],
    error: ['Error', 'error']
  };

  let settings = Object.assign({}, DEFAULTS);
  let diagText = '';

  const fmt = n => Number(n || 0).toLocaleString();
  const isDigit = c => c >= '0' && c <= '9';
  const motionOff = () =>
    root.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clampNum = (v, min, max, fallback) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const restart = (el, cls) => {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  };

  function setOdometer(el, value) {
    const text = String(value);
    if (el.dataset.odo === text) return;
    el.dataset.odo = text;
    el.classList.toggle('odo-empty', text === '');

    const chars = [...text];
    const shape = chars.map(c => (isDigit(c) ? '#' : c)).join('');
    let sr = el.querySelector(':scope > .sr-only');
    let odo = el.querySelector(':scope > .odo');

    if (!odo || el.dataset.shape !== shape) {
      el.dataset.shape = shape;
      el.textContent = '';
      sr = document.createElement('span');
      sr.className = 'sr-only';
      odo = document.createElement('span');
      odo.className = 'odo';
      odo.setAttribute('aria-hidden', 'true');
      for (const c of chars) {
        if (isDigit(c)) {
          const col = document.createElement('span');
          col.className = 'odo-digit';
          const strip = document.createElement('span');
          strip.className = 'odo-strip';
          for (let d = 0; d <= 9; d++) {
            const cell = document.createElement('span');
            cell.textContent = String(d);
            strip.appendChild(cell);
          }
          col.appendChild(strip);
          odo.appendChild(col);
        } else {
          const s = document.createElement('span');
          s.className = 'odo-static';
          s.textContent = c;
          odo.appendChild(s);
        }
      }
      el.append(sr, odo);
      void odo.offsetWidth;
    }

    sr.textContent = text;
    const strips = odo.querySelectorAll('.odo-strip');
    const digits = chars.filter(isDigit);
    strips.forEach((strip, i) => {
      strip.style.transitionDelay = `${(strips.length - 1 - i) * 45}ms`;
      strip.style.transform = `translateY(${-Number(digits[i]) * 10}%)`;
    });
  }

  function showError(msg) {
    errorText.textContent = msg;
    errorBanner.hidden = false;
  }

  function send(type, extra) {
    return chrome.runtime.sendMessage(Object.assign({ type }, extra)).catch(err => {
      showError('Extension error: ' + err.message);
    });
  }

  $('error-dismiss').addEventListener('click', () => {
    errorBanner.hidden = true;
    chrome.storage.local.set({ error: null });
  });

  noticeCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(diagText);
      noticeCopy.textContent = 'Copied ✓';
    } catch {
      noticeCopy.textContent = 'Copy failed';
    }
    setTimeout(() => { noticeCopy.textContent = 'Copy details'; }, 1800);
  });

  const savedThemeMode = () => {
    try {
      const t = localStorage.getItem('theme');
      return t === 'light' || t === 'dark' ? t : 'system';
    } catch {
      return 'system';
    }
  };

  function syncThemeControls() {
    const label = root.getAttribute('data-theme') === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;
    setSegment('set-theme', savedThemeMode());
  }

  let fadeTimer = null;
  function applyTheme(mode) {
    const resolved = mode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
    const apply = () => {
      root.setAttribute('data-theme', resolved);
      try {
        if (mode === 'system') localStorage.removeItem('theme');
        else localStorage.setItem('theme', mode);
      } catch {}
      chrome.storage.local.set({ uiTheme: mode === 'system' ? null : mode });
      syncThemeControls();
    };
    if (motionOff() || root.getAttribute('data-theme') === resolved) {
      apply();
    } else if (typeof document.startViewTransition === 'function') {
      document.startViewTransition(apply);
    } else {
      root.classList.add('theme-fade');
      apply();
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => root.classList.remove('theme-fade'), 600);
    }
  }

  themeBtn.addEventListener('click', () => {
    applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  function saveSettings(patch) {
    settings = Object.assign({}, settings, patch);
    chrome.storage.local.set({ settings });
    syncSettingsUI();
  }

  function setReduceMotion(on) {
    root.classList.toggle('reduce-motion', on);
    try { localStorage.setItem('reduceMotion', on ? '1' : '0'); } catch {}
  }

  async function loadSettings() {
    const data = await chrome.storage.local.get(['settings']);
    let legacyCount = null;
    try { legacyCount = parseInt(localStorage.getItem('searchCount'), 10); } catch {}
    const base = Object.assign({}, DEFAULTS, Number.isFinite(legacyCount) ? { defaultCount: legacyCount } : {});
    settings = Object.assign(base, data.settings || {});
    setReduceMotion(!!settings.reduceMotion);
    if (!countInput.disabled) countInput.value = settings.defaultCount;
    syncSettingsUI();
    refresh();
  }

  function clampCount() {
    const v = clampNum(countInput.value, 1, 150, settings.defaultCount);
    countInput.value = v;
    return v;
  }

  countInput.addEventListener('change', () => {
    saveSettings({ defaultCount: clampCount() });
    refresh();
  });

  let pendingStartUntil = 0;

  function setAction(mode, label, disabled) {
    btnAction.classList.toggle('is-stop', mode === 'stop');
    btnAction.dataset.mode = mode;
    if (actionLabel.textContent !== label) {
      actionLabel.textContent = label;
      if (!motionOff()) restart(actionLabel, 'swap');
    }
    btnAction.disabled = !!disabled;
  }

  function ripple(e) {
    if (motionOff()) return;
    const rect = btnAction.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2.2;
    const fromPointer = e.detail > 0 && e.clientX;
    const x = (fromPointer ? e.clientX : rect.left + rect.width / 2) - rect.left - size / 2;
    const y = (fromPointer ? e.clientY : rect.top + rect.height / 2) - rect.top - size / 2;
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px`;
    btnAction.appendChild(dot);
    dot.addEventListener('animationend', () => dot.remove());
  }

  btnAction.addEventListener('click', e => {
    ripple(e);
    errorBanner.hidden = true;
    if (btnAction.dataset.mode === 'start') {
      const count = clampCount();
      saveSettings({ defaultCount: count });
      pendingStartUntil = Date.now() + 4000;
      setAction('stop', 'Starting…', true);
      send('start', { count });
    } else {
      setAction('stop', 'Stopping…', true);
      send('stop');
    }
  });

  let statusTimer = null;
  function setStatus(text, cls, isQuery, title) {
    const key = `${cls}|${isQuery ? 'q' : ''}|${text}`;
    if (statusEl.dataset.key === key) return;
    const first = !statusEl.dataset.key;
    statusEl.dataset.key = key;
    const from = statusEl.offsetWidth;
    clearTimeout(statusTimer);
    statusEl.style.width = '';
    statusEl.className = 'status ' + cls + (isQuery ? ' show-query' : '');
    statusText.textContent = text;
    if (title) statusEl.title = title;
    else statusEl.removeAttribute('title');
    if (first || motionOff()) return;
    restart(statusText, 'swap');
    const to = statusEl.offsetWidth;
    if (Math.abs(to - from) < 1) return;
    statusEl.style.width = from + 'px';
    void statusEl.offsetWidth;
    statusEl.style.width = to + 'px';
    statusTimer = setTimeout(() => { statusEl.style.width = ''; }, 380);
  }

  function setTip(id, title, lines, note) {
    const tip = $(id);
    const key = JSON.stringify([title, lines, note]);
    if (tip.dataset.key === key) return;
    tip.dataset.key = key;
    tip.textContent = '';
    const head = document.createElement('span');
    head.className = 'tip-title';
    head.textContent = title;
    tip.appendChild(head);
    for (const line of lines) {
      const row = document.createElement('span');
      row.className = 'tip-line' + (line.done ? ' done' : '') + (line.sub ? ' sub' : '');
      const name = document.createElement('span');
      name.textContent = line.name;
      const val = document.createElement('span');
      val.className = 'tip-val';
      val.textContent = line.value;
      row.append(name, val);
      tip.appendChild(row);
    }
    if (note) {
      const n = document.createElement('span');
      n.className = 'tip-note';
      n.textContent = note;
      tip.appendChild(n);
    }
  }

  function setRing(pct) {
    const p = Math.max(0, Math.min(1, pct));
    arc.style.strokeDashoffset = ARC_LENGTH * (1 - p);
    arc.classList.toggle('empty', p === 0);
    ring.setAttribute('aria-valuenow', Math.round(p * 100));
  }

  function setNotice(kind, title, text) {
    if (!kind) { notice.hidden = true; return; }
    notice.className = 'notice enter' + (kind === 'warn' ? ' warn' : '');
    noticeTitle.textContent = title;
    noticeBody.textContent = text;
    notice.hidden = false;
  }

  function render(d) {
    const phase = STATUS[d.phase] ? d.phase : 'idle';
    const running = !!d.running;
    const current = d.currentSearch || 0;
    const total = d.totalSearch || 0;
    const start = d.startPoints || 0;
    const startKnown = !!d.startKnown;
    const today = d.todaySearch && d.todaySearch.max > 0 ? d.todaySearch : null;
    const todayStart = d.todayStart && d.todayStart.max > 0 ? d.todayStart : null;
    const live = !!(d.liveCheck && today && todayStart);
    const remaining = todayStart ? Math.max(0, todayStart.max - todayStart.progress) : Infinity;
    const estimate = live
      ? Math.max(0, today.progress - todayStart.progress)
      : Math.min(current * POINTS_PER_SEARCH, remaining);
    const inSearch = ['searching', 'cooldown', 'fetchingEndPoints'].includes(phase);
    const cooldownLeft = phase === 'cooldown' ? Math.max(0, (d.cooldownUntil || 0) - Date.now()) : 0;
    const clock = ms => {
      const s = Math.ceil(ms / 1000);
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };

    const [label, cls] = STATUS[phase];
    const showQuery = phase === 'searching' && !d.stopRequested && !!d.currentQuery;
    if (showQuery) {
      setStatus(d.currentQuery, cls, true, `Searching: ${d.currentQuery}`);
    } else if (phase === 'searching') {
      setStatus(d.stopRequested ? 'Stopping' : `Search ${current} of ${total}`, cls, false);
    } else {
      setStatus(label, cls, false);
    }

    const spinning = phase in SPIN_LABEL;
    ring.classList.toggle('spinning', spinning);
    if (spinning) {
      setOdometer(progressText, '');
      progressSub.textContent = SPIN_LABEL[phase];
    } else if (phase === 'limitReached' && today) {
      setOdometer(progressText, `${today.progress} / ${today.max}`);
      progressSub.textContent = 'pts today';
      setRing(1);
    } else if (phase === 'idle') {
      // Read the box without rewriting it, so the user can clear it and type.
      setOdometer(progressText, `0 / ${clampNum(countInput.value, 1, 150, settings.defaultCount)}`);
      progressSub.textContent = 'searches';
      setRing(0);
    } else if (phase === 'cooldown') {
      setOdometer(progressText, clock(cooldownLeft));
      progressSub.textContent = 'cooldown';
      const minutes = d.cooldownWaitMs || Math.max(5, Number(settings.cooldownMinutes) || 15) * 60 * 1000;
      setRing(cooldownLeft / minutes);
    } else {
      setOdometer(progressText, `${current} / ${total}`);
      progressSub.textContent = 'searches';
      setRing(total > 0 ? current / total : 0);
    }

    let startTxt = startKnown ? fmt(start) : '—';
    let currentTxt = '—';
    let earnedTxt = '+0';
    let earnedCls = 'point-value';
    let earnedLbl = 'Earned';

    if (phase === 'fetchingStartPoints') {
      startTxt = '…';
      earnedTxt = '—';
      earnedCls += ' estimated';
    } else if (phase === 'checkingLimit') {
      earnedTxt = '—';
      earnedCls += ' estimated';
    } else if (inSearch && live) {
      currentTxt = startKnown ? fmt(start + estimate) : '—';
      earnedTxt = '+' + fmt(estimate);
      earnedCls += ' actual';
    } else if (inSearch) {
      currentTxt = startKnown ? '~' + fmt(start + estimate) : '—';
      earnedTxt = '~+' + fmt(estimate);
      earnedCls += ' estimated';
      earnedLbl = 'Earned (est.)';
    } else if (phase === 'completed') {
      currentTxt = fmt(d.endPoints);
      const est = !!d.earnedIsEstimate;
      earnedTxt = (est ? '~+' : '+') + fmt(d.finalEarned);
      earnedCls += est ? ' estimated' : ' actual';
      if (est) earnedLbl = 'Earned (est.)';
    } else if (phase === 'limitReached') {
      currentTxt = startTxt;
    }

    setOdometer(startEl, startTxt);
    setOdometer(currentEl, currentTxt);
    setOdometer(earnedEl, earnedTxt);
    earnedEl.className = earnedCls;
    earnedLabel.textContent = earnedLbl;

    setTip('tip-start', 'Start balance', [],
      startKnown ? 'Read from your Rewards dashboard when this run began.' : 'Appears once a run reads your dashboard.');
    let currentNote = 'Updates while a run is going.';
    if (inSearch) currentNote = live ? 'Start + points Bing has counted so far.' : 'Estimated: start + 3 pts per search.';
    else if (phase === 'completed') currentNote = 'Read from your dashboard after the run.';
    else if (phase === 'limitReached') currentNote = "Nothing to add today — you're maxed.";
    setTip('tip-current', 'Current balance', [], currentNote);
    const lines = [];
    if (today) lines.push({ name: 'Bing search', value: `${today.progress}/${today.max} pts`, done: today.progress >= today.max });
    for (const a of d.todayActivities || []) {
      lines.push({ name: a.name, value: `${a.done}/${a.total}${a.unit ? ' ' + a.unit : ''}`, done: a.done >= a.total });
      const open = a.done < a.total && Array.isArray(a.left) ? a.left : [];
      const shown = open.length > 3 ? open.slice(0, 2) : open;
      for (const c of shown) lines.push({ name: c.title, value: c.points ? `+${c.points}` : '', sub: true });
      if (open.length > shown.length) {
        const more = open.slice(shown.length).reduce((s, c) => s + (c.points || 0), 0);
        lines.push({ name: `${open.length - shown.length} more`, value: more ? `+${more}` : '', sub: true });
      }
    }
    setTip('tip-earned', "Today's progress", lines, lines.length ? '' : 'Loading today’s progress…');

    if (phase === 'cooldown') {
      const until = new Date(d.cooldownUntil || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      setNotice('warn', 'Waiting out Bing cooldown',
        `Bing stopped counting points for a while. Searching resumes by itself at ${until} (round ${d.cooldownCycles || 1} of ${MAX_COOLDOWNS}).`);
    } else if (phase === 'limitReached' && today) {
      setNotice('ok', 'Daily search points already earned',
        `Bing search today: ${today.progress}/${today.max} pts. More searches won't add points — come back tomorrow.`);
    } else if (phase === 'completed' && d.stoppedEarly && today) {
      setNotice('ok', 'Daily search limit reached',
        `Stopped after ${current} searches — Bing search today: ${today.progress}/${today.max} pts.`);
    } else if (phase === 'completed' && d.cooldownGaveUp) {
      setNotice('warn', 'Bing kept the cooldown on',
        `Points stayed paused after ${MAX_COOLDOWNS} waits, so the run ended early. Try again later today.`);
    } else if (d.warning && (running || phase === 'completed')) {
      setNotice('warn', 'Heads up', d.warning);
    } else {
      setNotice(null);
    }

    if (today && notice.hidden && !d.error) {
      const projected = inSearch && !live
        ? Math.min(today.max, (todayStart || today).progress + estimate)
        : today.progress;
      const maxed = projected >= today.max;
      daily.hidden = false;
      daily.classList.toggle('maxed', maxed);
      setOdometer(dailyValue, `${projected} / ${today.max} pts`);
      dailyFill.style.width = `${Math.round((projected / today.max) * 100)}%`;
      dailyHint.textContent = maxed
        ? 'Maxed for today — searches won’t earn more.'
        : `~${Math.ceil((today.max - projected) / POINTS_PER_SEARCH)} more searches to max today`;
    } else {
      daily.hidden = true;
    }
    diagText = JSON.stringify({ start: d.diag || null, limit: d.diagLimit || null }, null, 2);
    noticeCopy.hidden = notice.hidden || !(d.diag || d.diagLimit);

    if (d.error) showError(d.error);

    if (running) {
      pendingStartUntil = 0;
      countInput.disabled = true;
      if (phase === 'fetchingEndPoints') setAction('stop', 'Finishing…', true);
      else if (d.stopRequested) setAction('stop', 'Stopping…', true);
      else setAction('stop', 'Stop', false);
    } else if (Date.now() < pendingStartUntil) {
      setAction('stop', 'Starting…', true);
    } else {
      countInput.disabled = false;
      setAction('start', 'Start Searching', false);
    }
  }

  let pending = false;
  function refresh() {
    if (pending) return;
    pending = true;
    setTimeout(async () => {
      pending = false;
      try {
        render(await chrome.storage.local.get(KEYS));
      } catch (err) {
        console.warn('Render failed:', err.message);
      }
    }, 0);
  }

  const panel = $('settings');
  const openBtn = $('settings-open');

  function openSettings() {
    syncSettingsUI();
    syncReminderSwitch();
    body.classList.add('settings-open');
    panel.inert = false;
    main.inert = true;
    panel.classList.add('open');
    setTimeout(() => $('settings-back').focus(), 60);
  }

  function closeSettings() {
    panel.classList.remove('open');
    panel.inert = true;
    main.inert = false;
    body.classList.remove('settings-open');
    openBtn.focus();
    refresh();
  }

  openBtn.addEventListener('click', openSettings);
  $('settings-back').addEventListener('click', closeSettings);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel.classList.contains('open')) closeSettings();
  });

  function setSegment(id, value) {
    for (const b of $(id).querySelectorAll('button[data-value]')) {
      b.setAttribute('aria-checked', String(b.dataset.value === String(value)));
    }
  }

  function onSegment(id, handler) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button[data-value]');
      if (b) handler(b.dataset.value);
    });
  }

  function syncSettingsUI() {
    setSegment('set-theme', savedThemeMode());
    $('set-reduce').checked = !!settings.reduceMotion;
    setSegment('set-count-chips', settings.defaultCount);
    const isPreset = [10, 20, 30, 50].includes(Number(settings.defaultCount));
    const custom = $('set-count');
    if (document.activeElement !== custom) custom.value = isPreset ? '' : settings.defaultCount;
    custom.placeholder = 'Other';
    custom.classList.toggle('custom', !isPreset);
    setSegment('set-pace', settings.pace);
    $('set-autostop').checked = !!settings.autoStop;
    $('set-perday-value').textContent = String(settings.reminderPerDay);
    $('set-perday').querySelector('[data-step="-1"]').disabled = settings.reminderPerDay <= 1;
    $('set-perday').querySelector('[data-step="1"]').disabled = settings.reminderPerDay >= 5;
    if (document.activeElement !== $('set-from')) $('set-from').value = settings.reminderFrom;
    if (document.activeElement !== $('set-to')) $('set-to').value = settings.reminderTo;
    setSegment('set-gap', settings.reminderGapHours);
    setSegment('set-duration', settings.reminderSeconds);

    $('set-cooldown').checked = !!settings.cooldownAware;
    $('cooldown-opts').classList.toggle('off', !settings.cooldownAware);
    setSegment('set-cooldown-min', settings.cooldownMinutes);
  }

  onSegment('set-theme', mode => applyTheme(mode));

  $('set-reduce').addEventListener('change', e => {
    setReduceMotion(e.target.checked);
    saveSettings({ reduceMotion: e.target.checked });
  });

  function setDefaultCount(v) {
    const count = clampNum(v, 1, 150, settings.defaultCount);
    saveSettings({ defaultCount: count });
    if (!countInput.disabled) countInput.value = count;
    refresh();
  }

  onSegment('set-count-chips', v => setDefaultCount(v));
  $('set-count').addEventListener('change', e => {
    if (e.target.value !== '') setDefaultCount(e.target.value);
  });

  onSegment('set-pace', v => saveSettings({ pace: v }));
  $('set-autostop').addEventListener('change', e => saveSettings({ autoStop: e.target.checked }));

  $('set-perday').addEventListener('click', e => {
    const b = e.target.closest('button[data-step]');
    if (!b || b.disabled) return;
    const next = clampNum(settings.reminderPerDay + Number(b.dataset.step), 1, 5, 3);
    if (next === settings.reminderPerDay) return;
    saveSettings({ reminderPerDay: next });
    if (!motionOff()) restart($('set-perday-value'), 'bump');
  });

  const validTime = v => /^\d{2}:\d{2}$/.test(v);
  $('set-from').addEventListener('change', e => { if (validTime(e.target.value)) saveSettings({ reminderFrom: e.target.value }); });
  $('set-to').addEventListener('change', e => { if (validTime(e.target.value)) saveSettings({ reminderTo: e.target.value }); });
  $('set-cooldown').addEventListener('change', e => saveSettings({ cooldownAware: e.target.checked }));
  onSegment('set-cooldown-min', v => saveSettings({ cooldownMinutes: Number(v) }));
  onSegment('set-gap', v => saveSettings({ reminderGapHours: Number(v) }));
  onSegment('set-duration', v => saveSettings({ reminderSeconds: Number(v) }));

  const reminderSwitch = $('set-reminder');
  const reminderOpts = $('reminder-opts');

  function setReminderUI(on) {
    reminderSwitch.checked = on;
    reminderOpts.classList.toggle('off', !on);
  }

  async function syncReminderSwitch() {
    try {
      const { reminderEnabled } = await chrome.storage.local.get('reminderEnabled');
      setReminderUI(!!reminderEnabled && await chrome.permissions.contains(ALL_SITES));
    } catch {
      setReminderUI(false);
    }
  }

  async function enableReminders() {
    let granted = false;
    try { granted = await chrome.permissions.request(ALL_SITES); } catch {}
    if (!granted) {
      setReminderUI(false);
      showError('Reminders need permission to show a small card on websites. Turn them on again and choose Allow.');
      return false;
    }
    await chrome.storage.local.set({ reminderEnabled: true });
    setReminderUI(true);
    return true;
  }

  const previewBtn = $('set-preview');
  const previewMsg = $('set-preview-msg');
  const PREVIEW_LABEL = 'Show a preview on this tab';
  const PREVIEW_REASONS = {
    page: 'Open a normal website in this tab (not a new tab or edge:// page), then try again.',
    permission: 'Allow access when Edge asks — the card needs it to appear on websites.',
    rewards: "Couldn't load today's progress. Make sure you're signed in to rewards.bing.com.",
    blocked: "Couldn't open a Bing tab for the preview. Check your connection and try again.",
    error: 'Something went wrong showing the preview. Try again.'
  };

  function setPreviewMsg(text, warn) {
    previewMsg.textContent = text || '';
    previewMsg.classList.toggle('warn', !!warn);
    previewMsg.hidden = !text;
  }

  reminderSwitch.addEventListener('change', async () => {
    setPreviewMsg('');
    if (reminderSwitch.checked) {
      if (await enableReminders()) setPreviewMsg('Reminders are on. Tap “Show a preview” to see one.');
    } else {
      await chrome.storage.local.set({ reminderEnabled: false });
      setReminderUI(false);
    }
  });

  previewBtn.addEventListener('click', async () => {
    setPreviewMsg('');
    previewBtn.disabled = true;
    previewBtn.textContent = 'Showing preview…';
    let reason = 'error';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && /^https?:\/\//.test(tab.url || '') && !(await chrome.permissions.contains(ALL_SITES))) {
        await chrome.permissions.request(ALL_SITES).catch(() => false);
      }
      const res = await send('previewReminder', { tabId: tab ? tab.id : null });
      if (res && res.ok) {
        window.close();
        return;
      }
      reason = (res && res.reason) || 'error';
    } catch {
      reason = 'error';
    }
    previewBtn.disabled = false;
    previewBtn.textContent = PREVIEW_LABEL;
    setPreviewMsg(PREVIEW_REASONS[reason] || PREVIEW_REASONS.error, true);
  });

  const resetBtn = $('set-reset');
  let resetTimer = null;
  resetBtn.addEventListener('click', () => {
    if (!resetBtn.classList.contains('confirm')) {
      resetBtn.classList.add('confirm');
      resetBtn.textContent = 'Tap again to reset';
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        resetBtn.classList.remove('confirm');
        resetBtn.textContent = 'Reset to defaults';
      }, 3000);
      return;
    }
    clearTimeout(resetTimer);
    resetBtn.classList.remove('confirm');
    resetBtn.textContent = 'Reset to defaults';
    setReduceMotion(false);
    saveSettings(Object.assign({}, DEFAULTS));
    applyTheme('system');
    if (!countInput.disabled) countInput.value = DEFAULTS.defaultCount;
    refresh();
  });

  syncThemeControls();
  chrome.storage.local.set({ uiTheme: savedThemeMode() === 'system' ? null : savedThemeMode() });
  loadSettings();
  syncReminderSwitch();
  chrome.storage.local.get(['running', 'todayCheckedAt']).then(s => {
    if (!s.running && Date.now() - (s.todayCheckedAt || 0) > TODAY_REFRESH_MS) send('refreshToday');
  });

  refresh();
  chrome.storage.onChanged.addListener((_, area) => { if (area === 'local') refresh(); });
  const pollId = setInterval(refresh, 1000);
  window.addEventListener('pagehide', () => clearInterval(pollId));
});
