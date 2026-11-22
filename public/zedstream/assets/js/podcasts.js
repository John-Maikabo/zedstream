/* ZedStream — my podcasts */
(function () {
  'use strict';
  var ZS = window.ZS;
  var editingId = null;

  function $(id) { return document.getElementById(id); }

  function card(podcast, s) {
    var episodes = s.episodes.filter(function (e) { return e.podcastId === podcast.id; });
    var recorded = episodes.filter(function (e) { return e.hasRecording; }).length;
    var scheduled = s.sessions.filter(function (x) { return x.podcastId === podcast.id; }).length;
    var bars = '';
    for (var i = 0; i < 12; i++) {
      var h = 20 + Math.abs(Math.sin((podcast.name.length + i) * 1.4)) * 72;
      bars += '<i style="height:' + h.toFixed(0) + '%"></i>';
    }
    return '<article class="episode-card">' +
      '<div class="thumb" data-tone="' + ZS.esc(podcast.tone || ZS.tone(podcast.id)) + '">' +
      '<div class="thumb-wave">' + bars + '</div>' +
      '<div class="thumb-top"><span class="badge">' + zIcon('disc') + 'Show</span>' +
      '<span class="badge">' + episodes.length + ' episode' + (episodes.length === 1 ? '' : 's') + '</span></div></div>' +
      '<div class="episode-body">' +
      '<h3>' + ZS.esc(podcast.name) + '</h3>' +
      '<p class="small muted" style="font-size:11.5px;line-height:1.5">' +
      ZS.esc(podcast.description || 'No description yet.') + '</p>' +
      '<div class="episode-meta"><span>' + zIcon('mic') + ZS.esc(podcast.host || 'Host') + '</span>' +
      '<span>' + zIcon('video') + recorded + ' recorded</span>' +
      '<span>' + zIcon('calendar') + scheduled + ' session' + (scheduled === 1 ? '' : 's') + '</span></div>' +
      '</div>' +
      '<div class="episode-foot">' +
      '<a class="link-btn" href="schedule.html">' + zIcon('calendarPlus') + 'Schedule</a>' +
      '<div class="card-actions">' +
      '<button class="mini-btn" type="button" data-pod-edit="' + ZS.esc(podcast.id) + '" title="Edit podcast" aria-label="Edit podcast">' + zIcon('edit') + '</button>' +
      '<button class="mini-btn danger" type="button" data-pod-delete="' + ZS.esc(podcast.id) + '" title="Delete podcast" aria-label="Delete podcast">' + zIcon('trash') + '</button>' +
      '</div></div></article>';
  }

  function render() {
    var s = ZS.state();
    var grid = $('podcastGrid');
    if (!s.podcasts.length) {
      grid.innerHTML = ZS.emptyState({
        icon: 'disc',
        title: 'No podcasts yet',
        text: 'Create your first show to start scheduling episodes and inviting guests.',
        action: { href: '#', label: 'Create a podcast', icon: 'plus' }
      });
      grid.querySelector('.btn').addEventListener('click', function (e) {
        e.preventDefault();
        openNew();
      });
      return;
    }
    grid.innerHTML = s.podcasts.map(function (p) { return card(p, s); }).join('');
    if (window.zHydrateIcons) window.zHydrateIcons();
  }

  function openNew() {
    editingId = null;
    $('podcastModalTitle').textContent = 'New podcast';
    $('podcastSubmit').innerHTML = zIcon('check') + ' Create podcast';
    var s = ZS.state();
    $('podcastName').value = '';
    $('podcastAbout').value = '';
    $('podcastHost').value = s.settings.displayName || '';
    $('podcastName').closest('.field').classList.remove('invalid');
    ZS.openModal('podcastModal');
  }

  function openEdit(id) {
    var p = ZS.getPodcast(id);
    if (!p) return;
    editingId = id;
    $('podcastModalTitle').textContent = 'Edit podcast';
    $('podcastSubmit').innerHTML = zIcon('check') + ' Save changes';
    $('podcastName').value = p.name;
    $('podcastAbout').value = p.description || '';
    $('podcastHost').value = p.host || '';
    ZS.openModal('podcastModal');
  }

  function wire() {
    $('newPodcastBtn').addEventListener('click', openNew);

    $('podcastForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('podcastName').value.trim();
      if (!name) {
        $('podcastName').closest('.field').classList.add('invalid');
        $('podcastName').focus();
        return;
      }
      var about = $('podcastAbout').value.trim();
      var host = $('podcastHost').value.trim() || ZS.displayName();
      ZS.update(function (s) {
        if (editingId) {
          s.podcasts.forEach(function (p) {
            if (p.id !== editingId) return;
            p.name = name;
            p.description = about;
            p.host = host;
            p.tone = ZS.tone(name);
          });
        } else {
          s.podcasts.push({
            id: ZS.uid('pod'),
            name: name,
            description: about,
            host: host,
            tone: ZS.tone(name),
            createdAt: new Date().toISOString()
          });
          if (!s.settings.displayName) s.settings.displayName = host;
        }
        return s;
      });
      ZS.closeModal('podcastModal');
      ZS.toast(editingId ? 'Podcast updated' : 'Podcast created', 'success');
      render();
    });

    $('podcastName').addEventListener('input', function () {
      this.closest('.field').classList.remove('invalid');
    });

    document.addEventListener('click', function (e) {
      var close = e.target.closest('[data-close]');
      if (close) ZS.closeModal(close.getAttribute('data-close'));

      var edit = e.target.closest('[data-pod-edit]');
      if (edit) { openEdit(edit.getAttribute('data-pod-edit')); return; }

      var del = e.target.closest('[data-pod-delete]');
      if (del) {
        var id = del.getAttribute('data-pod-delete');
        var podcast = ZS.getPodcast(id);
        if (!podcast) return;
        ZS.confirmDialog({
          title: 'Delete "' + podcast.name + '"?',
          message: 'Episodes and sessions stay in your library but are no longer linked to a show.',
          confirmText: 'Delete podcast',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          ZS.update(function (s) {
            s.podcasts = s.podcasts.filter(function (p) { return p.id !== id; });
            s.sessions.forEach(function (ses) { if (ses.podcastId === id) ses.podcastId = ''; });
            s.episodes.forEach(function (ep) { if (ep.podcastId === id) ep.podcastId = ''; });
            return s;
          });
          ZS.toast('Podcast deleted');
          render();
        });
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () { wire(); render(); });
  document.addEventListener('zs:change', render);
})();
