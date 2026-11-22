/* ============================================================
   ZedStream — studio room networking
   WebSocket room + WebRTC mesh (perfect negotiation), with
   screen / media sharing and document relay to every guest.
   ============================================================ */
window.ZSN = (function () {
  'use strict';

  var socket = null;
  var selfId = null;
  var config = { room: '', name: 'Guest', role: 'guest' };
  var localStream = null;
  var shareStream = null;
  var peers = new Map();
  var listeners = {};
  var started = false;
  var intentional = false;
  var reconnectTimer = null;
  var status = { state: 'idle' };

  var ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

  function on(type, fn) {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(fn);
  }

  function emit(type, payload) {
    (listeners[type] || []).forEach(function (fn) {
      try { fn(payload); } catch (error) { console.error('[ZedStream] listener failed', error); }
    });
  }

  function socketUrl() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/zed/ws' +
      '?room=' + encodeURIComponent(config.room) +
      '&name=' + encodeURIComponent(config.name) +
      '&role=' + encodeURIComponent(config.role);
  }

  function send(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify(message)); } catch (error) { /* socket closing */ }
    }
  }

  function sendSignal(to, data) {
    send({ type: 'signal', to: to, data: data });
  }

  function entryFor(id, info) {
    var entry = peers.get(id);
    if (entry) {
      if (info) Object.assign(entry, info);
      return entry;
    }
    entry = Object.assign({
      id: id,
      name: 'Guest',
      role: 'guest',
      mic: true,
      cam: true,
      sharing: false,
      shareKind: '',
      shareTitle: '',
      pc: null,
      videoStream: null,
      videoTrack: null,
      shareTrack: null,
      shareAudioTrack: null,
      shareStream: null,
      audioTrack: null,
      polite: false,
      makingOffer: false,
      ignoreOffer: false,
      shouldOffer: false,
      negotiated: false,
      connection: 'new',
      pending: []
    }, info || {});
    peers.set(id, entry);
    return entry;
  }

  function createPeer(entry) {
    if (!entry || entry.pc) return entry;
    var pc = new RTCPeerConnection(ICE);
    entry.pc = pc;
    entry.polite = String(selfId || '') > String(entry.id);
    entry.shouldOffer = String(selfId || '') < String(entry.id);

    if (localStream) {
      localStream.getTracks().forEach(function (track) {
        try { pc.addTrack(track, localStream); } catch (error) { /* duplicate */ }
      });
    }
    if (shareStream) {
      shareStream.getTracks().forEach(function (track) {
        try { pc.addTrack(track, shareStream); } catch (error) { /* duplicate */ }
      });
    }

    pc.onnegotiationneeded = function () {
      if (!entry.shouldOffer && !entry.negotiated) return;
      entry.makingOffer = true;
      pc.setLocalDescription().then(function () {
        sendSignal(entry.id, { sdp: pc.localDescription });
      }).catch(function () {
        /* the connection will retry on the next track change */
      }).then(function () {
        entry.makingOffer = false;
      });
    };

    pc.onicecandidate = function (event) {
      if (event.candidate) sendSignal(entry.id, { candidate: event.candidate });
    };

    pc.ontrack = function (event) {
      entry.negotiated = true;
      var track = event.track;

      if (track.kind === 'video') {
        if (!entry.videoTrack) {
          entry.videoTrack = track;
          entry.videoStream = new MediaStream([track]);
          emit('peer-media', entry);
        } else if (!entry.shareTrack) {
          entry.shareTrack = track;
          rebuildShareStream(entry);
        }
      } else if (track.kind === 'audio') {
        if (!entry.audioTrack) {
          entry.audioTrack = track;
        } else if (!entry.shareAudioTrack) {
          entry.shareAudioTrack = track;
          rebuildShareStream(entry);
        }
      }
    };

    pc.onconnectionstatechange = function () {
      entry.connection = pc.connectionState;
      if (pc.connectionState === 'connected') entry.negotiated = true;
      emit('peers');
    };

    return entry;
  }

  function rebuildShareStream(entry) {
    var tracks = [];
    if (entry.shareTrack) tracks.push(entry.shareTrack);
    if (entry.shareAudioTrack) tracks.push(entry.shareAudioTrack);
    entry.shareStream = tracks.length ? new MediaStream(tracks) : null;
    if (entry.shareStream) emit('share-media', entry);
  }

  function handleSignal(from, data) {
    var entry = peers.get(from);
    if (!entry) entry = entryFor(from, { name: 'Guest' });
    var peer = createPeer(entry);
    var pc = peer.pc;
    if (!pc) return;

    if (data.candidate) {
      if (pc.remoteDescription) {
        pc.addIceCandidate(data.candidate).catch(function () { /* stale candidate */ });
      } else {
        peer.pending.push(data.candidate);
      }
      return;
    }
    if (!data.sdp) return;

    var description = data.sdp;
    var offerCollision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
    peer.ignoreOffer = !peer.polite && offerCollision;
    if (peer.ignoreOffer) return;

    Promise.resolve().then(function () {
      if (offerCollision) return pc.setLocalDescription({ type: 'rollback' });
      return null;
    }).then(function () {
      return pc.setRemoteDescription(description);
    }).then(function () {
      peer.negotiated = true;
      peer.shouldOffer = true;
      var queued = peer.pending.splice(0, peer.pending.length);
      return Promise.all(queued.map(function (candidate) {
        return pc.addIceCandidate(candidate).catch(function () { /* stale */ });
      }));
    }).then(function () {
      if (description.type === 'offer') {
        return pc.setLocalDescription().then(function () {
          sendSignal(from, { sdp: pc.localDescription });
        });
      }
      return null;
    }).catch(function (error) {
      console.warn('[ZedStream] negotiation error:', error && error.message);
    });
  }

  function handleMessage(message) {
    if (!message || !message.type) return;

    if (message.type === 'joined') {
      selfId = message.selfId;
      status = { state: 'joined', selfId: selfId, room: message.room };
      emit('status', status);
      (message.peers || []).forEach(function (info) {
        createPeer(entryFor(info.id, info));
      });
      emit('peers');
      return;
    }

    if (message.type === 'peer-join') {
      createPeer(entryFor(message.peer.id, message.peer));
      emit('peers');
      return;
    }

    if (message.type === 'peer-leave') {
      var leaving = peers.get(message.id);
      if (leaving && leaving.pc) {
        try { leaving.pc.close(); } catch (error) { /* already closed */ }
      }
      peers.delete(message.id);
      emit('peers');
      if (leaving && leaving.sharing) emit('share-stop', leaving);
      return;
    }

    if (message.type === 'peer-state') {
      var peer = peers.get(message.id);
      if (peer) {
        peer.mic = message.mic !== false;
        peer.cam = message.cam !== false;
      }
      emit('peers');
      return;
    }

    if (message.type === 'signal') {
      handleSignal(message.from, message.data || {});
      return;
    }

    if (message.type === 'share-start') {
      var sharer = peers.get(message.from);
      if (sharer) {
        sharer.sharing = true;
        sharer.shareKind = message.kind || '';
        sharer.shareTitle = message.title || '';
        emit('share-start', sharer);
        if (sharer.shareStream) emit('share-media', sharer);
      }
      emit('peers');
      return;
    }

    if (message.type === 'share-stop') {
      var stopper = peers.get(message.from);
      if (stopper) {
        stopper.sharing = false;
        stopper.shareKind = '';
        stopper.shareTitle = '';
        emit('share-stop', stopper);
      }
      emit('peers');
      return;
    }

    if (message.type === 'share-pause') {
      emit('share-pause', message);
      return;
    }

    if (message.type === 'doc') {
      emit('doc', message);
    }
  }

  function connect() {
    if (!started || !config.room) return;
    try {
      socket = new WebSocket(socketUrl());
    } catch (error) {
      emit('status', { state: 'error' });
      return;
    }

    status = { state: 'connecting' };
    emit('status', status);

    socket.onopen = function () {
      status = { state: 'open' };
      emit('status', status);
    };

    socket.onmessage = function (event) {
      var message;
      try { message = JSON.parse(event.data); } catch (error) { return; }
      handleMessage(message);
    };

    socket.onclose = function (event) {
      if (event && event.code === 1008) {
        // The room refused us (full, or no room id): do not hammer it with retries
        started = false;
        emit('status', { state: 'refused', reason: event.reason || 'The studio room was closed' });
        return;
      }
      emit('status', { state: 'closed' });
      if (intentional || !started) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(function () {
        if (!started || intentional) return;
        closePeers();
        selfId = null;
        connect();
      }, 1800);
    };

    socket.onerror = function () {
      emit('status', { state: 'error' });
    };
  }

  function closePeers() {
    peers.forEach(function (entry) {
      if (entry.pc) {
        try { entry.pc.close(); } catch (error) { /* already closed */ }
      }
    });
    peers.clear();
    emit('peers');
  }

  function start(options) {
    options = options || {};
    config.room = String(options.room || '');
    config.name = String(options.name || 'Guest').slice(0, 60);
    config.role = options.role === 'host' ? 'host' : 'guest';
    localStream = options.stream || null;
    if (started) {
      if (localStream) setLocalStream(localStream);
      send({ type: 'state', mic: true, cam: true });
      return;
    }
    started = true;
    intentional = false;
    connect();
  }

  function setLocalStream(stream) {
    localStream = stream;
    if (!stream) return;
    peers.forEach(function (entry) {
      if (!entry.pc) return;
      var senders = entry.pc.getSenders();
      stream.getTracks().forEach(function (track) {
        var sender = senders.filter(function (candidate) {
          return candidate.track && candidate.track.kind === track.kind;
        })[0];
        if (sender) sender.replaceTrack(track).catch(function () { /* closed */ });
        else {
          try { entry.pc.addTrack(track, stream); } catch (error) { /* duplicate */ }
        }
      });
    });
  }

  function addShareStream(stream) {
    if (!stream) return;
    shareStream = stream;
    peers.forEach(function (entry) {
      if (!entry.pc) createPeer(entry);
      stream.getTracks().forEach(function (track) {
        try { entry.pc.addTrack(track, stream); } catch (error) { /* duplicate */ }
      });
    });
  }

  function removeShareStream() {
    if (!shareStream) return;
    var tracks = shareStream.getTracks();
    peers.forEach(function (entry) {
      if (!entry.pc) return;
      entry.pc.getSenders().forEach(function (sender) {
        if (sender.track && tracks.indexOf(sender.track) !== -1) {
          try { entry.pc.removeTrack(sender); } catch (error) { /* gone */ }
        }
      });
    });
    shareStream = null;
  }

  function announceShare(info) {
    info = info || {};
    send({
      type: 'share-start',
      kind: info.kind || 'media',
      title: info.title || '',
      hasVideo: !!info.hasVideo,
      hasAudio: !!info.hasAudio
    });
  }

  function announceStop() {
    send({ type: 'share-stop' });
  }

  function announcePause(paused) {
    send({ type: 'share-pause', paused: !!paused });
  }

  function sendDoc(info) {
    send({ type: 'doc', name: info.name, mime: info.mime, data: info.data });
  }

  function setMediaState(state) {
    send({ type: 'state', mic: !!state.mic, cam: !!state.cam });
  }

  function list() {
    return Array.from(peers.values());
  }

  function stop() {
    intentional = true;
    started = false;
    clearTimeout(reconnectTimer);
    closePeers();
    if (socket) {
      try { socket.close(); } catch (error) { /* closing */ }
      socket = null;
    }
    status = { state: 'closed' };
    emit('status', status);
  }

  return {
    on: on,
    start: start,
    stop: stop,
    setLocalStream: setLocalStream,
    addShareStream: addShareStream,
    removeShareStream: removeShareStream,
    announceShare: announceShare,
    announceStop: announceStop,
    announcePause: announcePause,
    sendDoc: sendDoc,
    setMediaState: setMediaState,
    list: list,
    status: function () { return status; }
  };
})();
