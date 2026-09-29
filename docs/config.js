/* =====================================================================
 *  부대 설정 파일  ―  이 파일만 수정하면 됩니다.
 * =====================================================================
 *  부대명 · 안내문구 · 개방여부는 구글 시트에서 관리됩니다.
 *  아래 subjects / surveyFormUrl 은 "즉시 표시용 예비 정보"입니다.
 *  덕분에 최초 접속에서도 Apps Script 응답을 기다리지 않고 배너가 보이고,
 *  동시 접속이 몰려 서버 응답이 늦어도 화면이 죽지 않습니다.
 *  과목을 추가·변경했으면 이 목록도 함께 고쳐 주십시오.
 * ===================================================================== */
window.UNIT_CONFIG = {
  unitName: "서산 과학화 예비군훈련대",

  apiUrl: "https://script.google.com/macros/s/AKfycbyV4B0UNY4aQ8s3VlGVBAP_rOTKN6KvNv-H4a_rhXWcLHbPQjefg7GdgM71IBoalcusWA/exec",

  refreshSeconds: 15,

  // 상태 확인이 이 시간(ms)을 넘기면 예비 정보로 응시를 허용한다
  fallbackAfterMs: 2500,

  subjects: [
    { name: "안보교육",       url: "https://docs.google.com/forms/d/e/1FAIpQLSfcQo-f729Gqr9VCvDkdXevX09n9RP2paF3RdLWdJhQnJAXzg/viewform" },
    { name: "전투부상자처치", url: "https://docs.google.com/forms/d/e/1FAIpQLSd1DODca9hTt_qk93nXEz-Rxg9FxOvq71zq8Z-_4zcQXZ6jkw/viewform" },
    { name: "전시동원절차",   url: "https://docs.google.com/forms/d/e/1FAIpQLSfwYkz9Owvy68Kb2z_1QEhOIOZffyfEAwR7apsycJrCKZk3Cg/viewform" },
  ],
  surveyFormUrl: "https://docs.google.com/forms/d/e/1FAIpQLSeIQuvTNPj9r-MasFQIC0M27jKyl1SEAp9JVhoGtWONPoZzPg/viewform",

  notice: "",
};
