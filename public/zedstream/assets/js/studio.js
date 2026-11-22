/* ============================================================
   ZedStream — recording studio
   Real getUserMedia capture, live level meter, screen share,
   MediaRecorder capture saved to the local episode library.
   ============================================================ */
(function () {
  'use strict';
  var ZS = window.ZS;

  var session = null;
  var guest = null;
  var role = 'host';
  var localStream = null;
  var screenStream = null;
  var audioCtx = null;
  var analyser = null;
  var meterRAF = null;
  var recorder = null;
  var chunks = [];
  var recSeconds = 0;
  var recTicker = null;
  var pendingBlob = null;
  var pendingSize = 0;
  var micOn = true;
  var camOn = true;
  var joined = false;
  var prefs = { background: 'none', quality: '1080', episode: '' };

  function $(id) { return document.getElementById(id); }

  function showNote(text, ms) {
    var note = $('studioNote');
    note.innerHTML = zIcon('sparkles', 'sm') + '<span>' + ZS.esc(text) + '</span>';
    note.classList.remove('hidden');
    clearTimeout(showNote._t);
    showNote._t = setTimeout(function () { note.classList.add('hidden'); }, ms || 4200);
  }

  function status(el, ok, text) {
    el.innerHTML = '<span class="' + (ok ? 'status-ok' : 'status-bad') + '">' +
      zIcon(ok ? 'check' : 'x', 'sm') + ' ' + ZS.esc(text) + '</span>';
  }

  /* ---------- context ---------- */
  function resolveContext() {
    var params = new URLSearchParams(location.search);
    var sessionId = params.get('s');
    var token = params.get('invite');
    var s = ZS.state();

    if (token) {
      s.sessions.forEach(function (ses) {
        (ses.guests || []).forEach(function (g) {
          if (g.token === token) { session = ses; guest = g; role = 'guest'; }
        });
      });
    }
    if (!session && sessionId) {
      session = ZS.getSession(sessionId);
    }
    if (!session) {
      var upcoming = ZS.upcomingSessions(1);
      session = upcoming[0] || null;
    }
    if (session && !guest) {
      var guestId = params.get('g');
      var found = (session.guests || []).filter(function (g) { return g.id === guestId; })[0];
      if (found) { guest = found; role = 'guest'; }
    }
  }

  function contextTitle() {
    if (session) return session.episodeTitle || 'Untitled episode';
    return 'Ad-hoc recording session';
  }

  function fillContext() {
    $('studioTitle').textContent = contextTitle();
    $('studioSub').textContent = role === 'guest'
      ? 'Guest room · joined by invitation'
      : (session ? ZS.fmtDateLong(session.date, session.time) : 'Local studio · nothing scheduled');
    $('panelEpisode').textContent = contextTitle();
    $('panelMeta').textContent = session
      ? ZS.podcastName(session.podcastId, session.podcastName) + ' · ' + ZS.fmtDateLong(session.date, session.time)
      : 'No podcast selected';

    var guests = session ? (session.guests || []) : [];
    $('panelGuests').textContent = guests.length + (guests.length === 1 ? ' guest' : ' guests');
    $('participantsCount').textContent = '1';

    var name = guest ? guest.name : (ZS.state().settings.displayName || 'Host');
    $('lobbyName').value = name || '';
    $('previewInitials').textContent = ZS.initials(name || 'You');
    $('previewName').textContent = name || 'Your camera';
    $('lobbyTitle').textContent = role === 'guest' ? "You're invited to record" : 'Ready to record?';
    $('lobbySub').textContent = session
      ? contextTitle() + ' · ' + ZS.fmtDateLong(session.date, session.time)
      : 'Set up your camera and microphone, then join the studio.';

    var st = ZS.state().settings;
    prefs.background = (session && session.prefs && session.prefs.background) || st.background || 'none';
    prefs.quality = (session && session.prefs && session.prefs.quality) || st.quality || '1080';
    prefs.episode = contextTitle();
    $('settingBackground').value = prefs.background === 'gradient-violet' ? 'soft' : (prefs.background === 'gradient-studio' ? 'none' : prefs.background);
    $('settingQuality').value = prefs.quality;
    $('settingEpisode').value = prefs.episode;

    renderPodcastOptions();
    renderPeople();
    applyCameraLook();
  }

  function renderPodcastOptions() {
    var s = ZS.state();
    var select = $('recPodcast');
    if (!select) return;
    select.innerHTML = '<option value="">No podcast</option>' + s.podcasts.map(function (p) {
      return '<option value="' + ZS.esc(p.id) + '">' + ZS.esc(p.name) + '</option>';
    }).join('');
    if (session && session.podcastId) select.value = session.podcastId;
  }

  /* ---------- people ---------- */
  function renderPeople() {
    var list = $('peopleList');
    var guests = session ? (session.guests || []) : [];
    var myName = guest ? guest.name : (ZS.state().settings.displayName || 'Host');
    var myRole = role === 'guest' ? 'Guest' : 'Host';

    var html = '<div class="person">' +
      '<span class="avatar">' + ZS.esc(ZS.initials(myName || 'You')) + '</span>' +
      '<span class="person-meta"><strong>' + ZS.esc(myName || 'You') + ' <span class="muted tiny">(you)</span></strong>' +
      '<small>' + myRole + ' · ' + (joined ? 'in studio' : 'not joined yet') + '</small></span>' +
      '<span class="person-icons">' +
      '<span class="' + (micOn ? 'on' : 'off') + '">' + zIcon(micOn ? 'mic' : 'micOff') + '</span>' +
      '<span class="' + (camOn ? 'on' : 'off') + '">' + zIcon(camOn ? 'video' : 'videoOff') + '</span>' +
      '</span></div>';

    guests.forEach(function (g) {
      if (guest && g.id === guest.id) return;
      html += '<div class="person">' +
        '<span class="avatar" style="background:linear-gradient(140deg,#3f3f56,#242433)">' + ZS.esc(ZS.initials(g.name || g.email)) + '</span>' +
        '<span class="person-meta"><strong>' + ZS.esc(g.name || 'Guest') + '</strong>' +
        '<small><span class="badge badge-amber" style="height:17px;font-size:9.5px;padding:0 6px">Invited</span></small></span>' +
        '<span class="person-icons" style="opacity:.5">' + zIcon('mic') + zIcon('video') + '</span></div>';
    });

    list.innerHTML = html;
  }

  /* ---------- tiles ---------- */
  function selfName() {
    return guest ? guest.name : (ZS.state().settings.displayName || 'Host');
  }

  function renderGrid() {
    var grid = $('videoGrid');
    var guests = session ? (session.guests || []).filter(function (g) { return !guest || g.id !== guest.id; }) : [];
    var waiting = guests.slice(0, 3);
    var tiles = [];

    tiles.push(
      '<div class="tile mirror" id="selfTile">' +
      '<video id="selfVideo" autoplay playsinline muted></video>' +
      '<div class="tile-empty hidden" id="selfEmpty">' +
      '<span class="avatar">' + ZS.esc(ZS.initials(selfName() || 'You')) + '</span>' +
      '<strong>' + ZS.esc(selfName() || 'You') + '</strong><span>Camera is off</span></div>' +
      '<div class="tile-top"><span class="tile-name">' + ZS.esc(selfName() || 'You') +
      ' <span class="role">' + (role === 'guest' ? 'Guest' : 'Host') + '</span></span>' +
      '<span class="tile-signal">' + zIcon('signal') + 'You</span></div>' +
      '<div class="tile-bottom"><div class="tile-status">' +
      '<span class="mic-chip" id="selfMicChip">' + zIcon('mic') + '</span>' +
      '<span class="level-meter" id="selfMeter"><i></i><i></i><i></i><i></i><i></i></span>' +
      '</div><span class="tile-signal">HD</span></div></div>'
    );

    if (role === 'guest') {
      tiles.push(
        '<div class="tile">' +
        '<div class="tile-empty"><span class="pulse-ring"></span>' +
        '<span class="avatar" style="background:linear-gradient(140deg,#4c1d95,#2b1050)">' + ZS.esc(ZS.initials('Host')) + '</span>' +
        '<strong>Host</strong><span>Waiting for the host to start</span></div>' +
        '<div class="tile-top"><span class="tile-name">Host <span class="role">Host</span></span>' +
        '<span class="tile-signal warn">' + zIcon('clock') + 'Waiting</span></div></div>'
      );
    } else if (waiting.length) {
      waiting.forEach(function (g) {
        tiles.push(
          '<div class="tile">' +
          '<div class="tile-empty"><span class="pulse-ring"></span>' +
          '<span class="avatar" style="background:linear-gradient(140deg,#3f3f56,#242433)">' + ZS.esc(ZS.initials(g.name || g.email)) + '</span>' +
          '<strong>' + ZS.esc(g.name || 'Guest') + '</strong><span>Invited · waiting to join</span></div>' +
          '<div class="tile-top"><span class="tile-name">' + ZS.esc(g.name || 'Guest') + ' <span class="role">Guest</span></span>' +
          '<span class="tile-signal warn">' + zIcon('clock') + 'Invited</span></div></div>'
        );
      });
    } else {
      tiles.push(
        '<div class="tile">' +
        '<div class="tile-empty"><span class="pulse-ring"></span>' +
        '<span class="avatar" style="background:linear-gradient(140deg,#4c1d95,#2b1050)">' + zIcon('userPlus') + '</span>' +
        '<strong>Invite a guest</strong><span>Copy the joining link and send it over</span>' +
        '<button class="btn btn-sm btn-soft" type="button" data-open-invite style="margin-top:6px">' + zIcon('link') + 'Copy invite</button></div>' +
        '<div class="tile-top"><span class="tile-name">Guest seat <span class="role">Empty</span></span></div></div>'
      );
    }

    grid.className = 'video-grid' + (tiles.length === 1 ? ' solo' : tiles.length >= 3 ? ' triple' : '');
    grid.innerHTML = tiles.join('');

    var video = $('selfVideo');
    if (video) {
      video.srcObject = localStream;
      video.style.objectFit = camOn ? 'cover' : 'cover';
      applyCameraLook();
    }
    updateSelfChrome();
    if (window.zHydrateIcons) window.zHydrateIcons();
  }

  function updateSelfChrome() {
    var chip = $('selfMicChip');
    if (chip) {
      chip.classList.toggle('muted', !micOn);
      chip.innerHTML = zIcon(micOn ? 'mic' : 'micOff');
    }
    var selfEmpty = $('selfEmpty');
    var tile = $('selfTile');
    if (tile) tile.classList.toggle('off', !camOn);
    if (selfEmpty) selfEmpty.classList.toggle('hidden', camOn && !!localStream);
    $('micBtn').classList.toggle('off', !micOn);
    $('micBtn').classList.toggle('active', micOn);
    $('camBtn').classList.toggle('off', !camOn);
    $('micLabel').textContent = micOn ? 'Mic' : 'Muted';
    $('camLabel').textContent = camOn ? 'Cam' : 'Cam off';
    if (window.zHydrateIcons) window.zHydrateIcons();
  }

  function applyCameraLook() {
    var videos = [$('selfVideo'), $('previewVideo')];
    var bgSetting = prefs.background;
    videos.forEach(function (v) {
      if (!v) return;
      v.style.transition = 'filter .2s ease';
      v.style.background = 'transparent';
      if (bgSetting === 'blur') {
        v.style.filter = 'blur(9px)';
        v.style.transform = $('mirrorToggle') && $('mirrorToggle').checked ? 'scaleX(-1) scale(1.06)' : 'scale(1.06)';
      } else if (bgSetting === 'soft') {
        v.style.filter = 'saturate(1.05) contrast(1.03)';
        v.style.transform = $('mirrorToggle') && $('mirrorToggle').checked ? 'scaleX(-1)' : 'none';
      } else {
        v.style.filter = 'none';
        v.style.transform = $('mirrorToggle') && $('mirrorToggle').checked ? 'scaleX(-1)' : 'none';
      }
    });
    var self = $('selfTile');
    if (self) self.classList.toggle('mirror', !!($('mirrorToggle') && $('mirrorToggle').checked));
  }

  /* ---------- devices ---------- */
  function startPreview(audioOnly) {
    var constraints = audioOnly
      ? { audio: { echoCancellation: true, noiseSuppression: true }, video: false }
      : { audio: { echoCancellation: true, noiseSuppression: true }, video: { width: { ideal: 1280 }, height: { ideal: 720 } } };

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status($('camStatus'), false, 'Unsupported');
      status($('micStatus'), false, 'Unsupported');
      showNote('This browser cannot access camera or microphone. You can still explore the studio layout.', 6000);
      return Promise.resolve(null);
    }

    return navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      stopStream(localStream);
      localStream = stream;
      micOn = stream.getAudioTracks().length > 0;
      camOn = stream.getVideoTracks().length > 0;
      var preview = $('previewVideo');
      preview.srcObject = stream;
      status($('camStatus'), camOn, camOn ? 'Ready' : 'Off');
      status($('micStatus'), micOn, micOn ? 'Ready' : 'Off');
      $('previewEmpty').classList.toggle('hidden', camOn);
      applyCameraLook();
      if (joined) {
        var selfVideo = $('selfVideo');
        if (selfVideo) selfVideo.srcObject = stream;
        updateSelfChrome();
      }
      startMeter(stream);
      return stream;
    }).catch(function (err) {
      var msg = err && err.name === 'NotAllowedError'
        ? 'Camera or microphone permission was blocked.'
        : 'No camera or microphone was found.';
      status($('camStatus'), false, 'Blocked');
      status($('micStatus'), false, 'Blocked');
      $('previewEmpty').classList.remove('hidden');
      showNote(msg + ' You can still join the studio without devices.', 6000);
      return null;
    });
  }

  function stopStream(stream) {
    if (!stream) return;
    stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* noop */ } });
  }

  /* ---------- level meter ---------- */
  function startMeter(stream) {
    stopMeter();
    var audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      var data = new Uint8Array(analyser.fftSize);
      var last = 0;

      (function loop() {
        meterRAF = requestAnimationFrame(loop);
        if (!analyser) return;
        analyser.getByteTimeDomainData(data);
        var sum = 0;
        for (var i = 0; i < data.length; i++) {
          var v = (data[i] - 128) / 128;
          sum += v * v;
        }
        var rms = Math.sqrt(sum / data.length);
        var level = Math.min(1, rms * 4.2);
        var meter = $('selfMeter');
        if (meter) {
          var bars = meter.querySelectorAll('i');
          for (var b = 0; b < bars.length; b++) {
            var threshold = (b + 1) / bars.length;
            var active = level >= threshold * 0.72;
            bars[b].style.height = active ? '100%' : '38%';
            bars[b].style.background = active ? (b > 3 ? '#fbbf24' : '#a78bfa') : 'rgba(255,255,255,.22)';
          }
        }
        var lvl = $('levelStatus');
        if (lvl && !joined) {
          lvl.className = 'status small ' + (level > 0.06 ? 'status-ok' : 'muted');
          lvl.textContent = level > 0.06 ? 'We can hear you' : 'Say something';
        }
        var tile = $('selfTile');
        if (tile) {
          var speaking = level > 0.14 && micOn;
          if (speaking !== tile.classList.contains('speaking')) tile.classList.toggle('speaking', speaking);
        }
        if (Date.now() - last > 500 && audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      })();
    } catch (e) {
      /* audio meter is best-effort */
    }
  }

  function stopMeter() {
    if (meterRAF) cancelAnimationFrame(meterRAF);
    meterRAF = null;
    analyser = null;
    if (audioCtx) { try { audioCtx.close(); } catch (e) { /* noop */ } audioCtx = null; }
  }

  /* ---------- invitations ---------- */
  function copyInvite() {
    if (session && (session.guests || []).length) {
      var g = guest || session.guests[0];
      ZS.copyText(ZS.inviteUrl(session, g), 'Guest joining link copied');
      return;
    }
    if (session) {
      ZS.copyText(ZS.baseUrl() + 'studio.html?s=' + encodeURIComponent(session.id), 'Studio link copied — add guests on the schedule page');
      return;
    }
    ZS.copyText(ZS.baseUrl() + 'studio.html', 'Studio link copied');
  }

  function openPeople() {
    $('peoplePanel').classList.remove('collapsed');
  }

  function togglePeople() {
    $('peoplePanel').classList.toggle('collapsed');
  }

  /* ---------- recording ---------- */
  function pickMime() {
    var candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'audio/webm'];
    if (!window.MediaRecorder) return '';
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  function startRecording() {
    if (!localStream || !localStream.getAudioTracks().length && !localStream.getVideoTracks().length) {
      ZS.toast('Connect a camera or microphone before recording.', 'error');
      return;
    }
    if (!window.MediaRecorder) {
      ZS.toast('This browser cannot record media. Try a recent Chrome or Edge.', 'error');
      return;
    }
    try {
      var mime = pickMime();
      var options = {};
      if (mime) options.mimeType = mime;
      options.videoBitsPerSecond = prefs.quality === '720' ? 1500000 : 2500000;
      options.audioBitsPerSecond = 128000;
      recorder = new MediaRecorder(localStream, options);
      chunks = [];
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = finalizeRecording;
      recorder.start(1000);
      recSeconds = 0;
      $('recChip').classList.remove('idle');
      $('recChip').classList.add('badge-live');
      $('recordBtn').classList.add('active');
      $('recordLabel').textContent = 'Stop';
      $('recordBtn').title = 'Stop recording';
      $('recordBtn').querySelector('.ctl-icon').innerHTML = zIcon('square');
      startTicker();
      showNote('Recording started — capture stays on this device', 3200);
    } catch (e) {
      ZS.toast('Could not start recording on this device.', 'error');
    }
  }

  function startTicker() {
    clearInterval(recTicker);
    recTicker = setInterval(function () {
      recSeconds += 1;
      $('recTime').textContent = 'REC ' + ZS.fmtDuration(recSeconds);
    }, 1000);
    $('recTime').textContent = 'REC 0:00';
  }

  function stopRecording() {
    if (!recorder || recorder.state === 'inactive') return;
    try { recorder.stop(); } catch (e) { /* noop */ }
    clearInterval(recTicker);
    $('recChip').classList.add('idle');
    $('recChip').classList.remove('badge-live');
    $('recordBtn').classList.remove('active');
    $('recordLabel').textContent = 'Record';
    $('recordBtn').title = 'Start recording';
    $('recordBtn').querySelector('.ctl-icon').innerHTML = zIcon('circle');
    $('recTime').textContent = 'Saving…';
  }

  function finalizeRecording() {
    var blob = new Blob(chunks, { type: (chunks[0] && chunks[0].type) || 'video/webm' });
    if (!blob.size) {
      $('recTime').textContent = 'Not recording';
      ZS.toast('The recording was empty — check your microphone.', 'error');
      return;
    }
    pendingBlob = blob;
    pendingSize = blob.size;
    $('recDuration').textContent = ZS.fmtDuration(recSeconds);
    $('recSize').textContent = ZS.fmtBytes(blob.size) + ' · ' + recSeconds + 's captured';
    $('recTitle').value = (prefs.episode && prefs.episode !== 'Ad-hoc recording session')
      ? prefs.episode
      : 'Recording · ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    renderPodcastOptions();
    $('recordLabel').textContent = 'Record';
    $('recTime').textContent = 'Not recording';
    ZS.openModal('saveRecording');
  }

  function discardRecording() {
    if (pendingBlob) URL.revokeObjectURL(pendingBlob._url || '');
    pendingBlob = null;
    pendingSize = 0;
    ZS.closeModal('saveRecording');
    ZS.toast('Recording discarded');
  }

  function downloadPending() {
    if (!pendingBlob) return;
    var url = URL.createObjectURL(pendingBlob);
    pendingBlob._url = url;
    var a = document.createElement('a');
    a.href = url;
    a.download = ($('recTitle').value.trim() || 'zedstream-recording').replace(/[^\w\-. ]+/g, '') + '.webm';
    document.body.appendChild(a);
    a.click();
    a.remove();
    ZS.toast('Download started', 'success');
  }

  function saveRecording() {
    if (!pendingBlob) return;
    var title = $('recTitle').value.trim();
    if (!title) {
      ZS.toast('Give the recording a title first.', 'error');
      $('recTitle').focus();
      return;
    }
    var podcastId = $('recPodcast').value;
    var publish = $('recPublish').checked;
    var episodeId = ZS.uid('ep');
    var duration = recSeconds;

    ZS.update(function (s) {
      var planned = session ? s.episodes.filter(function (e) { return e.sessionId === session.id; })[0] : null;
      var data = {
        title: title,
        podcastId: podcastId,
        podcastName: ZS.podcastName(podcastId),
        date: new Date().toISOString().slice(0, 10),
        sessionId: session ? session.id : null,
        planned: false,
        hasRecording: true,
        duration: duration,
        size: pendingSize,
        status: publish ? 'published' : 'draft',
        updatedAt: new Date().toISOString()
      };
      if (planned) {
        Object.assign(planned, data);
      } else {
        s.episodes.push(Object.assign({
          id: episodeId,
          tone: ZS.tone(title),
          createdAt: new Date().toISOString()
        }, data));
        episodeId = s.episodes[s.episodes.length - 1].id;
      }
      episodeId = (planned || {}).id || episodeId;
      return s;
    });

    ZS.rec.put(episodeId, pendingBlob).catch(function () {
      ZS.toast('Saved the episode, but the media file could not be stored locally.', 'error');
    });

    var blob = pendingBlob;
    pendingBlob = null;
    pendingSize = 0;
    ZS.closeModal('saveRecording');
    ZS.toast('Recording saved to your library', 'success');
    showNote('Saved to Recordings · available in the library', 5000);
    if (blob) blob._saved = true;
  }

  /* ---------- screen share ---------- */
  function startShare() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      ZS.toast('Screen sharing is not available in this browser.', 'error');
      return;
    }
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (stream) {
      screenStream = stream;
      $('screenVideo').srcObject = stream;
      $('presentationStage').classList.remove('hidden');
      $('videoGrid').classList.add('hidden');
      $('shareBtn').classList.add('active');
      showNote('You are sharing your screen', 3200);
      stream.getVideoTracks()[0].addEventListener('ended', stopShare);
    }).catch(function () {
      ZS.toast('Screen share was cancelled.', 'error');
    });
  }

  function stopShare() {
    stopStream(screenStream);
    screenStream = null;
    var video = $('screenVideo');
    if (video) video.srcObject = null;
    $('presentationStage').classList.add('hidden');
    $('videoGrid').classList.remove('hidden');
    $('shareBtn').classList.remove('active');
  }

  /* ---------- join / leave ---------- */
  function join(audioOnly) {
    if (audioOnly) {
      micOn = true;
      camOn = false;
    } else {
      micOn = !!(localStream && localStream.getAudioTracks().length);
      camOn = !!(localStream && localStream.getVideoTracks().length);
    }

    var name = $('lobbyName').value.trim();
    if (role === 'guest' && guest) {
      guest.name = name || guest.name;
      ZS.update(function (s) {
        s.sessions.forEach(function (ses) {
          if (ses.id !== session.id) return;
          (ses.guests || []).forEach(function (g) {
            if (g.id === guest.id) {
              g.name = guest.name;
              g.status = 'accepted';
            }
          });
        });
        if (name && !s.settings.displayName) s.settings.displayName = name;
        return s;
      });
    } else if (name && !ZS.state().settings.displayName) {
      ZS.update(function (s) { s.settings.displayName = name; return s; });
    }

    joined = true;
    $('lobby').classList.add('hidden');
    $('participantsChip').classList.remove('hidden');
    renderGrid();
    renderPeople();
    if (!localStream) startPreview(audioOnly);
    showNote(audioOnly ? 'Joined with audio only — camera off' : 'You are live in the studio', 3600);
    if (window.zHydrateIcons) window.zHydrateIcons();
  }

  function leave() {
    ZS.confirmDialog({
      title: 'Leave the studio?',
      message: recorder && recorder.state === 'recording'
        ? 'Recording is running. Stopping now will keep the capture for you to save.'
        : 'Your camera and microphone will be turned off.',
      confirmText: 'Leave studio',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      if (recorder && recorder.state === 'recording') stopRecording();
      stopMeter();
      stopStream(localStream);
      stopStream(screenStream);
      location.href = session ? 'library.html?view=recordings' : 'index.html';
    });
  }

  /* ---------- wiring ---------- */
  function wire() {
    $('joinStudioBtn').addEventListener('click', function () { join(false); });
    $('joinAudioBtn').addEventListener('click', function () { join(true); });

    $('micBtn').addEventListener('click', function () {
      if (!localStream) { ZS.toast('No microphone connected.', 'error'); return; }
      micOn = !micOn;
      localStream.getAudioTracks().forEach(function (t) { t.enabled = micOn; });
      updateSelfChrome();
      renderPeople();
    });

    $('camBtn').addEventListener('click', function () {
      if (!localStream) { ZS.toast('No camera connected.', 'error'); return; }
      camOn = !camOn;
      localStream.getVideoTracks().forEach(function (t) { t.enabled = camOn; });
      updateSelfChrome();
      renderPeople();
    });

    $('shareBtn').addEventListener('click', function () {
      if (screenStream) stopShare();
      else startShare();
    });
    $('stopShareBtn').addEventListener('click', stopShare);

    $('inviteBtn').addEventListener('click', copyInvite);
    $('inviteTopBtn').addEventListener('click', function () { openPeople(); copyInvite(); });
    $('inviteCta').addEventListener('click', function () { openPeople(); copyInvite(); });
    $('panelInviteBtn').addEventListener('click', copyInvite);

    $('recordBtn').addEventListener('click', function () {
      if (recorder && recorder.state === 'recording') stopRecording();
      else startRecording();
    });

    $('settingsBtn').addEventListener('click', function () { ZS.openModal('studioSettings'); });
    $('leaveBtn').addEventListener('click', leave);

    $('videoGrid').addEventListener('click', function (e) {
      if (e.target.closest('[data-open-invite]')) copyInvite();
    });

    $('peopleToggle').addEventListener('click', togglePeople);
    $('peopleClose').addEventListener('click', function () { $('peoplePanel').classList.add('collapsed'); });

    $('mirrorToggle').addEventListener('change', function () {
      applyCameraLook();
      var tile = $('selfTile');
      if (tile) tile.classList.toggle('mirror', this.checked);
    });

    $('blurToggle').addEventListener('change', function () {
      prefs.background = this.checked ? 'blur' : 'none';
      $('settingBackground').value = this.checked ? 'blur' : 'none';
      applyCameraLook();
    });

    $('noiseToggle').addEventListener('change', function () {
      var enabled = this.checked;
      if (!localStream) return;
      localStream.getAudioTracks().forEach(function (track) {
        if (track.applyConstraints) {
          track.applyConstraints({ noiseSuppression: enabled, echoCancellation: enabled }).catch(function () {
            ZS.toast('This device does not support changing noise suppression live.', 'error');
          });
        }
      });
      ZS.toast(enabled ? 'Noise suppression on' : 'Noise suppression off');
    });

    $('settingBackground').addEventListener('change', function () {
      prefs.background = this.value;
      $('blurToggle').checked = this.value === 'blur';
      applyCameraLook();
    });
    $('settingQuality').addEventListener('change', function () {
      prefs.quality = this.value;
      ZS.update(function (s) { s.settings.quality = prefs.quality; return s; });
    });
    $('settingEpisode').addEventListener('change', function () {
      prefs.episode = this.value.trim();
      if (!session && this.value.trim()) $('studioTitle').textContent = this.value.trim();
    });

    $('downloadRecordingBtn').addEventListener('click', downloadPending);
    $('discardRecordingBtn').addEventListener('click', function () {
      ZS.confirmDialog({ title: 'Discard this recording?', message: 'The capture cannot be recovered.', confirmText: 'Discard', danger: true })
        .then(function (ok) { if (ok) discardRecording(); });
    });
    $('saveRecordingBtn').addEventListener('click', saveRecording);

    ZS.$$('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () { ZS.closeModal(btn.getAttribute('data-close')); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && joined) $('peoplePanel').classList.add('collapsed');
    });

    window.addEventListener('pagehide', function () {
      stopMeter();
      stopStream(localStream);
      stopStream(screenStream);
    });
  }

  function init() {
    resolveContext();
    fillContext();
    wire();
    renderGrid();
    startPreview(false);
    var st = ZS.state().settings;
    $('mirrorToggle').checked = true;
    $('blurToggle').checked = prefs.background === 'blur';
    if (st.background === 'gradient-violet') prefs.background = 'soft';
    applyCameraLook();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
