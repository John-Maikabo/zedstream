/* ZedStream — guests */
(function () {
  'use strict';
  var ZS = window.ZS;
  var filter = 'all';
  var search = '';

  function $(id) { return document.getElementById(id); }

  function rows() {
    return ZS.allGuests().filter(function (x) {
      var g = x.guest;
      if (filter === 'invited' && g.status === 'accepted') return false;
      if (filter === 'accepted' && g.status !== 'accepted') return false;
      if (search) {
        var hay = ((g.name || '') + ' ' + (g.email || '') + ' ' + (x.session.episodeTitle || '')).toLowerCase();
        if (hay.indexOf(search.toLowerCase()) === -1) return false;
      }
      return true;
    });
  }

  function stats() {
    var all = ZS.allGuests();
    var accepted = all.filter(function (x) { return x.guest.status === 'accepted'; }).length;
    var sessions = ZS.state().sessions.filter(function (s) { return (s.guests || []).length; }).length;
    var cards = [
      { label: 'Guests invited', value: all.length, icon: 'users', tone: '' },
      { label: 'Joined studio', value: accepted, icon: 'check', tone: 'green' },
      { label: 'Awaiting response', value: all.length - accepted, icon: 'mail', tone: 'amber' },
      { label: 'Sessions with guests', value: sessions, icon: 'calendar', tone: 'pink' }
    ];
    $('guestStats').innerHTML = cards.map(function (c) {
      return '<article class="stat"><div class="stat-top"><span class="stat-label">' + c.label + '</span>' +
        '<span class="stat-icon ' + c.tone + '">' + zIcon(c.icon) + '</span></div>' +
        '<div class="stat-value">' + c.value + '</div>' +
        '<div class="stat-foot">' + (c.value ? 'Updated from your sessions' : 'Nothing here yet') + '</div></article>';
    }).join('');
  }

  function render() {
    stats();
    var list = rows();
    var all = ZS.allGuests();
    $('guestCount').textContent = all.length + (all.length === 1 ? ' guest' : ' guests');

    var wrap = $('guestList');
    if (!all.length) {
      wrap.innerHTML = ZS.emptyState({
        icon: 'users',
        title: 'No guests invited yet',
        text: 'Add guests while scheduling a recording — each one gets a personal joining link.',
        action: { href: 'schedule.html', label: 'Schedule with guests', icon: 'calendarPlus' }
      });
      return;
    }

    if (!list.length) {
      wrap.innerHTML = ZS.emptyState({
        icon: 'search',
        title: 'No guests match this view',
        text: 'Try another filter or clear the search.',
        compact: true
      });
      return;
    }

    wrap.innerHTML = list.map(function (x) {
      var g = x.guest;
      var accepted = g.status === 'accepted';
      return '<div class="session-row" data-guest="' + ZS.esc(g.id) + '" data-session="' + ZS.esc(x.session.id) + '">' +
        '<span class="avatar">' + ZS.esc(ZS.initials(g.name || g.email)) + '</span>' +
        '<div class="session-main">' +
        '<h3>' + ZS.esc(g.name || 'Unnamed guest') + '</h3>' +
        '<div class="session-meta">' +
        '<span>' + zIcon('mail') + ZS.esc(g.email || 'No email') + '</span>' +
        '<span>' + zIcon('disc') + ZS.esc(x.session.episodeTitle || 'Episode') + '</span>' +
        '<span>' + zIcon('calendar') + ZS.esc(ZS.fmtDateLong(x.session.date, x.session.time)) + '</span>' +
        '</div></div>' +
        '<span class="badge ' + (accepted ? 'badge-green' : 'badge-amber') + '" style="margin-right:4px">' +
        (accepted ? 'Joined' : 'Invited') + '</span>' +
        '<div class="session-actions">' +
        '<button class="mini-btn" type="button" data-copy="1" title="Copy joining link" aria-label="Copy joining link">' + zIcon('link') + '</button>' +
        '<button class="mini-btn" type="button" data-wa="1" title="Send on WhatsApp" aria-label="Send on WhatsApp">' + zIcon('message') + '</button>' +
        '<button class="mini-btn" type="button" data-mail="1" title="Send by email" aria-label="Send by email">' + zIcon('mail') + '</button>' +
        '<button class="mini-btn danger" type="button" data-remove="1" title="Remove guest" aria-label="Remove guest">' + zIcon('trash') + '</button>' +
        '</div></div>';
    }).join('');
    if (window.zHydrateIcons) window.zHydrateIcons();
  }

  function findGuest(row) {
    var session = ZS.getSession(row.getAttribute('data-session'));
    if (!session) return null;
    var guest = (session.guests || []).filter(function (g) { return g.id === row.getAttribute('data-guest'); })[0];
    return guest ? { session: session, guest: guest } : null;
  }

  function message(session, guest) {
    var template = (session.invitation && session.invitation.message) ||
      'Hi {{name}},\n\nYou are invited to record "{{episode}}" on ZedStream.\n\nJoin here: {{link}}';
    return template
      .replace(/\{\{\s*name\s*\}\}/g, guest.name || 'there')
      .replace(/\{\{\s*episode\s*\}\}/g, session.episodeTitle || 'our episode')
      .replace(/\{\{\s*host\s*\}\}/g, session.host || ZS.displayName())
      .replace(/\{\{\s*link\s*\}\}/g, ZS.inviteUrl(session, guest));
  }

  function wire() {
    $('guestSearch').addEventListener('input', function () {
      search = this.value.trim();
      render();
    });
    $('guestFilters').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-filter]');
      if (!chip) return;
      filter = chip.getAttribute('data-filter');
      ZS.$$('#guestFilters .chip').forEach(function (c) { c.classList.toggle('active', c === chip); });
      render();
    });

    $('guestList').addEventListener('click', function (e) {
      var row = e.target.closest('[data-guest]');
      if (!row) return;
      var found = findGuest(row);
      if (!found) return;

      if (e.target.closest('[data-copy]')) {
        ZS.copyText(ZS.inviteUrl(found.session, found.guest), 'Joining link copied');
        return;
      }
      if (e.target.closest('[data-wa]')) {
        ZS.sendWhatsApp('', message(found.session, found.guest));
        return;
      }
      if (e.target.closest('[data-mail]')) {
        ZS.sendEmail(found.guest.email, 'Invitation: ' + (found.session.episodeTitle || 'Recording'), message(found.session, found.guest));
        return;
      }
      if (e.target.closest('[data-remove]')) {
        ZS.confirmDialog({
          title: 'Remove ' + (found.guest.name || 'this guest') + '?',
          message: 'Their joining link stops being valid for this session.',
          confirmText: 'Remove guest',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          ZS.update(function (s) {
            s.sessions.forEach(function (ses) {
              if (ses.id !== found.session.id) return;
              ses.guests = (ses.guests || []).filter(function (g) { return g.id !== found.guest.id; });
            });
            return s;
          });
          ZS.toast('Guest removed');
          render();
        });
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () { wire(); render(); });
  document.addEventListener('zs:change', render);
})();
