/* 첫 화면
 *  ① 본인 번호(조-번)를 한 번 선택하면 기억한다.  ?g=3&n=7 로도 지정 가능.
 *  ② 조에 배정된 안(A/B)의 폼으로만 안내하고, 번호를 미리 채워 준다.
 *  ③ 서버 응답이 늦거나 실패해도 화면이 죽지 않게 한다.
 *     단, 안(案)을 모르면 잘못된 폼으로 보낼 수 있으므로
 *     '예비 정보에 해당 안의 링크가 있을 때'만 응시를 허용한다.
 */
(function () {
  var CFG = UNIT.CFG;
  var el = function (id) { return document.getElementById(id); };

  var STATE_KEY = 'rf_state_v3';
  var ME_KEY = 'rf_me_v2';
  var DEV_KEY = 'rf_dev_v1';
  var STALE_MS = 12 * 60 * 60 * 1000;
  var FALLBACK_MS = Number(CFG.fallbackAfterMs) || 2500;

  var state = null;        // 화면에 적용 중인 상태
  var isStale = false;     // 최신 상태를 아직 못 받았다
  var allowTap = false;    // 상태 불명이어도 응시 허용
  var done = false;
  var me = null;           // {g:3, n:7}

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function pick(k, maxAge) {
    try {
      var o = JSON.parse(localStorage.getItem(k) || 'null');
      if (!o) return null;
      if (maxAge && (Date.now() - (o.at || 0)) > maxAge) return null;
      return o.v === undefined ? o : o.v;
    } catch (e) { return null; }
  }

  /* 폰에 저장한 번호는 '그 날' 것만 유효하다.
     서버 등록(claim)이 날짜별이므로 폰도 같은 기준을 써야
     다음 회차에 지난번 번호가 남아 교관이 일일이 풀어 주는 일이 없다. */
  function todayLocal() {
    var d = new Date(), p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* 기기를 구분하는 값. 같은 폰에서 새로고침해도 본인 등록은 유지된다. */
  function deviceToken() {
    var t = pick(DEV_KEY);
    if (t) return t;
    var v = null;
    try { if (window.crypto && crypto.randomUUID) v = crypto.randomUUID(); } catch (e) {}
    if (!v) v = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    store(DEV_KEY, { at: Date.now(), v: v });
    return v;
  }

  /* ── 안(案) 배정: 서버와 같은 규칙 ─────────────── */
  function planFor(g, pattern) {
    var p = String(pattern === null || pattern === undefined ? '' : pattern)
      .toUpperCase().replace(/[^AB]/g, '');
    if (!p) return 'A';
    return p.charAt((Number(g) - 1) % p.length);
  }

  /* 조별 개방은 과목마다 따로 관리된다 */
  function groupOpen(s, g) {
    var og = s && s.openGroups;
    if (og === null || og === undefined) return true;
    return og.indexOf(Number(g)) !== -1;
  }

  /* ── config.js 만으로 만드는 예비 상태 ──────────── */
  function baseState() {
    return {
      fromCache: false,
      unitName: CFG.unitName || '',
      notice: CFG.notice || '',
      groupCount: Number(CFG.groupCount) || 50,
      memberCount: Number(CFG.memberCount) || 10,
      planPattern: CFG.planPattern || 'ABBA',
      subjects: (CFG.subjects || []).map(function (s) {
        return { name: s.name, open: null, hasB: !!s.urlB, openGroups: null,
                 urls: { A: s.urlA || '', B: s.urlB || '' },
                 prefill: { A: '', B: '' } };
      }),
      survey: { open: null, url: CFG.surveyFormUrl || '' }
    };
  }

  /* ── 머리말 ───────────────────────────────────── */
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
  function markup(t) { return esc(t).replace(/\*([^*]+)\*/g, '<b>$1</b>'); }
  function renderGuide(s) {
    var lines = s && s.guide;
    if (!lines) return;
    var sec = el('guide');
    if (!lines.length) { sec.hidden = true; return; }
    sec.hidden = false;
    var h = el('guideTitle');
    h.textContent = s.guideTitle || '';
    h.hidden = !s.guideTitle;
    el('guideList').innerHTML = lines.map(function (t) { return '<li>' + markup(t) + '</li>'; }).join('');
  }

  /* ── 번호 선택 ────────────────────────────────── */
  function fillSelects() {
    var gc = (state && state.groupCount) || 50;
    var mc = (state && state.memberCount) || 10;
    var g = el('selG'), n = el('selN'), i;
    var keepG = g.value, keepN = n.value;
    if (g.options.length !== gc) {
      g.innerHTML = '';
      for (i = 1; i <= gc; i++) g.appendChild(new Option(i + '조', i));
    }
    if (n.options.length !== mc) {
      n.innerHTML = '';
      for (i = 1; i <= mc; i++) n.appendChild(new Option(i + '번', i));
    }
    if (keepG) g.value = keepG;
    if (keepN) n.value = keepN;
  }

  function showMePanel(on) {
    el('mePanel').hidden = !on;
    el('meBar').hidden = on || !me;
    el('meUnlock').hidden = !me;
    el('cards').hidden = on;
    el('guide').hidden = on;
    if (on) fillSelects();
  }

  function applyMe() {
    el('meNo').textContent = me.g + '-' + me.n;
    var hasB = (state.subjects || []).some(function (s) { return s.hasB; });
    var plan = planFor(me.g, state.planPattern);
    el('mePlan').textContent = plan + '안';
    el('mePlan').hidden = !hasB;
    el('meBar').hidden = false;
  }

  /* 번호는 한 번 등록하면 본인이 바꿀 수 없다.
     잘못 등록했으면 교관이 PIN 으로 풀어 준다. */
  el('meOk').addEventListener('click', async function () {
    var g = Number(el('selG').value), n = Number(el('selN').value);
    if (!g || !n) return;
    if (!confirm(g + '-' + n + ' 으로 등록합니다.\n\n' +
                 '이 번호는 본인에게 고정되어 다른 사람은 등록할 수 없습니다.\n' +
                 '한 번 등록하면 본인은 바꿀 수 없고, 교관만 변경해 줄 수 있습니다.\n\n' +
                 '번호가 맞습니까?')) return;

    var btn = el('meOk'), label = btn.textContent;
    btn.disabled = true; btn.textContent = '등록 중…';
    try {
      if (UNIT.hasApi()) {
        var r = await UNIT.api('claim', { g: g, n: n, token: deviceToken() });
        if (r && r.taken) {
          alert(g + '-' + n + ' 은(는) 이미 다른 사람이 등록한 번호입니다.\n\n' +
                '본인 번호가 맞다면 교관에게 알려 주십시오.\n' +
                '교관이 등록을 풀어 주면 바로 등록할 수 있습니다.');
          return;
        }
      }
      me = { g: g, n: n, d: todayLocal() };
      store(ME_KEY, { at: Date.now(), v: me });
      showMePanel(false);
      applyMe();
      render();
    } catch (err) {
      alert('등록에 실패했습니다.\n' + err.message + '\n\n잠시 후 다시 시도해 주십시오.');
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  });

  el('meUnlock').addEventListener('click', async function () {
    var pin = prompt('교관 PIN 을 입력하십시오.\n(예비군은 번호를 변경할 수 없습니다)');
    if (pin === null || !pin.trim()) return;
    el('meUnlock').disabled = true;
    try {
      await UNIT.api('ping', { pin: pin.trim() });
      if (me) { el('selG').value = me.g; el('selN').value = me.n; }
      showMePanel(true);
    } catch (err) {
      alert('PIN 이 올바르지 않습니다.');
    } finally {
      el('meUnlock').disabled = false;
    }
  });

  /* ── 카드 ─────────────────────────────────────── */
  function makeCard(o) {
    var a = document.createElement('a');
    var cls = 'card ' + (o.kind || 'eval');
    if (o.mode === 'closed' || o.mode === 'groupwait') cls += ' closed';
    else if (!o.tap) cls += ' pending';
    a.className = cls;
    a.innerHTML =
      '<span class="card-icon" aria-hidden="true">' + o.icon + '</span>' +
      '<span class="card-body">' +
        '<span class="card-title">' + esc(o.title) +
          (o.badge ? '<span class="plan-badge">' + esc(o.badge) + '</span>' : '') + '</span>' +
        (o.desc ? '<span class="card-desc">' + o.desc + '</span>' : '') +
      '</span>' +
      '<span class="pill ' + o.pillCls + '">' + o.pill + '</span>';
    if (o.tap) {
      a.href = o.url;
    } else {
      a.href = '#';
      a.addEventListener('click', function (e) { e.preventDefault(); alert(o.msg); });
    }
    return a;
  }

  function evalCard(s) {
    var hasB = !!s.hasB;
    var plan = planFor(me.g, state.planPattern);
    var which = (hasB && plan === 'B') ? 'B' : 'A';
    var url = (s.urls && s.urls[which]) || '';
    var tpl = (s.prefill && s.prefill[which]) || '';
    var href = tpl ? tpl.replace('__NO__', encodeURIComponent(me.g + '-' + me.n)) : url;
    var badge = hasB ? plan + '안' : '';
    // 번호가 자동으로 채워지므로 따로 안내하지 않는다.
    // 자동입력이 안 되는 폼일 때만 번호를 알려 준다.
    var desc = tpl ? '' : '첫 질문에 <b>' + me.g + '-' + me.n + '</b> 을(를) 입력하십시오.';

    if (!url) {
      return makeCard({ kind: 'eval', icon: '📝', title: s.name, badge: badge, desc: desc,
        mode: 'none', tap: false, pill: '준비 중', pillCls: 'shut',
        msg: badge ? (badge + ' 폼이 아직 준비되지 않았습니다. 교관에게 알려 주십시오.')
                   : '아직 준비되지 않았습니다. 교관 안내에 따라 주십시오.' });
    }
    // 과목 자체가 닫혔으면 '마감', 과목은 열렸는데 내 조 차례가 아니면 '대기'
    if (s.open === false && !isStale) {
      return makeCard({ kind: 'eval', icon: '📝', title: s.name, badge: badge, desc: desc,
        mode: 'closed', tap: false, pill: '마감', pillCls: 'shut',
        msg: state.evalClosedMessage || '평가 시간이 아닙니다. 교관 안내에 따라 주십시오.' });
    }
    if (!groupOpen(s, me.g)) {
      return makeCard({ kind: 'eval', icon: '📝', title: s.name, badge: badge, desc: desc,
        mode: 'groupwait', tap: false, pill: '대기', pillCls: 'shut',
        msg: state.groupClosedMessage || '아직 귀 조의 평가 시간이 아닙니다. 교관 안내에 따라 주십시오.' });
    }
    if (s.open === true) {
      return makeCard({ kind: 'eval', icon: '📝', title: s.name, badge: badge, desc: desc,
        mode: 'live', tap: true, url: href, pill: '진행 중', pillCls: 'open' });
    }
    return makeCard({ kind: 'eval', icon: '📝', title: s.name, badge: badge, desc: desc,
      mode: 'pending', tap: allowTap, url: href, pill: '확인 중', pillCls: '',
      msg: '상태를 확인하고 있습니다. 잠시 후 다시 눌러 주십시오.' });
  }

  function surveyCard() {
    var sv = state.survey || {};
    var desc = '<b>무기명</b>으로 진행됩니다. 솔직하게 응답해 주십시오.';
    if (!sv.url) {
      return makeCard({ kind: 'survey', icon: '📊', title: '설문 참여', desc: desc,
        mode: 'none', tap: false, pill: '준비 중', pillCls: 'shut',
        msg: '아직 준비되지 않았습니다. 교관 안내에 따라 주십시오.' });
    }
    if (sv.open === true) {
      return makeCard({ kind: 'survey', icon: '📊', title: '설문 참여', desc: desc,
        mode: 'live', tap: true, url: sv.url, pill: '진행 중', pillCls: 'open' });
    }
    if (sv.open === false && !isStale) {
      return makeCard({ kind: 'survey', icon: '📊', title: '설문 참여', desc: desc,
        mode: 'closed', tap: false, pill: '마감', pillCls: 'shut',
        msg: sv.closedMessage || '설문 시간이 아닙니다. 교관 안내에 따라 주십시오.' });
    }
    return makeCard({ kind: 'survey', icon: '📊', title: '설문 참여', desc: desc,
      mode: 'pending', tap: allowTap, url: sv.url, pill: '확인 중', pillCls: '',
      msg: '상태를 확인하고 있습니다. 잠시 후 다시 눌러 주십시오.' });
  }

  function render() {
    if (!me) return;
    var wrap = el('cards');
    wrap.innerHTML = '';
    (state.subjects || []).forEach(function (s) { wrap.appendChild(evalCard(s)); });
    wrap.appendChild(surveyCard());
    if (!(state.subjects || []).length) {
      var p = document.createElement('p');
      p.className = 'empty';
      p.textContent = '평가 과목이 아직 등록되지 않았습니다.';
      wrap.insertBefore(p, wrap.firstChild);
    }
  }

  function applyAll(s) {
    state = s;
    setUnit(s.unitName);
    setNotice(s.notice);
    renderGuide(s);
    if (me) { applyMe(); render(); } else { showMePanel(true); }
  }

  /* ── 시작 ─────────────────────────────────────── */
  var q = {};
  location.search.replace(/^\?/, '').split('&').forEach(function (kv) {
    var p = kv.split('=');
    if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
  });

  me = pick(ME_KEY);
  if (me && me.d !== todayLocal()) me = null;   // 지난 회차 번호는 쓰지 않는다
  if (q.g && /^\d+$/.test(q.g)) {
    me = { g: Number(q.g), d: todayLocal(),
           n: (q.n && /^\d+$/.test(q.n)) ? Number(q.n) : (me ? me.n : 0) };
    if (!me.n) me = null;                 // 번은 직접 골라야 한다
    else store(ME_KEY, { at: Date.now(), v: me });
  }

  var cached = pick(STATE_KEY, STALE_MS);
  if (cached) cached.fromCache = true;
  var shown = cached || baseState();

  if (!UNIT.hasApi()) {
    shown.subjects.forEach(function (s) { s.open = !!(s.urls.A || s.urls.B); });
    shown.survey.open = !!shown.survey.url;
    applyAll(shown);
    if (q.g && /^\d+$/.test(q.g)) el('selG').value = Number(q.g);
    return;
  }

  isStale = true;
  applyAll(shown);
  if (q.g && /^\d+$/.test(q.g) && !el('mePanel').hidden) el('selG').value = Number(q.g);
  el('checking').hidden = false;

  // 서버가 늦을 때: 안(案)별 링크를 아는 경우에만 응시를 허용한다
  var promote = setTimeout(function () {
    if (done) return;
    var sub = shown.subjects || [];
    var plan = me ? planFor(me.g, shown.planPattern) : 'A';
    var usable = sub.length && sub.every(function (s) {
      var w = (s.hasB && plan === 'B') ? 'B' : 'A';
      return !!(s.urls && s.urls[w]);
    });
    allowTap = !!usable;
    el('checking').textContent = usable
      ? '상태 확인이 지연되고 있습니다. 바로 응시할 수 있습니다.'
      : '상태 확인이 지연되고 있습니다. 잠시만 기다려 주십시오.';
    applyAll(shown);
  }, FALLBACK_MS);

  UNIT.fetchState().then(function (s) {
    done = true; clearTimeout(promote);
    isStale = false; allowTap = false;
    el('checking').hidden = true;
    applyAll(s);
    store(STATE_KEY, { at: Date.now(), v: s });
  }).catch(function (err) {
    done = true; clearTimeout(promote);
    el('checking').textContent = '상태를 확인하지 못했습니다. 교관 안내에 따라 진행하십시오.';
    console.warn('상태 확인 실패:', err);
  });
})();
