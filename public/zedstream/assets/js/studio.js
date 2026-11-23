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
  var linkTitle = '';
  var roomId = '';
  var previewAttempted = false;
  var netStarted = false;
  var prefs = { background: 'none', quality: '1080', episode: '', mirror: true, noise: true };
  var recCanvas = null;
  var recCtx = null;
  var recTimer = 0;
  var recTrack = null;
  var recCanvasStream = null;
  var recMixedStream = null;
  var recAudioCtx = null;

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
    linkTitle = params.get('title') || '';

    if (token) {
      // Joining from an invitation link is always a guest, even on a device
      // that does not hold the host's local session data.
      role = 'guest';
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

    // A room link is self-contained: whoever opens it joins the same room,
    // with no schedule entry or invitation token to look up.
    var roomParam = params.get('room');
    if (roomParam) {
      var hosting = params.get('host') === '1' || params.get('start') === '1';
      session = null;
      guest = null;
      role = hosting ? 'host' : 'guest';
      roomId = roomParam;
    } else if (session) {
      roomId = session.id;
    } else {
      roomId = 'zed-' + Math.random().toString(36).slice(2, 8);
      var url = new URL(location.href);
      url.searchParams.set('room', roomId);
      url.searchParams.set('host', '1');
      history.replaceState(null, '', url.pathname + '?' + url.searchParams.toString());
      role = 'host';
    }
  }

  function contextTitle() {
    if (session) return session.episodeTitle || 'Untitled episode';
    if (linkTitle) return linkTitle;
    return 'Live studio';
  }

  function roomKey() {
    return roomId;
  }

  function guestRoomLink() {
    return ZS.baseUrl() + 'studio.html?room=' + encodeURIComponent(roomId);
  }

  function fillContext() {
    $('studioTitle').textContent = contextTitle();
    $('studioSub').textContent = role === 'guest'
      ? 'Guest room · joined by invitation'
      : (session ? ZS.fmtDateLong(session.date, session.time) : 'Copy the invite link to bring guests in');
    $('participantsCount').textContent = '1';

    var name = guest ? guest.name : (ZS.state().settings.displayName || (role === 'guest' ? 'Guest' : 'Host'));
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

    var peers = window.ZSN ? window.ZSN.list() : [];
    peers.forEach(function (peer) {
      var connection = peer.connection === 'connected' ? 'in studio' : (peer.connection || 'connecting');
      html += '<div class="person">' +
        '<span class="avatar" style="background:linear-gradient(140deg,#5b21b6,#2b1050)">' + ZS.esc(ZS.initials(peer.name)) + '</span>' +
        '<span class="person-meta"><strong>' + ZS.esc(peer.name) + '</strong>' +
        '<small>' + (peer.role === 'host' ? 'Host' : 'Guest') + ' · ' + ZS.esc(connection) + '</small></span>' +
        '<span class="person-icons">' +
        '<span class="' + (peer.mic ? 'on' : 'off') + '">' + zIcon(peer.mic ? 'mic' : 'micOff') + '</span>' +
        '<span class="' + (peer.cam ? 'on' : 'off') + '">' + zIcon(peer.cam ? 'video' : 'videoOff') + '</span>' +
        '</span></div>';
    });

    var connected = peers.map(function (peer) { return String(peer.name || '').toLowerCase(); });
    guests.forEach(function (g) {
      if (guest && g.id === guest.id) return;
      if (connected.indexOf(String(g.name || '').toLowerCase()) !== -1) return;
      html += '<div class="person">' +
        '<span class="avatar" style="background:linear-gradient(140deg,#3f3f56,#242433)">' + ZS.esc(ZS.initials(g.name || g.email)) + '</span>' +
        '<span class="person-meta"><strong>' + ZS.esc(g.name || 'Guest') + '</strong>' +
        '<small><span class="badge badge-amber" style="height:17px;font-size:9.5px;padding:0 6px">Invited</span></small></span>' +
        '<span class="person-icons" style="opacity:.5">' + zIcon('mic') + zIcon('video') + '</span></div>';
    });

    list.innerHTML = html;
    var panelCount = $('panelGuests');
    if (panelCount) panelCount.textContent = String(1 + peers.length);
    if (window.zHydrateIcons) window.zHydrateIcons();
  }

  /* ---------- tiles ---------- */
  function selfName() {
    return guest ? guest.name : (ZS.state().settings.displayName || (role === 'guest' ? 'Guest' : 'Host'));
  }

  function renderGrid() {
    var grid = $('videoGrid');
    var guests = session ? (session.guests || []).filter(function (g) { return !guest || g.id !== guest.id; }) : [];
    var waiting = guests.slice(0, 6);
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

    var peers = window.ZSN ? window.ZSN.list() : [];
    peers.forEach(function (peer) {
      var live = peer.connection === 'connected';
      var hasVideo = !!peer.videoStream && peer.cam;
      tiles.push(
        '<div class="tile" id="peerTile-' + ZS.esc(peer.id) + '">' +
        '<video id="peerVideo-' + ZS.esc(peer.id) + '" autoplay playsinline></video>' +
        '<div class="tile-empty' + (hasVideo ? ' hidden' : '') + '" id="peerEmpty-' + ZS.esc(peer.id) + '">' +
        '<span class="avatar">' + ZS.esc(ZS.initials(peer.name)) + '</span>' +
        '<strong>' + ZS.esc(peer.name) + '</strong>' +
        '<span>' + (live ? (peer.cam ? 'Connected' : 'Camera off') : 'Connecting…') + '</span></div>' +
        '<div class="tile-top"><span class="tile-name">' + ZS.esc(peer.name) +
        ' <span class="role">' + (peer.role === 'host' ? 'Host' : 'Guest') + '</span></span>' +
        '<span class="tile-signal' + (live ? '' : ' warn') + '">' + zIcon(live ? 'signal' : 'clock') +
        (live ? 'Live' : 'Linking') + '</span></div>' +
        '<div class="tile-bottom"><div class="tile-status">' +
        '<span class="mic-chip' + (peer.mic ? '' : ' muted') + '">' + zIcon(peer.mic ? 'mic' : 'micOff') + '</span>' +
        (peer.sharing ? '<span class="badge badge-violet" style="height:22px">' + zIcon('monitor') + 'Sharing</span>' : '') +
        '</div><span class="tile-signal">WebRTC</span></div></div>'
      );
    });

    if (!peers.length && role === 'guest') {
      tiles.push(
        '<div class="tile">' +
        '<div class="tile-empty"><span class="pulse-ring"></span>' +
        '<span class="avatar" style="background:linear-gradient(140deg,#4c1d95,#2b1050)">' + ZS.esc(ZS.initials('Host')) + '</span>' +
        '<strong>Host</strong><span>Waiting for the host to start</span></div>' +
        '<div class="tile-top"><span class="tile-name">Host <span class="role">Host</span></span>' +
        '<span class="tile-signal warn">' + zIcon('clock') + 'Waiting</span></div></div>'
      );
    } else if (!peers.length && waiting.length) {
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
    } else if (!peers.length) {
      tiles.push(
        '<div class="tile">' +
        '<div class="tile-empty"><span class="pulse-ring"></span>' +
        '<span class="avatar" style="background:linear-gradient(140deg,#4c1d95,#2b1050)">' + zIcon('userPlus') + '</span>' +
        '<strong>Invite a guest</strong><span>Copy the joining link and send it over</span>' +
        '<button class="btn btn-sm btn-soft" type="button" data-open-invite style="margin-top:6px">' + zIcon('link') + 'Copy invite</button></div>' +
        '<div class="tile-top"><span class="tile-name">Guest seat <span class="role">Empty</span></span></div></div>'
      );
    }

    grid.className = 'video-grid' +
      (tiles.length === 1 ? ' solo' : tiles.length === 2 ? '' : tiles.length <= 4 ? ' triple' : tiles.length <= 6 ? ' crowd-3' : ' crowd-4');
    grid.innerHTML = tiles.join('');

    peers.forEach(function (peer) {
      var peerVideo = $('peerVideo-' + peer.id);
      var playable = peer.stream || peer.videoStream;
      if (peerVideo && playable) {
        if (peerVideo.srcObject !== playable) peerVideo.srcObject = playable;
        peerVideo.play().catch(function () { /* autoplay may need a gesture */ });
      }
    });

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
        v.style.transform = prefs.mirror ? 'scaleX(-1) scale(1.06)' : 'scale(1.06)';
      } else if (bgSetting === 'soft') {
        v.style.filter = 'saturate(1.05) contrast(1.03)';
        v.style.transform = prefs.mirror ? 'scaleX(-1)' : 'none';
      } else {
        v.style.filter = 'none';
        v.style.transform = prefs.mirror ? 'scaleX(-1)' : 'none';
      }
    });
    var self = $('selfTile');
    if (self) self.classList.toggle('mirror', !!prefs.mirror);
  }

  /* ---------- devices ---------- */
  function startPreview(audioOnly) {
    previewAttempted = true;
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
      if (joined && window.ZSN) window.ZSN.setLocalStream(stream);
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
    if (role === 'guest') {
      ZS.copyText(location.href, 'Room link copied');
      return;
    }
    if (session && (session.guests || []).length) {
      var g = guest || session.guests[0];
      ZS.copyText(ZS.inviteUrl(session, g), 'Guest joining link copied');
      return;
    }
    ZS.copyText(guestRoomLink(), 'Guest link copied — send it to anyone you want in the room');
  }

  function openPeople() {
    $('peoplePanel').classList.remove('collapsed');
  }

  function togglePeople() {
    $('peoplePanel').classList.toggle('collapsed');
  }

  /* ---------- recording ---------- */
  function recordingFileName(title) {
    var now = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var base = String(title || prefs.episode || 'ZedStream recording')
      .replace(/[^\w\-. ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'ZedStream recording';
    return base + ' · ' + now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' +
      pad(now.getDate()) + ' ' + pad(now.getHours()) + '-' + pad(now.getMinutes()) + '.webm';
  }

  // Writes the file to the machine's downloads, so a take is never only in
  // browser storage.
  function saveToDevice(blob, name) {
    if (!blob || !blob.size) return;
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 90000);
  }

  function pickMime() {
    var candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'audio/webm'];
    if (!window.MediaRecorder) return '';
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  /* The recording is the studio view, not just one camera: the shared
     screen, movie or document on the stage plus every participant, with a
     mixed audio track carrying all microphones and the shared sound. */
  function recordSize() {
    var width = prefs.quality === '720' ? 1280 : 1920;
    return { w: width, h: Math.round(width * 9 / 16) };
  }

  function recordingParticipants() {
    var list = [];
    var self = $('selfVideo');
    if (self) list.push({ video: self, name: selfName() || 'You' });
    (window.ZSN ? window.ZSN.list() : []).forEach(function (peer) {
      var el = $('peerVideo-' + peer.id);
      if (el) list.push({ video: el, name: peer.name || 'Guest' });
    });
    return list;
  }

  function shareVisualForRecording() {
    if (share.mode === 'screen') {
      var screen = $('shareVideo');
      return screen && screen.readyState >= 2 ? { el: screen, type: 'video' } : null;
    }
    if (share.mode === 'media' && share.queue.length) {
      var item = share.queue[share.index];
      if (item && item.kind === 'video') {
        var video = $('shareVideo');
        return video && video.readyState >= 2 ? { el: video, type: 'video' } : null;
      }
      return null;
    }
    if (share.mode === 'document') {
      var image = $('shareImage');
      if (image && !image.classList.contains('hidden') && image.naturalWidth) {
        return { el: image, type: 'image' };
      }
    }
    return null;
  }

  function recordingShareAudio() {
    var el = null;
    if (share.mode === 'media') el = activeMediaEl();
    else if (share.mode === 'screen') el = $('shareVideo');
    if (!el || !el.captureStream) return null;
    try {
      var stream = el.captureStream();
      return stream && stream.getAudioTracks().length ? stream : null;
    } catch (e) {
      return null;
    }
  }

  function buildRecordingAudio() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    var inputs = [];
    if (localStream && micOn && localStream.getAudioTracks().length) inputs.push(localStream);
    (window.ZSN ? window.ZSN.list() : []).forEach(function (peer) {
      if (peer.audioTrack && peer.audioTrack.readyState === 'live') {
        inputs.push(new MediaStream([peer.audioTrack]));
      }
    });
    var shared = recordingShareAudio();
    if (shared) inputs.push(shared);
    if (!inputs.length) return null;

    var ctx = new Ctx();
    var destination = ctx.createMediaStreamDestination();
    inputs.forEach(function (stream) {
      try {
        ctx.createMediaStreamSource(stream).connect(destination);
      } catch (e) { /* one silent input must not kill the mix */ }
    });
    recAudioCtx = ctx;
    return destination.stream;
  }

  function drawRecordingTile(ctx, video, x, y, w, h) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = '#141021';
    ctx.fillRect(x, y, w, h);
    if (video && video.readyState >= 2 && video.videoWidth) {
      var scale = Math.max(w / video.videoWidth, h / video.videoHeight);
      var dw = video.videoWidth * scale;
      var dh = video.videoHeight * scale;
      try { ctx.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); } catch (e) { /* frame not ready */ }
    }
    ctx.restore();
  }

  function drawRecordingLabel(ctx, name, x, y) {
    ctx.save();
    ctx.font = '600 15px system-ui, sans-serif';
    var text = String(name || '').slice(0, 28);
    var width = ctx.measureText(text).width + 18;
    ctx.fillStyle = 'rgba(10,7,17,.72)';
    ctx.fillRect(x + 8, y + 8, width, 24);
    ctx.fillStyle = '#f4f1ff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 17, y + 20);
    ctx.restore();
  }

  function drawRecordingFrame() {
    if (!recCtx || !recCanvas) return;
    var ctx = recCtx;
    var W = recCanvas.width;
    var H = recCanvas.height;
    ctx.fillStyle = '#0b0710';
    ctx.fillRect(0, 0, W, H);

    var visual = shareVisualForRecording();
    var parts = recordingParticipants();

    if (visual) {
      var pad = 0; // no gutters: the shared screen and the room meet edge to edge
      var thumbHeight = Math.round(H * 0.26);
      var sourceW = visual.type === 'video' ? visual.el.videoWidth : visual.el.naturalWidth;
      var sourceH = visual.type === 'video' ? visual.el.videoHeight : visual.el.naturalHeight;
      var mainH = H - thumbHeight - pad * 2;
      if (sourceW && sourceH) {
        var fit = Math.min(W / sourceW, mainH / sourceH);
        var dw = sourceW * fit;
        var dh = sourceH * fit;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, mainH);
        try { ctx.drawImage(visual.el, (W - dw) / 2, (mainH - dh) / 2, dw, dh); } catch (e) { /* frame not ready */ }
      }
      if (parts.length) {
        var tw = Math.min((W - pad * (parts.length + 1)) / parts.length, thumbHeight * 16 / 9);
        var th = tw * 9 / 16;
        parts.slice(0, 6).forEach(function (part, i) {
          var x = pad + i * (tw + pad);
          var y = H - th;
          drawRecordingTile(ctx, part.video, x, y, tw, th);
          drawRecordingLabel(ctx, part.name, x, y);
        });
      }
    } else {
      var count = Math.max(1, parts.length);
      var cols = count === 1 ? 1 : count === 2 ? 2 : Math.ceil(Math.sqrt(count));
      var rows = Math.ceil(count / cols);
      var gap = 0; // one room: tiles butt together with no dividing lines
      var cellW = (W - gap * (cols + 1)) / cols;
      var cellH = (H - gap * (rows + 1)) / rows;
      parts.forEach(function (part, i) {
        var x = gap + (i % cols) * (cellW + gap);
        var y = gap + Math.floor(i / cols) * (cellH + gap);
        drawRecordingTile(ctx, part.video, x, y, cellW, cellH);
        drawRecordingLabel(ctx, part.name, x, y);
      });
    }

    if (recTrack && recTrack.requestFrame) {
      try { recTrack.requestFrame(); } catch (e) { /* older engines paint on change */ }
    }
  }

  function releaseRecording() {
    if (recTimer) clearInterval(recTimer);
    recTimer = 0;
    if (recCanvasStream) {
      recCanvasStream.getTracks().forEach(function (track) { try { track.stop(); } catch (e) { /* noop */ } });
      recCanvasStream = null;
    }
    recTrack = null;
    if (recMixedStream) {
      recMixedStream.getTracks().forEach(function (track) { try { track.stop(); } catch (e) { /* noop */ } });
      recMixedStream = null;
    }
    if (recAudioCtx) { try { recAudioCtx.close(); } catch (e) { /* noop */ } recAudioCtx = null; }
    recCanvas = null;
    recCtx = null;
  }

  function buildRecordingStream() {
    releaseRecording();
    var size = recordSize();
    recCanvas = document.createElement('canvas');
    recCanvas.width = size.w;
    recCanvas.height = size.h;
    recCtx = recCanvas.getContext('2d');

    // Frames are pushed explicitly. Some Chromium builds throw away
    // automatically captured canvas frames as soon as audio is muxed in,
    // which produced empty recordings.
    recCanvasStream = recCanvas.captureStream(0);
    recTrack = recCanvasStream.getVideoTracks()[0];
    if (!recTrack || !recTrack.requestFrame) {
      recCanvasStream.getTracks().forEach(function (track) { try { track.stop(); } catch (e) { /* noop */ } });
      recCanvasStream = recCanvas.captureStream(30);
      recTrack = recCanvasStream.getVideoTracks()[0];
    }

    drawRecordingFrame();
    recTimer = setInterval(drawRecordingFrame, 33);

    var tracks = recCanvasStream.getVideoTracks().slice();
    var audio = buildRecordingAudio();
    if (audio) tracks = tracks.concat(audio.getAudioTracks());
    recMixedStream = new MediaStream(tracks);
    return recMixedStream;
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
      options.videoBitsPerSecond = prefs.quality === '720' ? 2500000 : 5500000;
      options.audioBitsPerSecond = 128000;
      var mixed = buildRecordingStream();
      if (!mixed || !mixed.getVideoTracks().length) throw new Error('No recordable surface');
      recorder = new MediaRecorder(mixed, options);
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
      showNote('Recording the studio — every participant and whatever is shared', 3600);
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
    releaseRecording();
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
    saveToDevice(blob, recordingFileName($('recTitle').value));
    ZS.toast('Recording saved to your device', 'success');
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
    saveToDevice(pendingBlob, recordingFileName($('recTitle').value));
    ZS.toast('Saving a copy to your device', 'success');
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

    // Ask the browser to keep this origin's storage instead of treating it as
    // disposable cache, so library playback survives restarts.
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () { /* best effort */ });
    }
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

  /* ============================================================
     sharing: screen / window, song or album, movie, document
     ============================================================ */
  var share = { mode: 'none', queue: [], index: 0, screen: null, volume: 0.85, muted: false, remote: null, published: false };

  function setShareHead(kind, title, sub) {
    $('shareKind').textContent = kind;
    $('shareTitle').textContent = title;
    $('shareSub').textContent = sub;
  }

  function resetShareCanvas() {
    var video = $('shareVideo');
    var audio = $('shareAudio');
    if (video) {
      video.pause();
      video.srcObject = null;
      video.removeAttribute('src');
      video.classList.add('hidden');
    }
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.removeAttribute('src');
    }
    $('shareImage').classList.add('hidden');
    $('shareImage').removeAttribute('src');
    $('shareDoc').classList.add('hidden');
    $('shareDoc').removeAttribute('src');
    $('shareText').classList.add('hidden');
    $('shareText').textContent = '';
    $('shareAudioVisual').classList.add('hidden');
    $('shareAlbumArt').classList.remove('playing');
    $('shareDiscuss').classList.add('hidden');
    $('shareProgressWrap').classList.add('hidden');
  }

  function activeMediaEl() {
    if (share.mode !== 'media' || !share.queue.length) return null;
    var item = share.queue[share.index];
    if (!item) return null;
    if (item.kind === 'audio') return $('shareAudio');
    if (item.kind === 'video') return $('shareVideo');
    return null;
  }

  function syncShareButton() {
    var btn = $('sharePlayBtn');
    if (!btn) return;
    if (share.mode === 'screen') {
      btn.innerHTML = zIcon('message') + '<span>Discuss</span>';
      return;
    }
    var el = activeMediaEl();
    var paused = !el || el.paused;
    btn.innerHTML = paused
      ? zIcon('play') + '<span>Play</span>'
      : zIcon('pause') + '<span>Pause</span>';
  }

  function applyShareVolume() {
    ['shareAudio', 'shareVideo'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.muted = share.muted;
      el.volume = share.volume;
    });
    $('shareVolume').value = String(Math.round((share.muted ? 0 : share.volume) * 100));
    $('shareMute').innerHTML = zIcon(share.muted ? 'volumeOff' : 'volume');
    $('shareMute').classList.toggle('muted', share.muted);
  }

  function updateShareProgress() {
    var el = activeMediaEl();
    var seek = $('shareSeek');
    var label = $('shareTime');
    if (!el) {
      label.textContent = '0:00 / 0:00';
      seek.value = '0';
      return;
    }
    var duration = isFinite(el.duration) ? el.duration : 0;
    seek.max = String(Math.max(1, Math.round(duration)));
    seek.value = String(Math.round(el.currentTime || 0));
    label.textContent = ZS.fmtDuration(el.currentTime || 0) + ' / ' + ZS.fmtDuration(duration);
  }

  function renderShareQueue() {
    $('shareQueueList').innerHTML = share.queue.map(function (item, i) {
      var icon = item.kind === 'audio' ? 'music' : item.kind === 'video' ? 'film' : 'fileText';
      return '<button class="share-item' + (i === share.index ? ' active' : '') + '" type="button" data-share-index="' + i + '">' +
        zIcon(icon) + '<span><strong>' + ZS.esc(item.name) + '</strong><small>' + ZS.esc(item.kind) + '</small></span></button>';
    }).join('');
  }

  function loadShareItem(index) {
    if (!share.queue.length) return;
    share.index = Math.max(0, Math.min(index, share.queue.length - 1));
    var item = share.queue[share.index];
    resetShareCanvas();

    var isAudio = item.kind === 'audio';
    var isVideo = item.kind === 'video';
    var isImage = /^image\//.test(item.file.type);

    $('shareTitle').textContent = item.name;
    $('shareKind').textContent = isAudio ? 'Audio' : isVideo ? 'Video' : 'Document';
    $('shareSub').textContent = (share.queue.length > 1 ? 'Item ' + (share.index + 1) + ' of ' + share.queue.length + ' · ' : '') +
      'Local file · never uploaded';
    $('shareProgressWrap').classList.toggle('hidden', !(isAudio || isVideo));
    $('sharePrev').classList.toggle('hidden', share.queue.length < 2);
    $('shareNext').classList.toggle('hidden', share.queue.length < 2);
    renderShareQueue();

    if (isAudio) {
      $('shareAudioVisual').classList.remove('hidden');
      $('shareAlbumArt').classList.add('playing');
      $('shareTrack').textContent = item.name.replace(/\.[^.]+$/, '');
      var audio = $('shareAudio');
      audio.src = item.url;
      audio.volume = share.volume;
      audio.muted = share.muted;
      audio.play().catch(function () { /* the play button starts it */ });
    } else if (isVideo) {
      var video = $('shareVideo');
      video.srcObject = null;
      video.src = item.url;
      video.muted = share.muted;
      video.volume = share.volume;
      video.classList.remove('hidden');
      video.play().catch(function () { /* the play button starts it */ });
    } else if (isImage) {
      $('shareImage').src = item.url;
      $('shareImage').classList.remove('hidden');
    } else if (/\.pdf$/i.test(item.name)) {
      $('shareDoc').src = item.url;
      $('shareDoc').classList.remove('hidden');
    } else {
      $('shareText').textContent = item.text ||
        'This file type cannot be previewed in the studio. PDFs, images, text, audio and video work best.';
      $('shareText').classList.remove('hidden');
    }

    syncShareButton();
    updateShareProgress();

    if (isAudio) publishElementShare(audio, 'audio', item.name);
    else if (isVideo) publishElementShare(video, 'video', item.name);
    else {
      shareToRoom('document', item.name, null);
      sendDocToRoom(item);
    }

    if (window.zHydrateIcons) window.zHydrateIcons();
  }

  function openShareFiles(kind, fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var items = files.map(function (file) {
      return { kind: kind, name: file.name, file: file, url: URL.createObjectURL(file), text: '' };
    });

    var textJobs = items.filter(function (item) {
      return kind === 'doc' && (/^text\//.test(item.file.type) || /\.(txt|md|csv|json|srt|vtt)$/i.test(item.name));
    }).map(function (item) {
      return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function () { item.text = String(reader.result || '').slice(0, 60000); resolve(); };
        reader.onerror = function () { resolve(); };
        reader.readAsText(item.file);
      });
    });

    Promise.all(textJobs).then(function () {
      closeShare(true);
      share.muted = false;
      share.mode = 'media';
      share.queue = items;
      share.index = 0;
      $('shareStage').classList.remove('hidden');
      $('videoGrid').classList.add('hidden');
      $('shareBtn').classList.add('active');
      $('shareQueue').classList.toggle('hidden', items.length < 2);
      loadShareItem(0);
      ZS.closeModal('shareModal');
      showNote(items.length > 1 ? 'Loaded ' + items.length + ' items into the share queue' : 'Opened ' + items[0].name, 3600);
    });
  }

  function startScreenShare() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      ZS.toast('Screen sharing is not available in this browser.', 'error');
      return;
    }
    navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true }).then(function (stream) {
      closeShare(true);
      share.muted = false;
      share.mode = 'screen';
      share.screen = stream;
      resetShareCanvas();

      $('shareStage').classList.remove('hidden');
      $('videoGrid').classList.add('hidden');
      $('shareBtn').classList.add('active');
      $('shareQueue').classList.add('hidden');
      $('sharePrev').classList.add('hidden');
      $('shareNext').classList.add('hidden');
      $('shareProgressWrap').classList.add('hidden');

      var video = $('shareVideo');
      video.srcObject = stream;
      video.classList.remove('hidden');
      video.muted = false;
      video.volume = share.volume;
      video.play().catch(function () { /* capture still renders */ });

      var hasAudio = stream.getAudioTracks().length > 0;
      setShareHead('Screen', 'Your screen or window',
        hasAudio ? 'Live from this device · system audio on' : 'Live from this device · no audio captured');
      syncShareButton();
      applyShareVolume();

      var track = stream.getVideoTracks()[0];
      if (track) track.addEventListener('ended', function () { closeShare(); });

      ZS.closeModal('shareModal');
      shareToRoom('screen', 'Screen share', stream);
      showNote(hasAudio ? 'Sharing your screen with sound' : 'Sharing your screen — tick “Share audio” for sound', 5200);
    }).catch(function (err) {
      if (err && err.name === 'NotAllowedError') ZS.toast('Screen share was cancelled.');
      else ZS.toast('Screen sharing could not start.', 'error');
    });
  }

  function toggleDiscuss() {
    var overlay = $('shareDiscuss');
    overlay.classList.toggle('hidden');
    if (share.mode === 'media') syncShareButton();
    if (share.published && window.ZSN) {
      window.ZSN.announcePause(!overlay.classList.contains('hidden'));
    }
  }

  function toggleSharePlayback() {
    if (share.mode === 'none') return;
    if (share.mode === 'screen') { toggleDiscuss(); return; }

    var el = activeMediaEl();
    if (!el) {
      ZS.toast('This item is a preview — there is nothing to play.');
      return;
    }
    if (el.paused) {
      el.play().catch(function () { ZS.toast('Playback was blocked by the browser.', 'error'); });
      $('shareDiscuss').classList.add('hidden');
      $('shareAlbumArt').classList.add('playing');
    } else {
      el.pause();
      $('shareDiscuss').classList.remove('hidden');
      $('shareAlbumArt').classList.remove('playing');
    }
    if (share.published && window.ZSN) {
      window.ZSN.announcePause(!$('shareDiscuss').classList.contains('hidden'));
    }
    syncShareButton();
  }

  function skipShare(delta) {
    if (share.queue.length < 2) return;
    loadShareItem((share.index + delta + share.queue.length) % share.queue.length);
  }

  function closeShare(silent) {
    if (share.published && window.ZSN) {
      window.ZSN.removeShareStream();
      window.ZSN.announceStop();
    }
    share.published = false;
    if (share.screen) {
      stopStream(share.screen);
      share.screen = null;
    }
    resetShareCanvas();
    share.queue.forEach(function (item) {
      try { URL.revokeObjectURL(item.url); } catch (e) { /* noop */ }
    });
    share.queue = [];
    share.index = 0;
    share.mode = 'none';
    $('shareStage').classList.add('hidden');
    $('videoGrid').classList.remove('hidden');
    $('shareBtn').classList.remove('active');
    $('shareQueue').classList.add('hidden');
    $('shareQueueList').innerHTML = '';
    $('shareTitle').textContent = 'Nothing shared';
    $('shareSub').textContent = 'Local studio';
    $('sharePlayBtn').classList.remove('hidden');
    $('closeShareBtn').innerHTML = zIcon('x') + ' Close';
    if (!silent) showNote('Share closed — back to the studio', 3000);
  }

  /* ---------- sharing to the room ---------- */
  function shareToRoom(kind, title, stream) {
    if (!window.ZSN) return;
    window.ZSN.removeShareStream();
    if (stream && stream.getTracks().length) window.ZSN.addShareStream(stream);
    window.ZSN.announceShare({
      kind: kind,
      title: title || '',
      hasVideo: !!(stream && stream.getVideoTracks().length),
      hasAudio: !!(stream && stream.getAudioTracks().length)
    });
    share.published = true;
  }

  function publishElementShare(el, kind, title) {
    if (!window.ZSN || !el) return;
    var done = false;

    function publish() {
      if (done) return;
      var stream = el.captureStream ? el.captureStream() : null;
      if (!stream || !stream.getTracks().length) return;
      done = true;
      el.removeEventListener('loadedmetadata', publish);
      el.removeEventListener('playing', publish);
      shareToRoom(kind, title, stream);
    }

    if (el.readyState >= 1) publish();
    if (!done) {
      el.addEventListener('loadedmetadata', publish);
      el.addEventListener('playing', publish);
    }
    setTimeout(publish, 900);
  }

  function sendDocToRoom(item) {
    if (!window.ZSN || !item.file) return;
    if (item.file.size > 8 * 1024 * 1024) {
      ZS.toast('Documents over 8 MB stay on this device — others get the title only.', 'error');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      window.ZSN.sendDoc({
        name: item.name,
        mime: item.file.type || 'application/octet-stream',
        data: String(reader.result)
      });
    };
    reader.readAsDataURL(item.file);
  }

  function showRemoteShare(peer) {
    if (share.published) return;
    if (share.mode === 'remote' && share.remote === peer.id) {
      $('shareTitle').textContent = peer.shareTitle || 'Shared media';
      attachRemoteShare(peer);
      return;
    }
    if (share.mode !== 'none') closeShare(true);
    closeRemoteShare(true);

    share.mode = 'remote';
    share.remote = peer.id;
    resetShareCanvas();
    $('shareStage').classList.remove('hidden');
    $('videoGrid').classList.add('hidden');
    $('sharePrev').classList.add('hidden');
    $('shareNext').classList.add('hidden');
    $('shareQueue').classList.add('hidden');
    $('shareProgressWrap').classList.add('hidden');
    $('sharePlayBtn').classList.add('hidden');
    $('shareKind').textContent = peer.shareKind === 'audio' ? 'Audio'
      : peer.shareKind === 'video' ? 'Video'
        : peer.shareKind === 'screen' ? 'Screen' : 'Document';
    $('shareTitle').textContent = peer.shareTitle || 'Shared media';
    $('shareSub').textContent = 'Shared by ' + (peer.name || 'a guest') + ' · live in this room';
    $('closeShareBtn').innerHTML = zIcon('x') + ' Hide';
    applyShareVolume();
    attachRemoteShare(peer);
    if (window.zHydrateIcons) window.zHydrateIcons();
  }

  function attachRemoteShare(peer) {
    if (!peer || !peer.shareStream) return;
    var hasVideo = peer.shareStream.getVideoTracks().length > 0;
    if (hasVideo) {
      var video = $('shareVideo');
      if (video.srcObject !== peer.shareStream) video.srcObject = peer.shareStream;
      video.classList.remove('hidden');
      video.muted = share.muted;
      video.volume = share.volume;
      video.play().catch(function () { /* muted autoplay fallback */ });
      $('shareAudioVisual').classList.add('hidden');
    } else {
      var audio = $('shareAudio');
      if (audio.srcObject !== peer.shareStream) audio.srcObject = peer.shareStream;
      audio.muted = share.muted;
      audio.volume = share.volume;
      audio.play().catch(function () { /* user gesture needed */ });
      $('shareAudioVisual').classList.remove('hidden');
      $('shareAlbumArt').classList.add('playing');
      $('shareTrack').textContent = peer.shareTitle || 'Shared audio';
    }
  }

  function closeRemoteShare(silent) {
    if (share.mode !== 'remote') return;
    resetShareCanvas();
    share.mode = 'none';
    share.remote = null;
    $('shareStage').classList.add('hidden');
    $('videoGrid').classList.remove('hidden');
    $('sharePlayBtn').classList.remove('hidden');
    $('closeShareBtn').innerHTML = zIcon('x') + ' Close';
    if (!silent) showNote('Stopped viewing shared media', 2600);
  }

  function decodeDataUrl(dataUrl) {
    try {
      var base64 = String(dataUrl).split(',')[1] || '';
      return decodeURIComponent(escape(atob(base64))).slice(0, 60000);
    } catch (error) {
      return 'This document could not be previewed.';
    }
  }

  function showRemoteDoc(message) {
    if (share.published) return;
    var peers = window.ZSN ? window.ZSN.list() : [];
    var sharer = peers.filter(function (p) { return p.id === message.from; })[0];
    showRemoteShare({
      id: message.from,
      name: sharer ? sharer.name : 'A guest',
      shareKind: 'document',
      shareTitle: message.name,
      shareStream: null
    });
    if (/^image\//.test(message.mime)) {
      $('shareImage').src = message.data;
      $('shareImage').classList.remove('hidden');
    } else if (/pdf/.test(message.mime)) {
      $('shareDoc').src = message.data;
      $('shareDoc').classList.remove('hidden');
    } else {
      $('shareText').textContent = decodeDataUrl(message.data);
      $('shareText').classList.remove('hidden');
    }
    if (window.zHydrateIcons) window.zHydrateIcons();
  }

  function updateParticipants() {
    var peers = window.ZSN ? window.ZSN.list() : [];
    $('participantsCount').textContent = String(1 + peers.length);
    $('participantsChip').classList.remove('hidden');
  }

  function wireNetwork() {
    if (!window.ZSN) return;
    window.ZSN.on('peers', function () {
      renderGrid();
      renderPeople();
      updateParticipants();
    });
    window.ZSN.on('peer-media', function () { renderGrid(); });
    window.ZSN.on('share-start', function (peer) {
      if (!share.published) showRemoteShare(peer);
    });
    window.ZSN.on('share-media', function (peer) {
      if (share.published) return;
      if (share.mode !== 'remote' || share.remote !== peer.id) showRemoteShare(peer);
      else attachRemoteShare(peer);
    });
    window.ZSN.on('share-stop', function () { closeRemoteShare(); });
    window.ZSN.on('share-pause', function (message) {
      if (share.mode !== 'remote' || share.remote !== message.from) return;
      $('shareDiscuss').classList.toggle('hidden', !message.paused);
      $('shareAlbumArt').classList.toggle('playing', !message.paused);
    });
    window.ZSN.on('doc', function (message) { showRemoteDoc(message); });
    window.ZSN.on('status', function (state) {
      if (state.state === 'joined') showNote('Connected to the studio room', 2600);
      if (state.state === 'refused') {
        showNote(state.reason || 'This studio is full', 8000);
        ZS.toast(state.reason || 'This studio is full', 'error');
      }
      renderPeople();
    });
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

    if (window.ZSN && !netStarted) {
      netStarted = true;
      window.ZSN.start({ room: roomKey(), name: name || selfName(), role: role, stream: localStream });
    }

    renderGrid();
    renderPeople();
    updateParticipants();
    if (!localStream && !previewAttempted) startPreview(audioOnly);
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
      closeShare(true);
      if (window.ZSN) window.ZSN.stop();
      stopStream(localStream);
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
      if (window.ZSN && netStarted) window.ZSN.setMediaState({ mic: micOn, cam: camOn });
    });

    $('camBtn').addEventListener('click', function () {
      if (!localStream) { ZS.toast('No camera connected.', 'error'); return; }
      camOn = !camOn;
      localStream.getVideoTracks().forEach(function (t) { t.enabled = camOn; });
      updateSelfChrome();
      renderPeople();
      if (window.ZSN && netStarted) window.ZSN.setMediaState({ mic: micOn, cam: camOn });
    });

    $('shareBtn').addEventListener('click', function () {
      if (share.mode !== 'none') { closeShare(); return; }
      ZS.openModal('shareModal');
    });

    $('shareModal').addEventListener('click', function (e) {
      var option = e.target.closest('[data-share-kind]');
      if (!option) return;
      var kind = option.getAttribute('data-share-kind');
      if (kind === 'screen') startScreenShare();
      else if (kind === 'audio') $('audioInput').click();
      else if (kind === 'video') $('videoInput').click();
      else $('docInput').click();
    });

    $('audioInput').addEventListener('change', function () {
      openShareFiles('audio', this.files);
      this.value = '';
    });
    $('videoInput').addEventListener('change', function () {
      openShareFiles('video', this.files);
      this.value = '';
    });
    $('docInput').addEventListener('change', function () {
      openShareFiles('doc', this.files);
      this.value = '';
    });

    $('closeShareBtn').addEventListener('click', function () { closeShare(); });
    $('sharePlayBtn').addEventListener('click', toggleSharePlayback);
    $('resumeShareBtn').addEventListener('click', toggleSharePlayback);
    $('sharePrev').addEventListener('click', function () { skipShare(-1); });
    $('shareNext').addEventListener('click', function () { skipShare(1); });
    $('shareQueueList').addEventListener('click', function (e) {
      var item = e.target.closest('[data-share-index]');
      if (item) loadShareItem(Number(item.getAttribute('data-share-index')));
    });

    $('shareMute').addEventListener('click', function () {
      share.muted = !share.muted;
      applyShareVolume();
      showNote(share.muted ? 'Shared audio muted' : 'Shared audio on', 1800);
    });
    $('shareVolume').addEventListener('input', function () {
      share.volume = Number(this.value) / 100;
      if (share.volume > 0) share.muted = false;
      applyShareVolume();
    });
    $('shareSeek').addEventListener('input', function () {
      var el = activeMediaEl();
      if (el) el.currentTime = Number(this.value);
    });

    ['shareAudio', 'shareVideo'].forEach(function (id) {
      var el = $(id);
      el.addEventListener('timeupdate', updateShareProgress);
      el.addEventListener('loadedmetadata', updateShareProgress);
      el.addEventListener('play', function () {
        $('shareAlbumArt').classList.add('playing');
        syncShareButton();
      });
      el.addEventListener('pause', syncShareButton);
      el.addEventListener('ended', function () {
        if (share.queue.length > 1) { skipShare(1); return; }
        $('shareDiscuss').classList.remove('hidden');
        $('shareAlbumArt').classList.remove('playing');
        syncShareButton();
      });
    });

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

    $('settingMirror').addEventListener('change', function () {
      prefs.mirror = this.checked;
      applyCameraLook();
      var tile = $('selfTile');
      if (tile) tile.classList.toggle('mirror', this.checked);
    });

    $('settingNoise').addEventListener('change', function () {
      var enabled = this.checked;
      prefs.noise = enabled;
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
      closeShare(true);
      if (window.ZSN) window.ZSN.stop();
      stopStream(localStream);
    });

    document.addEventListener('keydown', function (e) {
      if (share.mode === 'none') return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (e.code === 'Space') { e.preventDefault(); toggleSharePlayback(); }
    });
  }

  function init() {
    resolveContext();
    fillContext();
    wire();
    wireNetwork();
    renderGrid();

    // Coming from the landing page: go straight into the room and keep the
    // guest link one tap away. Joining does not wait on the camera prompt —
    // the preview fills in as soon as permission is answered.
    var autoStart = new URLSearchParams(location.search).get('start') === '1';
    startPreview(false);
    if (autoStart) {
      join(false);
      if (role !== 'guest') showNote('Your studio is live — Invite copies the guest link', 7000);
    }
    var st = ZS.state().settings;
    $('settingMirror').checked = prefs.mirror;
    $('settingNoise').checked = prefs.noise;
    if (st.background === 'gradient-violet') prefs.background = 'soft';
    applyCameraLook();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
