/**
 * =====================================================================
 *  예비군 평가 · 설문 관리 백엔드 (Google Apps Script)
 * =====================================================================
 *  평가 과목 여러 개를 각각 열고 닫으며, 조별 득점률 평균으로
 *  종합 순위(우수 조)를 산출한다.
 *
 *  설치: 응답 스프레드시트 → 확장 프로그램 → Apps Script → 붙여넣기
 *        → setup() 실행 → 배포 → 웹 앱(실행: 나 / 액세스: 모든 사용자)
 * =====================================================================
 */

var SETTINGS_SHEET = '설정';
var SUBJECTS_SHEET = '과목';
var ROSTER_SHEET = '명단';
var STATE_CACHE_KEY = 'public_state_v2';
var STATE_CACHE_SEC = 5;

var DEFAULTS = [
  ['부대명', '서산 과학화 예비군훈련대', '첫 화면 상단에 표시됩니다.'],
  ['관리자PIN', '1234', '교관용 로그인 PIN. 반드시 변경하십시오.'],
  ['설문폼_편집링크', '', '설문 구글폼의 편집 주소(.../edit).'],
  ['설문폼_응시링크', '', '비워두면 편집링크에서 자동으로 채워집니다.'],
  ['설문개방', '아니오', '예 / 아니오. 관리자 화면에서 바뀝니다.'],
  ['평가마감안내', '평가 시간이 아닙니다. 교관 안내에 따라 주십시오.', '평가 마감 시 문구.'],
  ['설문마감안내', '설문 시간이 아닙니다. 교관 안내에 따라 주십시오.', '설문 마감 시 문구.'],
  ['공지', '', '첫 화면 공지. 비워두면 표시되지 않습니다.'],
  ['조개수', '10', '전체 조 수(m). 명단 시트가 있으면 명단이 우선합니다.'],
  ['조별인원', '10', '조당 인원(n).'],
  ['번호열', '', '번호(조-번) 열 제목. 비우면 자동 탐색.'],
  ['점수열', '', '점수 열 제목/번호를 쉼표로. 비우면 자동 탐색.'],
  ['점수계산', '합계', '합계 / 평균 — 점수열이 여러 개일 때.']
];

var SUBJECT_HEADER = ['과목명', '폼_편집링크', '폼_응시링크', '응답시트', '만점', '개방'];
var SUBJECT_DEFAULTS = [
  ['안보교육', '', '', '', '', '아니오'],
  ['전투부상자처치', '', '', '', '', '아니오'],
  ['전시동원절차', '', '', '', '', '아니오']
];

/* ===================================================================
 *  설치 · 메뉴
 * =================================================================== */

function setup() {
  var ss = SpreadsheetApp.getActive();
  ensureKeyValueSheet_(ss, SETTINGS_SHEET, DEFAULTS);
  ensureTableSheet_(ss, SUBJECTS_SHEET, SUBJECT_HEADER, SUBJECT_DEFAULTS);
  ss.toast('설정 / 과목 시트를 준비했습니다. 값을 채운 뒤 배포하십시오.', '설치 완료', 8);
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
    sh.setColumnWidth(1, 150).setColumnWidth(2, 330).setColumnWidth(3, 420);
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

function ensureTableSheet_(ss, name, header, defaults) {
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name, 1);
  sh.getRange(1, 1, 1, header.length).setValues([header])
    .setFontWeight('bold').setBackground('#4a5d3a').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.getRange(2, 1, defaults.length, header.length).setValues(defaults);
  sh.setColumnWidth(1, 160).setColumnWidth(2, 330).setColumnWidth(3, 330).setColumnWidth(4, 200);
  return sh;
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('예비군 평가')
    .addItem('설정 / 과목 시트 준비', 'setup')
    .addSeparator()
    .addItem('평가 전체 열기', 'menuAllOpen')
    .addItem('평가 전체 닫기', 'menuAllClose')
    .addItem('설문 열기', 'menuSurveyOpen')
    .addItem('설문 닫기', 'menuSurveyClose')
    .addSeparator()
    .addItem('종합 순위 보기', 'menuSummary')
    .addToUi();
}

function menuAllOpen() { menuToggle_('subjects', '', true); }
function menuAllClose() { menuToggle_('subjects', '', false); }
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

function menuSummary() {
  var d = dashboard_(readConfig_());
  var lines = [];
  d.combined.groups.slice()
    .sort(function (a, b) { return (b.overall === null ? -1 : b.overall) - (a.overall === null ? -1 : a.overall); })
    .forEach(function (g, i) {
      lines.push((i + 1) + '위  ' + g.group + '조   종합 ' +
                 (g.overall === null ? '-' : g.overall + '%') +
                 (g.complete ? '' : '  (미완)'));
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

    var cfg = readConfig_();
    requirePin_(cfg, p.pin);

    if (action === 'ping') return json_({ ok: true, data: { auth: true } });
    if (action === 'dashboard') return json_({ ok: true, data: dashboard_(cfg) });
    if (action === 'toggle') {
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
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
 *  설정 · 과목 읽기/쓰기
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
    if (String(keys[i][0]).trim() === key) { sh.getRange(i + 2, 2).setValue(value); return; }
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([[key, value]]);
}

/** 과목 시트를 읽는다. 없으면 구버전 설정(평가폼_편집링크)으로 1과목 구성. */
function subjects_(cfg) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SUBJECTS_SHEET);
  var list = [];
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, SUBJECT_HEADER.length).getValues()
      .forEach(function (r, i) {
        var name = String(r[0] || '').trim();
        if (!name) return;
        list.push({
          row: i + 2, name: name,
          editLink: String(r[1] || '').trim(),
          viewLink: String(r[2] || '').trim(),
          sheetName: String(r[3] || '').trim(),
          maxScore: toNumber_(r[4]),
          open: truthy_(r[5])
        });
      });
  }
  if (list.length) return list;

  var legacy = String(cfg['평가폼_편집링크'] || '').trim();
  if (!legacy) return [];
  return [{
    row: 0, legacy: true, name: '평가',
    editLink: legacy,
    viewLink: String(cfg['평가폼_응시링크'] || '').trim(),
    sheetName: String(cfg['평가응답시트'] || '').trim(),
    maxScore: toNumber_(cfg['만점']),
    open: truthy_(cfg['평가개방'])
  }];
}

function setSubjectCell_(subj, colName, value) {
  if (subj.legacy) {
    if (colName === '개방') setConfig_('평가개방', value);
    if (colName === '폼_응시링크') setConfig_('평가폼_응시링크', value);
    return;
  }
  var sh = SpreadsheetApp.getActive().getSheetByName(SUBJECTS_SHEET);
  if (!sh) return;
  var col = SUBJECT_HEADER.indexOf(colName) + 1;
  if (col > 0 && subj.row > 1) sh.getRange(subj.row, col).setValue(value);
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
  return {
    unitName: String(cfg['부대명'] || ''),
    notice: String(cfg['공지'] || ''),
    evalClosedMessage: String(cfg['평가마감안내'] || ''),
    subjects: subjects_(cfg).map(function (s) {
      return { name: s.name, open: s.open, url: subjectViewUrl_(s) };
    }),
    survey: {
      open: truthy_(cfg['설문개방']),
      url: surveyViewUrl_(cfg),
      closedMessage: String(cfg['설문마감안내'] || '')
    }
  };
}

function subjectViewUrl_(s) {
  if (s.viewLink) return s.viewLink;
  if (!s.editLink) return '';
  try {
    var url = openForm_(s.editLink, s.name).getPublishedUrl();
    setSubjectCell_(s, '폼_응시링크', url);
    return url;
  } catch (err) { return ''; }
}

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
}

function applyClosedMessage_(form, msg, label, warnings) {
  if (!form || !msg) return;
  try {
    form.setCustomClosedFormMessage(msg);
  } catch (err) {
    warnings.push(label + ' 마감 안내 문구는 적용하지 못했습니다(개폐는 정상 처리됨)');
  }
}

function toggleSubject_(cfg, s, open, warnings) {
  var form = null;
  if (s.editLink) {
    form = openForm_(s.editLink, s.name);
    setAccepting_(form, open, s.name);
  } else {
    warnings.push(s.name + ' 은(는) 폼 편집링크가 없어 화면 표시만 바뀝니다');
  }
  setSubjectCell_(s, '개방', open ? '예' : '아니오');
  if (!open) applyClosedMessage_(form, String(cfg['평가마감안내'] || '').trim(), s.name, warnings);
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

/** 과목에 해당하는 응답 시트를 찾는다. 못 찾으면 null. */
function findSubjectSheet_(ss, subj) {
  var reserved = [SETTINGS_SHEET, SUBJECTS_SHEET, ROSTER_SHEET];
  if (subj.sheetName) return ss.getSheetByName(subj.sheetName);
  var sheets = ss.getSheets(), i;
  for (i = 0; i < sheets.length; i++) {
    var n = sheets[i].getName();
    if (reserved.indexOf(n) !== -1) continue;
    if (n.indexOf(subj.name) !== -1) return sheets[i];
  }
  var cands = sheets.filter(function (s) {
    var nm = s.getName();
    return reserved.indexOf(nm) === -1 && /응답|Response/i.test(nm);
  });
  if (cands.length === 1) return cands[0];
  return null;
}

/* ===================================================================
 *  과목별 집계
 * =================================================================== */

function aggregateSubject_(ss, cfg, subj, roster) {
  var base = {
    name: subj.name,
    open: subj.open,
    formLinked: !!subj.editLink,
    maxScore: subj.maxScore,
    sheetName: '',
    warning: '',
    totals: { expected: 0, submitted: 0, average: null },
    groups: [],
    unknown: [],
    duplicates: 0
  };

  var sh = findSubjectSheet_(ss, subj);
  if (!sh) {
    base.warning = '응답 시트를 찾지 못했습니다. 과목 시트의 "응답시트" 칸에 시트 이름을 적어 주십시오.';
    base.groups = emptyGroups_(roster);
    base.totals.expected = countRoster_(roster);
    return base;
  }
  base.sheetName = sh.getName();

  var values = sh.getLastRow() > 0 ? sh.getDataRange().getValues() : [];
  var header = values.length ? values[0].map(function (h) { return String(h); }) : [];
  var rows = values.length > 1 ? values.slice(1) : [];

  if (!header.length) {
    base.warning = '응답 시트가 비어 있습니다.';
    base.groups = emptyGroups_(roster);
    base.totals.expected = countRoster_(roster);
    return base;
  }

  var noIdx = findNoColumn_(header, cfg['번호열']);
  var score = findScoreColumns_(header, rows, noIdx, cfg['점수열']);
  var tsIdx = -1;
  for (var h = 0; h < header.length; h++) { if (isTimestampHeader_(header[h])) { tsIdx = h; break; } }

  var avgMode = String(cfg['점수계산'] || '합계').trim() === '평균';
  var maxScore = subj.maxScore;

  var latest = {}, unknown = [], duplicates = 0;

  rows.forEach(function (row) {
    if (row.every(function (c) { return c === '' || c === null; })) return;

    var vals = [];
    score.idxs.forEach(function (i) {
      var v = toNumber_(row[i]);
      if (v !== null) vals.push(v);
      if (score.mode === 'quiz' && (maxScore === null || maxScore === undefined)) {
        var mx = quizMax_(row[i]);
        if (mx !== null) maxScore = mx;
      }
    });
    var s = null;
    if (vals.length) {
      if (score.mode === 'quiz') s = vals[0];
      else {
        var sum = vals.reduce(function (a, b) { return a + b; }, 0);
        s = avgMode ? sum / vals.length : sum;
      }
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

  var groupKeys = {};
  Object.keys(roster).forEach(function (g) { groupKeys[g] = true; });
  Object.keys(latest).forEach(function (k) { groupKeys[latest[k].g] = true; });

  base.groups = Object.keys(groupKeys).sort(function (a, b) { return Number(a) - Number(b); })
    .map(function (g) {
      var slots = roster[g] ? roster[g].slice() : [];
      var members = Object.keys(latest)
        .filter(function (k) { return latest[k].g === g; })
        .map(function (k) { return latest[k]; })
        .sort(function (a, b) { return a.n - b.n; });
      var scored = members.filter(function (m) { return m.score !== null; });
      var avg = scored.length
        ? scored.reduce(function (a, m) { return a + m.score; }, 0) / scored.length : null;
      return {
        group: g, slots: slots, expected: slots.length, submitted: members.length,
        average: round_(avg, 2),
        members: members.map(function (m) { return { no: m.no, n: m.n, score: m.score, at: m.at }; })
      };
    });

  var allScored = Object.keys(latest).map(function (k) { return latest[k]; })
    .filter(function (m) { return m.score !== null; });
  base.totals = {
    expected: base.groups.reduce(function (a, g) { return a + g.expected; }, 0),
    submitted: Object.keys(latest).length,
    average: allScored.length
      ? round_(allScored.reduce(function (a, m) { return a + m.score; }, 0) / allScored.length, 2)
      : null
  };
  base.maxScore = (maxScore === null || maxScore === undefined) ? null : maxScore;
  base.unknown = unknown;
  base.duplicates = duplicates;
  if (!base.maxScore) {
    base.warning = (base.warning ? base.warning + ' / ' : '') +
      '만점을 알 수 없어 종합 순위에서 제외됩니다. 과목 시트의 "만점" 칸을 채워 주십시오.';
  }
  return base;
}

function emptyGroups_(roster) {
  return Object.keys(roster).sort(function (a, b) { return Number(a) - Number(b); })
    .map(function (g) {
      return {
        group: g, slots: roster[g].slice(), expected: roster[g].length,
        submitted: 0, average: null, members: []
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

function combine_(perSubject, roster) {
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
      var detail = perSubject.map(function (s) {
        var grp = null;
        (s.groups || []).forEach(function (x) { if (x.group === g) grp = x; });
        var avg = grp ? grp.average : null;
        var rate = (avg !== null && s.maxScore) ? round_((avg / s.maxScore) * 100, 1) : null;
        return {
          name: s.name, average: avg, rate: rate,
          submitted: grp ? grp.submitted : 0,
          expected: grp ? grp.expected : expected
        };
      });
      var rates = detail.map(function (d) { return d.rate; })
        .filter(function (r) { return r !== null; });
      var overall = rates.length
        ? round_(rates.reduce(function (a, b) { return a + b; }, 0) / rates.length, 1) : null;
      var complete = expected > 0 && detail.every(function (d) { return d.submitted >= expected; });
      return { group: g, expected: expected, subjects: detail, overall: overall, complete: complete };
    });

  return { groups: groups, missingMax: missingMax };
}

function dashboard_(cfg) {
  var ss = SpreadsheetApp.getActive();
  var roster = buildRoster_(ss, cfg);
  var subs = subjects_(cfg);
  var perSubject = subs.map(function (s) { return aggregateSubject_(ss, cfg, s, roster); });

  return {
    updatedAt: new Date().toISOString(),
    survey: { open: truthy_(cfg['설문개방']) },
    subjects: perSubject,
    combined: combine_(perSubject, roster),
    rosterTotal: countRoster_(roster)
  };
}

/** 편집기에서 직접 실행해 동작을 확인할 때 사용 */
function testDashboard() {
  Logger.log(JSON.stringify(dashboard_(readConfig_()), null, 2));
}
