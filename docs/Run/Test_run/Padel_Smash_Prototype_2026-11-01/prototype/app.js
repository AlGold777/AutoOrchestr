/* Padel Coach — кликабельный прототип. Анализ — имитация на заготовках (см. provider-mock.js). */
(function () {
  'use strict';
  var D = window.DEMO_DATA, POSES = window.POSES, EDGES = window.POSE_EDGES, Store = window.Store;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var lsGet = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var lsSet = function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* без хранилища работаем дальше */ } };
  var ST = {
    role: lsGet('pc.role') === 'coach' ? 'coach' : 'athlete',
    refs: JSON.parse(JSON.stringify(D.references)),
    attempts: JSON.parse(JSON.stringify(D.attempts)),
    activeRefId: D.activeReferenceId,
    idbOk: false,
    recKind: 'attempt', pending: null, blobs: {}, flash: '',
    cur: { attemptId: null, selectedErrorId: null, view: 'both', side: 'athlete' },
    s04: { simulateFail: false, scenario: 'scenario-1' }
  };
  var cat = {}; D.catalog.forEach(function (c) { cat[c.code] = c; });

  /* ---------- проверка данных при загрузке ---------- */
  function validate() {
    var bad = [], refs = {};
    D.references.forEach(function (r) { refs[r.id] = r; });
    D.attempts.forEach(function (a) {
      if (!refs[a.referenceId]) bad.push('попытка ' + a.id + ': нет эталона ' + a.referenceId);
      if (!D.mockScenarios[a.mockScenarioId]) bad.push('попытка ' + a.id + ': нет сценария ' + a.mockScenarioId);
    });
    Object.keys(D.mockScenarios).forEach(function (sid) {
      D.mockScenarios[sid].errors.forEach(function (e) {
        var c = cat[e.code], ref = refs[D.activeReferenceId], shot = ref.shots[e.referenceShotIndex - 1];
        if (!c) bad.push(e.id + ': нет кода ' + e.code);
        else if (c.phase !== e.phase) bad.push(e.id + ': фаза не совпадает с каталогом');
        if (!POSES[e.evidence.athletePose] || !POSES[e.evidence.referencePose]) bad.push(e.id + ': нет ключа позы');
        if (e.evidence.athleteFrameAsset !== 'frames/' + e.evidence.athletePose + '.svg' ||
            e.evidence.referenceFrameAsset !== 'frames/' + e.evidence.referencePose + '.svg') bad.push(e.id + ': путь подложки');
        if (!shot || shot.phasesMs[e.phase] !== e.referenceMs) bad.push(e.id + ': referenceMs не совпадает с меткой эталона');
        D.attempts.forEach(function (a) { if (a.mockScenarioId === sid && e.athleteMs > a.durationMs) bad.push(e.id + ': athleteMs больше длительности'); });
      });
    });
    return bad;
  }

  /* ---------- помощники ---------- */
  function fmt(ms) {
    var s = ms / 1000, m = Math.floor(s / 60), r = s - m * 60;
    return ('0' + m).slice(-2) + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
  }
  function go(id) { if (location.hash === '#' + id) route(); else location.hash = '#' + id; }
  function attemptNo(a) { return ST.attempts.indexOf(a) + 1; }
  function getAttempt(id) { return ST.attempts.filter(function (a) { return a.id === id; })[0]; }
  function activeRef() { return ST.refs.filter(function (r) { return r.id === ST.activeRefId; })[0]; }
  function analysisOf(a) { return a.analysis || (a.mockScenarioId && a.source === 'demo' ? D.mockScenarios[a.mockScenarioId] : null); }
  function errCount(a) { var r = analysisOf(a); return r ? r.errors.length : null; }

  function modal(html, onClose) {
    var m = $('#modal'); m.innerHTML = '<div class="box">' + html + '</div>'; m.hidden = false;
    function close() { m.hidden = true; m.innerHTML = ''; onClose && onClose(); }
    m.onclick = function (e) { if (e.target === m) close(); };
    var c = m.querySelector('[data-close]'); if (c) c.onclick = close;
    return { el: m, close: close };
  }
  function getBlob(videoId) {
    if (ST.blobs[videoId]) return Promise.resolve(ST.blobs[videoId]);
    return Store.get('videos', videoId).then(function (v) { return v ? v.blob : null; });
  }
  function openPlayer(videoId, label, atMs, demoNote) {
    var m = modal('<h3>' + esc(label) + '</h3><div id="pl"></div><button class="btn sec" data-close>Закрыть</button>');
    var url = null;
    function done() { if (url) URL.revokeObjectURL(url); }
    m.el.querySelector('[data-close]').onclick = function () { done(); m.close(); };
    getBlob(videoId).catch(function () { return null; }).then(function (b) {
      var pl = $('#pl'); if (!pl) return;
      if (!b) {
        pl.innerHTML = '<div class="poster">Демо: видео не записывалось.<br>' + (atMs != null ? 'Момент ' + fmt(atMs) : '') + (demoNote ? '<br>' + esc(demoNote) : '') + '</div>';
        return;
      }
      url = URL.createObjectURL(b);
      pl.innerHTML = '<video controls playsinline src="' + url + '"></video>';
      var v = pl.querySelector('video');
      if (atMs != null) v.addEventListener('loadedmetadata', function () {
        try { var d = isFinite(v.duration) ? v.duration : atMs / 1000; v.currentTime = Math.min(atMs / 1000, d); } catch (e) { /* не критично */ }
      });
    });
  }

  /* ---------- SVG кадра ---------- */
  function frameSvg(poseKey, hl, limited, side, spec) {
    var W = spec.width, H = spec.height, P = POSES[poseKey];
    var c = { n: side === 'athlete' ? '#4aa3ff' : '#3ecf8e', h: side === 'athlete' ? '#ff5a5f' : '#ffd23f' };
    var s = '<svg class="frame-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" data-pose="' + poseKey + '">' +
      '<image href="frames/' + poseKey + '.svg" width="' + W + '" height="' + H + '"/><g fill="none" stroke-linecap="round">';
    EDGES.forEach(function (e) {
      var a = P[e[0]], b = P[e[1]], on = hl.indexOf(e[0]) >= 0 && hl.indexOf(e[1]) >= 0;
      s += '<line x1="' + a[0] * W + '" y1="' + a[1] * H + '" x2="' + b[0] * W + '" y2="' + b[1] * H + '" stroke="' + (on ? c.h : c.n) + '" stroke-width="' + (on ? 9 : 6) + '"/>';
    });
    Object.keys(P).forEach(function (k) {
      var on = hl.indexOf(k) >= 0;
      s += '<circle cx="' + P[k][0] * W + '" cy="' + P[k][1] * H + '" r="' + (on ? 20 : 10) + '" fill="' + (on ? 'none' : c.n) + '"' +
        (on ? ' stroke="' + c.h + '" stroke-width="7"' + (limited ? ' stroke-dasharray="10 8"' : '') : '') + '/>';
    });
    return s + '</g></svg>';
  }

  /* ---------- S01 ---------- */
  function renderS01() {
    var sec = $('#s01'), ref = activeRef(), coach = ST.role === 'coach';
    var list = ST.attempts.map(function (a, i) {
      var n = errCount(a);
      return '<button class="att" data-att="' + a.id + '"><span>Попытка ' + (i + 1) + (a.source === 'demo' ? ' <span class="badge">Демо</span>' : '') +
        '</span><span class="mut small">' + (n == null ? 'не разобрана' : 'замечаний: ' + n) + '</span></button>';
    }).join('') || '<p class="mut">Попыток пока нет.</p>';
    sec.innerHTML =
      '<div class="top"><span class="ttl">PADEL COACH · Прототип</span></div>' +
      '<div class="seg" id="roles"><button data-r="athlete" class="' + (coach ? '' : 'on') + '">Спортсмен</button><button data-r="coach" class="' + (coach ? 'on' : '') + '">Тренер</button></div>' +
      (ST.flash ? '<div class="plate" style="color:var(--ok);background:#0c2a1e;border-color:#1d6b4a">' + esc(ST.flash) + '</div>' : '') +
      '<div class="card"><h2>Упражнение «Смэш»</h2><p class="small mut">' + esc(D.exercise.name) + '</p>' +
      '<p>Эталон v' + ref.version + (ref.source === 'demo' ? ' <span class="badge">Демо</span>' : ' <span class="badge ok">записан</span>') + '</p>' +
      '<button class="btn sec" id="refplay">Эталон</button></div>' +
      '<button class="btn" id="main">' + (coach ? (ref.source === 'demo' && ST.refs.length === 1 ? 'Записать эталон' : 'Заменить эталон') : 'Снять подход') + '</button>' +
      '<h3 style="margin-top:14px">Мои попытки</h3>' + list;
    ST.flash = '';
    sec.querySelectorAll('#roles button').forEach(function (b) {
      b.onclick = function () { ST.role = b.dataset.r; lsSet('pc.role', ST.role); renderS01(); };
    });
    $('#refplay', sec).onclick = function () { openPlayer(ref.videoId, 'Эталон v' + ref.version, null, 'Демо-эталон'); };
    $('#main', sec).onclick = function () {
      if (!coach) { ST.recKind = 'attempt'; go('s02'); return; }
      var replace = !(ref.source === 'demo' && ST.refs.length === 1);
      var begin = function () { ST.recKind = 'reference'; go('s02'); };
      if (!replace) return begin();
      var m = modal('<h3>Заменить эталон?</h3><p class="small">Будет создана новая версия. Старые версии и попытки сохранятся.</p>' +
        '<button class="btn" id="yes">Заменить</button><button class="btn sec" data-close>Отмена</button>');
      $('#yes', m.el).onclick = function () { m.close(); begin(); };
    };
    sec.querySelectorAll('.att').forEach(function (b) {
      b.onclick = function () {
        ST.cur = { attemptId: b.dataset.att, selectedErrorId: null, view: 'both', side: 'athlete' };
        go(analysisOf(getAttempt(b.dataset.att)) ? 's05' : 's04');
      };
    });
  }

  /* ---------- S02 ---------- */
  var cam = { stream: null, rec: null, chunks: [], t0: 0, timer: null };
  function stopCamera() {
    clearInterval(cam.timer);
    if (cam.rec && cam.rec.state !== 'inactive') { cam.rec.onstop = null; try { cam.rec.stop(); } catch (e) { /* уже остановлена */ } }
    if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); });
    cam = { stream: null, rec: null, chunks: [], t0: 0, timer: null };
  }
  function renderS02() {
    var sec = $('#s02'), label = ST.recKind === 'reference' ? 'Эталон тренера' : 'Подход спортсмена';
    sec.innerHTML =
      '<div class="top"><span class="ttl">Камера</span></div>' +
      '<div class="stage"><video id="cv" muted playsinline></video><div class="grid"></div><div class="sil"></div>' +
      '<span class="role">' + label + '</span><span class="rec" id="rec" hidden>● REC <span id="tm">00:00</span></span>' +
      '<div class="hint">Поместите в кадр всё тело, ракетку и зону удара</div></div>' +
      '<div id="ctl"></div><div id="err"></div>';
    var ctl = $('#ctl', sec);
    function setCtl(state) {
      if (state === 'prep') ctl.innerHTML = '<button class="btn" id="go">Начать</button><button class="btn sec" id="cancel">Отмена</button>';
      if (state === 'rec') ctl.innerHTML = '<button class="btn bad" id="stop">Остановить</button><button class="btn sec" id="cancel">Отмена</button>';
      if (state === 'none') ctl.innerHTML = '<button class="btn sec" id="cancel">Отмена</button>';
      var c = $('#cancel', sec); if (c) c.onclick = function () { go('s01'); };
    }
    function fail(msg) {
      stopCamera();
      $('#rec', sec).hidden = true;
      setCtl('none');
      $('#cv', sec).hidden = true;
      var st = sec.querySelector('.stage');
      st.insertAdjacentHTML('beforeend', frameSvg('high-contact', [], false, 'reference', { width: 1280, height: 720 }).replace('class="frame-svg"', 'class="frame-svg" style="opacity:.5"'));
      $('#err', sec).innerHTML = '<div class="plate">' + esc(msg) + '</div>' +
        '<label class="btn" style="cursor:pointer">Выбрать файл<input type="file" accept="video/*" id="file" hidden></label>' +
        (ST.recKind === 'attempt' ? '<div class="row"><button class="btn sec" data-demo="attempt-001">Демо-попытка 1</button><button class="btn sec" data-demo="attempt-002">Демо-попытка 2</button></div>' : '');
      $('#file', sec).onchange = function (e) {
        var f = e.target.files && e.target.files[0]; if (!f) return; /* отмена выбора — остаёмся в ошибке S02 */
        ST.pending = { blob: f, mime: f.type, durationMs: null, kind: ST.recKind, source: 'imported' };
        go('s03');
      };
      sec.querySelectorAll('[data-demo]').forEach(function (b) {
        b.onclick = function () { ST.cur = { attemptId: b.dataset.demo, selectedErrorId: null, view: 'both', side: 'athlete' }; go('s04'); };
      });
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      return fail('Запись с камеры недоступна в этом браузере или режиме (нужен HTTPS или localhost).');
    }
    setCtl('prep');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (stream) {
      if (location.hash !== '#s02') { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      cam.stream = stream;
      var v = $('#cv', sec); v.srcObject = stream; v.play().catch(function () { });
    }, function (e) {
      fail(e && e.name === 'NotAllowedError' ? 'Нет доступа к камере. Разрешите её в настройках браузера или выберите файл.' : 'Камера недоступна: ' + (e && e.name || 'ошибка') + '.');
    });
    sec.onclick = function (e) {
      var t = e.target.closest('button'); if (!t) return;
      if (t.id === 'go' && cam.stream) {
        var mimes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
        var mime = mimes.filter(function (m) { return MediaRecorder.isTypeSupported(m); })[0];
        try { cam.rec = mime ? new MediaRecorder(cam.stream, { mimeType: mime }) : new MediaRecorder(cam.stream); }
        catch (err) { return fail('Не удалось начать запись: ' + err.name + '.'); }
        cam.chunks = [];
        cam.rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) cam.chunks.push(ev.data); };
        cam.rec.onstop = function () {
          var ms = Date.now() - cam.t0, type = cam.rec.mimeType || mime || 'video/webm', blob = new Blob(cam.chunks, { type: type });
          if (!blob.size) return fail('Запись получилась пустой. Повторите или выберите файл.');
          stopCamera();
          ST.pending = { blob: blob, mime: type, durationMs: ms, kind: ST.recKind, source: 'recorded' };
          go('s03');
        };
        cam.rec.start(); cam.t0 = Date.now();
        $('#rec', sec).hidden = false; setCtl('rec');
        cam.timer = setInterval(function () {
          var s = Math.floor((Date.now() - cam.t0) / 1000);
          $('#tm', sec).textContent = ('0' + Math.floor(s / 60)).slice(-2) + ':' + ('0' + s % 60).slice(-2);
        }, 250);
      } else if (t.id === 'stop' && cam.rec) {
        cam.rec.stop();
      }
    };
  }

  /* ---------- S03 ---------- */
  function renderS03() {
    var sec = $('#s03'), p = ST.pending;
    if (!p) return go('s01');
    var isRef = p.kind === 'reference', label = isRef ? 'Эталон' : 'Попытка ' + (ST.attempts.length + 1);
    var url = URL.createObjectURL(p.blob);
    sec.innerHTML =
      '<div class="top"><span class="ttl">Просмотр</span><span class="badge">' + label + '</span></div>' +
      '<video id="pv" controls playsinline src="' + url + '" style="width:100%;border-radius:10px;background:#000"></video>' +
      '<p class="small mut">Длительность: <span id="dur">' + (p.durationMs ? fmt(p.durationMs) : '…') + '</span></p><div id="msg"></div>' +
      '<button class="btn" id="save">' + (isRef ? 'Сохранить эталон' : 'Сохранить и анализировать') + '</button>' +
      '<button class="btn sec" id="redo">Переснять</button>';
    var v = $('#pv', sec);
    v.addEventListener('loadedmetadata', function () {
      if (!p.durationMs && isFinite(v.duration)) { p.durationMs = Math.round(v.duration * 1000); $('#dur', sec).textContent = fmt(p.durationMs); }
    });
    $('#redo', sec).onclick = function () { URL.revokeObjectURL(url); ST.pending = null; ST.recKind = p.kind; go('s02'); };
    $('#save', sec).onclick = function () {
      var btn = this; btn.disabled = true; $('#msg', sec).innerHTML = '';
      var stamp = Date.now().toString(36), video = { id: 'vid-' + stamp, blob: p.blob, mime: p.mime }, dur = p.durationMs || 0;
      var job;
      if (isRef) {
        var old = activeRef(), ver = Math.max.apply(null, ST.refs.map(function (r) { return r.version; })) + 1;
        var ref = { id: 'ref-' + ('00' + ver).slice(-3), version: ver, status: 'active', videoId: video.id, role: 'coach', viewpoint: 'side',
          handedness: 'right', durationMs: dur, source: p.source, shots: [], createdAt: Date.now() };
        job = Store.saveReference(ref, video, old).then(function () {
          old.status = 'archived'; ST.refs.push(ref); ST.activeRefId = ref.id; ST.blobs[video.id] = p.blob; ST.flash = 'Эталон готов (версия ' + ver + ')'; return 's01';
        });
      } else {
        var att = { id: 'attempt-' + stamp, videoId: video.id, referenceId: ST.activeRefId, durationMs: dur, shotCount: null,
          source: p.source, mockScenarioId: null, createdAt: Date.now() };
        job = Store.saveAttempt(att, video).then(function () {
          att.status = 'saved'; ST.attempts.push(att); ST.blobs[video.id] = p.blob;
          ST.cur = { attemptId: att.id, selectedErrorId: null, view: 'both', side: 'athlete' }; return 's04';
        });
      }
      job.then(function (next) { ST.pending = null; URL.revokeObjectURL(url); go(next); }, function (e) {
        btn.disabled = false;
        $('#msg', sec).innerHTML = '<div class="plate">Не удалось сохранить: ' + esc(e && e.message || e) + '. Анализ не запускается.</div>' +
          '<button class="btn sec" id="retry">Повторить</button><a class="btn sec" href="' + url + '" download="padel-' + stamp + '.webm">Экспорт файла</a>';
        $('#retry', sec).onclick = function () { $('#save', sec).click(); };
      });
    };
  }

  /* ---------- S04 ---------- */
  var runId = 0;
  function renderS04() {
    var sec = $('#s04'), a = getAttempt(ST.cur.attemptId);
    if (!a) return go('s01');
    var ref = ST.refs.filter(function (r) { return r.id === a.referenceId; })[0];
    var head = '<div class="top"><span class="ttl">Анализ смэша</span><span class="badge">Демо</span></div><p class="small mut">Используются заранее подготовленные данные</p>';
    if (!ref) {
      sec.innerHTML = head + '<div class="plate">Нет валидного эталона. Анализ не запускается.</div><button class="btn" id="back">К попыткам</button>';
      $('#back', sec).onclick = function () { go('s01'); }; return;
    }
    if (!a.mockScenarioId && !analysisOf(a)) return choice();
    run(false);

    function choice() {
      sec.innerHTML = head +
        '<div class="plate">Ошибки не вычисляются по вашей записи. Выберите демо-сценарий, который покажет приложение.</div>' +
        '<label class="opt"><input type="radio" name="sc" value="scenario-1"' + (ST.s04.scenario === 'scenario-1' ? ' checked' : '') + '> Демо-сценарий 1 (3 замечания)</label>' +
        '<label class="opt"><input type="radio" name="sc" value="scenario-2"' + (ST.s04.scenario === 'scenario-2' ? ' checked' : '') + '> Демо-сценарий 2 (1 замечание)</label>' +
        '<label class="opt small mut"><input type="checkbox" id="fail"' + (ST.s04.simulateFail ? ' checked' : '') + '> Демо: имитировать сбой анализа</label>' +
        '<button class="btn" id="goan">Показать разбор</button><button class="btn sec" id="back">К попыткам</button>';
      $('#goan', sec).onclick = function () {
        ST.s04.scenario = sec.querySelector('input[name=sc]:checked').value; ST.s04.simulateFail = $('#fail', sec).checked;
        a.mockScenarioId = ST.s04.scenario;
        var p = a.source === 'demo' ? Promise.resolve() : Store.putAttempt(Object.assign({}, a, { status: 'saved' })).catch(function () { });
        p.then(function () { run(ST.s04.simulateFail); });
      };
      $('#back', sec).onclick = function () { go('s01'); };
    }
    function run(fail) {
      var my = ++runId;
      sec.innerHTML = head + '<div class="prog"><i id="bar" style="width:0"></i></div><p id="step" class="mut small">Старт…</p>';
      getBlob(a.videoId).catch(function () { return null; }).then(function (blob) {
        return window.ANALYSIS_PROVIDER.analyze({ attemptId: a.id, referenceId: a.referenceId, videoBlob: blob, mockScenarioId: a.mockScenarioId, simulateFail: fail }, function (f, t) {
          if (my !== runId || location.hash !== '#s04') return;
          $('#bar', sec).style.width = Math.round(f * 100) + '%'; $('#step', sec).textContent = t;
        });
      }).then(function (res) {
        if (my !== runId || location.hash !== '#s04') return;
        a.analysis = res;
        if (a.source !== 'demo') Store.putAttempt(Object.assign({}, a, { status: 'saved' })).catch(function () { });
        ST.cur.selectedErrorId = null; go('s05');
      }, function (e) {
        if (my !== runId || location.hash !== '#s04') return;
        sec.innerHTML = head + '<div class="plate">Анализ не удался: ' + esc(e && e.message || e) + '</div>' +
          '<button class="btn" id="retry">Повторить анализ</button><button class="btn sec" id="demo">Открыть демо-разбор</button><button class="btn sec" id="back">К попыткам</button>';
        $('#retry', sec).onclick = function () { run(false); };
        $('#demo', sec).onclick = function () { ST.s04.simulateFail = false; a.mockScenarioId = null; choice(); };
        $('#back', sec).onclick = function () { go('s01'); };
      });
    }
  }

  /* ---------- S05 ---------- */
  function renderS05() {
    var sec = $('#s05'), a = getAttempt(ST.cur.attemptId), res = a && analysisOf(a);
    if (!res) return go(a ? 's04' : 's01');
    var errs = res.errors, k = errs.length, cur = ST.cur;
    var sel = errs.filter(function (e) { return e.id === cur.selectedErrorId; })[0] || errs[0];
    if (sel) cur.selectedErrorId = sel.id;
    var spec = res.frameSpec;
    var imported = a.source !== 'demo';
    var html = '<div class="top"><span class="ttl">Разбор смэша · Попытка ' + attemptNo(a) + '</span><span class="badge">Демо</span></div>' +
      '<p><b>' + (k ? 'Найдено ' + k + ' ' + (k === 1 ? 'замечание' : k < 5 ? 'замечания' : 'замечаний') : 'В демо-данных замечаний нет') + '</b></p>' +
      (imported ? '<div class="plate">Ошибки не вычислены по вашей записи, показан демо-сценарий ' + esc(String(a.mockScenarioId).replace('scenario-', '')) + '</div>' : '');
    if (sel) {
      var c = cat[sel.code], ev = sel.evidence, hl = ev.highlightJoints;
      var seg = '<div class="seg" style="margin:8px 0"><button data-v="both" class="' + (cur.view === 'both' ? 'on' : '') + '">Рядом</button><button data-v="one" class="' + (cur.view === 'one' ? 'on' : '') + '">По одному</button></div>';
      var fa = '<div class="fr" data-zoom="athlete"><div class="stage">' + frameSvg(ev.athletePose, hl, c.viewpointLimited, 'athlete', spec.athlete) + '</div><div class="cap">Спортсмен · ' + fmt(sel.athleteMs) + '</div></div>';
      var fr = '<div class="fr" data-zoom="ref"><div class="stage">' + frameSvg(ev.referencePose, hl, c.viewpointLimited, 'ref', spec.reference) + '</div><div class="cap">Эталон · ' + fmt(sel.referenceMs) + '</div></div>';
      var one = cur.view === 'one';
      html += '<div id="frames">' + seg +
        (one ? '<div class="seg" style="margin:0 0 8px"><button data-s="athlete" class="' + (cur.side === 'athlete' ? 'on' : '') + '">Спортсмен</button><button data-s="ref" class="' + (cur.side === 'ref' ? 'on' : '') + '">Эталон</button></div>' : '') +
        '<div class="frames' + (one ? ' one' : '') + '">' + (one ? (cur.side === 'ref' ? fr : fa) : fa + fr) + '</div>' +
        '<p class="small mut">Фаза: ' + D.phaseNames[sel.phase] + ' · спортсмен ' + fmt(sel.athleteMs) + ', эталон ' + fmt(sel.referenceMs) + '</p>' +
        '<p class="small mut">Схематические кадры и позы, не результат анализа реального видео.</p>' +
        (c.viewpointLimited ? '<div class="plate">Условная демонстрация: ракурс сбоку ограничивает оценку</div>' : '') + '</div>';
    }
    html += '<div id="errs" style="margin-top:10px">';
    errs.forEach(function (e) {
      var c = cat[e.code], open = e.id === cur.selectedErrorId;
      html += '<div class="acc' + (open ? ' open' : '') + '"><button data-e="' + e.id + '"><b>' + esc(c.title) + '</b><br><span class="small mut">Удар ' + e.shotIndex + ' · ' + fmt(e.athleteMs) + '</span></button>' +
        (open ? '<div class="body"><p class="small">' + esc(c.sign) + '</p><div class="advice">' + esc(c.advice) + '</div>' +
          '<p class="small mut">Причина: ' + esc(c.cause) + '. Исправление: ' + esc(c.fix) + '.</p>' +
          (c.note ? '<p class="small mut">' + esc(c.note) + '</p>' : '') +
          '<button class="btn sec" data-look="' + e.id + '">Смотреть момент</button></div>' : '') + '</div>';
    });
    html += '</div><button class="btn" id="again">Повторить подход</button><button class="btn sec" id="all">Все попытки</button>';
    sec.innerHTML = html;

    sec.onclick = function (ev) {
      var t = ev.target.closest('[data-e],[data-v],[data-s],[data-zoom],[data-look],#again,#all'); if (!t) return;
      if (t.dataset.e) { cur.selectedErrorId = t.dataset.e; renderS05(); var f = $('#frames', sec); if (f) f.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      else if (t.dataset.v) { cur.view = t.dataset.v; renderS05(); }
      else if (t.dataset.s) { cur.side = t.dataset.s; renderS05(); }
      else if (t.dataset.zoom) {
        var big = t.querySelector('.stage').innerHTML, m = modal('<div class="stage" style="aspect-ratio:16/9">' + big + '</div><p class="small mut">Схематический кадр, не результат анализа реального видео.</p><button class="btn sec" data-close>Закрыть</button>');
      }
      else if (t.dataset.look) {
        var e = errs.filter(function (x) { return x.id === t.dataset.look; })[0];
        openPlayer(a.videoId, 'Попытка ' + attemptNo(a) + ' · ' + cat[e.code].title, e.athleteMs, 'Метка демонстрационная');
      }
      else if (t.id === 'again') { ST.recKind = 'attempt'; go('s02'); }
      else if (t.id === 'all') go('s01');
    };
  }

  /* ---------- маршрутизатор ---------- */
  var ROUTES = { s01: renderS01, s02: renderS02, s03: renderS03, s04: renderS04, s05: renderS05 };
  function route() {
    var id = (location.hash || '#s01').slice(1);
    if (!ROUTES[id]) id = 's01';
    stopCamera(); $('#modal').hidden = true;
    document.querySelectorAll('.screen').forEach(function (s) { s.hidden = s.id !== id; s.onclick = null; });
    ROUTES[id]();
    window.scrollTo(0, 0);
  }

  /* ---------- запуск ---------- */
  function boot() {
    var bad = validate();
    if (bad.length) { var b = $('#banner'); b.hidden = false; b.textContent = 'Данные демо не прошли проверку: ' + bad.join('; '); }
    Store.open().then(function () { ST.idbOk = true; return Store.cleanup(); }).then(function () {
      return Promise.all([Store.all('references'), Store.all('attempts'), Store.all('meta')]);
    }).then(function (r) {
      r[0].filter(function (x) { return x.status !== 'saving'; }).forEach(function (x) {
        var i = ST.refs.map(function (y) { return y.id; }).indexOf(x.id); if (i < 0) ST.refs.push(x); else ST.refs[i] = x;
      });
      r[1].filter(function (x) { return x.status === 'saved'; }).sort(function (x, y) { return x.createdAt - y.createdAt; }).forEach(function (x) { ST.attempts.push(x); });
      var m = r[2].filter(function (x) { return x.key === 'activeReferenceId'; })[0];
      if (m) { ST.activeRefId = m.value; ST.refs.forEach(function (x) { x.status = x.id === m.value ? 'active' : 'archived'; }); }
    }).catch(function (e) {
      var b = $('#banner'); b.hidden = false; b.textContent = 'Хранилище недоступно (' + (e && e.message || e) + '). Просмотр демо работает, сохранение записей — нет.';
    }).then(function () {
      window.addEventListener('hashchange', route);
      route();
    });
  }
  boot();
})();
