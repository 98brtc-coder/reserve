/* =====================================================================
 *  부대 설정 파일  ―  이 파일만 수정하면 됩니다.
 * =====================================================================
 *  apiUrl 만 넣어두면 평가/설문 링크와 개방 여부는 구글 시트의
 *  "설정" 탭에서 관리됩니다. (Apps Script 배포 후 받은 /exec 주소)
 *  apiUrl 없이 쓰려면 아래 두 폼 주소만 채우면 링크 연결만 동작합니다.
 * ===================================================================== */
window.UNIT_CONFIG = {
  // 부대명 (화면 상단에 표시)
  unitName: "서산 과학화 예비군훈련대",

  // Apps Script 웹앱 주소 (https://script.google.com/macros/s/..../exec)
  apiUrl: "https://script.google.com/macros/s/AKfycbx2RlT5vvrI8dEdbTp3oncyhZ_VPdy9kWWmzAU7MVWfv6FXRXC-KthyEI6kSwOftg/exec",

  // 구글폼 "응시용" 링크 (설정 시트에 편집링크를 넣으면 자동으로 덮어씁니다)
  evalFormUrl: "",
  surveyFormUrl: "",

  // 첫 화면에 띄울 공지 (비워두면 표시 안 됨)
  notice: "",

  // 관리자 화면 자동 새로고침 간격(초)
  refreshSeconds: 15,
};
