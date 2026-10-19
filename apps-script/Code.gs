/**
 * =====================================================================
 *  예비군 평가 · 설문 관리 백엔드 (Google Apps Script)
 * =====================================================================
 *  · 평가 과목 여러 개를 각각 열고 닫는다
 *  · 조마다 A안/B안을 배정한다 (기본 ABBA 반복)
 *  · 조 단위로 접근을 열고 닫는다
 *  · 조별 득점률 평균으로 종합 순위(우수 조)를 낸다
 *
 *  설치: 응답 스프레드시트 → 확장 프로그램 → Apps Script → 붙여넣기
 *        → setup() 실행 → 배포 관리 → 새 버전 → 배포
 * =====================================================================
 */

var SETTINGS_SHEET = '설정';
var SUBJECTS_SHEET = '과목';
var ROSTER_SHEET = '명단';
var CLAIMS_SHEET = '등록';
var CLAIM_HEADER = ['날짜', '번호', '조', '번', '등록시각', '기기', '비고'];
var STATE_CACHE_KEY = 'public_state_v3';
var CLAIMS_CACHE_KEY = 'claims_map_v1';
var CLAIMS_CACHE_SEC = 5;
var STATE_CACHE_SEC = 5;

var GUIDE_DEFAULT = [
  '*1인 1회*만 인정됩니다. 같은 번호로 여러 번 내면 *처음 제출한 것*만 반영됩니다.',
  '이 화면으로 돌아오려면 카드를 휴대폰 뒷면에 다시 태그하십시오.'
].join('\n');

var DEFAULTS = [
  ['부대명', '서산 과학화 예비군훈련대', '첫 화면 상단에 표시됩니다.'],
  ['관리자PIN', '1234', '교관용 로그인 PIN. 반드시 변경하십시오.'],
  ['설문폼_편집링크', '', '설문 구글폼의 편집 주소(.../edit).'],
  ['설문폼_응시링크', '', '비워두면 편집링크에서 자동으로 채워집니다.'],
  ['설문개방', '아니오', '예 / 아니오. 관리자 화면에서 바뀝니다.'],
  ['평가마감안내', '평가 시간이 아닙니다. 교관 안내에 따라 주십시오.', '평가 마감 시 문구.'],
  ['설문마감안내', '설문 시간이 아닙니다. 교관 안내에 따라 주십시오.', '설문 마감 시 문구.'],
  ['조대기안내', '아직 귀 조의 평가 시간이 아닙니다. 교관 안내에 따라 주십시오.',
   '내 조가 열리지 않았을 때 표시할 문구.'],
  ['공지', '', '첫 화면 공지. 비워두면 표시되지 않습니다.'],
  ['안내제목', '안내', '첫 화면 안내 상자의 제목. 비우면 제목이 숨겨집니다.'],
  ['안내문구', GUIDE_DEFAULT,
   '한 줄에 한 항목씩(Alt+Enter 로 줄바꿈). *별표*로 감싸면 굵게. 비우면 안내 상자가 숨겨집니다.'],
  ['조개수', '50', '전체 조 수(m). 명단 시트가 있으면 명단이 우선합니다.'],
  ['조별인원', '10', '조당 인원(n).'],
  ['안배정', 'ABBA', 'A/B안 배정 패턴을 1조부터 반복 적용합니다. 비우면 전 조 A안.'],
  ['개방조', '없음', '과목 시트의 개방조가 비었을 때 쓰는 기본값. "전체" / "없음" / "1~10,15" 형식.'],
  ['자동마감시각', '22', '매일 이 시각(0~23)에 전 과목·설문을 자동으로 닫습니다. 비우면 자동마감 없음.'],
  ['개방기준일', '', '개방 설정을 마지막으로 바꾼 날짜. 자동 기록되므로 손대지 마십시오.'],
  ['마지막자동마감', '', '자동마감이 실행된 시각. 자동 기록.'],
  ['번호열', '', '번호(조-번) 열 제목. 비우면 자동 탐색.'],
  ['점수열', '', '점수 열 제목/번호를 쉼표로. 비우면 자동 탐색.'],
  ['점수계산', '합계', '합계 / 평균 — 점수열이 여러 개일 때.']
];

/* 과목 시트 열 — 이름으로 찾으므로 순서는 자유롭다 */
var SUBJECT_HEADER = [
  '과목명',
  '폼_편집링크', '폼_응시링크', '폼_프리필링크', '응답시트',
  '만점', '개방', '개방조',
  'B안_폼_편집링크', 'B안_폼_응시링크', 'B안_폼_프리필링크', 'B안_응답시트'
];
var SUBJECT_DEFAULTS = [
  ['안보교육', '', '', '', '', '', '아니오', '전체', '', '', '', ''],
  ['전투부상자처치', '', '', '', '', '', '아니오', '전체', '', '', '', ''],
  ['전시동원절차', '', '', '', '', '', '아니오', '전체', '', '', '', '']
];

/* ===================================================================
 *  설치 · 메뉴
 * =================================================================== */

function setup() {
  var ss = SpreadsheetApp.getActive();
  ensureKeyValueSheet_(ss, SETTINGS_SHEET, DEFAULTS);
  var sh = ss.getSheetByName(SUBJECTS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SUBJECTS_SHEET, 1);
    sh.getRange(1, 1, 1, SUBJECT_HEADER.length).setValues([SUBJECT_HEADER])
      .setFontWeight('bold').setBackground('#4a5d3a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, SUBJECT_DEFAULTS.length, SUBJECT_HEADER.length).setValues(SUBJECT_DEFAULTS);
    sh.setColumnWidth(1, 150);
  } else {
    var before = subjectColMap_(sh);
    var map = ensureSubjectColumns_(sh);     // 기존 시트에는 빠진 열만 뒤에 붙인다
    // 과목별 개방조 열이 새로 생겼으면 기존 전체 설정값을 각 과목에 복사한다
    if (!before['개방조'] && map['개방조'] && sh.getLastRow() > 1) {
      var legacy = String(readConfig_()['개방조'] || '전체').trim() || '전체';
      var n = sh.getLastRow() - 1;
      var cur = sh.getRange(2, map['개방조'], n, 1).getValues();
      var out = cur.map(function (r) {
        return [String(r[0] || '').trim() ? r[0] : legacy];
      });
      sh.getRange(2, map['개방조'], n, 1).setValues(out);
    }
  }
  claimsSheet_(true);
  ss.toast('설정 / 과목 / 등록 시트를 준비했습니다.', '설치 완료', 8);
  return '준비 완료';
}

function ensureKeyValueSheet_(ss, name, defaults) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name, 0);
    sh.getRange(1, 1, 1, 3).setValues([['항목', '값', '설명']])
      .setFontWeight('bold').setBackground('#16243a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, defaults.length, 3).setValues(defaults);
    sh.setColumnWidth(1, 150).setColumnWidth(2, 330).setColumnWidth(3, 440);
    sh.getRange(2, 3, defaults.length, 1).setFontColor('#888888').setFontSize(9);
    return sh;
  }
  var have = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
      .forEach(function (r) { have[String(r[0]).trim()] = true; });
  }
  var add = defaults.filter(function (d) { return !have[d[0]]; });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 3).setValues(add);
  return sh;
}

function subjectsSheet_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SUBJECTS_SHEET);
  if (!sh) throw new Error('"과목" 시트가 없습니다. Apps Script 에서 setup() 을 먼저 실행하십시오.');
  return sh;
}

function subjectColMap_(sh) {
  var last = sh.getLastColumn();
  if (last < 1) return {};
  var hdr = sh.getRange(1, 1, 1, last).getValues()[0];
  var map = {};
  hdr.forEach(function (h, i) { var k = String(h).trim(); if (k) map[k] = i + 1; });
  return map;
}

function ensureSubjectColumns_(sh) {
  var map = subjectColMap_(sh);
  var missing = SUBJECT_HEADER.filter(function (h) { return !map[h]; });
  if (missing.length) {
    var start = Math.max(sh.getLastColumn(), 1) + 1;
    sh.getRange(1, start, 1, missing.length).setValues([missing])
      .setFontWeight('bold').setBackground('#4a5d3a').setFontColor('#ffffff');
    map = subjectColMap_(sh);
  }
  return map;
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('예비군 평가')
    .addItem('설정 / 과목 시트 준비', 'setup')
    .addSeparator()
    .addItem('평가 — 모든 조 열기', 'menuGroupsAll')
    .addItem('평가 — 모든 조 닫기', 'menuGroupsNone')
    .addSeparator()
    .addItem('설문 열기', 'menuSurveyOpen')
    .addItem('설문 닫기', 'menuSurveyClose')
    .addSeparator()
    .addItem('지금 전부 마감', 'menuAutoCloseNow')
    .addItem('자동 마감 켜기 / 갱신', 'menuAutoCloseOn')
    .addItem('자동 마감 끄기', 'menuAutoCloseOff')
    .addSeparator()
    .addItem('문제 순서 섞기 켜기', 'menuShuffleOn')
    .addItem('자동입력 점검 / 복구', 'menuCheckPrefill')
    .addItem('응답 시트 다시 찾기', 'menuRefindSheets')
    .addItem('링크 캐시 비우기', 'menuClearLinks')
    .addItem('종합 순위 보기', 'menuSummary')
    .addSeparator()
    .addItem('진단 (상태 찍어보기)', 'menuDiagnose')
    .addToUi();
}

function menuSurveyOpen() { menuToggle_('survey', '', true); }
function menuSurveyClose() { menuToggle_('survey', '', false); }

function menuToggle_(target, name, open) {
  try {
    var r = toggleAny_(readConfig_(), target, name, open);
    SpreadsheetApp.getActive().toast(
      (open ? '열었습니다.' : '닫았습니다.') + (r.warning ? ' (' + r.warning + ')' : ''), '완료', 6);
  } catch (err) {
    SpreadsheetApp.getUi().alert('실패: ' + err.message);
  }
}

function menuGroupsAll() { setOpenGroups_(readConfig_(), '*', '전체'); SpreadsheetApp.getActive().toast('전 과목에서 모든 조를 열었습니다.', '완료', 5); }
function menuGroupsNone() { setOpenGroups_(readConfig_(), '*', '없음'); SpreadsheetApp.getActive().toast('전 과목에서 모든 조를 닫았습니다.', '완료', 5); }

/** 평가 폼의 문제 순서를 섞도록 설정한다(번호 질문은 첫 섹션에 두어야 섞이지 않는다). */
function menuShuffleOn() {
  var done = [], failed = [];
  subjects_(readConfig_()).forEach(function (s) {
    ['A', 'B'].forEach(function (k) {
      var link = s[k].editLink;
      if (!link) return;
      try { openForm_(link, s.name + ' ' + k + '안').setShuffleQuestions(true); done.push(s.name + ' ' + k + '안'); }
      catch (e) { failed.push(s.name + ' ' + k + '안: ' + e.message); }
    });
  });
  SpreadsheetApp.getUi().alert('문제 순서 섞기',
    '적용: ' + (done.join(', ') || '없음') + (failed.length ? '\n\n실패:\n' + failed.join('\n') : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * 번호 자동입력 링크를 폼에서 다시 만들어 과목 시트에 적는다.
 * 폼의 번호 질문을 지우고 다시 만들면 entry 아이디가 바뀌어
 * 캐시된 링크가 낡게 되는데, 그러면 번호가 채워지지 않는다.
 * 폼을 고친 뒤에는 이 메뉴를 한 번 실행하십시오.
 */
function menuCheckPrefill() {
  var cfg = readConfig_();
  var lines = [], bad = 0;
  subjects_(cfg).forEach(function (s) {
    ['A', 'B'].forEach(function (k) {
      var v = s[k];
      if (!v.editLink) return;
      var label = s.name + (s.hasB ? ' ' + k + '안' : '');
      try {
        var info = prefillInfo_(openForm_(v.editLink, label));
        if (!info.url) { bad++; lines.push('✗ ' + label + ' — 단답형 번호 질문을 찾지 못했습니다'); return; }
        setSubjectCell_(s, v.cols.prefill, info.url);
        var eid = (info.url.match(/entry\.(\d+)/) || [])[1] || '?';
        var warn = /번호/.test(info.title) ? '' : '  ⚠ 제목에 "번호"가 없습니다 — 다른 질문을 잡았을 수 있습니다';
        lines.push('✓ ' + label + ' → "' + info.title + '" (entry.' + eid + ')' + warn);
      } catch (err) {
        bad++;
        lines.push('✗ ' + label + ' — ' + ((err && err.message) ? err.message : err));
      }
    });
  });
  CacheService.getScriptCache().remove(STATE_CACHE_KEY);
  SpreadsheetApp.getUi().alert('자동입력 점검 / 복구',
    (lines.join('\n') || '등록된 평가 폼이 없습니다.') +
    '\n\n' + (bad ? bad + '개 폼에 문제가 있습니다. 번호 질문이 "단답형"인지 확인하십시오.'
                   : '모든 폼의 자동입력 링크를 새로 만들었습니다.'),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * 과목 시트의 "응답시트" 칸을 비워 자동 탐색을 다시 돌린다.
 * 응답 탭 이름을 바꾼 뒤에 쓴다(폼 문항 제목과 헤더를 대조해 다시 연결한다).
 */
function menuRefindSheets() {
  var sh = subjectsSheet_(), map = ensureSubjectColumns_(sh);
  var n = sh.getLastRow() - 1;
  if (n > 0) {
    ['응답시트', 'B안_응답시트'].forEach(function (k) {
      if (map[k]) sh.getRange(2, map[k], n, 1).clearContent();
    });
  }
  CacheService.getScriptCache().remove(STATE_CACHE_KEY);

  // 바로 한 번 돌려서 결과를 보여 준다
  var cfg = readConfig_();
  var d = dashboard_(cfg, todayKey_());
  var lines = d.subjects.map(function (x) {
    var sheets = x.sheets || {};
    var t = x.name + ' → ';
    t += (sheets.A ? (x.hasB ? 'A안 ' : '') + sheets.A : 'A안 못 찾음');
    if (x.hasB) t += ' / ' + (sheets.B ? 'B안 ' + sheets.B : 'B안 못 찾음');
    if (x.warning) t += '\n    ⚠ ' + x.warning;
    return t;
  });
  SpreadsheetApp.getUi().alert('응답 시트 다시 찾기',
    lines.join('\n\n') + '\n\n못 찾은 항목은 과목 시트의 "응답시트" 칸에 탭 이름을 직접 적어 주십시오.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** 응시·프리필 링크를 다시 만들게 한다(폼 문항을 바꿨을 때 사용). */
function menuClearLinks() {
  var sh = subjectsSheet_(), map = ensureSubjectColumns_(sh);
  var n = sh.getLastRow() - 1;
  if (n > 0) {
    ['폼_응시링크', '폼_프리필링크', 'B안_폼_응시링크', 'B안_폼_프리필링크'].forEach(function (k) {
      if (map[k]) sh.getRange(2, map[k], n, 1).clearContent();
    });
  }
  setConfig_('설문폼_응시링크', '');
  CacheService.getScriptCache().remove(STATE_CACHE_KEY);
  SpreadsheetApp.getActive().toast('링크 캐시를 비웠습니다. 다음 접속 때 다시 만들어집니다.', '완료', 6);
}

function menuSummary() {
  var d = dashboard_(readConfig_(), todayKey_());
  var lines = [];
  d.combined.groups.slice()
    .sort(function (a, b) { return (b.overall === null ? -1 : b.overall) - (a.overall === null ? -1 : a.overall); })
    .forEach(function (g, i) {
      lines.push((i + 1) + '위  ' + g.group + '조(' + g.plan + '안)   종합 ' +
                 (g.overall === null ? '-' : g.overall + '점') + (g.complete ? '' : '  (미완)'));
    });
  if (d.combined.missingMax.length) {
    lines.push('', '※ 만점 미설정으로 종합에서 제외된 과목: ' + d.combined.missingMax.join(', '));
  }
  SpreadsheetApp.getUi().alert('종합 순위', lines.join('\n') || '집계할 응답이 없습니다.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ===================================================================
 *  웹앱 진입점
 * =================================================================== */

function doGet(e) { return handle_(e && e.parameter ? e.parameter : {}); }

function doPost(e) {
  var p = {};
  try {
    if (e && e.postData && e.postData.contents) p = JSON.parse(e.postData.contents);
  } catch (err) { p = (e && e.parameter) || {}; }
  return handle_(p);
}

function handle_(p) {
  try {
    var action = String(p.action || 'state');
    if (action === 'state') return json_({ ok: true, data: cachedState_() });
    if (action === 'claim') {
      return json_({ ok: true,
        data: claimNumber_(readConfig_(), p.g, p.n, p.token) });
    }
    if (action === 'mine') {
      return json_({ ok: true, data: claimStatus_(p.g, p.n, p.token) });
    }

    var cfg = readConfig_();
    requirePin_(cfg, p.pin);

    if (action === 'ping') return json_({ ok: true, data: { auth: true } });
    if (action === 'dashboard') return json_({ ok: true, data: dashboard_(cfg, resolveDay_(p.date)) });
    if (action === 'survey') return json_({ ok: true, data: cachedSurvey_(cfg, resolveDay_(p.date)) });
    if (action === 'lookup') {
      return json_({ ok: true, data: lookupNumber_(cfg, String(p.no || ''), resolveDay_(p.date)) });
    }
    if (action === 'toggle' || action === 'groups' || action === 'reset') {
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        if (action === 'groups') return json_({ ok: true, data: setOpenGroups_(cfg, p.subject, p.groups) });
        if (action === 'reset') {
          return json_({ ok: true, data: resetNumber_(cfg, String(p.no || ''), resolveDay_(p.date),
            truthy_(p.release), String(p.subjects === undefined ? '' : p.subjects)) });
        }
        return json_({ ok: true, data: toggleAny_(cfg, String(p.target || ''), p.name, truthy_(p.open)) });
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
 *  설정 읽기/쓰기
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

/* 시트는 "2026-10-18" 같은 값을 날짜로 바꿔 저장해 버린다.
   그러면 문자열 비교가 영원히 어긋나므로, 날짜·시각 항목은 텍스트로 박아 둔다. */
var TEXT_KEYS = { '개방기준일': true, '마지막자동마감': true };

function setConfig_(key, value) {
  var sh = settingsSheet_();
  var n = sh.getLastRow() - 1;
  var keys = n > 0 ? sh.getRange(2, 1, n, 1).getValues() : [];
  var row = 0;
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() === key) { row = i + 2; break; }
  }
  if (!row) {
    row = sh.getLastRow() + 1;
    sh.getRange(row, 1).setValue(key);
  }
  var cell = sh.getRange(row, 2);
  if (TEXT_KEYS[key]) { try { cell.setNumberFormat('@'); } catch (e) { /* 무시 */ } }
  cell.setValue(value);
}

function truthy_(v) {
  var s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === '예' || s === 'y' || s === 'yes' || s === 'on' || s === '개방';
}

function round_(n, d) {
  if (n === null || n === undefined || isNaN(n)) return null;
  var f = Math.pow(10, d === undefined ? 1 : d);
  return Math.round(n * f) / f;
}

function splitLines_(v) {
  return String(v === null || v === undefined ? '' : v)
    .split(/\r?\n/)
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return x.length > 0; });
}

function dayKey_(d) {
  if (!d || Object.prototype.toString.call(d) !== '[object Date]' || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
function todayKey_() { return dayKey_(new Date()); }

function resolveDay_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (s === 'all') return '';
  if (!s) return todayKey_();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('날짜 형식이 올바르지 않습니다: ' + s);
  return s;
}

/* ===================================================================
 *  A/B안 배정 · 조별 개방
 * =================================================================== */

/** 1조부터 패턴을 반복 적용한다. 'ABBA' → 1:A 2:B 3:B 4:A 5:A … */
function planFor_(g, pattern) {
  var p = String(pattern === null || pattern === undefined ? '' : pattern).toUpperCase().replace(/[^AB]/g, '');
  if (!p) return 'A';
  return p.charAt((Number(g) - 1) % p.length);
}

/** '전체'→null(제한 없음), '없음'→{}, '1-10,15'→{1:true,…} */
function parseOpenGroups_(spec) {
  var s = String(spec === null || spec === undefined ? '' : spec).trim();
  if (!s || /^(전체|all|\*)$/i.test(s)) return null;
  if (/^(없음|none|-)$/i.test(s)) return {};
  var set = {};
  s.split(',').forEach(function (tok) {
    var t = tok.trim();
    if (!t) return;
    var m = t.match(/^(\d+)\s*[-~–]\s*(\d+)$/);
    if (m) {
      var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      for (var i = Math.min(a, b); i <= Math.max(a, b); i++) set[i] = true;
      return;
    }
    if (/^\d+$/.test(t)) set[parseInt(t, 10)] = true;
  });
  return set;
}

function formatOpenGroups_(set, maxG) {
  if (set === null) return '전체';
  var list = [];
  for (var g = 1; g <= maxG; g++) if (set[g]) list.push(g);
  if (!list.length) return '없음';
  var out = [], s = list[0], p = list[0];
  for (var i = 1; i <= list.length; i++) {
    var v = list[i];
    if (v === p + 1) { p = v; continue; }
    out.push(s === p ? String(s) : s + '~' + p);
    s = v; p = v;
  }
  return out.join(',');
}

/**
 * 과목 하나의 개방 조를 결정한다.
 * 과목 시트의 "개방조"가 비어 있으면 설정 시트의 "개방조"를 기본값으로 쓴다.
 */
function subjectOpen_(cfg, subj, maxG) {
  var spec = String(subj.openSpec || '').trim();
  if (!spec) spec = String(cfg['개방조'] || '').trim();
  var set = parseOpenGroups_(spec);
  var list = null;
  if (set !== null) {
    list = [];
    for (var g = 1; g <= maxG; g++) if (set[g]) list.push(g);
  }
  return { list: list, text: formatOpenGroups_(set, maxG) };
}

/**
 * 관리자 화면에서 넘어온 값을 과목별 개방조 칸에 적고,
 * 그 결과에 따라 구글폼의 응답 수락까지 자동으로 맞춘다.
 *   열린 조가 하나라도 있으면 → 폼 열기
 *   "없음" 이면                → 폼 닫기 (링크를 알아도 제출 불가)
 * 덕분에 교관은 조만 조정하면 되고, 과목 개폐는 따라온다.
 */
function setOpenGroups_(cfg, subjectName, spec) {
  var maxG = parseInt(cfg['조개수'], 10) || 50;
  var set = parseOpenGroups_(spec);
  var text = formatOpenGroups_(set, maxG);
  var shouldOpen = (set === null) || Object.keys(set).length > 0;

  var want = String(subjectName || '').trim();
  var hits = subjects_(cfg).filter(function (s) {
    return !want || want === '*' || s.name === want;
  });
  if (!hits.length) throw new Error('과목을 찾을 수 없습니다: ' + subjectName);

  var warnings = [];
  hits.forEach(function (s) {
    setSubjectCell_(s, '개방조', text);
    if (s.open === shouldOpen) return;               // 상태가 같으면 폼은 건드리지 않는다
    try {
      toggleSubject_(cfg, s, shouldOpen, warnings);
    } catch (err) {
      warnings.push(s.name + ': ' + ((err && err.message) ? err.message : err));
    }
  });

  setConfig_('개방기준일', todayKey_());
  CacheService.getScriptCache().remove(STATE_CACHE_KEY);
  return {
    subject: want || '*', openGroups: text, formOpen: shouldOpen,
    applied: hits.map(function (s) { return s.name; }),
    warning: warnings.join(' / ')
  };
}

/* ===================================================================
 *  과목 읽기/쓰기
 * =================================================================== */

/** 과목 시트를 읽는다. 없으면 구버전 설정(평가폼_편집링크)으로 1과목 구성. */
function subjects_(cfg) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SUBJECTS_SHEET);
  var list = [];
  if (sh && sh.getLastRow() > 1) {
    var map = ensureSubjectColumns_(sh);
    var last = sh.getLastColumn();
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, last).getValues();
    var get = function (row, key) {
      var c = map[key];
      if (!c) return '';
      var v = row[c - 1];
      return typeof v === 'string' ? v.trim() : v;
    };
    rows.forEach(function (row, i) {
      var name = String(get(row, '과목명') || '').trim();
      if (!name) return;
      list.push({
        row: i + 2,
        name: name,
        maxScore: toNumber_(get(row, '만점')),
        open: truthy_(get(row, '개방')),
        openSpec: String(get(row, '개방조') === undefined ? '' : (get(row, '개방조') || '')),
        A: {
          editLink: String(get(row, '폼_편집링크') || ''),
          viewLink: String(get(row, '폼_응시링크') || ''),
          prefill: String(get(row, '폼_프리필링크') || ''),
          sheetName: String(get(row, '응답시트') || ''),
          cols: { view: '폼_응시링크', prefill: '폼_프리필링크', sheet: '응답시트' }
        },
        B: {
          editLink: String(get(row, 'B안_폼_편집링크') || ''),
          viewLink: String(get(row, 'B안_폼_응시링크') || ''),
          prefill: String(get(row, 'B안_폼_프리필링크') || ''),
          sheetName: String(get(row, 'B안_응답시트') || ''),
          cols: { view: 'B안_폼_응시링크', prefill: 'B안_폼_프리필링크', sheet: 'B안_응답시트' }
        }
      });
    });
  }
  if (list.length) {
    list.forEach(function (s) { s.hasB = !!s.B.editLink; });
    return list;
  }

  var legacy = String(cfg['평가폼_편집링크'] || '').trim();
  if (!legacy) return [];
  return [{
    row: 0, legacy: true, name: '평가', hasB: false,
    maxScore: toNumber_(cfg['만점']),
    open: truthy_(cfg['평가개방']),
    openSpec: String(cfg['개방조'] || ''),
    A: {
      editLink: legacy,
      viewLink: String(cfg['평가폼_응시링크'] || ''),
      prefill: '',
      sheetName: String(cfg['평가응답시트'] || ''),
      cols: { view: '평가폼_응시링크', prefill: '', sheet: '평가응답시트' }
    },
    B: { editLink: '', viewLink: '', prefill: '', sheetName: '', cols: {} }
  }];
}

function setSubjectCell_(subj, colName, value) {
  if (!colName) return;
  if (subj.legacy) { setConfig_(colName, value); return; }
  var sh = SpreadsheetApp.getActive().getSheetByName(SUBJECTS_SHEET);
  if (!sh || subj.row < 2) return;
  var map = ensureSubjectColumns_(sh);
  if (map[colName]) sh.getRange(subj.row, map[colName]).setValue(value);
}

/* ===================================================================
 *  공개 상태 (예비군 첫 화면)
 * =================================================================== */

function cachedState_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(STATE_CACHE_KEY);
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* 무시 */ } }
  var st = publicState_(readConfig_());
  cache.put(STATE_CACHE_KEY, JSON.stringify(st), STATE_CACHE_SEC);
  return st;
}

function publicState_(cfg) {
  var maxG = parseInt(cfg['조개수'], 10) || 50;

  /* 개방 설정은 '그 날' 것만 유효하다.
     전날 설정이 남아 있으면 닫힌 것으로 본다.
     실제 마감은 자동마감 트리거와 관리자 접속 시 보정으로 처리된다. */
  var baseDay = claimDayOf_(cfg['개방기준일']);
  var stale = !!baseDay && baseDay !== todayKey_();

  return {
    unitName: String(cfg['부대명'] || ''),
    notice: String(cfg['공지'] || ''),
    evalClosedMessage: String(cfg['평가마감안내'] || ''),
    groupClosedMessage: String(cfg['조대기안내'] || ''),
    guideTitle: String(cfg['안내제목'] === undefined ? '안내' : (cfg['안내제목'] || '')),
    guide: splitLines_(cfg['안내문구'] === undefined ? GUIDE_DEFAULT : cfg['안내문구']),
    groupCount: maxG,
    memberCount: parseInt(cfg['조별인원'], 10) || 10,
    planPattern: String(cfg['안배정'] === undefined ? 'ABBA' : (cfg['안배정'] || '')),
    subjects: subjects_(cfg).map(function (s) {
      var a = ensureVariantLinks_(s, 'A');
      var b = s.hasB ? ensureVariantLinks_(s, 'B') : { view: '', prefill: '' };
      var og = subjectOpen_(cfg, s, maxG);
      return {
        name: s.name,
        open: stale ? false : s.open,
        hasB: !!s.hasB,
        openGroups: og.list,                  // null 이면 조 제한 없음
        urls: { A: a.view, B: b.view },
        prefill: { A: a.prefill, B: b.prefill }
      };
    }),
    survey: {
      open: stale ? false : truthy_(cfg['설문개방']),
      url: surveyViewUrl_(cfg),
      closedMessage: String(cfg['설문마감안내'] || '')
    }
  };
}

/** 응시링크·프리필링크를 필요할 때 만들어 과목 시트에 적어 둔다.
 *  둘 중 하나만 비어 있어도 폼은 한 번만 연다. */
function ensureVariantLinks_(s, which) {
  var v = s[which];
  if (!v || !v.editLink) return { view: '', prefill: '' };
  if (v.viewLink && v.prefill) return { view: v.viewLink, prefill: v.prefill };

  var out = { view: v.viewLink, prefill: v.prefill };
  try {
    var form = openForm_(v.editLink, s.name + ' ' + which + '안');
    if (!out.view) {
      out.view = form.getPublishedUrl() || '';
      if (out.view) setSubjectCell_(s, v.cols.view, out.view);
    }
    if (!out.prefill) {
      out.prefill = prefillTemplate_(form) || '';
      if (out.prefill) setSubjectCell_(s, v.cols.prefill, out.prefill);
    }
  } catch (err) { /* 링크가 잘못됐으면 빈 값으로 둔다 */ }
  return out;
}

/**
 * 번호 질문이 __NO__ 로 미리 채워진 링크를 만든다. 화면에서 실제 번호로 치환한다.
 * {url, title} 을 돌려준다(점검 메뉴에서 어느 질문을 잡았는지 보여 주기 위함).
 */
function prefillInfo_(form) {
  var items;
  try { items = form.getItems(FormApp.ItemType.TEXT); } catch (e) { items = []; }
  if (!items || !items.length) return { url: '', title: '' };
  var target = null;
  for (var i = 0; i < items.length; i++) {
    if (/번호/.test(String(items[i].getTitle() || ''))) { target = items[i]; break; }
  }
  if (!target) target = items[0];
  try {
    return {
      url: form.createResponse()
        .withItemResponse(target.asTextItem().createResponse('__NO__'))
        .toPrefilledUrl(),
      title: String(target.getTitle() || '')
    };
  } catch (e) { return { url: '', title: '' }; }
}

function prefillTemplate_(form) { return prefillInfo_(form).url; }

function surveyViewUrl_(cfg) {
  var cached = String(cfg['설문폼_응시링크'] || '').trim();
  if (cached) return cached;
  var edit = String(cfg['설문폼_편집링크'] || '').trim();
  if (!edit) return '';
  try {
    var url = openForm_(edit, '설문폼').getPublishedUrl();
    setConfig_('설문폼_응시링크', url);
    return url;
  } catch (err) { return ''; }
}

/* ===================================================================
 *  개폐
 * =================================================================== */

function openForm_(url, label) {
  var s = String(url || '').trim();
  if (!s) throw new Error(label + ' 편집링크가 비어 있습니다.');
  if (s.indexOf('/d/e/') !== -1) {
    throw new Error(label + ' 링크가 응시용 링크입니다. 폼을 편집 상태로 열었을 때 주소창에 ' +
                    '보이는 편집 링크(.../edit)를 넣어 주십시오.');
  }
  var m = s.match(/\/d\/([a-zA-Z0-9_-]{15,})/);
  var id = m ? m[1] : (/^[a-zA-Z0-9_-]{15,}$/.test(s) ? s : null);
  if (!id) throw new Error(label + ' 링크를 해석할 수 없습니다: ' + s);
  return FormApp.openById(id);
}

/** 새 구글폼은 "게시" 후에만 응답을 받을 수 있으므로 열 때 게시를 먼저 시도한다. */
function setAccepting_(form, open, label) {
  if (open) {
    try {
      if (typeof form.setPublished === 'function') {
        var published = (typeof form.isPublished === 'function') ? form.isPublished() : false;
        if (!published) form.setPublished(true);
      }
    } catch (e) { /* 아래에서 안내 */ }
  }
  try {
    form.setAcceptingResponses(open);
  } catch (err) {
    var m = String((err && err.message) ? err.message : err);
    if (/게시|publish/i.test(m)) {
      throw new Error(label + ' 폼이 아직 게시되지 않았습니다. 폼 편집 화면 우측 상단의 ' +
                      '"게시(Publish)" 버튼을 한 번 눌러 게시한 뒤 다시 시도하십시오.');
    }
    throw err;
  }

  /* 실제로 바뀌었는지 되읽어 확인한다.
     미게시 폼 등에서는 예외 없이 무시되는 경우가 있어,
     "열었습니다" 만 뜨고 실제로는 닫혀 있는 사고가 생긴다. */
  var now = null;
  try { now = form.isAcceptingResponses(); } catch (e) { now = null; }
  if (now !== null && now !== open) {
    throw new Error(label + ' 폼의 응답 수락 상태가 바뀌지 않았습니다(요청 ' +
      (open ? '열기' : '닫기') + ', 실제 ' + (now ? '열림' : '닫힘') + ').\n' +
      '폼 편집 화면 우측 상단이 "게시됨" 인지, 편집링크가 그 폼의 것인지 확인하십시오.');
  }
}

/**
 * 폼 자체의 "응답을 받지 않을 때 표시할 메시지"를 맞춰 준다.
 * 계정/폼 종류에 따라 이 API 가 지원되지 않는 경우가 있는데,
 * 개폐와는 무관한 문구일 뿐이므로 실패해도 조용히 넘긴다.
 * (필요하면 폼 설정 → 응답 에서 한 번 직접 적어 두면 계속 유지된다)
 */
function applyClosedMessage_(form, msg, label, warnings) {
  if (!form || !msg) return;
  try { form.setCustomClosedFormMessage(msg); } catch (err) { /* 무시 */ }
}

/** 과목 하나를 열고 닫는다. A안·B안 폼을 함께 적용한다. */
function toggleSubject_(cfg, s, open, warnings) {
  var any = false;
  ['A', 'B'].forEach(function (k) {
    var link = s[k].editLink;
    if (!link) return;
    any = true;
    var label = s.name + (s.hasB ? ' ' + k + '안' : '');
    var form = openForm_(link, label);
    setAccepting_(form, open, label);
    if (!open) applyClosedMessage_(form, String(cfg['평가마감안내'] || '').trim(), label, warnings);
  });
  if (!any) warnings.push(s.name + ' 은(는) 폼 편집링크가 없어 화면 표시만 바뀝니다');
  setSubjectCell_(s, '개방', open ? '예' : '아니오');
}

function toggleSurvey_(cfg, open, warnings) {
  var form = null;
  var edit = String(cfg['설문폼_편집링크'] || '').trim();
  if (edit) {
    form = openForm_(edit, '설문폼');
    setAccepting_(form, open, '설문');
  } else {
    warnings.push('설문 폼 편집링크가 없어 화면 표시만 바뀝니다');
  }
  setConfig_('설문개방', open ? '예' : '아니오');
  setConfig_('개방기준일', todayKey_());
  if (!open) applyClosedMessage_(form, String(cfg['설문마감안내'] || '').trim(), '설문', warnings);
}

function toggleAny_(cfg, target, name, open) {
  var warnings = [];
  if (target === 'survey') {
    toggleSurvey_(cfg, open, warnings);
  } else if (target === 'subjects') {
    var all = subjects_(cfg);
    if (!all.length) throw new Error('과목 시트에 등록된 평가 과목이 없습니다.');
    all.forEach(function (s) { toggleSubject_(cfg, s, open, warnings); });
  } else if (target === 'subject') {
    var want = String(name || '').trim();
    var hit = null;
    subjects_(cfg).forEach(function (s) { if (s.name === want) hit = s; });
    if (!hit) throw new Error('과목을 찾을 수 없습니다: ' + want);
    toggleSubject_(cfg, hit, open, warnings);
  } else {
    throw new Error('대상이 올바르지 않습니다: ' + target);
  }
  CacheService.getScriptCache().remove(STATE_CACHE_KEY);
  return { warning: warnings.join(' / '), state: publicState_(readConfig_()) };
}

/* ===================================================================
 *  집계 공용 유틸
 * =================================================================== */

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
  m = s.match(/^(-?\d+(?:\.\d+)?)\s*점/);
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
  var roster = {};
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

/** 과목·안(案) 에 해당하는 응답 시트를 찾는다. 못 찾으면 null. */
function findVariantSheet_(ss, subj, which, variantCount) {
  var v = subj[which];
  var reserved = [SETTINGS_SHEET, SUBJECTS_SHEET, ROSTER_SHEET];
  if (v.sheetName) return ss.getSheetByName(v.sheetName);

  var cands = ss.getSheets().filter(function (sh) {
    return reserved.indexOf(sh.getName()) === -1;
  });
  if (!cands.length) return null;

  var found = null, i;
  // 과목명 + 안 표기가 둘 다 들어간 시트를 먼저 찾는다
  for (i = 0; i < cands.length; i++) {
    var nm = cands[i].getName();
    if (nm.indexOf(subj.name) !== -1 && new RegExp(which + '\\s*안', 'i').test(nm)) { found = cands[i]; break; }
  }
  if (!found && !subj.hasB) {
    for (i = 0; i < cands.length; i++) {
      if (cands[i].getName().indexOf(subj.name) !== -1) { found = cands[i]; break; }
    }
  }
  if (!found && v.editLink) found = matchSheetByQuestions_(cands, v.editLink, subj.name + ' ' + which + '안');
  if (!found && variantCount === 1) {
    var single = cands.filter(function (sh) { return /응답|Response/i.test(sh.getName()); });
    if (single.length === 1) found = single[0];
  }
  if (found) { try { setSubjectCell_(subj, v.cols.sheet, found.getName()); } catch (e) { /* 무시 */ } }
  return found;
}

/** 폼 문항 제목과 시트 헤더가 가장 많이 겹치는 시트를 고른다. */
function matchSheetByQuestions_(cands, editLink, label) {
  var titles = {}, n = 0;
  try {
    openForm_(editLink, label).getItems().forEach(function (it) {
      var t = String(it.getTitle() || '').trim();
      if (t && !titles[t]) { titles[t] = true; n++; }
    });
  } catch (e) { return null; }
  if (!n) return null;

  var best = null, bestHit = 0;
  cands.forEach(function (sh) {
    var lastCol = sh.getLastColumn();
    if (lastCol < 1) return;
    var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var hit = 0;
    header.forEach(function (h) { if (titles[String(h).trim()]) hit++; });
    if (hit > bestHit) { bestHit = hit; best = sh; }
  });
  return (best && bestHit >= Math.max(1, Math.ceil(n / 2))) ? best : null;
}

/* ===================================================================
 *  과목별 집계 (A안 + B안 을 한 과목으로 합친다)
 * =================================================================== */

/** 시트 하나를 읽어 번호별 제출을 모두 모은다(최초 제출 선별은 집계 단계에서). */
function readVariant_(sh, cfg, day, dateSet, out) {
  var values = sh.getLastRow() > 0 ? sh.getDataRange().getValues() : [];
  var header = values.length ? values[0].map(function (h) { return String(h); }) : [];
  if (!header.length) { out.warnings.push(sh.getName() + ' 시트가 비어 있습니다.'); return; }
  var rows = values.length > 1 ? values.slice(1) : [];

  var noIdx = findNoColumn_(header, cfg['번호열']);
  var score = findScoreColumns_(header, rows, noIdx, cfg['점수열']);
  var tsIdx = -1;
  for (var h = 0; h < header.length; h++) { if (isTimestampHeader_(header[h])) { tsIdx = h; break; } }

  if (day && tsIdx < 0) {
    out.warnings.push(sh.getName() + ' 시트에 타임스탬프 열이 없어 날짜별 조회를 할 수 없습니다.');
    return;
  }
  var avgMode = String(cfg['점수계산'] || '합계').trim() === '평균';

  rows.forEach(function (row) {
    if (row.every(function (c) { return c === '' || c === null; })) return;

    var vals = [];
    score.idxs.forEach(function (i) {
      var v = toNumber_(row[i]);
      if (v !== null) vals.push(v);
      if (score.mode === 'quiz' && out.maxScore === null) {
        var mx = quizMax_(row[i]);
        if (mx !== null) out.maxScore = mx;
      }
    });
    var sc = null;
    if (vals.length) {
      if (score.mode === 'quiz') sc = vals[0];
      else {
        var sum = vals.reduce(function (a, b) { return a + b; }, 0);
        sc = avgMode ? sum / vals.length : sum;
      }
    }

    var at = tsIdx >= 0 && row[tsIdx] ? new Date(row[tsIdx]) : null;
    var key0 = dayKey_(at);
    if (key0 && dateSet) dateSet[key0] = true;
    if (day && key0 !== day) return;

    var p = parseNo_(row[noIdx]);
    if (!p) {
      out.unknown.push({ raw: String(row[noIdx] || ''), score: sc,
                         at: at ? at.toISOString() : null, plan: out.which });
      return;
    }
    var key = p.g + '-' + p.n;
    if (!out.all[key]) out.all[key] = [];
    out.all[key].push({ g: p.g, n: p.n, no: key, score: sc,
                        at: at ? at.toISOString() : null, plan: out.which });
  });
}

/** 번호별로 가장 먼저 제출한 것만 인정하고, 뒤에 들어온 것은 무시 목록에 남긴다. */
function pickFirst_(out) {
  Object.keys(out.all).forEach(function (key) {
    var arr = out.all[key].slice().sort(function (a, b) {
      var ta = a.at ? Date.parse(a.at) : Infinity;
      var tb = b.at ? Date.parse(b.at) : Infinity;
      return ta - tb;
    });
    var first = arr[0];
    first.count = arr.length;
    if (arr.length > 1) {
      first.ignored = arr.slice(1).map(function (e) {
        return { at: e.at, plan: e.plan, score: e.score };
      });
      out.duplicates += arr.length - 1;
    }
    out.first[key] = first;
  });
}

function aggregateSubject_(ss, cfg, subj, roster, day, dateSet, used, regByGroup) {
  var pattern = cfg['안배정'] === undefined ? 'ABBA' : cfg['안배정'];
  var base = {
    name: subj.name, open: subj.open, hasB: !!subj.hasB,
    formLinked: !!(subj.A.editLink || subj.B.editLink),
    maxScore: subj.maxScore, sheets: {}, warning: '',
    totals: { expected: 0, registered: 0, missing: 0, submitted: 0, average: null },
    groups: [], unknown: [], wrongPlan: [], dupes: [], missing: [], duplicates: 0
  };

  var out = { all: {}, first: {}, unknown: [], duplicates: 0,
              maxScore: (subj.maxScore === null || subj.maxScore === undefined) ? null : subj.maxScore,
              warnings: [], which: 'A' };

  var variants = subj.hasB ? ['A', 'B'] : ['A'];
  var any = false;
  variants.forEach(function (k) {
    out.which = k;
    var sh = findVariantSheet_(ss, subj, k, variants.length);
    if (!sh) {
      out.warnings.push((subj.hasB ? k + '안 ' : '') +
        '응답 시트를 찾지 못했습니다. 폼 응답을 스프레드시트에 연결한 뒤 과목 시트의 ' +
        '"' + subj[k].cols.sheet + '" 칸에 시트 이름을 적어 주십시오.');
      return;
    }
    var nm = sh.getName();
    if (used[nm]) {
      out.warnings.push('"' + nm + '" 시트를 이미 [' + used[nm] + ']이(가) 사용하고 있습니다.');
      return;
    }
    used[nm] = subj.name + (subj.hasB ? ' ' + k + '안' : '');
    base.sheets[k] = nm;
    any = true;
    readVariant_(sh, cfg, day, dateSet, out);
  });

  pickFirst_(out);

  base.maxScore = (out.maxScore === null || out.maxScore === undefined) ? null : out.maxScore;
  base.dupes = Object.keys(out.first)
    .filter(function (k) { return out.first[k].count > 1; })
    .map(function (k) {
      var f = out.first[k];
      return { no: k, count: f.count, keptAt: f.at, keptPlan: f.plan,
               ignored: f.ignored || [] };
    })
    .sort(function (a, b) { return b.count - a.count; });
  base.unknown = out.unknown;
  base.duplicates = out.duplicates;
  if (out.warnings.length) base.warning = out.warnings.join(' / ');

  if (!any) {
    base.groups = emptyGroups_(roster, pattern);
    base.totals.expected = countRoster_(roster);
    return base;
  }

  // 자기 조에 배정된 안이 아닌 폼으로 제출한 경우를 표시한다
  if (subj.hasB) {
    Object.keys(out.first).forEach(function (k) {
      var m = out.first[k];
      var should = planFor_(m.g, pattern);
      if (m.plan && m.plan !== should) {
        base.wrongPlan.push({ no: m.no, submitted: m.plan, should: should, at: m.at });
      }
    });
  }

  var groupKeys = {};
  Object.keys(roster).forEach(function (g) { groupKeys[g] = true; });
  Object.keys(out.first).forEach(function (k) { groupKeys[out.first[k].g] = true; });

  base.groups = Object.keys(groupKeys).sort(function (a, b) { return Number(a) - Number(b); })
    .map(function (g) {
      var slots = roster[g] ? roster[g].slice() : [];
      var members = Object.keys(out.first)
        .filter(function (k) { return out.first[k].g === g; })
        .map(function (k) { return out.first[k]; })
        .sort(function (a, b) { return a.n - b.n; });
      var scored = members.filter(function (m) { return m.score !== null; });
      var avg = scored.length
        ? scored.reduce(function (a, m) { return a + m.score; }, 0) / scored.length : null;

      // 오늘 번호를 등록한 사람 기준으로 미제출자를 뽑는다(정원이 아니라 실제 입소 인원)
      var reg = (regByGroup && regByGroup[g]) ? regByGroup[g].slice() : [];
      var done = {};
      members.forEach(function (m) { done[m.n] = true; });
      var missing = reg.filter(function (n) { return !done[n]; });

      return {
        group: g, plan: planFor_(g, pattern),
        slots: slots, expected: slots.length, submitted: members.length,
        registered: reg.length,
        regSlots: reg,
        missing: missing,
        average: round_(avg, 2),
        avgRaw: avg,                      // 순위 계산은 반올림 전 값으로 한다
        members: members.map(function (m) {
          return { no: m.no, n: m.n, score: m.score, at: m.at, plan: m.plan,
                   count: m.count || 1 };
        })
      };
    });

  var allScored = Object.keys(out.first).map(function (k) { return out.first[k]; })
    .filter(function (m) { return m.score !== null; });
  base.missing = [];
  base.groups.forEach(function (g) {
    g.missing.forEach(function (n) { base.missing.push(g.group + '-' + n); });
  });
  base.totals = {
    expected: base.groups.reduce(function (a, g) { return a + g.expected; }, 0),
    registered: base.groups.reduce(function (a, g) { return a + g.registered; }, 0),
    missing: base.missing.length,
    submitted: Object.keys(out.first).length,
    average: allScored.length
      ? round_(allScored.reduce(function (a, m) { return a + m.score; }, 0) / allScored.length, 2)
      : null
  };
  if (!base.maxScore) {
    base.warning = (base.warning ? base.warning + ' / ' : '') +
      '만점을 알 수 없어 종합 순위에서 제외됩니다. 과목 시트의 "만점" 칸을 채워 주십시오.';
  }
  return base;
}

function emptyGroups_(roster, pattern) {
  return Object.keys(roster).sort(function (a, b) { return Number(a) - Number(b); })
    .map(function (g) {
      return {
        group: g, plan: planFor_(g, pattern),
        slots: roster[g].slice(), expected: roster[g].length,
        registered: 0, regSlots: [], missing: [],
        submitted: 0, average: null, avgRaw: null, members: []
      };
    });
}

function countRoster_(roster) {
  var n = 0;
  Object.keys(roster).forEach(function (g) { n += roster[g].length; });
  return n;
}

/* ===================================================================
 *  종합 (과목별 득점률 평균)
 * =================================================================== */

function combine_(perSubject, roster, pattern) {
  var names = {};
  Object.keys(roster).forEach(function (g) { names[g] = true; });
  perSubject.forEach(function (s) {
    (s.groups || []).forEach(function (g) { names[g.group] = true; });
  });

  var missingMax = perSubject.filter(function (s) { return !s.maxScore; })
    .map(function (s) { return s.name; });

  var groups = Object.keys(names).sort(function (a, b) { return Number(a) - Number(b); })
    .map(function (g) {
      var expected = roster[g] ? roster[g].length : 0;
      var raw = [];
      var detail = perSubject.map(function (s) {
        var grp = null;
        (s.groups || []).forEach(function (x) { if (x.group === g) grp = x; });
        // 반올림 전 평균으로 득점률을 내고, 표시용으로만 반올림한다
        var exact = grp ? (grp.avgRaw === undefined ? grp.average : grp.avgRaw) : null;
        var rateExact = (exact !== null && exact !== undefined && s.maxScore)
          ? (exact / s.maxScore) * 100 : null;
        if (rateExact !== null) raw.push(rateExact);
        return {
          name: s.name,
          average: grp ? grp.average : null,
          rate: round_(rateExact, 1),
          submitted: grp ? grp.submitted : 0,
          expected: grp ? grp.expected : expected
        };
      });
      // 응시하지 않은 과목은 평균에서 제외한다 (안 본 것이 불이익이 되지 않도록)
      var overall = raw.length
        ? round_(raw.reduce(function (a, b) { return a + b; }, 0) / raw.length, 1) : null;
      // 등록 기록이 있으면 '등록자 전원 제출'을 완료 기준으로 쓴다
      // (입소 인원이 매번 달라지므로 정원보다 등록이 정확하다)
      var regN = 0;
      perSubject.forEach(function (s) {
        (s.groups || []).forEach(function (x) { if (x.group === g) regN = Math.max(regN, x.registered || 0); });
      });
      var need = regN > 0 ? regN : expected;
      var complete = need > 0 && detail.every(function (d) { return d.submitted >= need; });
      return { group: g, plan: planFor_(g, pattern), expected: expected,
               subjects: detail, overall: overall, complete: complete };
    });

  return { groups: groups, missingMax: missingMax };
}

function dashboard_(cfg, day) {
  /* 전날 개방 설정이 남아 있으면 조용히 전부 닫는다.
     자동마감 트리거가 돌지 않았을 때의 보정이다. */
  var baseDay = claimDayOf_(cfg['개방기준일']);
  if (baseDay && baseDay !== todayKey_()) {
    try { autoCloseAll(); cfg = readConfig_(); } catch (e) { /* 집계는 계속한다 */ }
  }

  var ss = SpreadsheetApp.getActive();
  var roster = buildRoster_(ss, cfg);
  var subs = subjects_(cfg);
  var pattern = cfg['안배정'] === undefined ? 'ABBA' : cfg['안배정'];
  // 오늘 등록(선점)된 번호를 조별로 모아 둔다 — 미제출자 판정의 기준
  var claims = readClaims_(day);
  var regByGroup = {};
  Object.keys(claims).forEach(function (no) {
    var p = parseNo_(no);
    if (!p) return;
    if (!regByGroup[p.g]) regByGroup[p.g] = [];
    regByGroup[p.g].push(p.n);
  });
  Object.keys(regByGroup).forEach(function (g) {
    regByGroup[g].sort(function (a, b) { return a - b; });
  });

  var dateSet = {}, used = {};
  var perSubject = subs.map(function (s) {
    return aggregateSubject_(ss, cfg, s, roster, day, dateSet, used, regByGroup);
  });

  var maxG = parseInt(cfg['조개수'], 10) || 50;
  subs.forEach(function (sj, i) {
    var og = subjectOpen_(cfg, sj, maxG);
    perSubject[i].openGroups = og.list;
    perSubject[i].openGroupsText = og.text;
  });

  // 등록은 했지만 아직 아무 과목도 제출하지 않은 번호
  var submitted = {};
  perSubject.forEach(function (s) {
    (s.groups || []).forEach(function (g) {
      (g.members || []).forEach(function (m) { submitted[m.no] = true; });
    });
  });
  var pending = Object.keys(claims).filter(function (no) { return !submitted[no]; })
    .sort(function (a, b) {
      var pa = parseNo_(a), pb = parseNo_(b);
      return (Number(pa.g) - Number(pb.g)) || (pa.n - pb.n);
    });

  return {
    updatedAt: new Date().toISOString(),
    date: day || '',
    today: todayKey_(),
    availableDates: Object.keys(dateSet).sort().reverse(),
    claims: { count: Object.keys(claims).length, pending: pending },
    groupCount: maxG,
    planPattern: String(pattern || ''),
    autoCloseHour: String(cfg['자동마감시각'] || ''),
    lastAutoClose: stampText_(cfg['마지막자동마감']),
    survey: { open: truthy_(cfg['설문개방']) },
    subjects: perSubject,
    combined: combine_(perSubject, roster, pattern),
    rosterTotal: countRoster_(roster)
  };
}

/* ===================================================================
 *  설문 결과 집계 (무기명)
 * =================================================================== */

var SURVEY_CACHE_KEY = 'survey_results_v1';
var SURVEY_CACHE_SEC = 20;
var TEXT_ANSWER_LIMIT = 300;

function cachedSurvey_(cfg, day) {
  var cache = CacheService.getScriptCache();
  var key = SURVEY_CACHE_KEY + '|' + (day || 'all');
  var hit = cache.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* 무시 */ } }
  var r = surveyResults_(cfg, day);
  try { cache.put(key, JSON.stringify(r), SURVEY_CACHE_SEC); } catch (e) { /* 용량 초과 */ }
  return r;
}

function surveyResults_(cfg, day) {
  var edit = String(cfg['설문폼_편집링크'] || '').trim();
  if (!edit) throw new Error('설정 시트의 "설문폼_편집링크" 가 비어 있습니다.');
  var form = openForm_(edit, '설문폼');
  var items = form.getItems();
  var questions = [], byId = {};

  items.forEach(function (item) {
    var q = buildQuestion_(item);
    if (!q) return;
    byId[item.getId()] = q;
    questions.push(q);
  });

  var all = form.getResponses();
  var dateSet = {};
  var responses = all.filter(function (fr) {
    var k = dayKey_(fr.getTimestamp());
    if (k) dateSet[k] = true;
    return !day || k === day;
  });

  responses.forEach(function (fr) {
    fr.getItemResponses().forEach(function (ir) {
      var q = byId[ir.getItem().getId()];
      if (!q) return;
      tally_(q, ir.getResponse());
    });
  });

  questions.forEach(finishQuestion_);

  return {
    updatedAt: new Date().toISOString(),
    date: day || '', today: todayKey_(),
    availableDates: Object.keys(dateSet).sort().reverse(),
    formTitle: form.getTitle(),
    accepting: form.isAcceptingResponses(),
    responseCount: responses.length,
    totalAllTime: all.length,
    questions: questions
  };
}

function buildQuestion_(item) {
  var type = String(item.getType());
  var q = { title: item.getTitle(), type: type, answered: 0, options: [], rows: [], answers: [] };

  if (type === 'MULTIPLE_CHOICE' || type === 'LIST' || type === 'CHECKBOX') {
    var ci = type === 'MULTIPLE_CHOICE' ? item.asMultipleChoiceItem()
           : type === 'LIST' ? item.asListItem() : item.asCheckboxItem();
    ci.getChoices().forEach(function (c) { q.options.push({ label: c.getValue(), count: 0 }); });
    q.multi = (type === 'CHECKBOX');
    return q;
  }
  if (type === 'SCALE') {
    var si = item.asScaleItem();
    q.min = si.getLowerBound();
    q.max = si.getUpperBound();
    q.minLabel = si.getLeftLabel() || '';
    q.maxLabel = si.getRightLabel() || '';
    for (var v = q.min; v <= q.max; v++) q.options.push({ label: String(v), count: 0 });
    q.sum = 0;
    return q;
  }
  if (type === 'GRID' || type === 'CHECKBOX_GRID') {
    var gi = (type === 'GRID') ? item.asGridItem() : item.asCheckboxGridItem();
    var cols = gi.getColumns();
    gi.getRows().forEach(function (r) {
      q.rows.push({ label: r, answered: 0,
                    options: cols.map(function (c) { return { label: c, count: 0 }; }) });
    });
    return q;
  }
  if (type === 'TEXT' || type === 'PARAGRAPH_TEXT') return q;
  return null;
}

function bump_(options, label) {
  var t = String(label === null || label === undefined ? '' : label).trim();
  if (!t) return;
  for (var i = 0; i < options.length; i++) {
    if (options[i].label === t) { options[i].count++; return; }
  }
  options.push({ label: t, count: 1, other: true });
}

function tally_(q, v) {
  if (v === null || v === undefined || v === '') return;

  if (q.type === 'CHECKBOX') {
    var arr = [].concat(v).filter(function (x) { return String(x).trim(); });
    if (!arr.length) return;
    q.answered++;
    arr.forEach(function (x) { bump_(q.options, x); });
    return;
  }
  if (q.type === 'MULTIPLE_CHOICE' || q.type === 'LIST') {
    q.answered++; bump_(q.options, v); return;
  }
  if (q.type === 'SCALE') {
    var n = parseFloat(v);
    if (isNaN(n)) return;
    q.answered++; q.sum += n; bump_(q.options, String(n));
    return;
  }
  if (q.type === 'GRID' || q.type === 'CHECKBOX_GRID') {
    var rows = [].concat(v);
    for (var i = 0; i < q.rows.length && i < rows.length; i++) {
      var cell = rows[i];
      if (cell === null || cell === undefined || cell === '') continue;
      q.rows[i].answered++;
      [].concat(cell).forEach(function (x) { bump_(q.rows[i].options, x); });
    }
    q.answered++;
    return;
  }
  q.answered++;
  if (q.answers.length < TEXT_ANSWER_LIMIT) q.answers.push(String(v).slice(0, 500));
}

function finishQuestion_(q) {
  if (q.type === 'SCALE' && q.answered > 0) q.average = round_(q.sum / q.answered, 2);
  delete q.sum;
  var base = q.answered || 0;
  q.options.forEach(function (o) { o.pct = base ? round_((o.count / base) * 100, 1) : 0; });
  q.rows.forEach(function (r) {
    var b = r.answered || 0;
    r.options.forEach(function (o) { o.pct = b ? round_((o.count / b) * 100, 1) : 0; });
  });
  if (!q.rows.length) delete q.rows;
  if (!q.options.length) delete q.options;
  if (!q.answers.length) delete q.answers;
}

/* ===================================================================
 *  자동 마감
 * ===================================================================
 *  하루가 끝나면 전 과목·설문을 닫아 다음 회차에 열린 채로 남지 않게 한다.
 *  시트 메뉴에서 매일 실행되는 트리거를 걸어 둔다.
 * =================================================================== */

function autoCloseAll() {
  var cfg = readConfig_();
  var notes = [];
  try {
    var r = setOpenGroups_(cfg, '*', '없음');
    notes.push('평가 ' + r.applied.length + '과목 마감' + (r.warning ? ' (' + r.warning + ')' : ''));
  } catch (err) { notes.push('평가 마감 실패: ' + ((err && err.message) ? err.message : err)); }

  var w = [];
  try { toggleSurvey_(readConfig_(), false, w); notes.push('설문 마감'); }
  catch (err) { notes.push('설문 마감 실패: ' + ((err && err.message) ? err.message : err)); }

  setConfig_('마지막자동마감',
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));
  CacheService.getScriptCache().remove(STATE_CACHE_KEY);
  return notes.join(' / ');
}

function menuAutoCloseOn() {
  var cfg = readConfig_();
  var hour = parseInt(cfg['자동마감시각'], 10);
  if (isNaN(hour) || hour < 0 || hour > 23) {
    SpreadsheetApp.getUi().alert('설정 시트의 "자동마감시각" 에 0~23 사이 숫자를 적어 주십시오.');
    return;
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'autoCloseAll') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('autoCloseAll').timeBased().everyDays(1).atHour(hour).create();
  SpreadsheetApp.getUi().alert('자동 마감 켜짐',
    '매일 ' + hour + '시경 전 과목과 설문을 자동으로 닫습니다.\n' +
    '(구글 정책상 ' + hour + '시~' + ((hour + 1) % 24) + '시 사이에 실행됩니다)',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuAutoCloseOff() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'autoCloseAll') { ScriptApp.deleteTrigger(t); n++; }
  });
  SpreadsheetApp.getUi().alert(n ? '자동 마감을 해제했습니다.' : '걸려 있는 자동 마감이 없었습니다.');
}

function menuAutoCloseNow() {
  SpreadsheetApp.getUi().alert('지금 전부 마감', autoCloseAll(), SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ===================================================================
 *  번호 등록(선점)
 * ===================================================================
 *  예비군이 첫 화면에서 조-번을 확정하면 그 번호를 그 날짜에 잠근다.
 *  다른 사람은 같은 번호로 등록할 수 없고, 교관만 풀어 줄 수 있다.
 * =================================================================== */

function claimsSheet_(create) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CLAIMS_SHEET);
  if (!sh && create) {
    sh = ss.insertSheet(CLAIMS_SHEET);
    sh.getRange(1, 1, 1, CLAIM_HEADER.length).setValues([CLAIM_HEADER])
      .setFontWeight('bold').setBackground('#1f3554').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidth(5, 160).setColumnWidth(6, 230);
  }
  if (sh) {
    // "1-10" 을 1월 10일로, "2026-10-17" 을 날짜로 바꿔 버리는 자동 변환을 막는다
    try { sh.getRange(1, 1, sh.getMaxRows(), 2).setNumberFormat('@'); } catch (e) { /* 무시 */ }
  }
  return sh;
}

/* 시트가 값을 날짜로 바꿔 저장해 버린 경우까지 견디도록 관대하게 읽는다. */
/* 시트가 Date 로 바꿔 저장했을 수도 있는 '시각' 값을 읽기 좋게 */
function stampText_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  }
  return String(v);
}

function claimDayOf_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return dayKey_(v);
  var t = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  var d = new Date(t);
  return isNaN(d.getTime()) ? t : dayKey_(d);
}

/** 번호는 조·번 숫자 열에서 되살린다(번호 칸이 날짜로 변질돼도 안전). */
function claimNoOf_(row) {
  var g = parseInt(row[2], 10), n = parseInt(row[3], 10);
  if (g > 0 && n > 0) return g + '-' + n;
  var p = parseNo_(row[1]);
  return p ? p.g + '-' + p.n : '';
}

/** 해당 날짜의 등록 현황을 번호별로 읽는다. */
function readClaims_(day) {
  var sh = claimsSheet_(false);
  var map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, CLAIM_HEADER.length).getValues();
  v.forEach(function (r, i) {
    var no = claimNoOf_(r);
    if (!no) return;
    if (day && claimDayOf_(r[0]) !== day) return;
    if (map[no]) return;                        // 먼저 등록한 것이 주인
    var at = r[4] ? new Date(r[4]) : null;
    map[no] = {
      token: String(r[5] || ''),
      at: (at && !isNaN(at.getTime())) ? at.toISOString() : null,
      row: i + 2
    };
  });
  return map;
}

/** 등록 현황 캐시. 등록·해제 때마다 반드시 비운다. */
function dropClaimsCache_() {
  try { CacheService.getScriptCache().remove(CLAIMS_CACHE_KEY + '_' + todayKey_()); } catch (e) { /* 무시 */ }
}

function cachedClaims_(day) {
  var cache = CacheService.getScriptCache();
  var key = CLAIMS_CACHE_KEY + '_' + day;
  try {
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  } catch (e) { /* 무시 */ }
  var map = readClaims_(day);
  try { cache.put(key, JSON.stringify(map), CLAIMS_CACHE_SEC); } catch (e) { /* 무시 */ }
  return map;
}

/** 이 기기가 아직 그 번호의 주인인지 확인한다(쓰지 않는다).
 *  mine === null 은 '판단 불가'로, 폰은 아무 것도 지우지 않는다. */
function claimStatus_(g, n, token) {
  var p = parseNo_(String(g) + '-' + String(n));
  var day = todayKey_();
  if (!p) return { no: '', date: day, claimed: false, mine: null };
  var no = p.g + '-' + p.n;
  var tk = String(token === null || token === undefined ? '' : token).trim();
  if (!tk) return { no: no, date: day, claimed: false, mine: null };
  var cur = cachedClaims_(day)[no];
  return {
    no: no, date: day,
    claimed: !!cur,
    mine: !!(cur && cur.token && cur.token === tk),
    at: cur ? cur.at : null
  };
}

function claimNumber_(cfg, g, n, token) {
  var p = parseNo_(String(g) + '-' + String(n));
  if (!p) throw new Error('번호가 올바르지 않습니다.');
  var maxG = parseInt(cfg['조개수'], 10) || 50;
  var maxN = parseInt(cfg['조별인원'], 10) || 10;
  if (Number(p.g) < 1 || Number(p.g) > maxG) throw new Error('조는 1~' + maxG + ' 사이여야 합니다.');
  if (p.n < 1 || p.n > maxN) throw new Error('번은 1~' + maxN + ' 사이여야 합니다.');

  var day = todayKey_();
  var no = p.g + '-' + p.n;
  var tk = String(token === null || token === undefined ? '' : token).trim() || 'unknown';

  var lock = LockService.getScriptLock();
  var locked = false;
  try { locked = lock.tryLock(5000); } catch (e) { /* 혼잡하면 그냥 진행 */ }
  try {
    var cur = readClaims_(day)[no];
    if (cur && cur.token && cur.token !== tk) {
      return { ok: false, taken: true, no: no, date: day, at: cur.at };
    }
    if (!cur) {
      var csh = claimsSheet_(true);
      csh.appendRow([day, no, Number(p.g), p.n, new Date(), tk, '']);
      // 혹시라도 날짜로 변질되지 않도록 방금 쓴 두 칸을 문자열로 다시 박아 둔다
      try {
        var rw = csh.getLastRow();
        csh.getRange(rw, 1, 1, 2).setNumberFormat('@').setValues([[day, no]]);
      } catch (e) { /* 무시 */ }
      dropClaimsCache_();
    }
    return { ok: true, taken: false, no: no, date: day };
  } finally { if (locked) lock.releaseLock(); }
}

/** 교관이 번호 등록을 풀어 준다. 지운 건수를 돌려준다. */
function releaseClaim_(no, day) {
  var sh = claimsSheet_(false);
  if (!sh || sh.getLastRow() < 2) return 0;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, CLAIM_HEADER.length).getValues();
  var rows = [];
  v.forEach(function (r, i) {
    if (claimNoOf_(r) !== no) return;
    if (day && claimDayOf_(r[0]) !== day) return;
    rows.push(i + 2);
  });
  rows.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
  if (rows.length) dropClaimsCache_();
  return rows.length;
}

/* ===================================================================
 *  번호 초기화 (교관용)
 * =================================================================== */

/** 번호가 일치하는 행들을 찾아 돌려준다(삭제하지 않음). */
function findNumberRows_(sh, cfg, p, day, plan) {
  var values = sh.getLastRow() > 1 ? sh.getDataRange().getValues() : [];
  if (values.length < 2) return [];
  var header = values[0].map(function (h) { return String(h); });
  var rows = values.slice(1);
  var noIdx = findNoColumn_(header, cfg['번호열']);
  var score = findScoreColumns_(header, rows, noIdx, cfg['점수열']);
  var tsIdx = -1;
  for (var h = 0; h < header.length; h++) { if (isTimestampHeader_(header[h])) { tsIdx = h; break; } }
  var avgMode = String(cfg['점수계산'] || '합계').trim() === '평균';

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var q = parseNo_(values[r][noIdx]);
    if (!q || q.g !== p.g || q.n !== p.n) continue;
    var at = (tsIdx >= 0 && values[r][tsIdx]) ? new Date(values[r][tsIdx]) : null;
    if (day && dayKey_(at) !== day) continue;
    var vals = [];
    score.idxs.forEach(function (i) {
      var v = toNumber_(values[r][i]);
      if (v !== null) vals.push(v);
    });
    var sc = null;
    if (vals.length) {
      if (score.mode === 'quiz') sc = vals[0];
      else {
        var sum = vals.reduce(function (a, b) { return a + b; }, 0);
        sc = avgMode ? sum / vals.length : sum;
      }
    }
    out.push({ row: r + 1, at: at ? at.toISOString() : null, score: sc, plan: plan });
  }
  out.sort(function (a, b) {
    var ta = a.at ? Date.parse(a.at) : Infinity, tb = b.at ? Date.parse(b.at) : Infinity;
    return ta - tb;
  });
  return out;
}

/**
 * 번호 하나의 현재 상태를 보여 준다.
 * 교관이 "등록만 풀지 / 어느 과목 기록까지 지울지" 를 보고 판단하게 한다.
 */
function lookupNumber_(cfg, no, day) {
  var p = parseNo_(no);
  if (!p) throw new Error('번호 형식이 올바르지 않습니다: ' + no + ' (예: 3-7)');
  if (!day) throw new Error('기준일을 먼저 고르십시오. "전체 기간"에서는 조회·삭제할 수 없습니다.');

  var key = p.g + '-' + p.n;
  var claim = readClaims_(day)[key];
  var ss = SpreadsheetApp.getActive();
  var out = {
    no: key, date: day,
    claimed: !!claim, claimedAt: claim ? claim.at : null,
    plan: planFor_(p.g, cfg['안배정'] === undefined ? 'ABBA' : cfg['안배정']),
    subjects: []
  };

  subjects_(cfg).forEach(function (s) {
    var variants = s.hasB ? ['A', 'B'] : ['A'];
    var rows = [];
    variants.forEach(function (k) {
      var sh = findVariantSheet_(ss, s, k, variants.length);
      if (!sh) return;
      rows = rows.concat(findNumberRows_(sh, cfg, p, day, k));
    });
    rows.sort(function (a, b) {
      var ta = a.at ? Date.parse(a.at) : Infinity, tb = b.at ? Date.parse(b.at) : Infinity;
      return ta - tb;
    });
    out.subjects.push({
      name: s.name,
      maxScore: s.maxScore,
      count: rows.length,
      at: rows.length ? rows[0].at : null,
      score: rows.length ? rows[0].score : null,
      plan: rows.length ? rows[0].plan : ''
    });
  });
  return out;
}

/**
 * 교관이 고른 범위만 정리한다.
 *   release = true          → 번호 등록을 풀어 다시 등록할 수 있게 한다
 *   subjectList = '안보교육' → 그 과목의 제출 기록만 지운다 (나머지 점수는 보존)
 * 둘 다 선택하지 않으면 아무것도 하지 않는다.
 */
function resetNumber_(cfg, no, day, release, subjectList) {
  var p = parseNo_(no);
  if (!p) throw new Error('번호 형식이 올바르지 않습니다: ' + no + ' (예: 3-7)');
  if (!day) throw new Error('기준일을 먼저 고르십시오. "전체 기간"에서는 삭제할 수 없습니다.');

  var want = {};
  var names = String(subjectList || '').split(',')
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return x; });
  names.forEach(function (n) { want[n] = true; });
  if (!release && !names.length) {
    throw new Error('무엇을 정리할지 하나도 고르지 않았습니다.');
  }

  var ss = SpreadsheetApp.getActive();
  var no2 = p.g + '-' + p.n;
  var removed = [];

  if (names.length) {
    var all = subjects_(cfg);
    var known = {};
    all.forEach(function (s) { known[s.name] = true; });
    names.forEach(function (n) { if (!known[n]) throw new Error('과목을 찾을 수 없습니다: ' + n); });

    all.filter(function (s) { return want[s.name]; }).forEach(function (s) {
      var variants = s.hasB ? ['A', 'B'] : ['A'];
      variants.forEach(function (k) {
        var sh = findVariantSheet_(ss, s, k, variants.length);
        if (!sh) return;
        var cnt = deleteAllRows_(sh, cfg, p, day);
        if (cnt) {
          removed.push({ subject: s.name + (s.hasB ? ' ' + k + '안' : ''),
                         sheet: sh.getName(), count: cnt });
        }
      });
    });
  }

  var released = release ? releaseClaim_(no2, day) : 0;
  CacheService.getScriptCache().remove(STATE_CACHE_KEY);

  if (!removed.length && !released) {
    throw new Error(no2 + ' 에서 지울 것이 없었습니다.\n' +
      '서버에 등록·제출 기록이 없는 번호입니다. 그 예비군의 폰에만 번호가 남아 있는 경우이니, ' +
      '폰에서 번호 옆 자물쇠(🔒)를 누르고 관리자 PIN 을 입력해 번호를 다시 고르게 하십시오.');
  }
  return { no: no2, date: day, removed: removed, released: released };
}

/** 번호가 일치하는 행을 모두 삭제한다. 삭제한 건수를 돌려준다. */
function deleteAllRows_(sh, cfg, p, day) {
  var values = sh.getLastRow() > 1 ? sh.getDataRange().getValues() : [];
  if (values.length < 2) return 0;
  var header = values[0].map(function (h) { return String(h); });
  var noIdx = findNoColumn_(header, cfg['번호열']);
  var tsIdx = -1;
  for (var h = 0; h < header.length; h++) { if (isTimestampHeader_(header[h])) { tsIdx = h; break; } }

  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var q = parseNo_(values[r][noIdx]);
    if (!q || q.g !== p.g || q.n !== p.n) continue;
    if (day) {
      var at = (tsIdx >= 0 && values[r][tsIdx]) ? new Date(values[r][tsIdx]) : null;
      if (dayKey_(at) !== day) continue;
    }
    rows.push(r + 1);
  }
  // 아래에서부터 지워야 행 번호가 밀리지 않는다
  rows.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
  return rows.length;
}

/**
 * 지금 시트와 폼이 실제로 어떤 상태인지 한 번에 보여 준다.
 * 메뉴는 편집기의 최신 코드로 실행되므로 배포 여부와 무관하다.
 */
function menuDiagnose() {
  var ss = SpreadsheetApp.getActive();
  var cfg = readConfig_();
  var L = [];
  L.push('[환경]');
  L.push('시트 이름 : ' + ss.getName());
  L.push('시트 ID   : ' + ss.getId());
  L.push('시간대    : ' + Session.getScriptTimeZone());
  L.push('오늘      : ' + todayKey_());
  L.push('');
  L.push('[설정 값]');
  ['설문개방', '개방조', '개방기준일', '마지막자동마감', '자동마감시각', '조개수', '안배정']
    .forEach(function (k) { L.push(k + ' = [' + String(cfg[k]) + ']'); });
  L.push('개방기준일(해석) = [' + claimDayOf_(cfg['개방기준일']) + ']  ← 오늘과 같아야 정상');
  L.push('');

  var sh = settingsSheet_();
  L.push('[설정 시트] ' + sh.getLastRow() + '행 x ' + sh.getLastColumn() + '열');
  var wide = Math.min(sh.getLastColumn(), 3);
  var rows = sh.getRange(1, 1, sh.getLastRow(), wide).getValues();
  rows.forEach(function (r, i) {
    var k = String(r[0]).trim();
    if (k === '설문개방' || k === '개방기준일' || k === '마지막자동마감') {
      L.push('  ' + (i + 1) + '행: ' + JSON.stringify(r));
    }
  });
  L.push('');

  L.push('[트리거]');
  var tg = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'autoCloseAll';
  });
  L.push('autoCloseAll 트리거 ' + tg.length + '개');
  L.push('');

  L.push('[설문 폼]');
  var edit = String(cfg['설문폼_편집링크'] || '').trim();
  if (!edit) { L.push('편집링크 없음'); }
  else {
    try {
      var f = openForm_(edit, '설문폼');
      L.push('제목      : ' + f.getTitle());
      L.push('응답 수락 : ' + f.isAcceptingResponses());
      try { L.push('게시 여부 : ' + (typeof f.isPublished === 'function' ? f.isPublished() : '(미지원)')); }
      catch (e) { L.push('게시 여부 : 확인 불가'); }
    } catch (err) { L.push('폼 열기 실패: ' + ((err && err.message) ? err.message : err)); }
  }

  var txt = L.join('\n');
  Logger.log(txt);                       // 편집기에서 실행하면 '실행 로그' 에 찍힌다
  // 시트 메뉴에서 실행했을 때만 창으로 보여 준다
  try { SpreadsheetApp.getUi().alert('진단', txt, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { /* 편집기 실행 — 로그로 충분하다 */ }
  return txt;
}

/** 편집기에서 직접 실행해 동작을 확인할 때 사용 */
function testDashboard() {
  Logger.log(JSON.stringify(dashboard_(readConfig_(), todayKey_()), null, 2));
}
