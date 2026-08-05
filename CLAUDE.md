# 섹터 자금흐름 대시보드 — 프로젝트 컨텍스트

## 개요
빅테크/반도체/소프트웨어/금융/2차전지·에너지/헬스케어 섹터의 자금흐름·뉴스 언급량을 추적하는 대시보드.
프레임워크 없음, 순수 HTML/CSS/JS 정적 사이트. GitHub Pages 배포 대상.
- `index.html` — 레이아웃
- `app.js` — 데이터 + 렌더링 전체 로직
- `styles.css` — Toss 스타일 디자인 시스템

## 디자인 톤 (Toss UI)
- 배경 `--bg`(연회색) 위에 흰 카드(`--card`), radius 14~20px, 옅은 그림자
- 상승=빨강(`--up`), 하락=파랑(`--down`) — 한국 증권앱 관례
- 폰트: Pretendard (CDN)
- 세그먼트 탭, 필(pill) 배지, 바텀시트형 모달(`.modal-box`)

## 데이터 상태
`Code.gs`(GAS 백엔드)가 네이버금융 실시간 시세 + `frgn.naver` 수급 페이지 + 네이버 뉴스 검색 API를 10분 주기로 수집해서 자체 생성 스프레드시트(`StockDashboard_DB`)에 저장한다. `app.js`는 설정(⚙️)에 저장된 GAS 웹앱 URL/SECRET_KEY로 `?action=dashboard`를 호출해서 `SECTORS`/`EVENTS`를 채운다.
연동 안 됐거나 fetch 실패 시 `MOCK_SECTORS`/`MOCK_EVENTS`(샘플)로 폴백하고 상단 배너(`renderStatusBanner`)로 DEMO/LIVE/오류 상태를 항상 표시한다 — 실데이터로 착각해서 매매 판단에 쓰이는 걸 막기 위한 장치이니 이 배너는 절대 없애지 말 것.

## 데이터 소스 세부사항
- KR 실시간 시세: `https://polling.finance.naver.com/api/realtime/domestic/stock/{code}`
- US 실시간 시세: `https://api.stock.naver.com/stock/{reutersCode}/basic` (reutersCode는 `https://ac.stock.naver.com/ac?q={심볼}&target=stock` 검색 결과의 `reutersCode` 필드 사용 — NASDAQ는 보통 `.O`, 일부 NYSE는 접미사 없음/`.K`, 티커마다 다르므로 새 종목 추가 시 반드시 이 검색으로 확인)
- KR 수급(외국인/기관): `https://finance.naver.com/item/frgn.naver?code={code}` HTML 파싱 (정규식, `Code.gs`의 `fetchKrFlow_` 참고) — 미국 종목은 이런 공개 수급 데이터 자체가 없어 `flow: null`
- 뉴스 언급량: 네이버 뉴스 검색 오픈API, 섹터별 대표 키워드로 최근 24시간 건수 집계 (Client ID/Secret 필요, 없으면 0건 처리)
- 하락 이벤트: 섹터 평균 등락률이 `DROP_THRESHOLD_PCT`(-2.5%) 이하면 자동 로깅, outcome(반등 여부)은 28일 뒤 `backfillOutcomes`가 계산

## 새 섹터/종목 추가 시
1. `Code.gs`의 `SECTOR_CONFIG`에 kr/us 종목 추가 (US는 위 방법으로 reutersCode 먼저 확인)
2. `app.js`의 `MOCK_SECTORS`에도 동일 구조로 추가 (연동 전 샘플 화면용)
3. 필드명(`netFlow`, `flowChangePct`, `newsVolume`, `newsChangePct`, `changePct`, `flow`, `divergence` 등)은 프론트/백엔드 둘 다 그대로 유지

## 코딩 규칙
- 전체 리팩토링보다 최소 변경 우선, 그러나 이 레포는 아직 초기 단계라 구조 변경에 유연함
- 새 섹터/종목 추가 시 `SECTORS` 배열 구조만 그대로 따르면 됨
- 금액 단위는 "억원"으로 통일 (US 종목도 환산 표기), fmtFlow()/fmtPct() 사용

## GitHub
- Repo: https://github.com/kesjjang12-sudo/stock
- Branch: main (직접 push, PR 없이 진행)
