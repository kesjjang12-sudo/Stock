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

## 데이터 상태 (중요)
`app.js` 상단 `SECTORS` / `EVENTS`는 **전부 샘플 데이터**다. 화면에는 항상 "DEMO/샘플 데이터" 배너를 노출해야 함 — 실데이터로 착각해서 매매 판단에 쓰이는 걸 방지하기 위함이니 실 연동 후에도 데이터 출처 표시는 유지할 것.

## 실데이터 연동 계획
1. Google Apps Script(신규 또는 accounting-app의 `Code.gs` 패턴 재사용)가 주기적으로(5~15분) 네이버금융 시세/수급 + 네이버 뉴스 검색 API를 수집해 캐싱
2. `app.js`에 `fetchSectorData()`/`fetchDropEvents()` async 함수 추가, GAS 웹앱 엔드포인트 호출
3. 기존 필드명(`netFlow`, `flowChangePct`, `newsVolume`, `newsChangePct`, `changePct`, `flow`, `divergence` 등) 유지하면 렌더링 코드는 그대로 재사용 가능
4. 외국인/연기금 수급은 무료 소스 기준 실시간이 아니라 D-1~당일 반영 수준임을 UI 문구에서 계속 명시할 것

## 코딩 규칙
- 전체 리팩토링보다 최소 변경 우선, 그러나 이 레포는 아직 초기 단계라 구조 변경에 유연함
- 새 섹터/종목 추가 시 `SECTORS` 배열 구조만 그대로 따르면 됨
- 금액 단위는 "억원"으로 통일 (US 종목도 환산 표기), fmtFlow()/fmtPct() 사용

## GitHub
- Repo: https://github.com/kesjjang12-sudo/stock
- Branch: main (직접 push, PR 없이 진행)
