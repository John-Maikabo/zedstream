/* ZedStream — schedule a recording */
(function () {
  'use strict';
  var ZS = window.ZS;
  var editingId = null;
  var guestSeq = 0;

  var DEFAULT_MESSAGE = 'Hi {{name}},\n\nYou are invited to record "{{episode}}" with {{host}} on ZedStream.\n\nOpen your studio room here:\n{{link}}\n\nNothing to install — camera and microphone run in the browser.';

  function $(id) { return document.getElementById(id); }

  function fieldWrap(input) { return input.closest('.field'); }

  function guestRow(guest) {
    guestSeq += 1;
    var row = document.createElement('div');
    row.className = 'guest-row';
    row.innerHTML =
      '<input class="input" data-guest-name maxlength="70" placeholder="Guest name" aria-label="Guest name" value="' + ZS.esc(guest.name || '') + '">' +
      '<input class="input guest-email" data-guest-email type="email" maxlength="120" placeholder="email@example.com" aria-label="Guest email" value="' + ZS.esc(guest.email || '') + '">' +
      '<button class="mini-btn danger" type="button" data-remove-guest aria-label="Remove guest">' + zIcon('trash') + '</button>';
    row.dataset.guestId = guest.id || ZS.uid('g');
    row.dataset.token = guest.token || ZS.uid('t') + Math.random().toString(36).slice(2, 8);
    row.dataset.status = guest.status || 'invited';
    return row;
  }

  function addGuest(guest, focus) {
    var list = $('guestList');
    var row = guestRow(guest || {});
    list.appendChild(row);
    if (focus) row.querySelector('[data-guest-name]').focus();
    updateSummary();
  }

  function readGuests() {
    return ZS.$$('#guestList .guest-row').map(function (row) {
      return {
        id: row.dataset.guestId,
        token: row.dataset.token,
        status: row.dataset.status || 'invited',
        name: row.querySelector('[data-guest-name]').value.trim(),
        email: row.querySelector('[data-guest-email]').value.trim()
      };
    }).filter(function (g) { return g.name || g.email; });
  }

  function renderPodcastOptions(selected) {
    var select = $('podcastSelect');
    var s = ZS.state();
    if (!s.podcasts.length) {
      select.innerHTML = '<option value="">No podcasts yet — create one first</option>';
      return;
    }
    select.innerHTML = '<option value="">Choose a podcast</option>' + s.podcasts.map(function (p) {
      return '<option value="' + ZS.esc(p.id) + '"' + (p.id === selected ? ' selected' : '') + '>' + ZS.esc(p.name) + '</option>';
    }).join('');
  }

  function setDefaultMessage() {
    var host = $('hostName').value.trim() || ZS.displayName();
    $('inviteMessage').value = DEFAULT_MESSAGE.replace('{{host}}', host);
  }

  function updateSummary() {
    var title = $('episodeTitle').value.trim();
    var podcastId = $('podcastSelect').value;
    var guests = readGuests();
    $('summaryTitle').textContent = title || 'Untitled episode';
    $('summaryPodcast').textContent = podcastId ? ZS.podcastName(podcastId) : 'No podcast selected';
    $('summaryDate').textContent = $('sessionDate').value ? ZS.fmtDateLong($('sessionDate').value) : 'Not set';
    $('summaryTime').textContent = $('sessionTime').value ? ZS.fmtTime($('sessionTime').value) : 'Not set';
    var minutes = parseInt($('sessionDuration').value, 10) || 45;
    $('summaryDuration').textContent = ZS.fmtDurationLong(minutes);
    $('summaryGuests').textContent = guests.length + (guests.length === 1 ? ' guest' : ' guests');
    $('summaryStatus').textContent = editingId ? 'Editing session' : 'Draft session';
  }

  function renderRecent() {
    var wrap = $('recentScheduled');
    var list = ZS.state().sessions.slice().sort(function (a, b) {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    }).slice(0, 3);

    if (!list.length) {
      wrap.innerHTML = ZS.emptyState({
        icon: 'calendar',
        title: 'Nothing scheduled yet',
        text: 'Your saved sessions show up here with a shortcut to their guest links.',
        compact: true
      });
      return;
    }

    wrap.innerHTML = list.map(function (session) {
      var d = ZS.fmtDay(session.date);
      return '<div class="session-row" style="padding:8px 4px">' +
        '<div class="date-chip"><small>' + d.month + '</small><strong>' + d.day + '</strong></div>' +
        '<div class="session-main"><h3 style="font-size:12.5px">' + ZS.esc(session.episodeTitle) + '</h3>' +
        '<div class="session-meta"><span>' + zIcon('clock') + ZS.esc(ZS.fmtTime(session.time)) + '</span></div></div>' +
        '<a class="mini-btn" href="schedule.html?id=' + encodeURIComponent(session.id) + '" title="Edit" aria-label="Edit session">' + zIcon('edit') + '</a>' +
        '</div>';
    }).join('');
  }

  function resetForm() {
    editingId = null;
    $('scheduleForm').reset();
    $('guestList').innerHTML = '';
    $('saveSessionLabel').textContent = 'Schedule session';
    $('scheduleTitle').textContent = 'Schedule a recording';
    $('sendNow').checked = true;
    var s = ZS.state();
    renderPodcastOptions(s.podcasts.length === 1 ? s.podcasts[0].id : '');
    $('hostName').value = s.settings.displayName || '';
    setDefaultMessage();
    ZS.$$('.field').forEach(function (f) { f.classList.remove('invalid'); });
    updateSummary();
    history.replaceState(null, '', 'schedule.html');
  }

  function fillForm(session) {
    editingId = session.id;
    renderPodcastOptions(session.podcastId);
    $('hostName').value = session.host || ZS.displayName();
    $('episodeTitle').value = session.episodeTitle || '';
    $('episodeSummary').value = session.summary || '';
    $('sessionDate').value = session.date || '';
    $('sessionTime').value = session.time || '';
    $('sessionDuration').value = String(session.duration || 45);
    var prefs = session.prefs || {};
    $('recordQuality').value = prefs.quality || '1080';
    $('recordBackground').value = prefs.background || 'none';
    $('recordFormat').value = prefs.format || 'video';
    $('inviteMessage').value = (session.invitation && session.invitation.message) || DEFAULT_MESSAGE;
    $('sendNow').checked = !session.invitation || session.invitation.showControls !== false;
    $('guestList').innerHTML = '';
    (session.guests || []).forEach(function (g) { addGuest(g); });
    $('saveSessionLabel').textContent = 'Save changes';
    $('scheduleTitle').textContent = 'Edit scheduled session';
    updateSummary();
  }

  function messageFor(session, guest) {
    var template = (session.invitation && session.invitation.message) || DEFAULT_MESSAGE;
    return template
      .replace(/\{\{\s*name\s*\}\}/g, guest.name || 'there')
      .replace(/\{\{\s*episode\s*\}\}/g, session.episodeTitle || 'our episode')
      .replace(/\{\{\s*host\s*\}\}/g, session.host || ZS.displayName())
      .replace(/\{\{\s*link\s*\}\}/g, ZS.inviteUrl(session, guest));
  }

  function openInviteModal(session) {
    var body = $('inviteModalBody');
    $('inviteModalSub').textContent = session.episodeTitle + ' · ' + ZS.fmtDateLong(session.date, session.time);
    $('inviteStudioLink').href = 'studio.html?s=' + encodeURIComponent(session.id);

    var guests = session.guests || [];
    if (!guests.length) {
      body.innerHTML = ZS.emptyState({
        icon: 'users',
        title: 'No guests added yet',
        text: 'Add guests to this session to generate personal joining links.',
        action: { href: 'schedule.html?id=' + encodeURIComponent(session.id), label: 'Add guests', icon: 'userPlus' }
      });
    } else {
      body.innerHTML = guests.map(function (g) {
        var link = ZS.inviteUrl(session, g);
        return '<div class="card card-pad" style="display:flex;flex-direction:column;gap:10px" data-invite-row="' + ZS.esc(g.id) + '">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
          '<span class="avatar">' + ZS.esc(ZS.initials(g.name || g.email)) + '</span>' +
          '<div style="min-width:0;flex:1"><strong style="font-size:13px;display:block">' + ZS.esc(g.name || 'Guest') + '</strong>' +
          '<small class="muted" style="font-size:11px">' + ZS.esc(g.email || 'No email added') + '</small></div>' +
          '<span class="badge badge-amber">Invited</span></div>' +
          '<div class="invite-link"><code>' + ZS.esc(link) + '</code>' +
          '<button class="btn btn-sm btn-soft" type="button" data-copy-link="' + ZS.esc(g.id) + '">' + zIcon('copy') + 'Copy</button></div>' +
          '<div style="display:flex;gap:7px;flex-wrap:wrap">' +
          '<button class="btn btn-sm btn-ghost" type="button" data-send-wa="' + ZS.esc(g.id) + '">' + zIcon('message') + 'WhatsApp</button>' +
          '<button class="btn btn-sm btn-ghost" type="button" data-send-mail="' + ZS.esc(g.id) + '">' + zIcon('mail') + 'Email</button>' +
          '</div></div>';
      }).join('');
    }

    body._session = session;
    ZS.hydrate();
    ZS.openModal('inviteModal');
  }

  function wireInviteModal() {
    var body = $('inviteModalBody');
    body.addEventListener('click', function (e) {
      var session = body._session;
      if (!session) return;
      var copy = e.target.closest('[data-copy-link]');
      if (copy) {
        var g1 = session.guests.filter(function (g) { return g.id === copy.getAttribute('data-copy-link'); })[0];
        if (g1) ZS.copyText(ZS.inviteUrl(session, g1), 'Joining link copied');
        return;
      }
      var wa = e.target.closest('[data-send-wa]');
      if (wa) {
        var g2 = session.guests.filter(function (g) { return g.id === wa.getAttribute('data-send-wa'); })[0];
        if (g2) ZS.sendWhatsApp('', messageFor(session, g2));
        return;
      }
      var mail = e.target.closest('[data-send-mail]');
      if (mail) {
        var g3 = session.guests.filter(function (g) { return g.id === mail.getAttribute('data-send-mail'); })[0];
        if (g3) ZS.sendEmail(g3.email, 'Invitation: ' + session.episodeTitle, messageFor(session, g3));
      }
    });
  }

  function collect() {
    var guests = readGuests();
    return {
      podcastId: $('podcastSelect').value,
      host: $('hostName').value.trim() || ZS.displayName(),
      episodeTitle: $('episodeTitle').value.trim(),
      summary: $('episodeSummary').value.trim(),
      date: $('sessionDate').value,
      time: $('sessionTime').value,
      duration: parseInt($('sessionDuration').value, 10) || 45,
      guests: guests,
      prefs: {
        quality: $('recordQuality').value,
        background: $('recordBackground').value,
        format: $('recordFormat').value
      },
      invitation: {
        message: $('inviteMessage').value.trim() || DEFAULT_MESSAGE,
        showControls: $('sendNow').checked
      }
    };
  }

  function validate(data) {
    var ok = true;
    function check(input, condition) {
      var wrap = fieldWrap(input);
      if (condition) wrap.classList.remove('invalid');
      else { wrap.classList.add('invalid'); if (ok) input.focus(); ok = false; }
    }
    check($('podcastSelect'), !!data.podcastId);
    check($('episodeTitle'), !!data.episodeTitle);
    check($('sessionDate'), !!data.date);
    check($('sessionTime'), !!data.time);
    return ok;
  }

  function save(e) {
    e.preventDefault();
    var data = collect();
    if (!validate(data)) {
      ZS.toast('Check the highlighted fields before saving.', 'error');
      return;
    }

    var session;
    var next = ZS.update(function (s) {
      var idx = editingId ? s.sessions.findIndex(function (x) { return x.id === editingId; }) : -1;
      if (idx >= 0) {
        session = Object.assign({}, s.sessions[idx], data, {
          id: editingId,
          updatedAt: new Date().toISOString(),
          status: s.sessions[idx].status || 'scheduled'
        });
        s.sessions[idx] = session;
      } else {
        session = Object.assign({ id: ZS.uid('ses'), createdAt: new Date().toISOString(), status: 'scheduled' }, data);
        s.sessions.push(session);
      }

      // keep a matching planned episode in the library
      var existing = s.episodes.filter(function (ep) { return ep.sessionId === session.id; })[0];
      var episodeData = {
        title: session.episodeTitle,
        podcastId: session.podcastId,
        podcastName: ZS.podcastName(session.podcastId),
        date: session.date,
        time: session.time,
        sessionId: session.id,
        planned: true,
        updatedAt: new Date().toISOString()
      };
      if (existing) {
        Object.assign(existing, episodeData);
      } else {
        s.episodes.push(Object.assign({
          id: ZS.uid('ep'),
          status: 'draft',
          duration: 0,
          hasRecording: false,
          tone: ZS.tone(session.episodeTitle),
          createdAt: new Date().toISOString()
        }, episodeData));
      }
      return s;
    });

    updateSummary();
    renderRecent();
    ZS.toast(editingId ? 'Session updated' : 'Session scheduled', 'success');
    if (data.invitation.showControls) openInviteModal(session);
    if (editingId) renderRecent();
    if (window.zHydrateIcons) window.zHydrateIcons();
  }

  function init() {
    var s = ZS.state();
    $('timezoneLabel').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';
    var today = new Date();
    $('sessionDate').min = today.toISOString().slice(0, 10);
    renderPodcastOptions(s.podcasts.length === 1 ? s.podcasts[0].id : '');
    $('hostName').value = s.settings.displayName || '';
    setDefaultMessage();
    if (s.podcasts.length === 1) $('sessionDate').value = today.toISOString().slice(0, 10);

    var params = new URLSearchParams(location.search);
    var editId = params.get('id');
    if (editId) {
      var session = ZS.getSession(editId);
      if (session) fillForm(session);
      else ZS.toast('That session no longer exists.', 'error');
    } else {
      addGuest({});
    }

    renderRecent();
    updateSummary();

    $('addGuestBtn').addEventListener('click', function () { addGuest({}, true); });
    $('guestList').addEventListener('click', function (e) {
      var remove = e.target.closest('[data-remove-guest]');
      if (remove) {
        remove.closest('.guest-row').remove();
        if (!ZS.$$('#guestList .guest-row').length) addGuest({});
        updateSummary();
      }
    });
    $('guestList').addEventListener('input', updateSummary);
    ['podcastSelect', 'episodeTitle', 'sessionDate', 'sessionTime', 'sessionDuration'].forEach(function (id) {
      $(id).addEventListener('input', updateSummary);
      $(id).addEventListener('change', updateSummary);
    });
    $('hostName').addEventListener('change', function () {
      if ($('inviteMessage').value.trim() === DEFAULT_MESSAGE.replace('{{host}}', ZS.displayName()) ||
        $('inviteMessage').value.trim() === DEFAULT_MESSAGE) setDefaultMessage();
    });
    $('scheduleForm').addEventListener('submit', save);
    $('resetFormBtn').addEventListener('click', function () {
      ZS.confirmDialog({ title: 'Clear this form?', message: 'Anything you typed here will be lost.', confirmText: 'Clear form', danger: true })
        .then(function (ok) { if (ok) { resetForm(); ZS.toast('Form cleared'); } });
    });
    wireInviteModal();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
