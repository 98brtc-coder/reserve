/* Apps Script 웹앱과 통신하는 공용 클라이언트 */
(function () {
  var CFG = window.UNIT_CONFIG || {};

  function hasApi() {
    return !!(CFG.apiUrl && /^https:\/\/script\.google\.com\//.test(CFG.apiUrl));
  }

  function unwrap(j) {
    if (!j || j.ok !== true) throw new Error((j && j.error) || '알 수 없는 오류가 발생했습니다.');
    return j.data;
  }

  /* POST(text/plain)로 먼저 시도하고, 막히면 GET으로 재시도한다.
     text/plain 으로 보내야 Apps Script 에서 CORS 사전요청(preflight)이 생기지 않는다. */
  var postBlocked = false;   // POST 가 한 번 막히면 이후로는 바로 GET 을 쓴다

  async function api(action, params) {
    if (!hasApi()) throw new Error('config.js 의 apiUrl 이 아직 설정되지 않았습니다.');
    var payload = Object.assign({ action: action }, params || {});
    if (!postBlocked) {
      try {
        var res = await fetch(CFG.apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
        });
        if (res.ok) return unwrap(await res.json());
        postBlocked = true;
      } catch (e) { postBlocked = true; }   // 왕복 두 번을 반복하지 않는다
    }

    var u = new URL(CFG.apiUrl);
    Object.keys(payload).forEach(function (k) { u.searchParams.set(k, payload[k]); });
    var res2 = await fetch(u.toString());
    if (!res2.ok) throw new Error('서버 응답 오류 (' + res2.status + ')');
    return unwrap(await res2.json());
  }

  function fmt(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return '-';
    return Number(n).toFixed(digits === undefined ? 1 : digits);
  }

  function timeText(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var p = function (x) { return String(x).padStart(2, '0'); };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* index.html 의 선행 요청 결과를 먼저 쓰고, 없거나 실패하면 정상 경로로 조회한다 */
  async function fetchState() {
    var early = window.__earlyState;
    if (early) {
      window.__earlyState = null;
      try { return unwrap(await early); } catch (e) { /* 아래에서 재시도 */ }
    }
    return api('state', { t: Date.now() });
  }

  window.UNIT = { CFG: CFG, api: api, hasApi: hasApi, fmt: fmt, timeText: timeText, fetchState: fetchState };
})();
