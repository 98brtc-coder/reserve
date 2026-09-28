/* 첫 화면: 부대명/공지 표시, 구글폼 링크 연결, 평가·설문 개방 여부 반영 */
(function () {
  var CFG = UNIT.CFG;
  var el = function (id) { return document.getElementById(id); };

  el('unitName').textContent = CFG.unitName || '예비군훈련대';
  el('footUnit').textContent = CFG.unitName || '';
  document.title = (CFG.unitName ? CFG.unitName + ' ' : '') + '평가 · 설문';

  if (CFG.notice) {
    el('notice').textContent = CFG.notice;
    el('notice').hidden = false;
  }

  var cards = {
    eval: { card: el('evalCard'), pill: el('evalPill'), url: CFG.evalFormUrl || '', closedMsg: '' },
    survey: { card: el('surveyCard'), pill: el('surveyPill'), url: CFG.surveyFormUrl || '', closedMsg: '' },
  };

  function apply(key, open) {
    var c = cards[key];
    if (open && c.url) {
      c.card.href = c.url;
      c.card.classList.remove('closed');
      c.pill.textContent = '진행 중';
      c.pill.className = 'pill open';
      c.card.onclick = null;
    } else {
      c.card.classList.add('closed');
      c.card.removeAttribute('href');
      c.pill.textContent = c.url ? '마감' : '준비 중';
      c.pill.className = 'pill shut';
      c.card.onclick = function (e) {
        e.preventDefault();
        alert(c.closedMsg || '아직 열려 있지 않습니다. 교관 안내에 따라 주십시오.');
      };
    }
  }

  // API 가 없으면 config.js 의 링크만으로 동작(개폐 제어 없음)
  if (!UNIT.hasApi()) {
    ['eval', 'survey'].forEach(function (k) {
      apply(k, !!cards[k].url);
      if (cards[k].url) cards[k].pill.hidden = true;
    });
    return;
  }

  UNIT.api('state').then(function (s) {
    if (s.unitName) { el('unitName').textContent = s.unitName; el('footUnit').textContent = s.unitName; }
    if (s.notice) { el('notice').textContent = s.notice; el('notice').hidden = false; }
    if (s.evalFormUrl) cards.eval.url = s.evalFormUrl;
    if (s.surveyFormUrl) cards.survey.url = s.surveyFormUrl;
    cards.eval.closedMsg = s.evalClosedMessage || '';
    cards.survey.closedMsg = s.surveyClosedMessage || '';
    apply('eval', !!s.evalOpen);
    apply('survey', !!s.surveyOpen);
  }).catch(function (err) {
    // 서버 확인 실패 시에도 최소한 링크는 살려 둔다
    ['eval', 'survey'].forEach(function (k) {
      apply(k, !!cards[k].url);
      cards[k].pill.textContent = '확인 불가';
      cards[k].pill.className = 'pill';
    });
    console.warn('상태 확인 실패:', err);
  });
})();
