/* ZedStream — recordings and episodes library */
(function () {
  'use strict';
  var ZS = window.ZS;
  var filter = 'all';
  var search = '';
  var playerUrl = null;
  var playerEpisode = null;
  var editingId = null;

  function $(id) { return document.getElementById(id); }

  function modeFromUrl() {
    var params = new URLSearchParams(location.search);
    var view = params.get('view');
    search = params.get('q') || '';
    $('librarySearch').value = search;
    if (view === 'recordings') {
      filter = 'recordings';
    } else if (view === 'episodes') {
      filter = 'all';
    }
    setHeader();
    ZS.$$('#libraryFilters .chip').forEach(function (chip) {
      chip.classList.toggle('active', chip.getAttribute('data-filter') === filter);
    });
  }

  function setHeader() {
    if (filter === 'recordings') {
      $('libraryEyebrow').textContent = 'Recordings';
      $('libraryTitle').textContent = 'Captured recordings';
      $('librarySub').textContent = 'Everything you have recorded in the browser, ready to play, download or publish.';
    } else if (filter === 'published') {
      $('libraryEyebrow').textContent = 'Published';
      $('libraryTitle').textContent = 'Published episodes';
      $('librarySub').textContent = 'Episodes marked as published in your library.';
    } else {
      $('libraryEyebrow').textContent = 'Media library';
      $('libraryTitle').textContent = 'Recordings and episodes';
      $('librarySub').textContent = 'Every capture, draft and published episode in one place.';
    }
  }

  function eps() {
    return ZS.state().episodes.slice().sort(function (a, b) {
      return new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0);
    });
  }

  function matches(ep) {
    if (search) {
      var hay = (ep.title + ' ' + (ep.podcastName || '') + ' ' + (ep.summary || '')).toLowerCase();
      if (hay.indexOf(search.toLowerCase()) === -1) return false;
    }
    if (filter === 'recordings') return !!ep.hasRecording;
    if (filter === 'planned') return !!ep.planned && !ep.hasRecording;
    if (filter === 'drafts') return ep.status !== 'published' && !ep.planned;
    if (filter === 'published') return ep.status === 'published';
    return true;
  }

  function statusBadge(ep) {
    if (ep.status === 'published') return '<span class="badge badge-green">Published</span>';
    if (ep.planned) return '<span class="badge badge-violet">Planned</span>';
    return '<span class="badge badge-amber">Draft</span>';
  }

  function card(ep) {
    return '<article class="episode-card" data-ep="' + ZS.esc(ep.id) + '">' +
      ZS.thumbHtml(ep) +
      '<button class="play-fab" type="button" data-play="' + ZS.esc(ep.id) + '" aria-label="Play ' + ZS.esc(ep.title) + '">' + zIcon('play') + '</button>' +
      '<div class="episode-body">' +
      '<span class="episode-pod">' + ZS.esc(ep.podcastName || ZS.podcastName(ep.podcastId)) + '</span>' +
      '<h3>' + ZS.esc(ep.title) + '</h3>' +
      '<div class="episode-meta">' +
      '<span>' + zIcon('calendar') + ZS.esc(ep.date ? ZS.fmtDateLong(ep.date) : 'No date') + '</span>' +
      (ep.duration ? '<span>' + zIcon('clock') + ZS.fmtDuration(ep.duration) + '</span>' : '') +
      (ep.size ? '<span>' + ZS.esc(ZS.fmtBytes(ep.size)) + '</span>' : '') +
      '</div></div>' +
      '<div class="episode-foot">' + statusBadge(ep) +
      '<div class="card-actions">' +
      '<button class="mini-btn" type="button" data-play="' + ZS.esc(ep.id) + '" title="Play" aria-label="Play">' + zIcon('play') + '</button>' +
      '<button class="mini-btn" type="button" data-download="' + ZS.esc(ep.id) + '" title="Download" aria-label="Download"' + (ep.hasRecording ? '' : ' disabled style="opacity:.35"') + '>' + zIcon('download') + '</button>' +
      '<button class="mini-btn" type="button" data-edit="' + ZS.esc(ep.id) + '" title="Edit" aria-label="Edit">' + zIcon('edit') + '</button>' +
      '<button class="mini-btn" type="button" data-publish="' + ZS.esc(ep.id) + '" title="' + (ep.status === 'published' ? 'Unpublish' : 'Publish') + '" aria-label="Toggle publish">' + zIcon(ep.status === 'published' ? 'eye' : 'check') + '</button>' +
      '<button class="mini-btn danger" type="button" data-delete="' + ZS.esc(ep.id) + '" title="Delete" aria-label="Delete">' + zIcon('trash') + '</button>' +
      '</div></div></article>';
  }

  function render() {
    var all = eps();
    $('countAll').textContent = all.length;
    $('countRec').textContent = all.filter(function (e) { return e.hasRecording; }).length;
    $('countPlanned').textContent = all.filter(function (e) { return e.planned && !e.hasRecording; }).length;
    $('countDraft').textContent = all.filter(function (e) { return e.status !== 'published' && !e.planned; }).length;
    $('countPub').textContent = all.filter(function (e) { return e.status === 'published'; }).length;

    var list = all.filter(matches);
    var grid = $('libraryGrid');

    if (!list.length) {
      var hasAny = all.length > 0;
      grid.innerHTML = ZS.emptyState({
        icon: filter === 'recordings' ? 'video' : 'headphones',
        title: hasAny ? 'Nothing matches this view' : (filter === 'recordings' ? 'No recordings yet' : 'No episodes yet'),
        text: hasAny
          ? 'Try another filter or clear the search.'
          : (filter === 'recordings'
            ? 'Open the studio and record your first episode. The capture is stored locally and appears here.'
            : 'Schedule a recording to plan your first episode, then capture it in the studio.'),
        action: filter === 'recordings'
          ? { href: 'studio.html', label: 'Open studio', icon: 'radio' }
          : { href: 'schedule.html', label: 'Schedule a session', icon: 'calendarPlus' }
      });
      return;
    }

    grid.innerHTML = list.map(card).join('');
    if (window.zHydrateIcons) window.zHydrateIcons();
  }

  /* ---------- player ---------- */
  function play(id) {
    var ep = ZS.state().episodes.filter(function (x) { return x.id === id; })[0];
    if (!ep) return;
    playerEpisode = ep;
    $('playerTitle').textContent = ep.title;
    $('playerSub').textContent = (ep.podcastName || 'Independent') + (ep.date ? ' · ' + ZS.fmtDateLong(ep.date) : '');
    $('playerPodcast').textContent = ep.podcastName || 'Independent';
    $('playerDate').textContent = ep.date ? ZS.fmtDateLong(ep.date) : 'Not recorded';
    $('playerDuration').textContent = ep.duration ? ZS.fmtDuration(ep.duration) : '—';
    $('playerStatus').textContent = ep.status === 'published' ? 'Published' : (ep.planned ? 'Planned' : 'Draft');
    $('playerStudioLink').href = ep.sessionId ? 'studio.html?s=' + encodeURIComponent(ep.sessionId) : 'studio.html';
    $('playerDownload').disabled = !ep.hasRecording;

    var video = $('playerVideo');
    var empty = $('playerEmpty');
    video.classList.add('hidden');
    empty.classList.add('hidden');
    if (playerUrl) { URL.revokeObjectURL(playerUrl); playerUrl = null; }
    video.removeAttribute('src');

    ZS.openModal('playerModal');

    if (!ep.hasRecording) {
      empty.classList.remove('hidden');
      return;
    }

    ZS.rec.get(ep.id).then(function (blob) {
      if (!blob) {
        empty.classList.remove('hidden');
        $('playerEmpty').querySelector('h3').textContent = 'Media file not found';
        return;
      }
      playerUrl = URL.createObjectURL(blob);
      video.src = playerUrl;
      video.classList.remove('hidden');
      video.play().catch(function () { /* autoplay may be blocked; controls remain */ });
    }).catch(function () {
      empty.classList.remove('hidden');
    });
  }

  function download(id) {
    var ep = ZS.state().episodes.filter(function (x) { return x.id === id; })[0];
    if (!ep || !ep.hasRecording) {
      ZS.toast('This episode has no captured file yet.', 'error');
      return;
    }
    ZS.rec.get(id).then(function (blob) {
      if (!blob) {
        ZS.toast('Media file not found in local storage.', 'error');
        return;
      }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = ep.title.replace(/[^\w\-. ]+/g, '') + '.webm';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      ZS.toast('Download started', 'success');
    });
  }

  /* ---------- edit ---------- */
  function openEdit(id) {
    var ep = ZS.state().episodes.filter(function (x) { return x.id === id; })[0];
    if (!ep) return;
    editingId = id;
    $('editEpisodeTitle').value = ep.title;
    $('editEpisodeSummary').value = ep.summary || '';
    $('editEpisodeStatus').value = ep.status === 'published' ? 'published' : 'draft';
    var s = ZS.state();
    $('editEpisodePodcast').innerHTML = '<option value="">No podcast</option>' + s.podcasts.map(function (p) {
      return '<option value="' + ZS.esc(p.id) + '"' + (p.id === ep.podcastId ? ' selected' : '') + '>' + ZS.esc(p.name) + '</option>';
    }).join('');
    $('editEpisodeTitle').closest('.field').classList.remove('invalid');
    ZS.openModal('editModal');
  }

  function saveEdit(e) {
    e.preventDefault();
    var title = $('editEpisodeTitle').value.trim();
    if (!title) {
      $('editEpisodeTitle').closest('.field').classList.add('invalid');
      $('editEpisodeTitle').focus();
      return;
    }
    var podcastId = $('editEpisodePodcast').value;
    var status = $('editEpisodeStatus').value;
    var summary = $('editEpisodeSummary').value.trim();
    ZS.update(function (s) {
      s.episodes.forEach(function (ep) {
        if (ep.id !== editingId) return;
        ep.title = title;
        ep.podcastId = podcastId;
        ep.podcastName = ZS.podcastName(podcastId);
        ep.status = status;
        ep.summary = summary;
        ep.tone = ZS.tone(title);
        ep.updatedAt = new Date().toISOString();
      });
      return s;
    });
    ZS.closeModal('editModal');
    ZS.toast('Episode updated', 'success');
    render();
  }

  function togglePublish(id) {
    var isPublished = false;
    ZS.update(function (s) {
      s.episodes.forEach(function (ep) {
        if (ep.id !== id) return;
        ep.status = ep.status === 'published' ? 'draft' : 'published';
        isPublished = ep.status === 'published';
        ep.updatedAt = new Date().toISOString();
      });
      return s;
    });
    ZS.toast(isPublished ? 'Episode published' : 'Episode moved back to drafts', 'success');
    render();
  }

  function remove(id) {
    var ep = ZS.state().episodes.filter(function (x) { return x.id === id; })[0];
    if (!ep) return;
    ZS.confirmDialog({
      title: 'Delete "' + ep.title + '"?',
      message: 'The episode card and its local recording file will be removed. This cannot be undone.',
      confirmText: 'Delete episode',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      ZS.update(function (s) {
        s.episodes = s.episodes.filter(function (x) { return x.id !== id; });
        return s;
      });
      ZS.rec.del(id).catch(function () { /* nothing stored */ });
      ZS.toast('Episode deleted');
      render();
    });
  }

  function wire() {
    $('librarySearch').addEventListener('input', function () {
      search = this.value.trim();
      render();
    });
    $('libraryFilters').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-filter]');
      if (!chip) return;
      filter = chip.getAttribute('data-filter');
      ZS.$$('#libraryFilters .chip').forEach(function (c) { c.classList.toggle('active', c === chip); });
      setHeader();
      var view = filter === 'recordings' ? 'recordings' : 'episodes';
      history.replaceState(null, '', 'library.html?view=' + view);
      render();
    });

    $('libraryGrid').addEventListener('click', function (e) {
      var playBtn = e.target.closest('[data-play]');
      if (playBtn) { play(playBtn.getAttribute('data-play')); return; }
      var dl = e.target.closest('[data-download]');
      if (dl) { download(dl.getAttribute('data-download')); return; }
      var ed = e.target.closest('[data-edit]');
      if (ed) { openEdit(ed.getAttribute('data-edit')); return; }
      var pub = e.target.closest('[data-publish]');
      if (pub) { togglePublish(pub.getAttribute('data-publish')); return; }
      var del = e.target.closest('[data-delete]');
      if (del) { remove(del.getAttribute('data-delete')); }
    });

    $('playerDownload').addEventListener('click', function () {
      if (playerEpisode) download(playerEpisode.id);
    });

    $('editForm').addEventListener('submit', saveEdit);
    $('editEpisodeTitle').addEventListener('input', function () {
      this.closest('.field').classList.remove('invalid');
    });

    ZS.$$('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-close');
        ZS.closeModal(id);
        if (id === 'playerModal') {
          var v = $('playerVideo');
          if (v) { v.pause(); v.removeAttribute('src'); }
          if (playerUrl) { URL.revokeObjectURL(playerUrl); playerUrl = null; }
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    modeFromUrl();
    wire();
    render();
    var params = new URLSearchParams(location.search);
    if (params.get('play')) play(params.get('play'));
  });
  document.addEventListener('zs:change', render);
})();
