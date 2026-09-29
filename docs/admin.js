/* 관리자 화면: 과목별 개폐 · 과목별 현황 · 종합 순위(득점률 평균) */
(function () {
  var CFG = UNIT.CFG;
  var el = function (id) { return document.getElementById(id); };
  var PIN_KEY = 'rf_admin_pin';
  var pin = sessionStorage.getItem(PIN_KEY) || '';
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
  function pct(n) { return n === null || n === undefined ? '-' : UNIT.fmt(n, 1) + '%'; }

  /* ── 로그인 ───────────────────────────────────────── */
  async function login(value) {
    setMsg(el('loginMsg'), '확인 중…');
    el('loginBtn').disabled = true;
    try {
      await UNIT.api('ping', { pin: value });
      pin = value;
      sessionStorage.setItem(PIN_KEY, pin);
      el('loginView').hidden = true;
      el('dashView').hidden = false;
      load();
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
    sessionStorage.removeItem(PIN_KEY);
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

  async function load() {
    try {
      last = await UNIT.api('dashboard', { pin: pin, date: dateParam });
      render(last);
      setMsg(el('dashMsg'), '');
    } catch (err) {
      setMsg(el('dashMsg'), '불러오기 실패: ' + err.message, 'err');
    }
    if (activeView === 'survey') await loadSurvey();
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
    if (v === 'survey' && !surveyData) loadSurvey();
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
      if (q.multi) html += '<p class="qnote">복수 선택 문항 — 비율 합계가 100%를 넘을 수 있습니다.</p>';
      html += bars(q.options);
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
    renderSwitches(d);
    renderCombined(d);
    renderTabs(d);
    renderSubject(d);
    renderUnknown(d);
  }

  function renderSwitches(d) {
    var wrap = el('switches');
    wrap.innerHTML = '';
    (d.subjects || []).forEach(function (s) {
      wrap.appendChild(switchCard(s.name, s.open, s.name + ' 평가', function () {
        toggle('subject', s.name, !s.open, s.name);
      }, s.formLinked ? '' : '폼 링크 없음'));
    });
    var sv = d.survey || {};
    var card = switchCard('설문', sv.open, '설문(무기명)', function () {
      toggle('survey', '', !sv.open, '설문');
    }, '');
    card.classList.add('survey');
    wrap.appendChild(card);
  }

  function switchCard(name, open, label, onClick, note) {
    var div = document.createElement('div');
    div.className = 'switch';
    div.innerHTML =
      '<div><div class="name">' + esc(name) + '</div>' +
      '<div class="state">' + (open ? '응답 받는 중' : '마감됨') +
      (note ? ' · <span class="warn">' + esc(note) + '</span>' : '') + '</div></div>';
    var btn = document.createElement('button');
    btn.textContent = open ? '닫기' : '열기';
    btn.className = open ? 'off' : 'on';
    btn.addEventListener('click', onClick);
    div.appendChild(btn);
    return div;
  }

  function renderCombined(d) {
    var subs = d.subjects || [];
    var rows = (d.combined && d.combined.groups) || [];
    var ranked = rows.filter(function (g) { return g.overall !== null; })
      .sort(function (a, b) { return b.overall - a.overall; });

    var thead = el('combinedTable').querySelector('thead');
    thead.innerHTML = '<tr><th class="num">순위</th><th>조</th><th class="num">종합</th>' +
      subs.map(function (s) { return '<th class="num">' + esc(s.name) + '</th>'; }).join('') +
      '<th class="num">제출</th></tr>';

    var tb = el('combinedTable').querySelector('tbody');
    tb.innerHTML = '';
    if (!ranked.length) {
      tb.innerHTML = '<tr><td colspan="' + (subs.length + 4) + '" class="empty">아직 집계할 응답이 없습니다.</td></tr>';
    }
    ranked.forEach(function (g, i) {
      var tr = document.createElement('tr');
      if (i === 0) tr.className = 'best';
      var done = g.subjects.reduce(function (a, s) { return a + s.submitted; }, 0);
      var need = g.expected * subs.length;
      tr.innerHTML =
        '<td class="num rank">' + (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1) + '</td>' +
        '<td><b>' + esc(g.group) + '조</b>' + (g.complete ? '' : ' <span class="warn">미완</span>') + '</td>' +
        '<td class="num"><b>' + pct(g.overall) + '</b></td>' +
        g.subjects.map(function (s) {
          return '<td class="num"><span class="sub-rate">' + pct(s.rate) + '</span>' +
                 '<small class="sub-sub">' + (s.average === null ? '-' : UNIT.fmt(s.average, 1)) + '점</small></td>';
        }).join('') +
        '<td class="num">' + done + ' / ' + need + '</td>';
      tb.appendChild(tr);
    });

    var miss = (d.combined && d.combined.missingMax) || [];
    el('combinedNote').textContent = miss.length
      ? '※ 만점을 알 수 없어 종합에서 제외된 과목: ' + miss.join(', ') + ' — 과목 시트의 "만점" 칸을 채우십시오.'
      : '과목마다 만점이 달라도 공정하게 비교되도록 득점률(%)로 환산해 평균을 냅니다.';
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
      el('subjWarn').hidden = true;
      return;
    }

    var t = s.totals || {};
    var maxTxt = s.maxScore ? ' <small>/ ' + s.maxScore + '</small>' : '';
    el('stSubmitted').innerHTML = (t.submitted || 0) + ' <small>/ ' + (t.expected || 0) + '</small>';
    el('stRate').innerHTML = (t.expected ? Math.round((t.submitted / t.expected) * 100) : 0) + '<small>%</small>';
    el('stAvg').innerHTML = (t.average === null || t.average === undefined ? '-' : UNIT.fmt(t.average)) + maxTxt;

    var ranked = (s.groups || []).filter(function (g) { return g.average !== null; })
      .sort(function (a, b) { return b.average - a.average; });
    el('stBest').textContent = ranked.length ? ranked[0].group + '조' : '-';

    if (s.warning) { el('subjWarn').textContent = '⚠ ' + s.warning; el('subjWarn').hidden = false; }
    else el('subjWarn').hidden = true;

    wrap.innerHTML = '';
    var groups = (s.groups || []).slice().sort(function (a, b) { return Number(a.group) - Number(b.group); });
    if (!groups.length) {
      wrap.innerHTML = '<p class="empty">설정 시트의 조 개수 / 조별 인원을 확인하십시오.</p>';
      return;
    }
    groups.forEach(function (g) {
      var byN = {};
      (g.members || []).forEach(function (m) { byN[m.n] = m; });
      var roster = {};
      (g.slots || []).forEach(function (n) { roster[n] = true; });
      var nums = (g.slots || []).slice();
      Object.keys(byN).forEach(function (n) { if (!roster[n]) nums.push(Number(n)); });
      nums.sort(function (a, b) { return a - b; });

      var chips = nums.map(function (n) {
        var m = byN[n];
        var cls = 'chip' + (m ? ' done' : '') + (roster[n] ? '' : ' extra');
        return '<span class="' + cls + '">' + g.group + '-' + n +
               (m ? ' · ' + UNIT.fmt(m.score, 0) : '') + (roster[n] ? '' : ' ?') + '</span>';
      }).join('');

      var div = document.createElement('div');
      div.className = 'gcard';
      div.innerHTML =
        '<div class="ghead"><span class="gname">' + esc(g.group) + '조</span>' +
        '<span class="gavg">평균 ' + UNIT.fmt(g.average) + ' · ' + g.submitted + '/' + g.expected + '</span></div>' +
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
    document.querySelectorAll('#switches button, #allOpenBtn, #allCloseBtn')
      .forEach(function (b) { b.disabled = true; });
    setMsg(el('toggleMsg'), '처리 중…');
    try {
      var res = await UNIT.api('toggle', {
        pin: pin, target: target, name: name || '', open: open ? '1' : '0'
      });
      var done = what + '을(를) ' + (open ? '열었습니다.' : '닫았습니다.');
      setMsg(el('toggleMsg'), res && res.warning ? done + ' (' + res.warning + ')' : done, 'ok');
    } catch (err) {
      setMsg(el('toggleMsg'), '실패: ' + err.message, 'err');
    }
    await load();
  }
  el('allOpenBtn').addEventListener('click', function () { toggle('subjects', '', true, '평가 전체'); });
  el('allCloseBtn').addEventListener('click', function () { toggle('subjects', '', false, '평가 전체'); });

  /* ── CSV 저장 ────────────────────────────────────── */
  el('csvBtn').addEventListener('click', function () {
    if (!last) return;
    var subs = last.subjects || [];
    var rows = [['구분', '과목', '조', '번', '번호', '점수', '만점', '제출시각']];
    subs.forEach(function (s) {
      (s.groups || []).forEach(function (g) {
        (g.members || []).forEach(function (m) {
          rows.push(['개인', s.name, g.group, m.n, m.no, m.score, s.maxScore || '', m.at || '']);
        });
      });
    });
    rows.push([]);
    rows.push(['구분', '조', '종합득점률(%)'].concat(subs.map(function (s) { return s.name + ' 평균'; }))
      .concat(subs.map(function (s) { return s.name + ' 득점률(%)'; })));
    ((last.combined && last.combined.groups) || []).slice()
      .sort(function (a, b) { return (b.overall === null ? -1 : b.overall) - (a.overall === null ? -1 : a.overall); })
      .forEach(function (g) {
        rows.push(['종합', g.group, g.overall === null ? '' : g.overall]
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
