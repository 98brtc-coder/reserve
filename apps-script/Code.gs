/**
 * =====================================================================
 *  예비군 평가 · 설문 관리 백엔드 (Google Apps Script)
 * =====================================================================
 *  설치: 평가 구글폼의 "응답 → 스프레드시트로 연결"로 만들어진 시트에서
 *        확장 프로그램 → Apps Script → 이 코드를 붙여넣고 setup() 실행.
 *        이후 배포 → 새 배포 → 웹 앱 (실행: 나, 액세스: 모든 사용자)
 *        받은 /exec 주소를 docs/config.js 의 apiUrl 에 입력.
 * =====================================================================
 */

var SETTINGS_SHEET = '설정';
var ROSTER_SHEET = '명단';
var STATE_CACHE_KEY = 'public_state_v1';
var STATE_CACHE_SEC = 15;

/** 설정 시트 기본값: [항목, 값, 설명] */
var DEFAULTS = [
  ['부대명', '○○예비군훈련대', '첫 화면 상단에 표시됩니다.'],
  ['관리자PIN', '1234', '교관용 로그인 PIN. 반드시 변경하십시오.'],
  ['평가폼_편집링크', '', '평가 구글폼의 편집 주소(.../edit). 열기/닫기에 사용됩니다.'],
  ['설문폼_편집링크', '', '설문 구글폼의 편집 주소(.../edit).'],
  ['평가폼_응시링크', '', '비워두면 편집링크에서 자동으로 채워집니다.'],
  ['설문폼_응시링크', '', '비워두면 편집링크에서 자동으로 채워집니다.'],
  ['평가개방', '아니오', '예 / 아니오. 관리자 화면에서 바꾸는 값입니다.'],
  ['설문개방', '아니오', '예 / 아니오.'],
  ['평가마감안내', '평가 시간이 아닙니다. 교관 안내에 따라 주십시오.', '마감 시 화면에 표시할 문구.'],
  ['설문마감안내', '설문 시간이 아닙니다. 교관 안내에 따라 주십시오.', '마감 시 화면에 표시할 문구.'],
  ['공지', '', '첫 화면에 띄울 공지. 비워두면 표시되지 않습니다.'],
  ['조개수', '10', '전체 조 수(m). 명단 시트가 있으면 명단이 우선합니다.'],
  ['조별인원', '10', '조당 인원(n).'],
  ['평가응답시트', '', '평가 응답이 기록되는 시트 이름. 비우면 자동 탐색.'],
  ['번호열', '', '번호(조-번)가 들어있는 열 제목. 비우면 자동 탐색.'],
  ['점수열', '', '점수 열 제목 또는 열 번호를 쉼표로. 비우면 자동 탐색.'],
  ['점수계산', '합계', '합계 / 평균 — 점수열이 여러 개일 때 계산 방식.'],
  ['만점', '', '표시용 만점. 퀴즈형 폼이면 자동으로 인식됩니다.']
];

/* ===================================================================
 *  설치 · 메뉴
 * =================================================================== */

function setup() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SETTINGS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SETTINGS_SHEET, 0);
    sh.getRange(1, 1, 1, 3).setValues([['항목', '값', '설명']]);
    sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#16243a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, DEFAULTS.length, 3).setValues(DEFAULTS);
    sh.setColumnWidth(1, 150).setColumnWidth(2, 320).setColumnWidth(3, 420);
    sh.getRange(2, 3, DEFAULTS.length, 1).setFontColor('#888888').setFontSize(9);
  } else {
    // 이미 있으면 빠진 항목만 추가
    var have = {};
    var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues() : [];
    rows.forEach(function (r) { have[String(r[0]).trim()] = true; });
    var add = DEFAULTS.filter(function (d) { return !have[d[0]]; });
    if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 3).setValues(add);
  }
  SpreadsheetApp.getActive().toast('설정 시트를 준비했습니다. 값을 채운 뒤 배포하십시오.', '설치 완료', 8);
  return '설정 시트 준비 완료';
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('예비군 평가')
    .addItem('설정 시트 준비 / 갱신', 'setup')
    .addSeparator()
    .addItem('평가 열기', 'menuEvalOpen')
    .addItem('평가 닫기', 'menuEvalClose')
    .addItem('설문 열기', 'menuSurveyOpen')
    .addItem('설문 닫기', 'menuSurveyClose')
    .addSeparator()
    .addItem('현황 요약 보기', 'menuSummary')
    .addToUi();
}

function menuEvalOpen() { menuToggle_('eval', true); }
function menuEvalClose() { menuToggle_('eval', false); }
function menuSurveyOpen() { menuToggle_('survey', true); }
function menuSurveyClose() { menuToggle_('survey', false); }

function menuToggle_(target, open) {
  try {
    toggle_(readConfig_(), target, open);
    SpreadsheetApp.getActive().toast(
      (target === 'eval' ? '평가' : '설문') + '을(를) ' + (open ? '열었습니다.' : '닫았습니다.'), '완료', 5);
  } catch (err) {
    SpreadsheetApp.getUi().alert('실패: ' + err.message);
  }
}

function menuSummary() {
  var d = dashboard_(readConfig_());
  var lines = ['제출 ' + d.totals.submitted + ' / ' + d.totals.expected +
               '   전체평균 ' + round_(d.totals.average, 2), ''];
  d.groups.slice().sort(function (a, b) { return (b.average || -1) - (a.average || -1); })
    .forEach(function (g, i) {
      lines.push((i + 1) + '위  ' + g.group + '조   평균 ' + round_(g.average, 2) +
                 '   (' + g.submitted + '/' + g.expected + ')');
    });
  if (d.unknown.length) lines.push('', '※ 번호 오류 응답 ' + d.unknown.length + '건');
  SpreadsheetApp.getUi().alert('평가 현황', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ===================================================================
 *  웹앱 진입점
 * =================================================================== */

function doGet(e) { return handle_(e && e.parameter ? e.parameter : {}); }

function doPost(e) {
  var p = {};
  try {
    if (e && e.postData && e.postData.contents) p = JSON.parse(e.postData.contents);
  } catch (err) {
    p = (e && e.parameter) || {};
  }
  return handle_(p);
}

function handle_(p) {
  try {
    var action = String(p.action || 'state');
    if (action === 'state') return json_({ ok: true, data: cachedState_() });

    var cfg = readConfig_();
    requirePin_(cfg, p.pin);

    if (action === 'ping') return json_({ ok: true, data: { auth: true } });
    if (action === 'dashboard') return json_({ ok: true, data: dashboard_(cfg) });
    if (action === 'toggle') {
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        var st = toggle_(cfg, String(p.target || ''), truthy_(p.open));
        return json_({ ok: true, data: st });
      } finally { lock.releaseLock(); }
    }
    throw new Error('알 수 없는 요청입니다: ' + action);
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function requirePin_(cfg, given) {
  var want = String(cfg['관리자PIN'] || '').trim();
  if (!want) throw new Error('설정 시트에 관리자PIN 이 비어 있습니다.');
  if (String(given || '').trim() !== want) throw new Error('PIN 이 올바르지 않습니다.');
}

/* ===================================================================
 *  설정 읽기 · 쓰기
 * =================================================================== */

function settingsSheet_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SETTINGS_SHEET);
  if (!sh) throw new Error('"설정" 시트가 없습니다. Apps Script 에서 setup() 을 먼저 실행하십시오.');
  return sh;
}

function readConfig_() {
  var sh = settingsSheet_();
  var cfg = {};
  if (sh.getLastRow() < 2) return cfg;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    var k = String(r[0]).trim();
    if (k) cfg[k] = typeof r[1] === 'string' ? r[1].trim() : r[1];
  });
  return cfg;
}

function setConfig_(key, value) {
  var sh = settingsSheet_();
  var n = sh.getLastRow() - 1;
  var keys = n > 0 ? sh.getRange(2, 1, n, 1).getValues() : [];
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() === key) {
      sh.getRange(i + 2, 2).setValue(value);
      return;
    }
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([[key, value]]);
}

function truthy_(v) {
  var s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === '예' || s === 'y' || s === 'yes' || s === 'on' || s === '개방';
}

function round_(n, d) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  var f = Math.pow(10, d === undefined ? 1 : d);
  return Math.round(n * f) / f;
}

/* ===================================================================
 *  공개 상태 (예비군 첫 화면)
 * =================================================================== */

function cachedState_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(STATE_CACHE_KEY);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* 무시 */ }
  }
  var st = publicState_(readConfig_());
  cache.put(STATE_CACHE_KEY, JSON.stringify(st), STATE_CACHE_SEC);
  return st;
}

function publicState_(cfg) {
  return {
    unitName: String(cfg['부대명'] || ''),
    notice: String(cfg['공지'] || ''),
    evalOpen: truthy_(cfg['평가개방']),
    surveyOpen: truthy_(cfg['설문개방']),
    evalClosedMessage: String(cfg['평가마감안내'] || ''),
    surveyClosedMessage: String(cfg['설문마감안내'] || ''),
    evalFormUrl: viewUrl_(cfg, '평가'),
    surveyFormUrl: viewUrl_(cfg, '설문')
  };
}

/** 응시링크가 비어 있으면 편집링크에서 한 번 구해 설정 시트에 적어 둔다. */
function viewUrl_(cfg, prefix) {
  var cached = String(cfg[prefix + '폼_응시링크'] || '').trim();
  if (cached) return cached;
  var edit = String(cfg[prefix + '폼_편집링크'] || '').trim();
  if (!edit) return '';
  try {
    var url = openForm_(edit, prefix + '폼').getPublishedUrl();
    setConfig_(prefix + '폼_응시링크', url);
    return url;
  } catch (err) {
    return '';
  }
}

/* ===================================================================
 *  평가 · 설문 개폐
 * =================================================================== */

function openForm_(url, label) {
  var s = String(url || '').trim();
  if (!s) throw new Error(label + ' 편집링크가 설정 시트에 비어 있습니다.');
  if (s.indexOf('/d/e/') !== -1) {
    throw new Error(label + ' 링크가 응시용 링크입니다. 폼을 편집 상태로 열었을 때 주소창에 보이는 ' +
                    '편집 링크(.../edit)를 설정 시트에 넣어 주십시오.');
  }
  var m = s.match(/\/d\/([a-zA-Z0-9_-]{15,})/);
  var id = m ? m[1] : (/^[a-zA-Z0-9_-]{15,}$/.test(s) ? s : null);
  if (!id) throw new Error(label + ' 링크를 해석할 수 없습니다: ' + s);
  return FormApp.openById(id);
}

function toggle_(cfg, target, open) {
  var prefix = target === 'eval' ? '평가' : target === 'survey' ? '설문' : null;
  if (!prefix) throw new Error('대상이 올바르지 않습니다: ' + target);

  // 구글폼 자체의 응답 수락을 끄고 켠다 (링크를 직접 아는 경우도 차단됨)
  var editLink = String(cfg[prefix + '폼_편집링크'] || '').trim();
  if (editLink) {
    var form = openForm_(editLink, prefix + '폼');
    form.setAcceptingResponses(open);
    if (!open) {
      var msg = String(cfg[prefix + '마감안내'] || '').trim();
      if (msg) form.setCustomClosedMessage(msg);
    }
  }
  setConfig_(prefix + '개방', open ? '예' : '아니오');
  CacheService.getScriptCache().remove(STATE_CACHE_KEY);

  var fresh = readConfig_();
  return {
    evalOpen: truthy_(fresh['평가개방']),
    surveyOpen: truthy_(fresh['설문개방']),
    formLinked: !!editLink
  };
}

/* ===================================================================
 *  평가 현황 집계
 * =================================================================== */

function responseSheet_(ss, name) {
  if (name) {
    var sh = ss.getSheetByName(String(name).trim());
    if (!sh) throw new Error('"' + name + '" 시트를 찾을 수 없습니다. 설정 시트의 평가응답시트 값을 확인하십시오.');
    return sh;
  }
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var n = sheets[i].getName();
    if (n === SETTINGS_SHEET || n === ROSTER_SHEET) continue;
    if (/응답|Response/i.test(n)) return sheets[i];
  }
  for (var j = 0; j < sheets.length; j++) {
    var nm = sheets[j].getName();
    if (nm !== SETTINGS_SHEET && nm !== ROSTER_SHEET) return sheets[j];
  }
  throw new Error('평가 응답 시트를 찾을 수 없습니다.');
}

/** "3-7", "3 - 7", "3조 7번" 등을 {g:'3', n:7} 로 정규화 */
function parseNo_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return null;
  var m = s.match(/(\d{1,3})\s*조?\s*[-–—_.\/\\ ]\s*(\d{1,3})\s*번?/);
  if (!m) m = s.match(/^(\d{1,3})\s*조\s*(\d{1,3})\s*번?$/);
  if (!m) return null;
  var g = parseInt(m[1], 10), n = parseInt(m[2], 10);
  if (!g || !n) return null;
  return { g: String(g), n: n };
}

function toNumber_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  if (Object.prototype.toString.call(v) === '[object Date]') return null;
  var s = String(v).trim();
  var m = s.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);   // 퀴즈형 "8 / 10"
  if (m) return parseFloat(m[1]);
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);
  m = s.match(/^(-?\d+(?:\.\d+)?)\s*점/);                            // "4점"
  if (m) return parseFloat(m[1]);
  return null;
}

function quizMax_(v) {
  var m = String(v === null || v === undefined ? '' : v).trim()
    .match(/^-?\d+(?:\.\d+)?\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  return m ? parseFloat(m[1]) : null;
}

function isTimestampHeader_(h) { return /타임스탬프|timestamp|제출\s*시간/i.test(h); }
function isEmailHeader_(h) { return /이메일|e-?mail/i.test(h); }

function findNoColumn_(header, cfgName) {
  var i;
  if (cfgName) {
    for (i = 0; i < header.length; i++) {
      if (String(header[i]).trim() === String(cfgName).trim()) return i;
    }
    throw new Error('"' + cfgName + '" 열을 찾을 수 없습니다. 설정 시트의 번호열 값을 확인하십시오.');
  }
  for (i = 0; i < header.length; i++) {
    var h = String(header[i]);
    if (isTimestampHeader_(h) || isEmailHeader_(h)) continue;
    if (/번호|조\s*-?\s*번|군번/.test(h)) return i;
  }
  for (i = 0; i < header.length; i++) {
    var h2 = String(header[i]);
    if (!isTimestampHeader_(h2) && !isEmailHeader_(h2) && !/^(점수|score)$/i.test(h2.trim())) return i;
  }
  return 1;
}

function findScoreColumns_(header, rows, noIdx, cfgSpec) {
  var i, idxs = [];
  if (cfgSpec) {
    String(cfgSpec).split(',').forEach(function (tok) {
      var t = tok.trim();
      if (!t) return;
      if (/^\d+$/.test(t)) { idxs.push(parseInt(t, 10) - 1); return; }
      for (var k = 0; k < header.length; k++) {
        if (String(header[k]).trim() === t) { idxs.push(k); return; }
      }
      throw new Error('점수열 "' + t + '" 을 찾을 수 없습니다.');
    });
    if (idxs.length) return { mode: 'cols', idxs: idxs };
  }
  for (i = 0; i < header.length; i++) {
    if (/^(점수|score)$/i.test(String(header[i]).trim())) return { mode: 'quiz', idxs: [i] };
  }
  for (i = 0; i < header.length; i++) {
    if (i === noIdx) continue;
    var h = String(header[i]);
    if (isTimestampHeader_(h) || isEmailHeader_(h)) continue;
    var seen = 0, num = 0;
    for (var r = 0; r < rows.length; r++) {
      var v = rows[r][i];
      if (v === '' || v === null || v === undefined) continue;
      seen++;
      if (toNumber_(v) !== null) num++;
    }
    if (seen > 0 && num / seen >= 0.8) idxs.push(i);
  }
  return { mode: 'cols', idxs: idxs };
}

/** 명단 시트(A열 = 번호) 또는 조개수 × 조별인원 으로 정원을 만든다. */
function buildRoster_(ss, cfg) {
  var roster = {};   // { '1': [1,2,3,...], ... }
  var sh = ss.getSheetByName(ROSTER_SHEET);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var p = parseNo_(r[0]);
      if (!p) return;
      if (!roster[p.g]) roster[p.g] = [];
      if (roster[p.g].indexOf(p.n) === -1) roster[p.g].push(p.n);
    });
    if (Object.keys(roster).length) {
      Object.keys(roster).forEach(function (g) {
        roster[g].sort(function (a, b) { return a - b; });
      });
      return roster;
    }
  }
  var m = parseInt(cfg['조개수'], 10) || 0;
  var n = parseInt(cfg['조별인원'], 10) || 0;
  for (var g = 1; g <= m; g++) {
    roster[String(g)] = [];
    for (var k = 1; k <= n; k++) roster[String(g)].push(k);
  }
  return roster;
}

function dashboard_(cfg) {
  var ss = SpreadsheetApp.getActive();
  var sh = responseSheet_(ss, cfg['평가응답시트']);
  var roster = buildRoster_(ss, cfg);

  var values = sh.getLastRow() > 0 ? sh.getDataRange().getValues() : [];
  var header = values.length ? values[0].map(function (h) { return String(h); }) : [];
  var rows = values.length > 1 ? values.slice(1) : [];

  var noIdx = header.length ? findNoColumn_(header, cfg['번호열']) : 1;
  var score = header.length ? findScoreColumns_(header, rows, noIdx, cfg['점수열'])
                            : { mode: 'cols', idxs: [] };
  var tsIdx = -1;
  for (var h = 0; h < header.length; h++) { if (isTimestampHeader_(header[h])) { tsIdx = h; break; } }

  var avgMode = String(cfg['점수계산'] || '합계').trim() === '평균';
  var maxScore = toNumber_(cfg['만점']);

  // 번호 기준으로 마지막 제출만 인정
  var latest = {};      // '3-7' -> {g,n,score,at}
  var unknown = [];
  var duplicates = 0;

  rows.forEach(function (row) {
    if (row.every(function (c) { return c === '' || c === null; })) return;

    var vals = [];
    score.idxs.forEach(function (i) {
      var v = toNumber_(row[i]);
      if (v !== null) vals.push(v);
      if (score.mode === 'quiz' && maxScore === null) {
        var mx = quizMax_(row[i]);
        if (mx !== null) maxScore = mx;
      }
    });
    var s = null;
    if (vals.length) {
      var sum = vals.reduce(function (a, b) { return a + b; }, 0);
      s = (score.mode === 'quiz' || !avgMode) ? sum : sum / vals.length;
      if (score.mode === 'quiz') s = vals[0];
    }

    var at = tsIdx >= 0 && row[tsIdx] ? new Date(row[tsIdx]) : null;
    var p = parseNo_(row[noIdx]);
    if (!p) {
      unknown.push({ raw: String(row[noIdx] || ''), score: s, at: at ? at.toISOString() : null });
      return;
    }
    var key = p.g + '-' + p.n;
    if (latest[key]) duplicates++;
    latest[key] = { g: p.g, n: p.n, no: key, score: s, at: at ? at.toISOString() : null };
  });

  // 조별 집계 (응답에만 있는 조도 포함)
  var groupKeys = {};
  Object.keys(roster).forEach(function (g) { groupKeys[g] = true; });
  Object.keys(latest).forEach(function (k) { groupKeys[latest[k].g] = true; });

  var groups = Object.keys(groupKeys).sort(function (a, b) { return Number(a) - Number(b); })
    .map(function (g) {
      var slots = roster[g] ? roster[g].slice() : [];
      var members = Object.keys(latest)
        .filter(function (k) { return latest[k].g === g; })
        .map(function (k) { return latest[k]; })
        .sort(function (a, b) { return a.n - b.n; });
      var scored = members.filter(function (m) { return m.score !== null; });
      var avg = scored.length
        ? scored.reduce(function (a, m) { return a + m.score; }, 0) / scored.length
        : null;
      return {
        group: g,
        slots: slots,
        expected: slots.length,
        submitted: members.length,
        average: avg === null ? null : Math.round(avg * 100) / 100,
        members: members.map(function (m) {
          return { no: m.no, n: m.n, score: m.score, at: m.at };
        })
      };
    });

  var allScored = Object.keys(latest).map(function (k) { return latest[k]; })
    .filter(function (m) { return m.score !== null; });
  var totalExpected = groups.reduce(function (a, g) { return a + g.expected; }, 0);
  var totalSubmitted = Object.keys(latest).length;
  var totalAvg = allScored.length
    ? allScored.reduce(function (a, m) { return a + m.score; }, 0) / allScored.length
    : null;

  return {
    updatedAt: new Date().toISOString(),
    state: { evalOpen: truthy_(cfg['평가개방']), surveyOpen: truthy_(cfg['설문개방']) },
    maxScore: maxScore,
    scoreMode: score.mode === 'quiz' ? '퀴즈점수' : (avgMode ? '평균' : '합계'),
    scoreColumns: score.idxs.map(function (i) { return header[i] || ('열' + (i + 1)); }),
    sheetName: sh.getName(),
    totals: {
      expected: totalExpected,
      submitted: totalSubmitted,
      average: totalAvg === null ? null : Math.round(totalAvg * 100) / 100
    },
    groups: groups,
    unknown: unknown,
    duplicates: duplicates
  };
}

/** 편집기에서 직접 실행해 동작을 확인할 때 사용 */
function testDashboard() {
  Logger.log(JSON.stringify(dashboard_(readConfig_()), null, 2));
}
