/* 관리자 화면: 과목별 개폐 · 과목별 현황 · 종합 순위(과목 점수 평균, 100점 만점) */
(function () {
  var CFG = UNIT.CFG;
  var el = function (id) { return document.getElementById(id); };
  var PIN_KEY = 'rf_admin_pin';

  /* 비공개 탭·쿠키 차단·file:// 환경에서는 저장소 접근이 예외를 던진다.
     감싸지 않으면 여기서 스크립트가 중단되어 버튼이 전부 죽는다. */
  function keep(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 무시 */ } }
  function recall(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function forget(k) { try { sessionStorage.removeItem(k); } catch (e) { /* 무시 */ } }

  var pin = recall(PIN_KEY);
  var timer = null, auto = true, last = null, activeTab = 0;
  var activeView = 'eval', surveyData = null;
  var dateParam = '', pastMode = false, knownDates = [];

  document.title = (CFG.unitName ? CFG.unitName + ' ' : '') + '관리자';

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function setMsg(node, text, kind) {
    node.textContent = text || '';
    node.className = 'msg' + (kind ? ' ' + kind : '');
  }
  /* 모든 과목이 100점 만점이므로 환산 점수 = 실제 점수.
     만점이 다른 과목이 섞이면 100점 만점으로 환산한 점수가 된다. */
  function pts(n) { return n === null || n === undefined ? '-' : UNIT.fmt(n, 1) + '점'; }

  /* ── 로그인 ───────────────────────────────────────── */
  /* PIN 확인용 요청(ping)을 따로 보내지 않는다.
     현황 조회 한 번으로 인증까지 끝내 왕복을 절반으로 줄인다. */
  async function login(value) {
    setMsg(el('loginMsg'), '확인 중…');
    el('loginBtn').disabled = true;
    try {
      var d = await UNIT.api('dashboard', { pin: value, date: '' });
      pin = value;
      keep(PIN_KEY, pin);
      el('loginView').hidden = true;
      el('dashView').hidden = false;
      last = d;
      render(d);
      setAuto(true);
    } catch (err) {
      setMsg(el('loginMsg'), err.message, 'err');
    } finally {
      el('loginBtn').disabled = false;
    }
  }
  el('loginBtn').addEventListener('click', function () {
    var v = el('pin').value.trim();
    if (!v) return setMsg(el('loginMsg'), 'PIN 을 입력하십시오.', 'err');
    login(v);
  });
  el('pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') el('loginBtn').click(); });
  el('logoutBtn').addEventListener('click', function () {
    forget(PIN_KEY);
    if (timer) clearInterval(timer);
    location.reload();
  });

  /* ── 로드 · 자동 새로고침 ─────────────────────────── */
  function setAuto(on) {
    auto = on;
    if (timer) clearInterval(timer);
    if (on) timer = setInterval(load, Math.max(5, Number(CFG.refreshSeconds) || 15) * 1000);
    el('autoBtn').textContent = on ? '자동 새로고침 끄기' : '자동 새로고침 켜기';
    el('autoState').textContent = on ? '자동 새로고침 켜짐' : '자동 새로고침 꺼짐';
  }
  el('autoBtn').addEventListener('click', function () { setAuto(!auto); });
  el('refreshBtn').addEventListener('click', function () { load(); });

  function settle(p) {
    return p.then(function (d) { return { ok: true, d: d }; },
                  function (e) { return { ok: false, e: e }; });
  }

  /* 평가 현황과 설문 결과를 동시에 요청한다(순차 호출이면 왕복 시간이 두 배). */
  async function load() {
    busy(true);
    var pDash = settle(UNIT.api('dashboard', { pin: pin, date: dateParam }));
    var pSurv = (activeView === 'survey')
      ? settle(UNIT.api('survey', { pin: pin, date: dateParam })) : null;

    var rd = await pDash;
    if (rd.ok) { last = rd.d; render(last); setMsg(el('dashMsg'), ''); }
    else setMsg(el('dashMsg'), '불러오기 실패: ' + rd.e.message, 'err');

    if (pSurv) {
      var rs = await pSurv;
      if (rs.ok) {
        surveyData = rs.d;
        mergeDates(surveyData.availableDates);
        renderSurvey(surveyData);
        setMsg(el('surveyMsg'), '');
      } else {
        setMsg(el('surveyMsg'), '설문 결과를 불러오지 못했습니다: ' + rs.e.message, 'err');
      }
    }
    busy(false);
  }

  function busy(on) {
    var b = el('refreshBtn');
    b.disabled = on;
    b.textContent = on ? '불러오는 중…' : '새로고침';
  }

  /* ── 조회 기준일 ─────────────────────────────────
     기본은 '당일'. 과거 조회로 들어가면 개폐 조작을 숨기고
     자동 새로고침을 끈다(지난 데이터는 더 변하지 않는다). */
  function dateText(s) {
    if (!s) return '전체 기간';
    var p = s.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var w = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return Number(p[0]) + '. ' + Number(p[1]) + '. ' + Number(p[2]) + '. (' + w + ')';
  }

  function mergeDates(list) {
    (list || []).forEach(function (d) { if (knownDates.indexOf(d) === -1) knownDates.push(d); });
    knownDates.sort().reverse();
  }

  function applyDateUI(d) {
    mergeDates(d.availableDates);
    var label;
    if (dateParam === 'all') label = '전체 기간';
    else if (!dateParam || d.date === d.today) label = '오늘 · ' + dateText(d.today);
    else label = dateText(d.date);
    el('dateLabel').textContent = label;

    if (d.today) el('dateInput').max = d.today;
    if (dateParam && dateParam !== 'all') el('dateInput').value = dateParam;

    var wrap = el('quickDates');
    wrap.innerHTML = '';
    knownDates.slice(0, 14).forEach(function (day) {
      var b = document.createElement('button');
      b.className = 'qdate' + (day === dateParam ? ' active' : '');
      b.textContent = dateText(day) + (day === d.today ? ' · 오늘' : '');
      b.addEventListener('click', function () { goDate(day); });
      wrap.appendChild(b);
    });
    if (!knownDates.length) wrap.innerHTML = '<span class="msg" style="color:var(--muted)">응답 기록이 없습니다.</span>';
  }

  function setPast(on) {
    pastMode = on;
    el('datePicker').hidden = !on;
    el('pastBtn').hidden = on;
    el('todayBtn').hidden = !on;
    el('togglePanel').hidden = on;      // 과거 조회 중에는 개폐 조작을 감춘다
    el('surveyPanel').hidden = on;
    el('dateBar').classList.toggle('past', on);
    setAuto(!on);
  }

  function goDate(v) {
    dateParam = v;
    surveyData = null;
    setPast(v !== '');
    load();
  }

  el('pastBtn').addEventListener('click', function () {
    setPast(true);
    if (!el('dateInput').value && knownDates.length) el('dateInput').value = knownDates[0];
  });
  el('todayBtn').addEventListener('click', function () {
    dateParam = ''; surveyData = null;
    setPast(false);
    load();
  });
  el('dateGo').addEventListener('click', function () {
    var v = el('dateInput').value;
    if (!v) return setMsg(el('dashMsg'), '날짜를 선택하십시오.', 'err');
    goDate(v);
  });
  el('dateAll').addEventListener('click', function () { goDate('all'); });

  /* ── 뷰 전환 (평가 현황 / 설문 결과) ──────────────── */
  function setView(v) {
    activeView = v;
    el('evalView').hidden = (v !== 'eval');
    el('surveyView').hidden = (v !== 'survey');
    el('viewEval').classList.toggle('active', v === 'eval');
    el('viewSurvey').classList.toggle('active', v === 'survey');
    el('csvBtn').hidden = (v !== 'eval');
    if (v === 'survey' && !surveyData) {
      el('surveyQuestions').innerHTML =
        '<div class="panel"><p class="empty">설문 결과를 불러오는 중…</p></div>';
      loadSurvey();
    }
  }
  el('viewEval').addEventListener('click', function () { setView('eval'); });
  el('viewSurvey').addEventListener('click', function () { setView('survey'); });

  async function loadSurvey() {
    try {
      setMsg(el('surveyMsg'), '');
      surveyData = await UNIT.api('survey', { pin: pin, date: dateParam });
      mergeDates(surveyData.availableDates);
      renderSurvey(surveyData);
    } catch (err) {
      setMsg(el('surveyMsg'), '설문 결과를 불러오지 못했습니다: ' + err.message, 'err');
    }
  }

  /* ── 설문 결과 렌더링 ────────────────────────────
     단일 계열 분포이므로 색은 한 가지만 쓰고(범례 불필요),
     각 막대에 항목명·인원·비율을 직접 라벨로 붙인다. */
  function renderSurvey(d) {
    el('surveyTitle').textContent = d.formTitle || '설문 결과';
    el('surveyState').textContent =
      (d.accepting ? '응답 받는 중' : '마감됨') + ' · 갱신 ' + UNIT.timeText(d.updatedAt);
    el('surveyCount').textContent = d.responseCount;

    var wrap = el('surveyQuestions');
    wrap.innerHTML = '';
    if (!d.responseCount) {
      wrap.innerHTML = '<div class="panel"><p class="empty">아직 제출된 설문이 없습니다.</p></div>';
      return;
    }
    (d.questions || []).forEach(function (q) { wrap.appendChild(questionCard(q)); });
  }

  /* 단일선택 객관식은 항상 도넛으로 그린다.
     복수선택(합이 100%가 아님)·척도형(순서가 있음)·그리드는 원형이
     사실과 다른 그림이 되므로 막대를 유지한다. */
  function pieOK(q) {
    if (q.type !== 'MULTIPLE_CHOICE' && q.type !== 'LIST') return false;
    return !!(q.options && q.options.length && q.answered);
  }

  /* 색은 6개까지만 쓴다(그 이상은 인접 색이 구분되지 않음).
     항목이 7개 이상이면 상위 5개 + '기타'로 묶는다. */
  function pieSlices(q) {
    var opts = q.options.map(function (o, i) {
      return { label: o.label, count: o.count, pct: o.pct, other: o.other, idx: i };
    });
    if (opts.length <= 6) return opts;

    var sorted = opts.slice().sort(function (a, b) { return b.count - a.count; });
    var top = sorted.slice(0, 5).sort(function (a, b) { return a.idx - b.idx; });
    var rest = sorted.slice(5);
    var sum = rest.reduce(function (a, o) { return a + o.count; }, 0);
    top.push({
      label: '기타 ' + rest.length + '개 항목',
      count: sum,
      pct: q.answered ? Math.round((sum / q.answered) * 1000) / 10 : 0,
      folded: rest
    });
    return top;
  }

  function arcPath(cx, cy, R, r, a0, a1) {
    var f = function (n) { return Math.round(n * 100) / 100; };
    var big = (a1 - a0) > Math.PI ? 1 : 0;
    var x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
    var x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    var i1 = cx + r * Math.cos(a1), j1 = cy + r * Math.sin(a1);
    var i0 = cx + r * Math.cos(a0), j0 = cy + r * Math.sin(a0);
    return 'M' + f(x0) + ' ' + f(y0) +
           ' A' + R + ' ' + R + ' 0 ' + big + ' 1 ' + f(x1) + ' ' + f(y1) +
           ' L' + f(i1) + ' ' + f(j1) +
           ' A' + r + ' ' + r + ' 0 ' + big + ' 0 ' + f(i0) + ' ' + f(j0) + ' Z';
  }

  function donut(q) {
    var cx = 90, cy = 90, R = 78, r = 48, total = q.answered;
    var slices = pieSlices(q);
    var svg = '', acc = 0;

    slices.forEach(function (o, i) {
      if (!o.count) return;
      var c = 'var(--c' + (i + 1) + ')';
      var tip = esc(o.label) + ' — ' + o.count + '명 (' + UNIT.fmt(o.pct, 1) + '%)';
      if (o.count === total) {                       // 한 항목이 100%
        svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + ((R + r) / 2) +
               '" fill="none" stroke="' + c + '" stroke-width="' + (R - r) +
               '"><title>' + tip + '</title></circle>';
        return;
      }
      var a0 = (acc / total) * 2 * Math.PI - Math.PI / 2;
      acc += o.count;
      var a1 = (acc / total) * 2 * Math.PI - Math.PI / 2;
      svg += '<path d="' + arcPath(cx, cy, R, r, a0, a1) + '" fill="' + c +
             '" stroke="var(--surface)" stroke-width="2"><title>' + tip + '</title></path>';
    });

    var legend = slices.map(function (o, i) {
      var sub = '';
      if (o.folded) {
        sub = '<span class="lsub">' + o.folded.map(function (f) {
          return esc(f.label) + ' ' + f.count;
        }).join(' · ') + '</span>';
      }
      return '<li class="' + (o.count ? '' : 'zero') + '">' +
        '<span class="sw" style="background:var(--c' + (i + 1) + ')"></span>' +
        '<span class="lb">' + esc(o.label) +
          (o.other ? '<span class="other-tag">기타 입력</span>' : '') + sub + '</span>' +
        '<span class="ln">' + o.count + '명</span>' +
        '<span class="lp">' + UNIT.fmt(o.pct, 1) + '%</span></li>';
    }).join('');

    return '<div class="pie-wrap">' +
      '<svg class="pie-svg" width="180" height="180" viewBox="0 0 180 180" role="img" ' +
        'aria-label="' + esc(q.title) + ' 응답 분포">' + svg +
        '<text x="90" y="86" text-anchor="middle" class="pie-center-v" fill="currentColor">' +
          total + '</text>' +
        '<text x="90" y="103" text-anchor="middle" class="pie-center-k" fill="currentColor" ' +
          'opacity=".6">명 응답</text>' +
      '</svg>' +
      '<ul class="legend">' + legend + '</ul></div>';
  }

  function bars(options) {
    return '<div class="qbars">' + options.map(function (o) {
      var w = Math.max(0, Math.min(100, o.pct || 0));
      return '<div class="qbar' + (o.count ? '' : ' zero') + '" title="' +
             esc(o.label) + ' — ' + o.count + '명 (' + UNIT.fmt(o.pct, 1) + '%)">' +
        '<div class="qbar-top">' +
          '<span class="qbar-label">' + esc(o.label) +
            (o.other ? '<span class="other-tag">기타 입력</span>' : '') + '</span>' +
          '<span class="qbar-val">' + o.count + '명 · ' + UNIT.fmt(o.pct, 1) + '%</span>' +
        '</div>' +
        '<div class="qbar-track"><i style="width:' + w + '%"></i></div></div>';
    }).join('') + '</div>';
  }

  function questionCard(q) {
    var div = document.createElement('div');
    div.className = 'qcard';
    var isText = (q.type === 'TEXT' || q.type === 'PARAGRAPH_TEXT');
    var html = '<div class="qhead"><span class="qtitle">' + esc(q.title) + '</span>' +
               '<span class="qmeta">응답 ' + (q.answered || 0) + '명</span></div>';

    if (q.type === 'SCALE') {
      html += '<div class="qscale"><span class="avg">' +
              (q.average === undefined || q.average === null ? '-' : UNIT.fmt(q.average, 2)) +
              '</span><span class="of">/ ' + q.max + '점 평균</span></div>';
      if (q.options) html += bars(q.options);
      if (q.minLabel || q.maxLabel) {
        html += '<div class="qends"><span>' + esc(q.minLabel) + '</span>' +
                '<span>' + esc(q.maxLabel) + '</span></div>';
      }
    } else if (q.rows) {
      q.rows.forEach(function (r) {
        html += '<div class="qrow-label">' + esc(r.label) +
                ' <span class="qmeta">(' + r.answered + '명)</span></div>' + bars(r.options);
      });
    } else if (isText) {
      html += q.answers
        ? '<ul class="answers">' + q.answers.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>'
        : '<p class="qnote">아직 작성된 답변이 없습니다.</p>';
    } else if (q.options) {
      if (q.multi) html += '<p class="qnote">복수 선택 문항 — 비율 합계가 100%를 넘어 ' +
                           '원형으로 표시할 수 없어 막대로 보여 줍니다.</p>';
      html += pieOK(q) ? donut(q) : bars(q.options);
    } else {
      html += '<p class="qnote">집계할 수 없는 형식의 문항입니다.</p>';
    }
    div.innerHTML = html;
    return div;
  }

  /* ── 렌더링 ──────────────────────────────────────── */
  function render(d) {
    el('updatedAt').textContent = UNIT.timeText(d.updatedAt);
    applyDateUI(d);
    el('dashTitle').textContent = (CFG.unitName || '') + ' 평가 현황';
    renderEvalGates(d);
    renderGateMatrix(d);
    renderSurveySwitch(d);
    renderCombined(d);
    renderTabs(d);
    renderSubject(d);
    renderUnknown(d);
    renderWrongPlan(d);
    renderReset(d);
  }

  /* ── 번호 초기화 (교관용) ─────────────────────────
     최초 제출만 인정하므로, 남의 번호를 선점한 제출을 지워 주면
     뒤에 들어온 제출이 자동으로 승계된다. */
  function renderReset(d) {
    var subs = d.subjects || [];
    var allPeriod = (dateParam === 'all');
    el('rsGo').disabled = allPeriod;
    el('rsNo').disabled = allPeriod;
    if (allPeriod) {
      setMsg(el('rsMsg'), '전체 기간에서는 초기화할 수 없습니다. 날짜를 먼저 고르십시오.', 'err');
    } else if (el('rsMsg').className.indexOf('err') === -1) {
      setMsg(el('rsMsg'), '');
    }

    // 등록(선점) 현황
    var cl = d.claims || { count: 0, pending: [] };
    var pend = cl.pending || [];
    el('claimStat').textContent = '등록 ' + cl.count + '명 · 등록 후 미제출 ' + pend.length + '명';
    el('pendingWrap').hidden = pend.length === 0;
    el('pendingChips').innerHTML = pend.map(function (no) {
      return '<span class="chip">' + esc(no) + '</span>';
    }).join('');

    var rows = [];
    subs.forEach(function (s) {
      (s.dupes || []).forEach(function (x) {
        rows.push({ subject: s.name, no: x.no, count: x.count, keptAt: x.keptAt });
      });
    });
    el('dupWrap').hidden = rows.length === 0;
    var tb = el('dupTable').querySelector('tbody');
    tb.innerHTML = '';
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc(r.subject) + '</td><td><b>' + esc(r.no) + '</b></td>' +
                     '<td class="num">' + r.count + '회</td>' +
                     '<td>' + UNIT.timeText(r.keptAt) + '</td><td></td>';
      var btn = document.createElement('button');
      btn.className = 'off';
      btn.style.padding = '6px 12px';
      btn.style.fontSize = '13px';
      btn.textContent = '전부 삭제';
      btn.disabled = allPeriod;
      btn.addEventListener('click', function () { resetNo(r.no); });
      tr.lastChild.appendChild(btn);
      tb.appendChild(tr);
    });
  }

  /* 번호 하나를 완전히 비운다 — 전 과목 제출 기록 + 등록 */
  async function resetNo(no) {
    if (!confirm(no + ' 을(를) 완전히 초기화합니다.\n\n' +
                 '· 모든 과목의 제출 기록을 전부 삭제합니다\n' +
                 '· 번호 등록을 풀어 다시 등록할 수 있게 합니다\n\n' +
                 '되돌릴 수 없습니다. 진행하시겠습니까?')) return;
    el('rsGo').disabled = true;
    setMsg(el('rsMsg'), '처리 중…');
    try {
      var r = await UNIT.api('reset', { pin: pin, no: no, date: dateParam });
      var parts = [];
      (r.removed || []).forEach(function (x) {
        parts.push(x.subject + ' ' + x.count + '건');
      });
      var txt = r.no + ' 초기화 완료 — ' +
        (parts.length ? '제출 삭제: ' + parts.join(', ') : '삭제할 제출 없음') +
        (r.released ? ' · 등록 해제 (다시 등록 가능)' : '');
      setMsg(el('rsMsg'), txt, 'ok');
    } catch (err) {
      setMsg(el('rsMsg'), '실패: ' + err.message, 'err');
    }
    el('rsGo').disabled = false;
    await load();
  }

  el('rsGo').addEventListener('click', function () {
    var no = el('rsNo').value.trim();
    if (!/^\d{1,3}\s*-\s*\d{1,3}$/.test(no)) {
      return setMsg(el('rsMsg'), '번호를 조-번 형식으로 적으십시오. 예: 3-7', 'err');
    }
    resetNo(no.replace(/\s/g, ''));
  });
  el('rsNo').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') el('rsGo').click();
  });

  /* ── 평가 개폐 (과목별 + 조별) ────────────────────
     구글폼은 과목 단위로만 응답을 막을 수 있다. 조 단위 통제는
     '응시 화면에서 링크를 내주지 않는' 방식이므로, 완전 차단은
     과목 닫기로 하고 조별 개방은 진행 순서 통제에 쓴다. */
  function planOf(g, pattern) {
    var p = String(pattern || '').toUpperCase().replace(/[^AB]/g, '');
    if (!p) return 'A';
    return p.charAt((Number(g) - 1) % p.length);
  }

  var gridOpen = {};        // 과목별 '조 선택' 펼침 상태

  function renderEvalGates(d) {
    var wrap = el('evalGates');
    wrap.innerHTML = '';
    var subs = d.subjects || [];
    if (!subs.length) {
      wrap.innerHTML = '<p class="empty">과목 시트에 평가 과목을 등록하십시오.</p>';
      return;
    }
    subs.forEach(function (s) { wrap.appendChild(gateCard(s, d)); });
  }

  function gateCard(s, d) {
    var n = d.groupCount || 50;
    var unlimited = (s.openGroups === null || s.openGroups === undefined);
    var openSet = {};
    if (!unlimited) (s.openGroups || []).forEach(function (g) { openSet[g] = true; });

    var box = document.createElement('div');
    box.className = 'gate' + (s.open ? ' on' : '');

    // 머리말 — 개폐 상태는 '열린 조'에서 자동으로 결정된다
    var head = document.createElement('div');
    head.className = 'gate-head';
    var opened = esc(s.open ? (s.openGroupsText || '없음') : '없음');
    head.innerHTML = '<div><div class="name">' + esc(s.name) +
      (s.hasB ? ' <span class="plan-badge">A/B</span>' : '') + '</div>' +
      '<div class="state">현재 열린 조 <b>' + opened + '</b>' +
      (s.open ? '' : ' · 폼이 닫혀 제출 불가') +
      (s.formLinked ? '' : ' · <span class="warn">폼 링크 없음</span>') + '</div></div>';
    box.appendChild(head);

    // 조 지정
    var body = document.createElement('div');
    body.className = 'gate-body';
    var row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<label style="margin:0">열 조</label>';

    var input = document.createElement('input');
    input.type = 'text';
    input.value = s.openGroupsText || '';
    input.placeholder = '1,2,7  또는  1~7';
    row.appendChild(input);

    function mk(label, cls, spec) {
      var b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', function () {
        sendGroups(s.name, spec === '__input__' ? input.value.trim() : spec);
      });
      return b;
    }
    row.appendChild(mk('적용', '', '__input__'));
    row.appendChild(mk('전체', 'ghost', '전체'));
    row.appendChild(mk('없음', 'ghost', '없음'));
    row.appendChild(mk('A안 조', 'ghost', planGroups('A', n, d.planPattern)));
    row.appendChild(mk('B안 조', 'ghost', planGroups('B', n, d.planPattern)));

    var expand = document.createElement('button');
    expand.className = 'ghost';
    expand.textContent = gridOpen[s.name] ? '조 선택 접기' : '조 선택 펼치기';
    row.appendChild(expand);
    body.appendChild(row);

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendGroups(s.name, input.value.trim());
    });

    // 1~N 격자
    var grid = document.createElement('div');
    grid.className = 'ggrid';
    grid.hidden = !gridOpen[s.name];
    for (var g = 1; g <= n; g++) {
      (function (gg) {
        var isOpen = unlimited || !!openSet[gg];
        var b = document.createElement('button');
        b.className = 'gcell' + (isOpen ? ' open' : '');
        b.innerHTML = gg + '<span class="pl">' + planOf(gg, d.planPattern) + '안</span>';
        b.title = gg + '조 · ' + planOf(gg, d.planPattern) + '안 · ' + (isOpen ? '열림' : '닫힘');
        b.addEventListener('click', function () {
          var next = {};
          for (var k = 1; k <= n; k++) if (unlimited || openSet[k]) next[k] = true;
          if (next[gg]) delete next[gg]; else next[gg] = true;
          var list = [];
          for (var k2 = 1; k2 <= n; k2++) if (next[k2]) list.push(k2);
          sendGroups(s.name, list.length ? list.join(',') : '없음');
        });
        grid.appendChild(b);
      })(g);
    }
    expand.addEventListener('click', function () {
      gridOpen[s.name] = !gridOpen[s.name];
      grid.hidden = !gridOpen[s.name];
      expand.textContent = gridOpen[s.name] ? '조 선택 접기' : '조 선택 펼치기';
    });
    body.appendChild(grid);
    box.appendChild(body);
    return box;
  }

  /* ── 조별 개방 현황판 ────────────────────────────
     조 하나하나에 과목별 신호등을 띄운다.
     적록은 색맹에서 구분이 어려우므로 색만 쓰지 않고
     채워진 원(열림) / 빈 원(닫힘) 으로 모양까지 다르게 한다. */
  function openForGroup(s, g) {
    if (!s.open) return false;
    var og = s.openGroups;
    if (og === null || og === undefined) return true;
    return og.indexOf(Number(g)) !== -1;
  }

  function renderGateMatrix(d) {
    var subs = d.subjects || [];
    var n = d.groupCount || 50;
    var grid = el('gateMatrix');
    var legend = el('matrixLegend');
    grid.innerHTML = '';
    legend.innerHTML = '';

    if (!subs.length) {
      el('matrixSummary').textContent = '';
      return;
    }

    legend.innerHTML =
      '<span class="mxkey"><i class="lamp on"></i>열림</span>' +
      '<span class="mxkey"><i class="lamp off"></i>닫힘</span>' +
      '<span class="mxkey mxorder">칸 안의 순서: ' +
        subs.map(function (s) { return esc(s.name); }).join(' → ') + '</span>';

    var allOpen = 0, allShut = 0, partial = 0;
    var hasB = subs.some(function (s) { return s.hasB; });

    for (var g = 1; g <= n; g++) {
      var states = subs.map(function (s) { return openForGroup(s, g); });
      var on = states.filter(Boolean).length;
      if (on === subs.length) allOpen++;
      else if (on === 0) allShut++;
      else partial++;

      var cell = document.createElement('div');
      cell.className = 'mxcell' + (on === 0 ? ' shut' : (on === subs.length ? ' full' : ' part'));
      var head = '<div class="mxg">' + g + '조' +
        (hasB ? '<span class="mxplan">' + planOf(g, d.planPattern) + '안</span>' : '') + '</div>';
      var rows = subs.map(function (s, i) {
        return '<div class="mxrow" title="' + esc(s.name) + ' — ' + (states[i] ? '열림' : '닫힘') + '">' +
               '<i class="lamp ' + (states[i] ? 'on' : 'off') + '"></i>' +
               '<span class="mxname">' + esc(s.name) + '</span></div>';
      }).join('');
      cell.innerHTML = head + rows;
      grid.appendChild(cell);
    }

    el('matrixSummary').innerHTML =
      '전 과목 열림 <b>' + allOpen + '</b>개 조 · ' +
      '일부만 열림 <b>' + partial + '</b>개 조 · ' +
      '전 과목 닫힘 <b>' + allShut + '</b>개 조';
  }

  function planGroups(want, n, pattern) {
    var out = [];
    for (var g = 1; g <= n; g++) if (planOf(g, pattern) === want) out.push(g);
    return out.length ? out.join(',') : '없음';
  }

  async function sendGroups(subject, spec) {
    if (!spec) return setMsg(el('toggleMsg'), '열 조를 입력하십시오. 예: 1,2,7 또는 1~7', 'err');
    document.querySelectorAll('#togglePanel button').forEach(function (b) { b.disabled = true; });
    setMsg(el('toggleMsg'), '적용 중…');
    try {
      var r = await UNIT.api('groups', { pin: pin, subject: subject, groups: spec });
      var txt = subject + ' — 열린 조 ' + r.openGroups +
                ' · 폼 ' + (r.formOpen ? '열림' : '닫힘(제출 불가)');
      setMsg(el('toggleMsg'), r.warning ? txt + ' (' + r.warning + ')' : txt, 'ok');
    } catch (err) {
      setMsg(el('toggleMsg'), '실패: ' + err.message, 'err');
    }
    await load();
    document.querySelectorAll('#togglePanel button').forEach(function (b) { b.disabled = false; });
  }

  /* ── 설문 개폐 ───────────────────────────────── */
  function renderSurveySwitch(d) {
    var sv = d.survey || {};
    var wrap = el('surveySwitch');
    wrap.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'switch survey';
    div.innerHTML = '<div><div class="name">설문 (무기명)</div>' +
      '<div class="state">' + (sv.open ? '응답 받는 중' : '마감됨') + '</div></div>';
    var btn = document.createElement('button');
    btn.textContent = sv.open ? '닫기' : '열기';
    btn.className = sv.open ? 'off' : 'on';
    btn.addEventListener('click', function () { toggle('survey', '', !sv.open, '설문'); });
    div.appendChild(btn);
    wrap.appendChild(div);
  }

  /* ── 배정과 다른 안으로 응시한 경우 ──────────────── */
  function renderWrongPlan(d) {
    var rows = [];
    (d.subjects || []).forEach(function (s) {
      (s.wrongPlan || []).forEach(function (w) {
        rows.push({ subject: s.name, no: w.no, submitted: w.submitted, should: w.should, at: w.at });
      });
    });
    el('wrongPanel').hidden = rows.length === 0;
    var tb = el('wrongTable').querySelector('tbody');
    tb.innerHTML = '';
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc(r.subject) + '</td><td><b>' + esc(r.no) + '</b></td>' +
                     '<td class="warn">' + esc(r.submitted) + '안</td>' +
                     '<td>' + esc(r.should) + '안</td>' +
                     '<td>' + UNIT.timeText(r.at) + '</td>';
      tb.appendChild(tr);
    });
  }

  function renderCombined(d) {
    var subs = d.subjects || [];
    var rows = (d.combined && d.combined.groups) || [];
    var ranked = rows.filter(function (g) { return g.overall !== null; })
      .sort(function (a, b) { return b.overall - a.overall; });

    var thead = el('combinedTable').querySelector('thead');
    thead.innerHTML = '<tr><th class="num">순위</th><th>조</th><th>안</th><th class="num">종합</th>' +
      subs.map(function (s) { return '<th class="num">' + esc(s.name) + '</th>'; }).join('') +
      '<th class="num">제출</th></tr>';

    var tb = el('combinedTable').querySelector('tbody');
    tb.innerHTML = '';
    if (!ranked.length) {
      tb.innerHTML = '<tr><td colspan="' + (subs.length + 5) + '" class="empty">아직 집계할 응답이 없습니다.</td></tr>';
    }
    ranked.forEach(function (g, i) {
      var tr = document.createElement('tr');
      if (i === 0) tr.className = 'best';
      var done = g.subjects.reduce(function (a, s) { return a + s.submitted; }, 0);
      var need = g.expected * subs.length;
      tr.innerHTML =
        '<td class="num rank">' + (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1) + '</td>' +
        '<td><b>' + esc(g.group) + '조</b>' + (g.complete ? '' : ' <span class="warn">미완</span>') + '</td>' +
        '<td>' + esc(g.plan || '-') + '안</td>' +
        '<td class="num"><b>' + pts(g.overall) + '</b></td>' +
        g.subjects.map(function (s) {
          return '<td class="num"><span class="sub-rate">' + pts(s.rate) + '</span></td>';
        }).join('') +
        '<td class="num">' + done + ' / ' + need + '</td>';
      tb.appendChild(tr);
    });

    var miss = (d.combined && d.combined.missingMax) || [];
    el('combinedNote').textContent = miss.length
      ? '※ 만점을 알 수 없어 종합에서 제외된 과목: ' + miss.join(', ') + ' — 과목 시트의 "만점" 칸을 채우십시오.'
      : '점수는 100점 만점으로 환산한 값입니다. 응시하지 않은 과목은 평균에서 제외됩니다.';
  }

  function renderTabs(d) {
    var subs = d.subjects || [];
    if (activeTab >= subs.length) activeTab = 0;
    var wrap = el('tabs');
    wrap.innerHTML = '';
    subs.forEach(function (s, i) {
      var b = document.createElement('button');
      b.className = 'tab' + (i === activeTab ? ' active' : '');
      b.innerHTML = '<span class="dot' + (s.open ? ' live' : '') + '"></span>' + esc(s.name);
      b.addEventListener('click', function () { activeTab = i; render(last); });
      wrap.appendChild(b);
    });
  }

  function renderSubject(d) {
    var s = (d.subjects || [])[activeTab];
    var wrap = el('groupCards');
    if (!s) {
      wrap.innerHTML = '<p class="empty">과목 시트에 평가 과목을 등록하십시오.</p>';
      el('stSubmitted').textContent = el('stRate').textContent =
        el('stAvg').textContent = el('stBest').textContent = '-';
      el('subjSheet').textContent = '';
      el('subjWarn').hidden = true;
      return;
    }

    var t = s.totals || {};
    var maxTxt = s.maxScore ? ' <small>/ ' + s.maxScore + '</small>' : '';
    // 정원(최대 500)이 아니라 오늘 등록한 인원을 기준으로 본다
    var basis = t.registered || 0;
    el('stSubmitted').innerHTML = (t.submitted || 0) +
      ' <small>/ ' + (basis || (t.expected || 0)) + (basis ? ' 등록' : ' 정원') + '</small>';
    var den = basis || t.expected || 0;
    el('stRate').innerHTML = (den ? Math.round((t.submitted / den) * 100) : 0) + '<small>%</small>';

    // 미제출자
    var miss = s.missing || [];
    el('missWrap').hidden = miss.length === 0;
    el('missCount').textContent = miss.length + '명';
    el('missChips').innerHTML = miss.map(function (no) {
      return '<span class="chip miss">' + esc(no) + '</span>';
    }).join('');
    el('stAvg').innerHTML = (t.average === null || t.average === undefined ? '-' : UNIT.fmt(t.average)) + maxTxt;

    var ranked = (s.groups || []).filter(function (g) { return g.average !== null; })
      .sort(function (a, b) { return b.average - a.average; });
    el('stBest').textContent = ranked.length ? ranked[0].group + '조' : '-';

    // 어느 응답 시트를 읽고 있는지 늘 보이게 한다 (과목이 섞이는 사고 방지)
    var sh = s.sheets || {};
    var parts = [];
    if (sh.A) parts.push((s.hasB ? 'A안 ' : '') + sh.A);
    if (sh.B) parts.push('B안 ' + sh.B);
    el('subjSheet').textContent = parts.length ? '응답 시트: ' + parts.join('  |  ') : '';

    if (s.warning) { el('subjWarn').textContent = '⚠ ' + s.warning; el('subjWarn').hidden = false; }
    else el('subjWarn').hidden = true;

    wrap.innerHTML = '';
    // 등록이나 제출이 있는 조만 보여 준다 (정원 50조를 그대로 두어도 화면이 깨끗하다)
    var groups = (s.groups || []).slice()
      .filter(function (g) { return (g.registered || 0) > 0 || (g.submitted || 0) > 0; })
      .sort(function (a, b) { return Number(a.group) - Number(b.group); });
    if (!groups.length) {
      wrap.innerHTML = '<p class="empty">아직 등록·제출한 조가 없습니다.</p>';
      return;
    }
    groups.forEach(function (g) {
      var byN = {};
      (g.members || []).forEach(function (m) { byN[m.n] = m; });
      // 칩 목록 = 오늘 등록한 번호 + 제출된 번호 (등록이 없으면 정원으로 대체)
      var reg = {};
      ((g.regSlots && g.regSlots.length) ? g.regSlots : (g.slots || []))
        .forEach(function (n) { reg[n] = true; });
      var nums = Object.keys(reg).map(Number);
      Object.keys(byN).forEach(function (n) { if (!reg[n]) nums.push(Number(n)); });
      nums.sort(function (a, b) { return a - b; });
      var roster = reg;

      var chips = nums.map(function (n) {
        var m = byN[n];
        var cls = 'chip' + (m ? ' done' : '') + (roster[n] ? '' : ' extra');
        var dup = (m && m.count > 1) ? '<sup class="dupmark">' + m.count + '</sup>' : '';
        return '<span class="' + cls + (dup ? ' dup' : '') + '"' +
               (m && m.count > 1 ? ' title="' + m.count + '회 제출 — 처음 제출만 인정"' : '') + '>' +
               g.group + '-' + n + (m ? ' · ' + UNIT.fmt(m.score, 0) : '') +
               (roster[n] ? '' : ' ?') + dup + '</span>';
      }).join('');

      var div = document.createElement('div');
      div.className = 'gcard';
      div.innerHTML =
        '<div class="ghead"><span class="gname">' + esc(g.group) + '조' +
        (g.plan ? ' <span class="plan-badge">' + esc(g.plan) + '안</span>' : '') + '</span>' +
        '<span class="gavg">평균 ' + UNIT.fmt(g.average) + ' · ' + g.submitted + '/' +
        ((g.registered || 0) > 0 ? g.registered : g.expected) +
        ((g.missing && g.missing.length) ? ' <span class="warn">미제출 ' + g.missing.length + '</span>' : '') +
        '</span></div>' +
        '<div class="chips">' + chips + '</div>';
      wrap.appendChild(div);
    });
  }

  function renderUnknown(d) {
    var rows = [];
    (d.subjects || []).forEach(function (s) {
      (s.unknown || []).forEach(function (u) {
        rows.push({ subject: s.name, raw: u.raw, score: u.score, at: u.at });
      });
    });
    el('unknownPanel').hidden = rows.length === 0;
    var tb = el('unknownTable').querySelector('tbody');
    tb.innerHTML = '';
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc(r.subject) + '</td><td>' + esc(r.raw || '(빈칸)') + '</td>' +
                     '<td class="num">' + UNIT.fmt(r.score, 0) + '</td>' +
                     '<td>' + UNIT.timeText(r.at) + '</td>';
      tb.appendChild(tr);
    });
  }

  /* ── 개폐 ────────────────────────────────────────── */
  async function toggle(target, name, open, label) {
    var what = target === 'subjects' ? '평가 전체' : label;
    if (!confirm(what + '을(를) ' + (open ? '엽니다' : '닫습니다') + '. 진행하시겠습니까?')) return;
    var box = (target === 'survey') ? 'surveyToggleMsg' : 'toggleMsg';
    document.querySelectorAll('#togglePanel button, #surveyPanel button')
      .forEach(function (b) { b.disabled = true; });
    setMsg(el(box), '처리 중…');
    try {
      var res = await UNIT.api('toggle', {
        pin: pin, target: target, name: name || '', open: open ? '1' : '0'
      });
      var done = what + '을(를) ' + (open ? '열었습니다.' : '닫았습니다.');
      setMsg(el(box), res && res.warning ? done + ' (' + res.warning + ')' : done, 'ok');
    } catch (err) {
      setMsg(el(box), '실패: ' + err.message, 'err');
    }
    await load();
  }

  /* ── CSV 저장 ────────────────────────────────────── */
  el('csvBtn').addEventListener('click', function () {
    if (!last) return;
    var subs = last.subjects || [];
    var rows = [['구분', '과목', '조', '번', '번호', '배정안', '제출안', '점수', '만점', '제출시각']];
    subs.forEach(function (s) {
      (s.groups || []).forEach(function (g) {
        (g.members || []).forEach(function (m) {
          rows.push(['개인', s.name, g.group, m.n, m.no, g.plan || '', m.plan || '',
                     m.score, s.maxScore || '', m.at || '']);
        });
      });
    });
    rows.push([]);
    rows.push(['구분', '조', '안', '종합점수(100점 만점)'].concat(subs.map(function (s) { return s.name + ' 평균'; }))
      .concat(subs.map(function (s) { return s.name + ' 환산점수'; })));
    ((last.combined && last.combined.groups) || []).slice()
      .sort(function (a, b) { return (b.overall === null ? -1 : b.overall) - (a.overall === null ? -1 : a.overall); })
      .forEach(function (g) {
        rows.push(['종합', g.group, g.plan || '', g.overall === null ? '' : g.overall]
          .concat(g.subjects.map(function (s) { return s.average === null ? '' : s.average; }))
          .concat(g.subjects.map(function (s) { return s.rate === null ? '' : s.rate; })));
      });

    var csv = rows.map(function (r) {
      return r.map(function (c) {
        var s = c === null || c === undefined ? '' : String(c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    var tag = dateParam === 'all' ? '전체기간'
            : (dateParam || (last.today || '')).replace(/-/g, '');
    a.download = '평가현황_' + tag + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  /* ── 진입 ────────────────────────────────────────── */
  if (!UNIT.hasApi()) {
    setMsg(el('loginMsg'), 'config.js 의 apiUrl 을 먼저 설정하십시오.', 'err');
    el('loginBtn').disabled = true;
  } else if (pin) {
    login(pin);
  }
})();
