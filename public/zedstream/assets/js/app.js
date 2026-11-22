/* ============================================================
   ZedStream — shared shell, local data store, UI primitives
   No backend calls: the studio, scheduling and invitations run
   entirely on the device.
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'zedstream.v1';

  var DEFAULTS = {
    podcasts: [],
    sessions: [],
    episodes: [],
    settings: {
      displayName: '',
      studioName: '',
      defaultDuration: 45,
      quality: '1080',
      background: 'none'
    }
  };

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function norm(raw) {
    var s = raw && typeof raw === 'object' ? raw : {};
    return {
      podcasts: Array.isArray(s.podcasts) ? s.podcasts : [],
      sessions: Array.isArray(s.sessions) ? s.sessions : [],
      episodes: Array.isArray(s.episodes) ? s.episodes : [],
      settings: Object.assign(clone(DEFAULTS.settings), s.settings || {})
    };
  }

  function state() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return norm(null);
      return norm(JSON.parse(raw));
    } catch (e) {
      return norm(null);
    }
  }

  function commit(next) {
    var value = norm(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch (e) {
      toast('Storage is full — could not save.', 'error');
    }
    document.dispatchEvent(new CustomEvent('zs:change'));
    return value;
  }

  function update(fn) {
    var s = state();
    var result = fn(s) || s;
    return commit(result);
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'ZS';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  function displayName() {
    var s = state().settings;
    return s.displayName || 'Studio host';
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function parseDate(dateStr, timeStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr + 'T' + (timeStr || '00:00') + ':00');
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtDay(dateStr) {
    var d = parseDate(dateStr, '12:00');
    if (!d) return { day: '--', month: '---' };
    return { day: pad(d.getDate()), month: d.toLocaleString(undefined, { month: 'short' }).toUpperCase() };
  }

  function fmtDateLong(dateStr, timeStr) {
    var d = parseDate(dateStr, timeStr);
    if (!d) return 'Date to be decided';
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) +
      (timeStr ? ' · ' + fmtTime(timeStr) : '');
  }

  function fmtTime(timeStr) {
    if (!timeStr) return '';
    var bits = timeStr.split(':');
    var h = parseInt(bits[0], 10), m = bits[1] || '00';
    var suffix = h >= 12 ? 'PM' : 'AM';
    var hh = h % 12 === 0 ? 12 : h % 12;
    return hh + ':' + m + ' ' + suffix;
  }

  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }

  function fmtDurationLong(min) {
    min = Math.round(min || 0);
    if (!min) return '—';
    var h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + ' min';
    return h + ' hr' + (h > 1 ? 's' : '') + (m ? ' ' + m + ' min' : '');
  }

  function fmtBytes(bytes) {
    if (!bytes) return '';
    var mb = bytes / (1024 * 1024);
    return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb.toFixed(1) + ' MB';
  }

  function relTime(dateStr, timeStr) {
    var d = parseDate(dateStr, timeStr);
    if (!d) return '';
    var diff = d.getTime() - Date.now();
    var days = Math.round(diff / 86400000);
    if (diff < 0) return 'Started ' + Math.abs(days) + ' day' + (Math.abs(days) === 1 ? '' : 's') + ' ago';
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 7) return 'In ' + days + ' days';
    return fmtDateLong(dateStr, timeStr);
  }

  var TONES = ['violet', 'pink', 'ocean', 'amber', 'mint', 'slate'];
  function tone(id) {
    var sum = 0;
    String(id || '').split('').forEach(function (c) { sum += c.charCodeAt(0); });
    return TONES[sum % TONES.length];
  }

  function getPodcast(id) {
    return state().podcasts.filter(function (p) { return p.id === id; })[0] || null;
  }

  function podcastName(id, fallback) {
    var p = getPodcast(id);
    return p ? p.name : (fallback || 'Independent');
  }

  function getSession(id) {
    return state().sessions.filter(function (s) { return s.id === id; })[0] || null;
  }

  function upcomingSessions(limit) {
    var now = Date.now() - 3600000;
    var list = state().sessions.filter(function (s) {
      var d = parseDate(s.date, s.time);
      return s.status !== 'completed' && d && d.getTime() >= now;
    }).sort(function (a, b) {
      return (parseDate(a.date, a.time) || 0) - (parseDate(b.date, b.time) || 0);
    });
    return limit ? list.slice(0, limit) : list;
  }

  function allGuests() {
    var out = [];
    state().sessions.forEach(function (s) {
      (s.guests || []).forEach(function (g) { out.push({ guest: g, session: s }); });
    });
    return out;
  }

  function pendingInvites() {
    return allGuests().filter(function (x) { return x.guest.status !== 'accepted'; });
  }

  function baseUrl() {
    var path = location.pathname.replace(/[^/]*$/, '');
    return location.origin + path;
  }

  function inviteUrl(session, guest) {
    return baseUrl() + 'studio.html?invite=' + encodeURIComponent(guest.token) +
      '&s=' + encodeURIComponent(session.id) + '&g=' + encodeURIComponent(guest.id);
  }

  function inviteMessage(session, guest) {
    var name = guest && guest.name ? guest.name : 'there';
    var when = session.date ? fmtDateLong(session.date, session.time) : 'soon';
    return 'Hi ' + name + ', you are invited to "' + (session.episodeTitle || 'our podcast episode') +
      '" on ZedStream.\n\nWhen: ' + when + '\nJoin studio: ' + inviteUrl(session, guest);
  }

  /* ---------- recording blobs (IndexedDB) ---------- */
  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
      var req = indexedDB.open('zedstream-media', 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings');
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(mode, run) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction('recordings', mode);
        var store = transaction.objectStore('recordings');
        var request = run(store);
        transaction.oncomplete = function () { resolve(request ? request.result : true); };
        transaction.onerror = function () { reject(transaction.error); };
      });
    });
  }

  var rec = {
    put: function (id, blob) { return tx('readwrite', function (s) { return s.put(blob, id); }); },
    get: function (id) { return tx('readonly', function (s) { return s.get(id); }); },
    del: function (id) { return tx('readwrite', function (s) { return s.delete(id); }); }
  };

  /* ---------- toasts ---------- */
  function toastStack() {
    var stack = $('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(message, type) {
    var stack = toastStack();
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    var icon = type === 'success' ? 'check' : type === 'error' ? 'x' : 'sparkles';
    el.innerHTML = (window.zIcon ? window.zIcon(icon) : '') + '<span>' + esc(message) + '</span>';
    stack.appendChild(el);
    setTimeout(function () {
      el.classList.add('leaving');
      setTimeout(function () { el.remove(); }, 260);
    }, 3200);
  }

  /* ---------- clipboard ---------- */
  function copyText(text, message) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    }
    function done(ok) {
      if (ok) toast(message || 'Copied to clipboard', 'success');
      else toast('Copy failed — select the link and copy manually.', 'error');
    }
    if (navigator.clipboard && window.isSecureContext !== false) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback()); });
    } else {
      done(fallback());
    }
  }

  /* ---------- sharing (uses the device's own apps) ---------- */
  function sendWhatsApp(phone, text) {
    var number = String(phone || '').replace(/[^\d]/g, '');
    var url = number ? 'https://wa.me/' + number + '?text=' + encodeURIComponent(text)
      : 'https://wa.me/?text=' + encodeURIComponent(text);
    window.open(url, '_blank', 'noopener');
  }

  function sendEmail(email, subject, body) {
    window.location.href = 'mailto:' + encodeURIComponent(email || '') +
      '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  /* ---------- modal stack ---------- */
  function ensureOverlay(id) {
    var el = document.getElementById(id);
    if (el) return el;
    el = document.createElement('div');
    el.id = id;
    el.className = 'overlay';
    el.innerHTML = '<div class="modal" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(el);
    el.addEventListener('mousedown', function (e) { if (e.target === el) closeModal(id); });
    return el;
  }

  function openModal(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    var focusable = el.querySelector('input:not([type=hidden]), select, textarea, button');
    if (focusable) setTimeout(function () { focusable.focus(); }, 120);
  }

  function closeModal(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    if (!$$('.overlay.open').length) document.body.style.overflow = '';
  }

  function confirmDialog(opts) {
    opts = opts || {};
    var el = ensureOverlay('zsConfirm');
    var box = el.firstElementChild;
    box.innerHTML =
      '<div class="modal-head"><div><h2>' + esc(opts.title || 'Are you sure?') + '</h2>' +
      (opts.message ? '<p>' + esc(opts.message) + '</p>' : '') + '</div>' +
      '<button class="icon-btn" type="button" data-confirm-cancel aria-label="Close">' + (window.zIcon ? window.zIcon('x') : '') + '</button></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" type="button" data-confirm-cancel>Cancel</button>' +
      '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" type="button" data-confirm-ok>' +
      esc(opts.confirmText || 'Confirm') + '</button></div>';

    return new Promise(function (resolve) {
      function finish(value) {
        closeModal('zsConfirm');
        el.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey);
        resolve(value);
      }
      function onClick(e) {
        if (e.target.closest('[data-confirm-ok]')) finish(true);
        else if (e.target.closest('[data-confirm-cancel]')) finish(false);
      }
      function onKey(e) { if (e.key === 'Escape') finish(false); }
      el.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey);
      openModal('zsConfirm');
    });
  }

  /* ---------- shell ---------- */
  var NAV = [
    {
      label: 'Workspace',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: 'grid', href: 'index.html' },
        { id: 'podcasts', label: 'My Podcasts', icon: 'disc', href: 'podcasts.html' },
        { id: 'schedule', label: 'Schedule', icon: 'calendarPlus', href: 'schedule.html' },
        { id: 'studio', label: 'Recording Studio', icon: 'radio', href: 'studio.html' }
      ]
    },
    {
      label: 'Library',
      items: [
        { id: 'recordings', label: 'Recordings', icon: 'video', href: 'library.html?view=recordings' },
        { id: 'episodes', label: 'Episodes', icon: 'headphones', href: 'library.html?view=episodes', count: 'episodes' },
        { id: 'guests', label: 'Guests', icon: 'users', href: 'guests.html' }
      ]
    }
  ];

  var TITLES = {
    dashboard: 'Dashboard',
    podcasts: 'My Podcasts',
    schedule: 'Schedule',
    studio: 'Recording Studio',
    recordings: 'Recordings',
    episodes: 'Episodes',
    guests: 'Guests',
    settings: 'Settings'
  };

  function navCount(kind, s) {
    if (kind === 'episodes') return s.episodes.length;
    return 0;
  }

  function renderShell() {
    var body = document.body;
    var page = body.getAttribute('data-page') || '';
    var studio = body.classList.contains('studio-body');
    var s = state();
    var sidebar = document.getElementById('sidebar');
    var topbar = document.getElementById('topbar');
    var view = new URLSearchParams(location.search).get('view');
    var navId = page === 'library' ? (view === 'recordings' ? 'recordings' : 'episodes') : page;

    if (sidebar) {
      var html = '<a class="brand" href="index.html">' +
        '<span class="brand-mark">' + window.zIcon('wave') + '</span>' +
        '<span class="brand-text"><span class="brand-name">Zed<span>Stream</span></span>' +
        '<span class="brand-sub">Podcast Studio</span></span></a>' +
        '<div class="nav-scroll">';

      NAV.forEach(function (group) {
        html += '<div class="nav"><div class="nav-group-label">' + group.label + '</div>';
        group.items.forEach(function (item) {
          var active = item.id === navId;
          var count = item.count ? navCount(item.count, s) : 0;
          html += '<a class="nav-item' + (active ? ' active' : '') + '" href="' + item.href + '"' +
            (active ? ' aria-current="page"' : '') + '>' +
            window.zIcon(item.icon) + '<span>' + item.label + '</span>' +
            (count ? '<span class="nav-count">' + count + '</span>' : '') + '</a>';
        });
        html += '</div>';
      });

      html += '</div><div class="sidebar-foot">' +
        '<a class="nav-item' + (page === 'settings' ? ' active' : '') + '" href="settings.html">' +
        window.zIcon('settings') + '<span>Settings</span></a>' +
        '<a class="sidebar-user" href="settings.html">' +
        '<span class="avatar">' + esc(initials(displayName())) + '</span>' +
        '<span class="sidebar-user-meta"><strong>' + esc(displayName()) + '</strong>' +
        '<small>' + esc(s.settings.studioName || 'ZedStream Studio') + '</small></span></a>' +
        '</div>';

      sidebar.innerHTML = html;
    }

    if (topbar) {
      var pending = pendingInvites().length;
      topbar.innerHTML =
        '<button class="icon-btn menu-toggle" type="button" data-nav-toggle aria-label="Open navigation">' + window.zIcon('menu') + '</button>' +
        '<div class="crumbs"><span>ZedStream</span>' + window.zIcon('chevronRight') +
        '<strong class="crumb-page">' + esc(TITLES[page] || 'Studio') + '</strong></div>' +
        (studio ? '' : '<form class="topbar-search" role="search">' + window.zIcon('search') +
          '<input type="search" id="globalSearch" placeholder="Search episodes, guests…" aria-label="Search" autocomplete="off">' +
          '<kbd>↵</kbd></form>') +
        '<div style="position:relative">' +
        '<button class="icon-btn" type="button" id="notifBtn" aria-label="Notifications">' + window.zIcon('bell') +
        (pending ? '<span class="dot"></span>' : '') + '</button>' +
        '<div class="dropdown" id="notifMenu"><div class="dropdown-head">Pending invitations' +
        (pending ? '<span class="badge badge-violet">' + pending + '</span>' : '') + '</div>' +
        '<div class="dropdown-list">' + notifHtml() + '</div></div></div>' +
        '<a class="icon-btn" href="studio.html" title="Open recording studio" aria-label="Recording studio">' + window.zIcon('radio') + '</a>' +
        '<a class="sidebar-user" href="settings.html" style="padding:4px 10px 4px 4px" aria-label="Your profile">' +
        '<span class="avatar">' + esc(initials(displayName())) + '</span>' +
        '<span class="sidebar-user-meta"><strong>' + esc(displayName()) + '</strong>' +
        '<small>Host</small></span></a>';

      var notifBtn = document.getElementById('notifBtn');
      var notifMenu = document.getElementById('notifMenu');
      if (notifBtn && notifMenu) {
        notifBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          notifMenu.classList.toggle('open');
        });
        document.addEventListener('click', function (e) {
          if (!notifMenu.contains(e.target) && e.target !== notifBtn) notifMenu.classList.remove('open');
        });
      }

      var search = document.getElementById('globalSearch');
      if (search) {
        search.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            var q = search.value.trim();
            location.href = 'library.html' + (q ? '?q=' + encodeURIComponent(q) : '');
          }
        });
      }
    }

    if (!document.querySelector('[data-nav-toggle-binding]')) {
      document.addEventListener('click', function (e) {
        var toggle = e.target.closest('[data-nav-toggle]');
        if (toggle) { document.body.classList.toggle('nav-open'); }
        var scrim = e.target.closest('[data-nav-close]');
        if (scrim) { document.body.classList.remove('nav-open'); }
        var navLink = e.target.closest('.nav-item');
        if (navLink) { document.body.classList.remove('nav-open'); }
      });
      document.body.setAttribute('data-nav-toggle-binding', '1');
    }
  }

  function notifHtml() {
    var pending = pendingInvites();
    if (!pending.length) {
      return '<div class="dropdown-item" style="color:var(--faint)">' + window.zIcon('check', 'sm') +
        '<span>No pending invitations.</span></div>';
    }
    return pending.slice(0, 6).map(function (x) {
      return '<a class="dropdown-item" href="guests.html">' + window.zIcon('mail', 'sm') +
        '<span style="min-width:0"><strong style="display:block;font-size:12px;font-weight:500">' + esc(x.guest.name || x.guest.email) + '</strong>' +
        '<small style="color:var(--faint)">' + esc(x.session.episodeTitle || 'Episode') + '</small></span></a>';
    }).join('');
  }

  /* ---------- render helpers ---------- */
  function emptyState(opts) {
    return '<div class="empty ' + (opts.compact ? 'compact' : '') + '">' +
      '<span class="empty-orb">' + window.zIcon(opts.icon || 'sparkles') + '</span>' +
      '<h3>' + esc(opts.title || 'Nothing here yet') + '</h3>' +
      (opts.text ? '<p>' + esc(opts.text) + '</p>' : '') +
      (opts.action ? '<a class="btn btn-soft btn-sm" href="' + opts.action.href + '">' +
        window.zIcon(opts.action.icon || 'plus') + esc(opts.action.label) + '</a>' : '') +
      '</div>';
  }

  function thumbHtml(ep) {
    var bars = '';
    var seed = String(ep.id || 'x').split('').reduce(function (a, c) { return a + c.charCodeAt(0); }, 0);
    for (var i = 0; i < 14; i++) {
      var h = 18 + Math.abs(Math.sin(seed + i * 1.7)) * 78;
      bars += '<i style="height:' + h.toFixed(0) + '%"></i>';
    }
    return '<div class="thumb" data-tone="' + (ep.tone || tone(ep.id)) + '">' +
      '<div class="thumb-wave">' + bars + '</div>' +
      '<div class="thumb-top"><span class="badge">' + window.zIcon('disc') + 'Episode</span>' +
      '<span class="badge ' + (ep.status === 'published' ? 'badge-green' : 'badge-amber') + '">' +
      (ep.status === 'published' ? 'Published' : 'Draft') + '</span></div>' +
      (ep.duration ? '<span class="thumb-dur">' + fmtDuration(ep.duration) + '</span>' : '') +
      '</div>';
  }

  function wireNavScrim() {
    if (document.querySelector('.nav-scrim')) return;
    var scrim = document.createElement('div');
    scrim.className = 'nav-scrim';
    scrim.setAttribute('data-nav-close', '');
    document.body.appendChild(scrim);
  }

  function init() {
    if (document.getElementById('sidebar')) wireNavScrim();
    $$('.overlay').forEach(function (el) {
      if (el.getAttribute('aria-hidden') === null) el.setAttribute('aria-hidden', 'true');
    });
    renderShell();
    if (window.zHydrateIcons) window.zHydrateIcons();
  }

  document.addEventListener('zs:change', function () {
    if (!document.body.classList.contains('studio-body')) renderShell();
    if (window.zHydrateIcons) window.zHydrateIcons();
  });

  window.ZS = {
    KEY: KEY,
    state: state,
    update: update,
    save: function (s) { return commit(s); },
    reset: function () { return commit(clone(DEFAULTS)); },
    uid: uid,
    $: $,
    $$: $$,
    esc: esc,
    initials: initials,
    displayName: displayName,
    fmtDateLong: fmtDateLong,
    fmtTime: fmtTime,
    fmtDuration: fmtDuration,
    fmtDurationLong: fmtDurationLong,
    fmtBytes: fmtBytes,
    fmtDay: fmtDay,
    relTime: relTime,
    parseDate: parseDate,
    tone: tone,
    getPodcast: getPodcast,
    podcastName: podcastName,
    getSession: getSession,
    upcomingSessions: upcomingSessions,
    allGuests: allGuests,
    pendingInvites: pendingInvites,
    inviteUrl: inviteUrl,
    inviteMessage: inviteMessage,
    baseUrl: baseUrl,
    rec: rec,
    toast: toast,
    copyText: copyText,
    sendWhatsApp: sendWhatsApp,
    sendEmail: sendEmail,
    openModal: openModal,
    closeModal: closeModal,
    confirmDialog: confirmDialog,
    emptyState: emptyState,
    thumbHtml: thumbHtml,
    renderShell: renderShell,
    hydrate: function () { if (window.zHydrateIcons) window.zHydrateIcons(); }
  };

  window.zConfirm = confirmDialog;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
