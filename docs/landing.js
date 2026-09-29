/* 첫 화면
 *  표시 우선순위:  ① config.js 예비 정보(즉시)  ② 저장된 지난 상태  ③ 서버 최신 상태
 *  서버 응답이 늦거나 실패해도 응시가 막히지 않게 하고, 대신 상태 표시를
 *  '확인 중'으로 두어 잘못된 '마감' 안내를 하지 않는다.
 *  (실제 개폐는 구글폼 자체가 강제하므로 최종 차단은 서버 쪽에서 보장된다.)
 */
(function () {
  var CFG = UNIT.CFG;
  var el = function (id) { return document.getElementById(id); };

  var STATE_KEY = 'rf_state_v2';
  var STALE_MS = 12 * 60 * 60 * 1000;
  var FALLBACK_MS = Number(CFG.fallbackAfterMs) || 2500;

  var isStale = false;     // 최신 상태를 아직 못 받았다
  var allowTap = false;    // 상태 불명이어도 응시를 허용한다
  var done = false;        // 최신 상태 수신 완료

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function saveCache(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify({ at: Date.now(), s: s })); } catch (e) {}
  }
  function loadCache() {
    try {
      var o = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
      if (o && o.s && (Date.now() - o.at) < STALE_MS) return o.s;
    } catch (e) {}
    return null;
  }

  /* config.js 만으로 만드는 예비 상태 (개방 여부는 모름 = null) */
  function baseState() {
    return {
      unitName: CFG.unitName || '',
      notice: CFG.notice || '',
      subjects: (CFG.subjects || []).map(function (s) {
        return { name: s.name, url: s.url || '', open: null };
      }),
      survey: { open: null, url: CFG.surveyFormUrl || '' }
    };
  }

  function setUnit(name) {
    if (!name) return;
    el('unitName').textContent = name;
    el('footUnit').textContent = name;
    document.title = name + ' 평가 · 설문';
  }
  function setNotice(text) {
    if (!text) return;
    el('notice').textContent = text;
    el('notice').hidden = false;
  }

  function markup(text) { return esc(text).replace(/\*([^*]+)\*/g, '<b>$1</b>'); }

  function renderGuide(state) {
    var lines = state && state.guide;
    if (!lines) return;
    var sec = el('guide');
    if (!lines.length) { sec.hidden = true; return; }
    sec.hidden = false;
    var h = el('guideTitle');
    h.textContent = state.guideTitle || '';
    h.hidden = !state.guideTitle;
    el('guideList').innerHTML = lines.map(function (t) { return '<li>' + markup(t) + '</li>'; }).join('');
  }

  /* 카드 한 장의 표시 상태를 결정한다 */
  function decide(open, url) {
    if (!url) return { tap: false, text: '준비 중', cls: 'shut', mode: 'none' };
    if (open === true) return { tap: true, text: '진행 중', cls: 'open', mode: 'live' };
    if (open === false && !isStale) return { tap: false, text: '마감', cls: 'shut', mode: 'closed' };
    // 상태 불명(예비 정보/캐시) — 지연되면 응시를 허용한다
    return { tap: allowTap, text: '확인 중', cls: '', mode: 'pending' };
  }

  function makeCard(opts) {
    var st = decide(opts.open, opts.url);
    var a = document.createElement('a');
    a.className = 'card ' + (opts.kind || 'eval') +
                  (st.mode === 'closed' ? ' closed' : (st.tap ? '' : ' pending'));
    a.innerHTML =
      '<span class="card-icon" aria-hidden="true">' + opts.icon + '</span>' +
      '<span class="card-body">' +
        '<span class="card-title">' + esc(opts.title) + '</span>' +
        '<span class="card-desc">' + opts.desc + '</span>' +
      '</span>' +
      '<span class="pill ' + st.cls + '">' + st.text + '</span>';
    if (st.tap) {
      a.href = opts.url;
    } else {
      a.href = '#';
      a.addEventListener('click', function (e) {
        e.preventDefault();
        alert(st.mode === 'closed'
          ? (opts.closedMsg || '아직 열려 있지 않습니다. 교관 안내에 따라 주십시오.')
          : (st.mode === 'none'
              ? '아직 준비되지 않았습니다. 교관 안내에 따라 주십시오.'
              : '상태를 확인하고 있습니다. 잠시 후 다시 눌러 주십시오.'));
      });
    }
    return a;
  }

  function render(state) {
    var wrap = el('cards');
    wrap.innerHTML = '';
    (state.subjects || []).forEach(function (s) {
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
    if (!(state.subjects || []).length) {
      var p = document.createElement('p');
      p.className = 'empty';
      p.textContent = '평가 과목이 아직 등록되지 않았습니다.';
      wrap.insertBefore(p, wrap.firstChild);
    }
  }

  function applyAll(s) {
    setUnit(s.unitName);
    setNotice(s.notice);
    renderGuide(s);
    render(s);
  }

  /* ── 시작 ─────────────────────────────────────── */
  var shown = loadCache() || baseState();
  var hasAnything = (shown.subjects || []).length > 0 || (shown.survey && shown.survey.url);

  if (!UNIT.hasApi()) {
    // 서버 없이 링크만으로 동작
    shown.subjects.forEach(function (s) { s.open = !!s.url; });
    shown.survey.open = !!shown.survey.url;
    applyAll(shown);
    return;
  }

  if (hasAnything) {
    isStale = true;
    applyAll(shown);
    el('checking').hidden = false;
  }

  // 서버가 늦으면 예비 정보로 응시를 허용한다 (동시 접속이 몰릴 때 대비)
  var promote = setTimeout(function () {
    if (done) return;
    allowTap = true;
    el('checking').textContent = '상태 확인이 지연되고 있습니다. 바로 응시할 수 있습니다.';
    applyAll(shown);
  }, FALLBACK_MS);

  UNIT.fetchState().then(function (s) {
    done = true; clearTimeout(promote);
    isStale = false; allowTap = false;
    el('checking').hidden = true;
    applyAll(s);
    saveCache(s);
  }).catch(function (err) {
    done = true; clearTimeout(promote);
    allowTap = true;                      // 서버 실패 시에도 응시는 가능하게
    if (hasAnything) {
      el('checking').textContent = '상태를 확인하지 못했습니다. 교관 안내에 따라 진행하십시오.';
      applyAll(shown);
    } else {
      el('checking').hidden = true;
      el('cards').innerHTML = '<p class="empty">상태를 확인하지 못했습니다.<br>' +
        '<small>' + esc(err.message) + '</small></p>';
    }
    console.warn('상태 확인 실패:', err);
  });
})();
