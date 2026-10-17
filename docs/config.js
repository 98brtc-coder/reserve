/* =====================================================================
 *  부대 설정 파일
 * =====================================================================
 *  부대명 · 안내문구 · 개방여부 · A/B안 배정은 모두 구글 시트에서 관리됩니다.
 *  아래 값은 "서버 응답 전에 화면을 먼저 그리기 위한 예비 정보"입니다.
 *  과목을 추가하거나 B안 폼을 만들면 이 목록도 함께 고쳐 주십시오.
 * ===================================================================== */
window.UNIT_CONFIG = {
  unitName: "서산 과학화 예비군훈련대",

  apiUrl: "https://script.google.com/macros/s/AKfycbyV4B0UNY4aQ8s3VlGVBAP_rOTKN6KvNv-H4a_rhXWcLHbPQjefg7GdgM71IBoalcusWA/exec",

  refreshSeconds: 15,

  // 상태 확인이 이 시간(ms)을 넘기면 예비 정보로 응시를 허용한다
  fallbackAfterMs: 2500,

  // 조 선택 목록의 기본값 (서버 값이 오면 교체됩니다)
  groupCount: 50,
  memberCount: 10,
  planPattern: "ABBA",

  // urlA = A안 응시링크, urlB = B안 응시링크 (B안이 없으면 비워 둡니다)
  subjects: [
    { name: "안보교육",       urlA: "https://docs.google.com/forms/d/e/1FAIpQLSfcQo-f729Gqr9VCvDkdXevX09n9RP2paF3RdLWdJhQnJAXzg/viewform", urlB: "" },
    { name: "전투부상자처치", urlA: "https://docs.google.com/forms/d/e/1FAIpQLSd1DODca9hTt_qk93nXEz-Rxg9FxOvq71zq8Z-_4zcQXZ6jkw/viewform", urlB: "" },
    { name: "전시동원절차",   urlA: "https://docs.google.com/forms/d/e/1FAIpQLSfwYkz9Owvy68Kb2z_1QEhOIOZffyfEAwR7apsycJrCKZk3Cg/viewform", urlB: "" },
  ],
  surveyFormUrl: "https://docs.google.com/forms/d/e/1FAIpQLSeIQuvTNPj9r-MasFQIC0M27jKyl1SEAp9JVhoGtWONPoZzPg/viewform",

  notice: "",
};
