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
- 뉴스 언급량: **구글뉴스 RSS** (`news.google.com/rss/search`). API 키 불필요. 섹터마다 `newsQueryKr`(hl=ko) / `newsQueryUs`(hl=en) 두 쿼리를 `fetchAll`로 받아 최근 24시간 건수를 합산하고 `newsKr`/`newsUs`로 나눠 저장
  - 제목은 `"기사제목 - 매체명"` 형태에 HTML 엔티티가 섞여 있어 `cleanHeadline_`으로 정리
  - 네이버 뉴스 검색 API는 키 등록이 필요하고 한국어만 나와서 걷어냈다. 네이버 뉴스 *검색 페이지* 스크래핑은 클래스명이 난독화돼 있어(`sds-comps-*`) 불가
- 하락 이벤트: 섹터 평균 등락률이 `DROP_THRESHOLD_PCT`(-2.5%) 이하면 자동 로깅, outcome(반등 여부)은 28일 뒤 `backfillOutcomes`가 계산

## 알림 (웹 우선)
- `checkAlerts_`는 **카카오 연동 여부와 무관하게 항상** `AlertLog` 시트에 기록한다. 카카오가 연결돼 있으면 추가로 카톡을 보낼 뿐이다 — 이 순서를 바꾸면 웹 알림 탭이 비게 되니 주의
- `AlertLog` 스키마: `[date, sectorId, sectorName, type, sentAt, body]` (type: `drop` | `signal`)
- `getDashboard_`가 최근 30건을 `alerts`로 내려보내고, 프론트는 `stock_seen_alerts` localStorage로 안 읽음을 관리
- 뱃지는 `hidden` 속성으로 토글하는데, `.tab-badge`에 `display`가 지정돼 있어 `[hidden]`이 무력화된다 → `.tab-badge[hidden] { display: none; }` 규칙이 반드시 필요
- 브라우저 알림은 `Notification` API 사용. iOS Safari는 홈 화면 추가(PWA) 상태에서만 동작

## 카카오톡 알림 (선택, Code.gs 하단)
> 카카오톡은 단톡방/오픈채팅방 봇 공식 API가 없다. "나에게 보내기"와 친구 1:1만 가능.
> 단톡방이 필요하면 텔레그램/디스코드 그룹 봇으로 가야 한다.

- 스크립트 속성: `KAKAO_REST_KEY`(사용자 입력), `KAKAO_ACCESS_TOKEN` / `KAKAO_REFRESH_TOKEN` / `KAKAO_TOKEN_EXPIRES` / `KAKAO_ALERTS_ON`(자동 관리)
- OAuth 콜백을 GAS 웹앱 자신이 처리한다(`action=kakaoCallback`). 카카오 서버는 secret을 붙일 수 없으므로 authorize 단계에서 발급한 1회용 `state`(UUID)로 검증 — 이 경로만 `SECRET_KEY` 검사를 우회하므로 수정 시 주의
- 액세스 토큰 6시간 만료 → `kakaoAccessToken_()`이 만료 5분 전부터 리프레시 토큰으로 자동 재발급
- 알림 중복 방지: `AlertLog` 시트에 `date|sectorId|type` 기록. 한 실행당 `MAX_ALERTS_PER_RUN`(3건) 상한이 있어 초과분은 다음 실행으로 이월된다
- 카카오 텍스트 메시지 본문은 200자 제한 → `sendKakao_`가 195자로 자름
- 수급 데이터 없는 섹터(빅테크)와 뉴스 기준선 미완 섹터는 signal 알림에서 제외, drop 알림은 발송

## GAS 액션
`ping` · `dashboard` · `refresh` · `setup` · `status` · `kakaoAuth` / `kakaoCallback` / `kakaoStatus` / `kakaoTest` / `kakaoOff`
- `setup` — 편집기에 들어가지 않고 주소창만으로 트리거 등록 + 연동 점검. HTML로 결과를 뿌린다
- `status` — `triggerReady`(refreshAll 트리거 존재 여부), `lastSnapshotAt`/`lastSnapshotAgeMin`(시트가 마지막으로 갱신된 시각) 반환. **`dashboard`의 `updatedAt`은 호출 시각이라 갱신 여부 판단에 쓸 수 없다** — 트리거가 도는지 확인하려면 반드시 `status`를 봐야 한다
- `Code.gs`를 고친 뒤에는 **배포 관리 → 편집 → 버전 "새 버전" → 배포**로 올려야 반영된다. [새 배포]를 누르면 URL이 새로 발급돼 `app.js`의 `DEFAULT_GAS_URL`과 어긋나므로 쓰지 말 것

## 일/월/연 추이 (SectorDaily)
`SectorDaily` 시트 `[date, sectorId, market, netFlow, avgChangePct, stockCount]` — 시장을 행으로 분리해 국장/미장 세그먼트와 그대로 맞물린다.
- **수집 비용 0**: `refreshAll`은 이미 종목마다 20거래일치 수급 이력(`quotes.krFlow`)을 받아놓고 최신 하루만 쓰고 버렸다. `logSectorDailyFromQuotes_`가 그걸 저장할 뿐이라 추가 요청이 없다. 매번 최근 20거래일을 덮어써서 실행이 빠진 날짜도 저절로 메워진다
- **등락률은 연속한 두 종가로 계산**한다(`addKrDaily_`). 매매동향 페이지의 등락률 칸은 부호가 스타일로만 표시돼 텍스트만으로는 방향을 알 수 없다
- **미장 일별**은 `refreshAll`이 현재가만 받아서 안 쌓인다 → `syncUsDaily` 일 1회 트리거가 종목당 1요청으로 메운다
- **백필**: `action=backfill`이 섹터 단위로 처리하고 `BACKFILL_CURSOR`를 저장한다. 6분 제한에 걸리면 같은 주소를 다시 열어 이어서 진행. KR은 `frgn.naver` page 1~20(약 400거래일), US는 일별 시세 API page 1~7
- **US 시세 API의 `pageSize` 상한은 60**이다. 넘기면 JSON이 아니라 평문 에러를 돌려주므로 `parseUsPriceHistory_`가 빈 배열로 처리한다
- **집계 규칙**: 수급=합계, 뉴스=합계, **등락률=누적 수익률**(일별 수익률의 곱). 등락률을 평균이나 합으로 접으면 기간 수익률이 아닌 값이 나온다. 같은 날 KR/US 두 행이 있으면 `stockCount`로 가중해 하루치를 하나로 만든 뒤 곱한다
- 프론트 `trendChart()`는 막대만 SVG(`preserveAspectRatio="none"` + 고정 높이)로 그리고 **축 라벨은 HTML로 얹는다** — 라벨까지 viewBox에 넣으면 폰에서 같이 축소돼 못 읽는다

## 연동 설정 (기본값 내장)
기기마다 URL/키를 다시 입력하는 걸 없애려고 `app.js`에 `DEFAULT_GAS_URL` / `DEFAULT_GAS_KEY`를 박아뒀다. 저장소가 공개라 **이 키는 공개값**이며, 소유자가 편의를 위해 감수하기로 한 트레이드오프다 (링크를 아는 사람은 dashboard/refresh 호출 가능). GAS를 새로 배포하면 `Code.gs`의 `SECRET_KEY`와 여기를 **함께** 고쳐야 한다.
- `loadConfig()`는 localStorage 값이 없으면 기본값으로 폴백한다
- "연결 해제"는 `clearConfig()` → `stock_gas_off='1'` 플래그를 세워야 한다. 이게 없으면 지워도 기본값이 곧바로 되살아나 해제가 먹지 않는다 (`saveConfig()`는 이 플래그를 지운다)

## 국장/미장 분리 (프론트 전용)
백엔드는 한 섹터에 KR·US 종목을 함께 담아 내려준다. 분리는 `app.js`의 `viewSectors()`가 담당한다 — `marketFilter`(`all`|`kr`|`us`, localStorage `stock_market_filter`)에 따라 `stocks`를 시장별로 거르고 `netFlow`/`avgChangePct`/`newsVolume`을 다시 집계한 **파생 배열**을 만든다. 원본 `SECTORS`는 절대 건드리지 않는다(캐시/flash 비교가 원본 기준).
- 렌더 함수는 `SECTORS`가 아니라 `viewSectors()`를 참조해야 한다 (`sortedSectors`, `computeSignals`, `renderSignalPage`, `openSectorDetail`)
- 미장은 수급 공개 데이터가 없다 → 카드 대표 숫자가 평균 등락률로 바뀌고, 정렬은 `등락률순|뉴스언급순`만(`availableSortModes`), 선제 신호 탭은 안내 문구로 대체
- 해당 시장 종목이 0개인 섹터는 목록에서 제외 (국장 탭의 빅테크 등)
- 뉴스 건수는 `newsKr`/`newsUs`로 갈라지지만 `newsChangePct`(평소 대비)는 섹터 전체 기준 하나뿐 — 시장별로 나뉘지 않는다
- 알림·하락 히스토리는 시장 구분이 없는 데이터라 세그먼트를 `hidden`으로 숨긴다 → `.market-seg[hidden] { display: none; }` 규칙 필수 (`.tab-badge`와 같은 이유)

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
