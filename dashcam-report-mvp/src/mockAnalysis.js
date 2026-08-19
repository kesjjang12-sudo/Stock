/**
 * Mock AI 분석 레이어.
 *
 * MVP 단계에서는 실제 영상 업로드 / OCR / 위반 판정이 없다.
 * 대신 "서버 왕복 + 추론"이 있었다고 가정한 만큼의 지연(2초)만 흉내 내고
 * 고정된 결과를 돌려준다.
 *
 * 나중에 진짜 백엔드가 붙으면 이 파일의 analyzeClip() 시그니처
 * (Promise<AnalysisResult>)만 유지한 채 내부만 fetch 로 갈아끼우면 되도록
 * UI 와 분리해 뒀다.
 */

export const MOCK_CLIP = {
  id: 'clip_20260819_1432',
  deviceName: 'FineVu GX1000 (전방)',
  durationSec: 42,
  receivedAgoMin: 3,
  sizeMb: 128,
};

/** 위반 유형은 신고서 문구를 만들 때도 쓰이므로 코드/라벨을 함께 들고 다닌다. */
export const VIOLATION_TYPE = {
  code: 'ILLEGAL_LANE_CHANGE',
  label: '진로변경 위반 (실선 구간 차선변경)',
};

const ANALYSIS_DELAY_MS = 2000;

/** 'YYYY-MM-DD HH:mm' — 안전신문고 신고서 양식에 붙여넣기 좋은 형태 */
function formatDateTime(date) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}`
  );
}

/**
 * @returns {Promise<{
 *   plateNumber: string,
 *   violatedAt: Date,
 *   violatedAtText: string,
 *   location: string,
 *   coords: { lat: number, lng: number },
 *   violationType: { code: string, label: string },
 *   confidence: number,
 *   vehicle: string,
 * }>}
 */
export function analyzeClip(_clip = MOCK_CLIP) {
  return new Promise((resolve) => {
    setTimeout(() => {
      // 위반 시각 = 분석 시점 기준 10분 전
      const violatedAt = new Date(Date.now() - 10 * 60 * 1000);

      resolve({
        plateNumber: '12가 3456',
        violatedAt,
        violatedAtText: formatDateTime(violatedAt),
        location: '서울특별시 강남구 테헤란로 123',
        coords: { lat: 37.5006, lng: 127.0366 },
        violationType: VIOLATION_TYPE,
        confidence: 0.94, // 번호판 OCR 신뢰도 (가상)
        vehicle: '흰색 승용차',
      });
    }, ANALYSIS_DELAY_MS);
  });
}

/**
 * 클립보드에 넣을 신고 초안.
 * 안전신문고 앱의 '내용' 입력란에 그대로 붙여넣을 수 있도록 한 덩어리로 만든다.
 */
export function buildReportDraft(result) {
  return [
    `[차량번호] ${result.plateNumber}`,
    `[위반일시] ${result.violatedAtText}`,
    `[위반장소] ${result.location}`,
    `[위반내용] ${result.violationType.label}`,
    '',
    `${result.violatedAtText}경 ${result.location} 부근에서`,
    `${result.vehicle}(${result.plateNumber}) 차량이 ${result.violationType.label} 행위를 하여 신고합니다.`,
    '블랙박스 영상 첨부합니다.',
  ].join('\n');
}
