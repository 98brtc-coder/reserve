/* 관리자 화면: PIN 로그인 → 평가 현황 / 조별 평균 / 평가·설문 개폐 */
(function () {
  var CFG = UNIT.CFG;
  var el = function (id) { return document.getElementById(id); };
  var PIN_KEY = 'rf_admin_pin';
  var pin = sessionStorage.getItem(PIN_KEY) || '';
  var timer = null;
  var auto = true;
  var last = null;

  document.title = (CFG.unitName ? CFG.unitName + ' ' : '') + '관리자';
  el('dashTitle').textContent = (CFG.unitName || '') + ' 평가 현황';

  /* ── 로그인 ───────────────────────────────────────── */
  function setMsg(node, text, kind) {
    node.textContent = text || '';
    node.className = 'msg' + (kind ? ' ' + kind : '');
  }

  async function login(value) {
    setMsg(el('loginMsg'), '확인 중…');
    el('loginBtn').disabled = true;
    try {
      await UNIT.api('ping', { pin: value });
      pin = value;
      sessionStorage.setItem(PIN_KEY, pin);
      el('loginView').hidden = true;
      el('dashView').hidden = false;
      start();
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
  el('pin').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') el('loginBtn').click();
  });
  el('logoutBtn').addEventListener('click', function () {
    sessionStorage.removeItem(PIN_KEY);
    if (timer) clearInterval(timer);
    location.reload();
  });

  /* ── 데이터 로드 ──────────────────────────────────── */
  function start() {
    load();
    setAuto(true);
  }

  function setAuto(on) {
    auto = on;
    if (timer) clearInterval(timer);
    if (on) {
      var sec = Math.max(5, Number(CFG.refreshSeconds) || 15);
      timer = setInterval(load, sec * 1000);
    }
    el('autoBtn').textContent = on ? '자동 끄기' : '자동 켜기';
    el('autoState').textContent = on ? '자동 새로고침 켜짐' : '자동 새로고침 꺼짐';
  }
  el('autoBtn').addEventListener('click', function () { setAuto(!auto); });
  el('refreshBtn').addEventListener('click', function () { load(); });

  async function load() {
    try {
      var d = await UNIT.api('dashboard', { pin: pin });
      last = d;
      render(d);
      setMsg(el('dashMsg'), '');
    } catch (err) {
      setMsg(el('dashMsg'), '불러오기 실패: ' + err.message, 'err');
    }
  }

  /* ── 렌더링 ──────────────────────────────────────── */
  function render(d) {
    el('updatedAt').textContent = UNIT.timeText(d.updatedAt);
    renderSwitch('eval', d.state.evalOpen);
    renderSwitch('survey', d.state.surveyOpen);

    var t = d.totals || {};
    var maxTxt = d.maxScore ? ' <small>/ ' + d.maxScore + '</small>' : '';
    el('stSubmitted').innerHTML = (t.submitted || 0) + ' <small>/ ' + (t.expected || 0) + '</small>';
    el('stRate').innerHTML = (t.expected ? Math.round((t.submitted / t.expected) * 100) : 0) + '<small>%</small>';
    el('stAvg').innerHTML = (t.average === null || t.average === undefined ? '-' : UNIT.fmt(t.average)) + maxTxt;

    var ranked = (d.groups || [])
      .filter(function (g) { return g.submitted > 0; })
      .sort(function (a, b) { return b.average - a.average; });

    el('stBest').textContent = ranked.length ? ranked[0].group + '조' : '-';

    // 순위 표
    var tb = el('rankTable').querySelector('tbody');
    tb.innerHTML = '';
    el('rankEmpty').hidden = ranked.length > 0;
    ranked.forEach(function (g, i) {
      var pct = g.expected ? Math.round((g.submitted / g.expected) * 100) : 0;
      var tr = document.createElement('tr');
      if (i === 0) tr.className = 'best';
      tr.innerHTML =
        '<td class="num rank">' + (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1) + '</td>' +
        '<td><b>' + esc(g.group) + '조</b>' +
          (g.submitted < g.expected ? ' <span class="warn">미완</span>' : '') + '</td>' +
        '<td class="num"><b>' + UNIT.fmt(g.average) + '</b></td>' +
        '<td class="num">' + g.submitted + ' / ' + g.expected + '</td>' +
        '<td><div class="bar"><i style="width:' + pct + '%"></i></div></td>';
      tb.appendChild(tr);
    });

    // 조별 제출 현황 (조 번호 순)
    var wrap = el('groupCards');
    wrap.innerHTML = '';
    var groups = (d.groups || []).slice().sort(function (a, b) {
      return Number(a.group) - Number(b.group);
    });
    if (!groups.length) {
      wrap.innerHTML = '<p class="empty">설정 시트의 조 개수 / 조별 인원을 확인하십시오.</p>';
    }
    groups.forEach(function (g) {
      var byN = {};
      (g.members || []).forEach(function (m) { byN[m.n] = m; });
      var roster = {};
      (g.slots || []).forEach(function (n) { roster[n] = true; });
      // 정원(명단) + 실제 제출된 번호를 합쳐서 표시한다
      var nums = (g.slots || []).slice();
      Object.keys(byN).forEach(function (n) {
        if (!roster[n]) nums.push(Number(n));
      });
      nums.sort(function (a, b) { return a - b; });
      var chips = nums.map(function (n) {
        var m = byN[n];
        var cls = 'chip' + (m ? ' done' : '') + (roster[n] ? '' : ' extra');
        return '<span class="' + cls + '" title="' + (roster[n] ? '' : '명단에 없는 번호') + '">' +
               g.group + '-' + n + (m ? ' · ' + UNIT.fmt(m.score, 0) : '') +
               (roster[n] ? '' : ' ?') + '</span>';
      }).join('');
      var div = document.createElement('div');
      div.className = 'gcard';
      div.innerHTML =
        '<div class="ghead"><span class="gname">' + esc(g.group) + '조</span>' +
        '<span class="gavg">평균 ' + UNIT.fmt(g.average) + ' · ' + g.submitted + '/' + g.expected + '</span></div>' +
        '<div class="chips">' + chips + '</div>';
      wrap.appendChild(div);
    });

    // 번호 오류 응답
    var un = d.unknown || [];
    el('unknownPanel').hidden = un.length === 0;
    var utb = el('unknownTable').querySelector('tbody');
    utb.innerHTML = '';
    un.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc(r.raw || '(빈칸)') + '</td>' +
                     '<td class="num">' + UNIT.fmt(r.score, 0) + '</td>' +
                     '<td>' + UNIT.timeText(r.at) + '</td>';
      utb.appendChild(tr);
    });
  }

  function renderSwitch(key, open) {
    var btn = el(key + 'Toggle');
    el(key + 'State').textContent = open ? '응답 받는 중' : '마감됨';
    btn.textContent = open ? '닫기' : '열기';
    btn.className = open ? 'off' : 'on';
    btn.disabled = false;
    btn.onclick = function () { toggle(key, !open); };
  }

  async function toggle(target, open) {
    var label = target === 'eval' ? '평가' : '설문';
    if (!confirm(label + '을(를) ' + (open ? '엽니다' : '닫습니다') + '. 진행하시겠습니까?')) return;
    el('evalToggle').disabled = true;
    el('surveyToggle').disabled = true;
    setMsg(el('toggleMsg'), '처리 중…');
    try {
      await UNIT.api('toggle', { pin: pin, target: target, open: open ? '1' : '0' });
      setMsg(el('toggleMsg'), label + '을(를) ' + (open ? '열었습니다.' : '닫았습니다.'), 'ok');
      await load();
    } catch (err) {
      setMsg(el('toggleMsg'), '실패: ' + err.message, 'err');
      el('evalToggle').disabled = false;
      el('surveyToggle').disabled = false;
    }
  }

  /* ── CSV 저장 ────────────────────────────────────── */
  el('csvBtn').addEventListener('click', function () {
    if (!last) return;
    var rows = [['번호', '조', '번', '점수', '제출시각']];
    (last.groups || []).forEach(function (g) {
      (g.members || []).forEach(function (m) {
        rows.push([m.no, g.group, m.n, m.score, m.at || '']);
      });
    });
    rows.push([]);
    rows.push(['조', '제출', '정원', '평균']);
    (last.groups || []).forEach(function (g) {
      rows.push([g.group, g.submitted, g.expected, g.average === null ? '' : g.average]);
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
    a.download = '평가현황_' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ── 진입 ────────────────────────────────────────── */
  if (!UNIT.hasApi()) {
    setMsg(el('loginMsg'), 'config.js 의 apiUrl 을 먼저 설정하십시오.', 'err');
    el('loginBtn').disabled = true;
  } else if (pin) {
    login(pin);
  }
})();
