/* ZedStream — settings */
(function () {
  'use strict';
  var ZS = window.ZS;

  function $(id) { return document.getElementById(id); }

  function fill() {
    var s = ZS.state();
    $('setDisplayName').value = s.settings.displayName || '';
    $('setStudioName').value = s.settings.studioName || '';
    $('setDuration').value = String(s.settings.defaultDuration || 45);
    $('setQuality').value = s.settings.quality || '1080';
    $('setBackground').value = s.settings.background || 'none';

    $('dataPodcasts').textContent = s.podcasts.length;
    $('dataSessions').textContent = s.sessions.length;
    $('dataRecordings').textContent = s.episodes.filter(function (e) { return e.hasRecording; }).length;
    $('dataInvites').textContent = ZS.pendingInvites().length;
    $('dataBadge').textContent = s.episodes.length + (s.episodes.length === 1 ? ' episode' : ' episodes');
  }

  function init() {
    fill();

    $('settingsForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('setDisplayName').value.trim();
      var studio = $('setStudioName').value.trim();
      ZS.update(function (s) {
        s.settings.displayName = name;
        s.settings.studioName = studio;
        s.settings.defaultDuration = parseInt($('setDuration').value, 10) || 45;
        s.settings.quality = $('setQuality').value;
        s.settings.background = $('setBackground').value;
        return s;
      });
      ZS.toast('Settings saved', 'success');
      fill();
    });

    $('resetDataBtn').addEventListener('click', function () {
      ZS.confirmDialog({
        title: 'Clear all studio data?',
        message: 'Podcasts, scheduled sessions, guest links and recording metadata in this browser will be removed. Downloaded files are not affected.',
        confirmText: 'Clear everything',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        ZS.reset();
        ZS.toast('Studio data cleared');
        setTimeout(function () { location.href = 'index.html'; }, 500);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
  document.addEventListener('zs:change', fill);
})();
