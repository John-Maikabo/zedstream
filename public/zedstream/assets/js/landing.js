/* ZedStream — landing: one button starts a room and hands over a link */
(function () {
  'use strict';
  var ZS = window.ZS;
  var room = '';

  function code() {
    var bytes = new Uint8Array(4);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
      return Array.prototype.map.call(bytes, function (b) {
        return ('0' + b.toString(36)).slice(-2);
      }).join('').slice(0, 6);
    }
    return Math.random().toString(36).slice(2, 8);
  }

  function roomLink() {
    return ZS.baseUrl() + 'studio.html?room=' + encodeURIComponent(room);
  }

  // Prompts the browser's camera/microphone permission, then releases the
  // devices — the studio opens its own capture on the next page.
  function askCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.resolve('unsupported');
    }
    return navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: { echoCancellation: true, noiseSuppression: true }
    }).then(function (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      return 'ready';
    }).catch(function () {
      return 'blocked';
    });
  }

  function start() {
    var btn = document.getElementById('startBtn');
    btn.disabled = true;

    // The link exists immediately; the camera prompt can take as long as the
    // person needs and never holds the room hostage.
    room = 'zed-' + code();
    document.getElementById('roomLink').value = roomLink();

    var statusEl = document.getElementById('linkStatus');
    statusEl.textContent = 'Waiting for camera permission…';
    statusEl.classList.remove('ok', 'warn');

    btn.hidden = true;
    var panel = document.getElementById('linkPanel');
    panel.hidden = false;
    panel.classList.add('open');
    if (window.zHydrateIcons) window.zHydrateIcons();

    askCamera().then(function (state) {
      if (state === 'ready') {
        statusEl.textContent = 'Camera and mic ready';
        statusEl.classList.add('ok');
      } else if (state === 'unsupported') {
        statusEl.textContent = 'This browser cannot open a camera';
        statusEl.classList.add('warn');
      } else {
        statusEl.textContent = 'Camera blocked — allow it in the studio';
        statusEl.classList.add('warn');
      }
    });
  }

  function wire() {
    document.getElementById('startBtn').addEventListener('click', start);
    document.getElementById('copyLinkBtn').addEventListener('click', function () {
      ZS.copyText(document.getElementById('roomLink').value, 'Guest link copied');
    });
    document.getElementById('enterBtn').addEventListener('click', function () {
      location.href = 'studio.html?room=' + encodeURIComponent(room) + '&host=1&start=1';
    });
    document.getElementById('roomLink').addEventListener('focus', function () { this.select(); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    wire();
    if (window.zHydrateIcons) window.zHydrateIcons();
  });
})();
