/* ZedStream — dashboard */
(function () {
  'use strict';
  var ZS = window.ZS;

  function statCard(icon, tone, label, value, foot) {
    return '<article class="stat">' +
      '<div class="stat-top"><span class="stat-label">' + label + '</span>' +
      '<span class="stat-icon ' + tone + '">' + zIcon(icon) + '</span></div>' +
      '<div class="stat-value">' + value + '</div>' +
      '<div class="stat-foot">' + foot + '</div></article>';
  }

  function renderStats(s) {
    var upcoming = ZS.upcomingSessions().length;
    var published = s.episodes.filter(function (e) { return e.status === 'published'; }).length;
    var recorded = s.episodes.filter(function (e) { return e.hasRecording; }).length;
    var pending = ZS.pendingInvites().length;

    document.getElementById('statGrid').innerHTML =
      statCard('disc', '', 'Podcasts', s.podcasts.length,
        s.podcasts.length ? 'Shows in your studio' : 'Create your first show') +
      statCard('calendar', 'pink', 'Upcoming sessions', upcoming,
        upcoming ? 'Next: ' + ZS.relTime(ZS.upcomingSessions(1)[0].date, ZS.upcomingSessions(1)[0].time) : 'Nothing scheduled yet') +
      statCard('video', 'green', 'Recordings', recorded,
        recorded ? 'Captured in this studio' : 'Record straight in the browser') +
      statCard('mail', 'amber', 'Pending invitations', pending,
        pending ? 'Waiting for guests to join' : 'All invitations handled');
  }

  function sessionRow(session) {
    var d = ZS.fmtDay(session.date);
    var guests = (session.guests || []).length;
    return '<div class="session-row" data-session="' + ZS.esc(session.id) + '">' +
      '<div class="date-chip"><small>' + d.month + '</small><strong>' + d.day + '</strong></div>' +
      '<div class="session-main">' +
      '<h3>' + ZS.esc(session.episodeTitle || 'Untitled episode') + '</h3>' +
      '<div class="session-meta">' +
      '<span>' + zIcon('clock') + ZS.esc(ZS.fmtTime(session.time) || 'Time TBC') + '</span>' +
      '<span>' + zIcon('disc') + ZS.esc(ZS.podcastName(session.podcastId, session.podcastName)) + '</span>' +
      '<span>' + zIcon('users') + guests + ' guest' + (guests === 1 ? '' : 's') + '</span>' +
      '</div></div>' +
      '<div class="session-actions">' +
      '<button class="mini-btn" type="button" data-copy-invite="' + ZS.esc(session.id) + '" title="Copy guest joining link" aria-label="Copy guest joining link">' + zIcon('link') + '</button>' +
      '<a class="mini-btn" href="schedule.html?id=' + encodeURIComponent(session.id) + '" title="Edit session" aria-label="Edit session">' + zIcon('edit') + '</a>' +
      '<a class="btn btn-sm btn-soft" href="studio.html?s=' + encodeURIComponent(session.id) + '">' + zIcon('radio') + 'Open</a>' +
      '</div></div>';
  }

  function renderUpcoming(s) {
    var wrap = document.getElementById('upcomingList');
    var upcoming = ZS.upcomingSessions(4);
    if (!upcoming.length) {
      wrap.innerHTML = ZS.emptyState({
        icon: 'calendarPlus',
        title: 'No sessions scheduled',
        text: 'Schedule a recording to lock in the date, invite your guests and get a joining link to share.',
        action: { href: 'schedule.html', label: 'Schedule a recording', icon: 'calendarPlus' }
      });
      return;
    }
    wrap.innerHTML = upcoming.map(sessionRow).join('');
  }

  function renderPending(s) {
    var wrap = document.getElementById('pendingList');
    var pending = ZS.pendingInvites();
    if (!pending.length) {
      wrap.innerHTML = ZS.emptyState({
        icon: 'check',
        title: 'No pending invitations',
        text: 'Guests you invite appear here until they join.',
        compact: true
      });
      return;
    }
    wrap.innerHTML = pending.slice(0, 4).map(function (x) {
      return '<div class="session-row" style="padding:9px 4px">' +
        '<span class="avatar" style="width:32px;height:32px">' + ZS.esc(ZS.initials(x.guest.name || x.guest.email)) + '</span>' +
        '<div class="session-main"><h3 style="font-size:12.5px">' + ZS.esc(x.guest.name || x.guest.email) + '</h3>' +
        '<div class="session-meta"><span>' + zIcon('disc') + ZS.esc(x.session.episodeTitle || 'Episode') + '</span></div></div>' +
        '<button class="mini-btn" type="button" data-copy-guest="' + ZS.esc(x.session.id) + ':' + ZS.esc(x.guest.id) +
        '" title="Copy joining link" aria-label="Copy joining link">' + zIcon('copy') + '</button></div>';
    }).join('');
  }

  function renderRecordings(s) {
    var wrap = document.getElementById('recordingsList');
    var recs = s.episodes.filter(function (e) { return e.hasRecording; }).slice(0, 3);
    if (!recs.length) {
      wrap.innerHTML = ZS.emptyState({
        icon: 'radio',
        title: 'No recordings yet',
        text: 'Open the studio and hit record — your capture lands here.',
        compact: true,
        action: { href: 'studio.html', label: 'Open studio', icon: 'radio' }
      });
      return;
    }
    wrap.innerHTML = recs.map(function (ep) {
      return '<div class="session-row" style="padding:9px 4px">' +
        '<span class="empty-orb" style="width:34px;height:34px;border-radius:10px;margin:0">' + zIcon('video') + '</span>' +
        '<div class="session-main"><h3 style="font-size:12.5px">' + ZS.esc(ep.title) + '</h3>' +
        '<div class="session-meta"><span>' + ZS.fmtDuration(ep.duration) + '</span>' +
        '<span>' + ZS.esc(ep.date ? ZS.fmtDateLong(ep.date) : '') + '</span></div></div>' +
        '<a class="mini-btn" href="library.html?view=recordings&play=' + encodeURIComponent(ep.id) +
        '" title="Play recording" aria-label="Play recording">' + zIcon('play') + '</a></div>';
    }).join('');
  }

  function renderRecent(s) {
    var wrap = document.getElementById('recentEpisodes');
    var eps = s.episodes.slice().sort(function (a, b) {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    }).slice(0, 4);

    if (!eps.length) {
      wrap.innerHTML = ZS.emptyState({
        icon: 'headphones',
        title: 'Your episode library is empty',
        text: 'Episodes appear here once you schedule a session or record in the studio.',
        action: { href: 'schedule.html', label: 'Plan your first episode', icon: 'calendarPlus' }
      });
      return;
    }

    wrap.innerHTML = eps.map(function (ep) {
      return '<article class="episode-card">' +
        ZS.thumbHtml(ep) +
        '<div class="episode-body">' +
        '<span class="episode-pod">' + ZS.esc(ep.podcastName || ZS.podcastName(ep.podcastId)) + '</span>' +
        '<h3>' + ZS.esc(ep.title) + '</h3>' +
        '<div class="episode-meta"><span>' + zIcon('calendar') + ZS.esc(ep.date ? ZS.fmtDateLong(ep.date) : 'Unscheduled') + '</span></div>' +
        '</div>' +
        '<div class="episode-foot"><span class="badge ' + (ep.status === 'published' ? 'badge-green' : 'badge-amber') + '">' +
        (ep.status === 'published' ? 'Published' : 'Draft') + '</span>' +
        '<a class="link-btn" href="library.html?view=episodes">Open <i data-i="arrowRight" data-cls="sm"></i></a></div>' +
        '</article>';
    }).join('');
  }

  function firstGuestLink(sessionId, guestId) {
    var session = ZS.getSession(sessionId);
    if (!session) return null;
    var guest = guestId
      ? (session.guests || []).filter(function (g) { return g.id === guestId; })[0]
      : (session.guests || [])[0];
    if (!guest) return null;
    return { session: session, guest: guest, url: ZS.inviteUrl(session, guest) };
  }

  function wire() {
    document.addEventListener('click', function (e) {
      var copyInvite = e.target.closest('[data-copy-invite]');
      if (copyInvite) {
        var first = firstGuestLink(copyInvite.getAttribute('data-copy-invite'));
        if (!first) {
          ZS.toast('Add a guest to this session before copying an invitation.', 'error');
          return;
        }
        ZS.copyText(first.url, 'Guest joining link copied');
      }

      var copyGuest = e.target.closest('[data-copy-guest]');
      if (copyGuest) {
        var bits = copyGuest.getAttribute('data-copy-guest').split(':');
        var target = firstGuestLink(bits[0], bits[1]);
        if (target) ZS.copyText(target.url, 'Joining link for ' + (target.guest.name || 'guest') + ' copied');
      }

      if (e.target.closest('[data-action="new-podcast"]')) {
        var s = ZS.state();
        var host = document.getElementById('podcastHost');
        if (host) host.value = s.settings.displayName || '';
        ZS.openModal('podcastModal');
      }

      var closer = e.target.closest('[data-close]');
      if (closer) ZS.closeModal(closer.getAttribute('data-close'));
    });

    var form = document.getElementById('podcastForm');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var nameField = document.getElementById('podcastName');
      var name = nameField.value.trim();
      var wrap = nameField.closest('.field');
      if (!name) {
        wrap.classList.add('invalid');
        nameField.focus();
        return;
      }
      wrap.classList.remove('invalid');
      var about = document.getElementById('podcastAbout').value.trim();
      var host = document.getElementById('podcastHost').value.trim();
      var podcast = {
        id: ZS.uid('pod'),
        name: name,
        description: about,
        host: host || ZS.displayName(),
        tone: ZS.tone(name),
        createdAt: new Date().toISOString()
      };
      var next = ZS.update(function (s) {
        s.podcasts.push(podcast);
        if (host && !s.settings.displayName) s.settings.displayName = host;
        return s;
      });
      form.reset();
      ZS.closeModal('podcastModal');
      ZS.toast('Podcast "' + name + '" created', 'success');
      render(next);
      var hero = document.querySelector('[data-host-name]');
      if (hero) hero.textContent = ZS.displayName();
    });

    document.getElementById('podcastName').addEventListener('input', function () {
      this.closest('.field').classList.remove('invalid');
    });
  }

  function render(s) {
    s = s || ZS.state();
    document.querySelectorAll('[data-host-name]').forEach(function (el) {
      el.textContent = ZS.displayName();
    });
    renderStats(s);
    renderUpcoming(s);
    renderPending(s);
    renderRecordings(s);
    renderRecent(s);
    if (window.zHydrateIcons) window.zHydrateIcons();
  }

  document.addEventListener('DOMContentLoaded', function () {
    render();
    wire();
  });
  document.addEventListener('zs:change', function () { render(); });
})();
