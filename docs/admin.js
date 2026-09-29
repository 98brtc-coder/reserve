/* 관리자 화면: 과목별 개폐 · 과목별 현황 · 종합 순위(득점률 평균) */
(function () {
  var CFG = UNIT.CFG;
  var el = function (id) { return document.getElementById(id); };
  var PIN_KEY = 'rf_admin_pin';
  var pin = sessionStorage.getItem(PIN_KEY) || '';
  var timer = null, auto = true, last = null, activeTab = 0;

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
      last = await UNIT.api('dashboard', { pin: pin });
      render(last);
      setMsg(el('dashMsg'), '');
    } catch (err) {
      setMsg(el('dashMsg'), '불러오기 실패: ' + err.message, 'err');
    }
  }

  /* ── 렌더링 ──────────────────────────────────────── */
  function render(d) {
    el('updatedAt').textContent = UNIT.timeText(d.updatedAt);
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
    a.download = '평가현황_' + new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '') + '.csv';
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
