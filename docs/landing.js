/* 첫 화면: 평가 과목별 배너 + 설문 배너를 상태에 따라 렌더링 */
(function () {
  var CFG = UNIT.CFG;
  var el = function (id) { return document.getElementById(id); };

  /* 지난번 상태를 저장해 두고 재방문 시 즉시 그린다.
     Apps Script 응답이 1~3초 걸리므로 체감 속도가 크게 달라진다. */
  var STATE_KEY = 'rf_state_v1';
  var STALE_MS = 12 * 60 * 60 * 1000;      // 12시간 지난 캐시는 버린다
  var isStale = false;                      // 캐시로 그린 상태인가

  function saveCache(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify({ at: Date.now(), s: s })); }
    catch (e) { /* 사생활 보호 모드 등 */ }
  }
  function loadCache() {
    try {
      var o = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
      if (o && o.s && (Date.now() - o.at) < STALE_MS) return o.s;
    } catch (e) { /* 무시 */ }
    return null;
  }

  function setUnit(name) {
    if (!name) return;
    el('unitName').textContent = name;
    el('footUnit').textContent = name;
    document.title = name + ' 평가 · 설문';
  }
  setUnit(CFG.unitName);

  function setNotice(text) {
    if (!text) return;
    el('notice').textContent = text;
    el('notice').hidden = false;
  }
  setNotice(CFG.notice);

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** opts: {icon, title, desc, open, url, closedMsg, kind} */
  function makeCard(opts) {
    var a = document.createElement('a');
    var usable = opts.open && opts.url;
    a.className = 'card ' + (opts.kind || 'eval') + (usable ? '' : ' closed');
    a.innerHTML =
      '<span class="card-icon" aria-hidden="true">' + opts.icon + '</span>' +
      '<span class="card-body">' +
        '<span class="card-title">' + esc(opts.title) + '</span>' +
        '<span class="card-desc">' + opts.desc + '</span>' +
      '</span>' +
      '<span class="pill ' + (usable ? 'open' : 'shut') + '">' +
        (usable ? '진행 중' : (isStale ? '확인 중' : (opts.url ? '마감' : '준비 중'))) + '</span>';
    if (usable) {
      a.href = opts.url;
    } else {
      a.href = '#';
      a.addEventListener('click', function (e) {
        e.preventDefault();
        // 아직 최신 상태를 못 받았으면 '마감'이라고 단정하지 않는다
        alert(isStale
          ? '최신 상태를 확인하고 있습니다. 잠시 후 다시 눌러 주십시오.'
          : (opts.closedMsg || '아직 열려 있지 않습니다. 교관 안내에 따라 주십시오.'));
      });
    }
    return a;
  }

  // *별표*로 감싼 부분을 굵게. 그 외 태그는 모두 무해화한다.
  function markup(text) {
    return esc(text).replace(/\*([^*]+)\*/g, '<b>$1</b>');
  }

  function renderGuide(state) {
    var lines = state && state.guide;
    if (!lines) return;                       // 구버전 응답이면 HTML 기본 문구 유지
    var sec = el('guide');
    if (!lines.length) { sec.hidden = true; return; }
    sec.hidden = false;
    var h = el('guideTitle');
    h.textContent = state.guideTitle || '';
    h.hidden = !state.guideTitle;
    el('guideList').innerHTML = lines.map(function (t) {
      return '<li>' + markup(t) + '</li>';
    }).join('');
  }

  function render(state) {
    var wrap = el('cards');
    wrap.innerHTML = '';

    var subjects = state.subjects || [];
    subjects.forEach(function (s) {
      wrap.appendChild(makeCard({
        kind: 'eval', icon: '📝', title: s.name,
        desc: '첫 질문에 <b>본인 번호(조-번)</b>를 입력하십시오.',
        open: s.open, url: s.url, closedMsg: state.evalClosedMessage
      }));
    });

    var sv = state.survey || {};
    wrap.appendChild(makeCard({
      kind: 'survey', icon: '📊', title: '설문 참여',
      desc: '<b>무기명</b>으로 진행됩니다. 솔직하게 응답해 주십시오.',
      open: sv.open, url: sv.url, closedMsg: sv.closedMessage
    }));

    if (!subjects.length) {
      var p = document.createElement('p');
      p.className = 'empty';
      p.textContent = '평가 과목이 아직 등록되지 않았습니다.';
      wrap.insertBefore(p, wrap.firstChild);
    }
  }

  // API 미설정 시: config.js 값만으로 최소 동작
  if (!UNIT.hasApi()) {
    var subs = (CFG.subjects || []).map(function (s) {
      return { name: s.name, url: s.url, open: !!s.url };
    });
    if (!subs.length && CFG.evalFormUrl) {
      subs = [{ name: '평가 응시', url: CFG.evalFormUrl, open: true }];
    }
    render({ subjects: subs, survey: { open: !!CFG.surveyFormUrl, url: CFG.surveyFormUrl } });
    return;
  }

  function applyAll(s) {
    setUnit(s.unitName);
    setNotice(s.notice);
    renderGuide(s);
    render(s);
  }

  // ① 저장된 상태가 있으면 즉시 그린다 (정적 파일만 받으면 되므로 0.2초 수준)
  var cached = loadCache();
  if (cached) {
    isStale = true;
    applyAll(cached);
    el('checking').hidden = false;
  }

  // ② 최신 상태를 받아 덮어쓴다
  UNIT.fetchState().then(function (s) {
    isStale = false;
    el('checking').hidden = true;
    applyAll(s);
    saveCache(s);
  }).catch(function (err) {
    el('checking').hidden = true;
    if (!cached) {
      el('cards').innerHTML = '<p class="empty">상태를 확인하지 못했습니다.<br>' +
        '<small>' + esc(err.message) + '</small></p>';
    } else {
      isStale = false;
      applyAll(cached);        // 최소한 지난 상태로는 쓸 수 있게 둔다
    }
    console.warn('상태 확인 실패:', err);
  });
})();
