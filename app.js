/* ============================================================
   설정 (GAS 연동)
   ============================================================ */

const CFG_URL_KEY = 'stock_gas_url';
const CFG_SECRET_KEY = 'stock_gas_secret';
const CACHE_KEY = 'stock_dashboard_cache';
const AUTO_REFRESH_MS = 8 * 60 * 1000;

function loadConfig() {
  return {
    url: localStorage.getItem(CFG_URL_KEY) || '',
    key: localStorage.getItem(CFG_SECRET_KEY) || '',
  };
}
function saveConfig(url, key) {
  localStorage.setItem(CFG_URL_KEY, url.trim());
  localStorage.setItem(CFG_SECRET_KEY, key.trim());
}
function isConfigured() {
  const c = loadConfig();
  return !!(c.url && c.key);
}

/* ============================================================
   샘플(mock) 데이터 — 연결 전/실패 시 폴백으로 사용
   ============================================================ */

const MOCK_FLOW_DATE = '2026-08-04';

const MOCK_SECTORS = [
  {
    id: 'bigtech', name: '빅테크', icon: '💻',
    netFlow: 0, flowChangePct: 0, flowDate: '',
    newsVolume: 128, newsChangePct: 14, newsBaselineReady: true,
    stocks: [
      { ticker: 'AAPL', name: '애플', market: 'US', changePct: 1.2, flow: null },
      { ticker: 'MSFT', name: '마이크로소프트', market: 'US', changePct: 0.8, flow: null },
      { ticker: 'GOOGL', name: '알파벳', market: 'US', changePct: -0.4, flow: null },
      { ticker: 'AMZN', name: '아마존', market: 'US', changePct: 2.1, flow: null },
      { ticker: 'META', name: '메타', market: 'US', changePct: 1.6, flow: null },
    ],
  },
  {
    id: 'semi', name: '반도체', icon: '🔧',
    netFlow: -860, flowChangePct: -62.4, flowDate: MOCK_FLOW_DATE,
    newsVolume: 96, newsChangePct: 41, newsBaselineReady: true,
    stocks: [
      { ticker: 'NVDA', name: '엔비디아', market: 'US', changePct: -2.8, flow: null },
      { ticker: '005930', name: '삼성전자', market: 'KR', changePct: -1.1, flow: -180 },
      { ticker: '000660', name: 'SK하이닉스', market: 'KR', changePct: -1.9, flow: -210 },
      { ticker: 'TSM', name: 'TSMC', market: 'US', changePct: -0.6, flow: null },
      { ticker: 'AMD', name: 'AMD', market: 'US', changePct: -1.3, flow: null },
    ],
  },
  {
    id: 'software', name: '소프트웨어', icon: '🖥️',
    netFlow: 410, flowChangePct: 38.5, flowDate: MOCK_FLOW_DATE,
    newsVolume: 54, newsChangePct: 6, newsBaselineReady: true,
    stocks: [
      { ticker: 'CRM', name: '세일즈포스', market: 'US', changePct: 0.9, flow: null },
      { ticker: 'ORCL', name: '오라클', market: 'US', changePct: 1.1, flow: null },
      { ticker: '035420', name: '네이버', market: 'KR', changePct: 0.5, flow: 60 },
      { ticker: '035720', name: '카카오', market: 'KR', changePct: -0.8, flow: -40 },
      { ticker: 'ADBE', name: '어도비', market: 'US', changePct: 1.4, flow: null },
    ],
  },
  {
    id: 'finance', name: '금융', icon: '🏦',
    netFlow: 300, flowChangePct: 71.2, flowDate: MOCK_FLOW_DATE,
    newsVolume: 38, newsChangePct: -12, newsBaselineReady: true,
    stocks: [
      { ticker: 'JPM', name: 'JP모건', market: 'US', changePct: 0.4, flow: null },
      { ticker: '105560', name: 'KB금융', market: 'KR', changePct: 0.6, flow: 80 },
      { ticker: '055550', name: '신한지주', market: 'KR', changePct: 0.3, flow: 40 },
      { ticker: '086790', name: '하나금융지주', market: 'KR', changePct: 0.2, flow: 30 },
      { ticker: 'BAC', name: '뱅크오브아메리카', market: 'US', changePct: 0.5, flow: null },
    ],
  },
  {
    id: 'battery', name: '2차전지·에너지', icon: '🔋',
    netFlow: -520, flowChangePct: -45.8, flowDate: MOCK_FLOW_DATE,
    newsVolume: 71, newsChangePct: 22, newsBaselineReady: true,
    stocks: [
      { ticker: 'TSLA', name: '테슬라', market: 'US', changePct: -2.2, flow: null },
      { ticker: '373220', name: 'LG에너지솔루션', market: 'KR', changePct: -1.7, flow: -160 },
      { ticker: '006400', name: '삼성SDI', market: 'KR', changePct: -1.5, flow: -90 },
      { ticker: 'ENPH', name: '엔페이즈', market: 'US', changePct: -3.1, flow: null },
    ],
  },
  {
    id: 'health', name: '헬스케어·바이오', icon: '🧬',
    netFlow: 260, flowChangePct: 24.6, flowDate: MOCK_FLOW_DATE,
    newsVolume: 29, newsChangePct: 3, newsBaselineReady: true,
    stocks: [
      { ticker: 'LLY', name: '일라이릴리', market: 'US', changePct: 1.3, flow: null },
      { ticker: '207940', name: '삼성바이오로직스', market: 'KR', changePct: 0.7, flow: 70 },
      { ticker: '068270', name: '셀트리온', market: 'KR', changePct: -0.3, flow: -20 },
      { ticker: 'UNH', name: '유나이티드헬스', market: 'US', changePct: 0.9, flow: null },
    ],
  },
];

const MOCK_EVENTS = [
  {
    date: '2026-07-18', sector: '반도체', changePct: -4.1,
    headline: 'AI 반도체 수출규제 우려 확산, 필라델피아 반도체지수 급락',
    tags: ['규제 우려', '반도체'],
    outcome: { days: 20, pct: 9.6, positive: true },
  },
  {
    date: '2026-05-06', sector: '2차전지·에너지', changePct: -3.5,
    headline: '전기차 수요 둔화 지표 발표, 배터리 밸류체인 동반 하락',
    tags: ['수요 둔화', '실적 우려'],
    outcome: { days: 20, pct: 6.1, positive: true },
  },
  {
    date: '2026-03-10', sector: '빅테크', changePct: -3.0,
    headline: '미 국채금리 급등, 밸류에이션 부담에 성장주 매도',
    tags: ['금리', '밸류에이션'],
    outcome: { days: 20, pct: 11.4, positive: true },
  },
  {
    date: '2026-01-22', sector: '금융', changePct: -2.6,
    headline: '지역은행 부실채권 우려 재부각, 금융주 전반 약세',
    tags: ['신용 우려'],
    outcome: { days: 20, pct: -1.8, positive: false },
  },
  {
    date: '2025-11-03', sector: '소프트웨어', changePct: -3.3,
    headline: '클라우드 대기업 실적 가이던스 하향, 소프트웨어 섹터 조정',
    tags: ['실적 쇼크'],
    outcome: { days: 20, pct: 7.2, positive: true },
  },
  {
    date: '2025-09-15', sector: '반도체', changePct: -3.4,
    headline: '미 상무부 반도체 수출 통제 강화 발표',
    tags: ['규제', '지정학'],
    outcome: { days: 20, pct: 8.2, positive: true },
  },
];

/* ============================================================
   상태
   ============================================================ */

const MOCK_ALERTS = [
  { id: 'm1', date: '2026-08-05', sectorId: 'semi', sectorName: '반도체', type: 'signal',
    at: new Date(Date.now() - 12 * 60000).toISOString(),
    body: '⚠️ [반도체] 선제 신호 -103.4%p\n자금 -62.4% / 뉴스 +41% (평소 대비)\n수급 기준일 2026-08-04' },
  { id: 'm2', date: '2026-08-05', sectorId: 'finance', sectorName: '금융', type: 'signal',
    at: new Date(Date.now() - 96 * 60000).toISOString(),
    body: '📈 [금융] 선제 신호 +83.2%p\n자금 +71.2% / 뉴스 -12% (평소 대비)\n수급 기준일 2026-08-04' },
  { id: 'm3', date: '2026-08-04', sectorId: 'battery', sectorName: '2차전지·에너지', type: 'drop',
    at: new Date(Date.now() - 26 * 3600000).toISOString(),
    body: '📉 [2차전지·에너지] -2.9% 하락\n자금 평소 대비 -45.8%\n전기차 보조금 축소 논의 재점화' },
];

const SEEN_KEY = 'stock_seen_alerts';

let SECTORS = MOCK_SECTORS;
let EVENTS = MOCK_EVENTS;
let ALERTS = MOCK_ALERTS;
let newsEnabled = true;
let currentPage = 'flow';
let sortMode = 'flow'; // flow | change | news
let connStatus = 'demo'; // demo | live | error | loading
let lastUpdated = new Date();
let flashIds = new Set();

/* ============================================================
   유틸
   ============================================================ */

function fmtFlow(n) {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Math.round(n).toLocaleString('ko-KR')}억`;
}
function fmtPct(n) {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}
function pillClass(n) {
  return n > 0 ? 'pill-up' : n < 0 ? 'pill-down' : 'pill-neutral';
}
function arrow(n) {
  return n > 0 ? '▲' : n < 0 ? '▼' : '·';
}
function timeAgoLabel() {
  const diffMin = Math.max(0, Math.round((Date.now() - lastUpdated.getTime()) / 60000));
  if (diffMin < 1) return '방금 업데이트';
  return `${diffMin}분 전 업데이트`;
}

/* 국내 상장 종목이 없는 섹터(빅테크 등)는 외국인·기관 수급 공개 데이터 자체가 없다.
   netFlow 0을 "유출입 없음"으로 오해하지 않도록 구분한다. */
function hasFlowData(s) {
  return (s.stocks || []).some((st) => st.flow != null);
}

/* 자금과 뉴스 모두 "평소 대비 % 편차"라 같은 축에서 뺄 수 있다.
   자금은 크게 움직이는데 뉴스가 아직 조용하면 divergence가 커진다. */
const SIGNAL_THRESHOLD = 40;

function computeSignals() {
  return SECTORS
    .filter((s) => hasFlowData(s) && s.newsBaselineReady)
    .map((s) => ({ ...s, divergence: +(s.flowChangePct - s.newsChangePct).toFixed(1) }))
    .filter((s) => Math.abs(s.divergence) >= SIGNAL_THRESHOLD)
    .sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence));
}

function sortedSectors() {
  const arr = [...SECTORS];
  // 수급 데이터가 없는 섹터는 자금 기준 정렬에서 항상 뒤로 보낸다
  const flowRank = (s) => (hasFlowData(s) ? 0 : 1);
  if (sortMode === 'flow') arr.sort((a, b) => flowRank(a) - flowRank(b) || b.netFlow - a.netFlow);
  else if (sortMode === 'change') arr.sort((a, b) => flowRank(a) - flowRank(b) || b.flowChangePct - a.flowChangePct);
  else if (sortMode === 'news') arr.sort((a, b) => b.newsVolume - a.newsVolume);
  return arr;
}

/* ============================================================
   렌더링
   ============================================================ */

function render() {
  renderStatusBanner();
  const el = document.getElementById('pageContainer');
  el.innerHTML = '';
  if (currentPage === 'flow') renderFlowPage(el);
  else if (currentPage === 'alerts') renderAlertsPage(el);
  else if (currentPage === 'history') renderHistoryPage(el);
  else if (currentPage === 'signal') renderSignalPage(el);
  document.getElementById('updateTime').textContent = timeAgoLabel();
  renderUnseenBadge();
  applyFlash();
}

/* ============================================================
   알림 피드
   ============================================================ */

function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch (e) { return new Set(); }
}
function markAllSeen() {
  localStorage.setItem(SEEN_KEY, JSON.stringify(ALERTS.map((a) => a.id)));
}
function unseenAlerts() {
  const seen = loadSeen();
  return ALERTS.filter((a) => !seen.has(a.id));
}

function renderUnseenBadge() {
  const n = unseenAlerts().length;
  ['badge-tab-alerts', 'badge-nav-alerts'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = n > 9 ? '9+' : String(n);
    el.hidden = n === 0;
  });
}

function alertTimeLabel(iso) {
  if (!iso) return '';
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return '방금';
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}시간 전`;
  return `${Math.floor(diffMin / 1440)}일 전`;
}

function renderAlertsPage(el) {
  const seen = loadSeen();

  if (ALERTS.length === 0) {
    el.innerHTML = `
      <div class="section-title">알림</div>
      <div class="empty-state"><div class="empty-icon">🔔</div>아직 감지된 알림이 없어요.</div>
    `;
    return;
  }

  el.innerHTML = `
    <div class="section-title-row">
      <div class="section-title">알림 — 하락·선제 신호가 감지되면 여기 쌓여요</div>
      <button class="sort-btn" id="markSeenBtn">모두 읽음</button>
    </div>
    ${ALERTS.map((a) => alertCardHtml(a, !seen.has(a.id))).join('')}
  `;

  document.getElementById('markSeenBtn').addEventListener('click', () => {
    markAllSeen();
    render();
  });

  // 목록을 실제로 봤으므로 다음 렌더부터는 읽은 것으로 처리
  setTimeout(() => { markAllSeen(); renderUnseenBadge(); }, 2500);
}

function alertCardHtml(a, isNew) {
  const isDrop = a.type === 'drop';
  const lines = String(a.body).split('\n');
  const head = lines[0] || '';
  const rest = lines.slice(1);
  return `
    <div class="alert-card ${isDrop ? 'alert-drop' : 'alert-signal'} ${isNew ? 'alert-new' : ''}">
      <div class="alert-top">
        <span class="alert-head">${head}</span>
        <span class="alert-time">${isNew ? '<span class="alert-dot"></span>' : ''}${alertTimeLabel(a.at)}</span>
      </div>
      ${rest.map((l) => `<div class="alert-line">${l}</div>`).join('')}
    </div>
  `;
}

function renderStatusBanner() {
  const el = document.getElementById('statusBanner');
  if (connStatus === 'live') {
    el.className = 'demo-banner status-live';
    el.innerHTML = `<span class="demo-banner-badge badge-live">LIVE</span><span class="demo-banner-text">네이버 연동 데이터 표시 중이에요.</span>`;
  } else if (connStatus === 'error') {
    el.className = 'demo-banner status-error';
    el.innerHTML = `<span class="demo-banner-badge badge-error">오류</span><span class="demo-banner-text">서버 연결에 실패해서 마지막으로 받은 데이터(또는 샘플)를 보여주고 있어요. <button class="banner-link" id="openSettingsFromBanner">설정 확인</button></span>`;
  } else if (connStatus === 'loading') {
    el.className = 'demo-banner status-loading';
    el.innerHTML = `<span class="demo-banner-badge">연결중</span><span class="demo-banner-text">데이터를 불러오는 중이에요…</span>`;
  } else {
    el.className = 'demo-banner';
    el.innerHTML = `<span class="demo-banner-badge">DEMO</span><span class="demo-banner-text">지금은 <b>샘플 데이터</b>예요. ⚙️ 설정에서 GAS 웹앱 URL을 연결하면 실시간 데이터로 바뀝니다.</span>`;
  }
  const link = document.getElementById('openSettingsFromBanner');
  if (link) link.addEventListener('click', openSettingsModal);
}

function renderFlowPage(el) {
  const list = sortedSectors();
  el.innerHTML = `
    <div class="section-title-row">
      <div class="section-title">섹터별 자금흐름</div>
      <div class="sort-bar">
        <button class="sort-btn ${sortMode === 'flow' ? 'active' : ''}" data-sort="flow">자금유입순</button>
        <button class="sort-btn ${sortMode === 'change' ? 'active' : ''}" data-sort="change">변화율순</button>
        <button class="sort-btn ${sortMode === 'news' ? 'active' : ''}" data-sort="news">뉴스언급순</button>
      </div>
    </div>
    <div class="sector-grid">
      ${list.map(sectorCardHtml).join('')}
    </div>
  `;
  el.querySelectorAll('.sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      sortMode = btn.dataset.sort;
      render();
    });
  });
  el.querySelectorAll('.sector-card').forEach((card) => {
    card.addEventListener('click', () => openSectorDetail(card.dataset.id));
  });
}

function sectorCardHtml(s) {
  const flowAvailable = hasFlowData(s);
  const newsLabel = !newsEnabled
    ? '뉴스 연동 안 됨 (네이버 API 키 필요)'
    : s.newsBaselineReady
      ? `뉴스 ${s.newsVolume}건 (평소 대비 ${fmtPct(s.newsChangePct)})`
      : `뉴스 ${s.newsVolume}건 · 기준선 수집 중`;

  const headPill = flowAvailable
    ? `<span class="pill ${pillClass(s.flowChangePct)}">${arrow(s.flowChangePct)} ${fmtPct(s.flowChangePct)}</span>`
    : `<span class="pill pill-neutral">수급 없음</span>`;

  const amount = flowAvailable
    ? `<div class="sector-flow-amt ${s.netFlow >= 0 ? 'val-up' : 'val-down'}">${fmtFlow(s.netFlow)}</div>
       <div class="sector-flow-sub">외국인·기관 순매매${s.flowDate ? ` · ${s.flowDate} 확정` : ''}</div>`
    : `<div class="sector-flow-amt sector-flow-na">—</div>
       <div class="sector-flow-sub">국내 상장 종목이 없어 수급 공개 데이터가 없어요</div>`;

  return `
    <div class="sector-card ${flashIds.has(s.id) ? 'flash' : ''}" data-id="${s.id}">
      <div class="sector-card-head">
        <div class="sector-name"><span class="sector-icon">${s.icon}</span>${s.name}</div>
        ${headPill}
      </div>
      ${amount}
      <div class="sector-flow-sub">${newsLabel}</div>
      <div class="sector-stocks">
        ${s.stocks.slice(0, 3).map((st) => `
          <div class="mini-stock-row">
            <span class="mini-stock-name"><b>${st.name}</b> ${st.market}</span>
            <span class="${st.changePct >= 0 ? 'val-up' : 'val-down'}">${fmtPct(st.changePct)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderHistoryPage(el) {
  if (EVENTS.length === 0) {
    el.innerHTML = `
      <div class="section-title">과도한 하락 히스토리</div>
      <div class="empty-state"><div class="empty-icon">🗓️</div>아직 감지된 하락 이벤트가 없어요.</div>
    `;
    return;
  }
  el.innerHTML = `
    <div class="section-title">과도한 하락 히스토리 — 돌아보면 매수 관점이었을까?</div>
    <div class="timeline">
      ${EVENTS.map(eventCardHtml).join('')}
    </div>
  `;
}

function eventCardHtml(ev) {
  let outcomeHtml;
  if (!ev.outcome) {
    outcomeHtml = `<div class="event-outcome neutral">⏳ 아직 판단 기간(약 20거래일)이 지나지 않았어요. 조금 더 지켜봐야 해요.</div>`;
  } else {
    const outcomeText = ev.outcome.positive
      ? `이후 ${ev.outcome.days}거래일간 <b>+${ev.outcome.pct.toFixed(1)}%</b> 반등 — 돌아보면 매수 기회였음`
      : `이후 ${ev.outcome.days}거래일간 ${ev.outcome.pct.toFixed(1)}% — 추세적 하락이 이어짐`;
    outcomeHtml = `<div class="event-outcome ${ev.outcome.positive ? '' : 'neutral'}">${ev.outcome.positive ? '📈' : '📉'} ${outcomeText}</div>`;
  }
  return `
    <div class="event-card">
      <div class="event-top">
        <span class="event-date">${ev.date} · ${ev.sector}</span>
        <span class="pill pill-down">${arrow(ev.changePct)} ${fmtPct(ev.changePct)}</span>
      </div>
      <div class="event-headline">${ev.headline}</div>
      <div class="event-tags">
        ${ev.tags.map((t) => `<span class="pill pill-neutral">${t}</span>`).join('')}
      </div>
      ${outcomeHtml}
    </div>
  `;
}

function renderSignalPage(el) {
  // 선제 신호는 자금과 뉴스를 비교하는 지표라 뉴스 없이는 계산 자체가 불가능하다
  if (!newsEnabled) {
    el.innerHTML = `
      <div class="section-title">선제 신호</div>
      <div class="empty-state">
        <div class="empty-icon">🔑</div>
        <div style="font-weight:700;color:var(--text);margin-bottom:8px">뉴스 연동이 필요해요</div>
        선제 신호는 <b>자금 흐름과 뉴스 언급량의 괴리</b>로 계산해서<br>
        뉴스 데이터 없이는 만들 수 없어요.<br><br>
        네이버 개발자센터에서 검색 API 키를 발급받아<br>
        GAS 스크립트 속성에 <code>NAVER_CLIENT_ID</code>, <code>NAVER_CLIENT_SECRET</code>을<br>
        추가하면 활성화됩니다.
      </div>
    `;
    return;
  }

  const signals = computeSignals();
  const skipped = SECTORS.filter((s) => !hasFlowData(s) || !s.newsBaselineReady);
  const skipNote = skipped.length
    ? `<div class="signal-note">${skipped.map((s) => s.name).join(', ')} — 수급 데이터가 없거나 뉴스 기준선이 아직 쌓이지 않아 신호 계산에서 제외했어요.</div>`
    : '';

  if (signals.length === 0) {
    el.innerHTML = `
      <div class="section-title">선제 신호</div>
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        평소 대비 ${SIGNAL_THRESHOLD}%p 이상 벌어진 섹터가 없어요.
      </div>
      ${skipNote}
    `;
    return;
  }
  el.innerHTML = `
    <div class="section-title">선제 신호 — 뉴스보다 자금이 먼저 움직이는 섹터</div>
    ${signals.map(signalCardHtml).join('')}
    ${skipNote}
  `;
}

function signalCardHtml(s) {
  const isInflow = s.flowChangePct > 0;
  const desc = isInflow
    ? `자금은 평소보다 ${fmtPct(s.flowChangePct)} 강하게 들어오는데 뉴스 언급은 ${fmtPct(s.newsChangePct)}에 그쳐요. 뉴스가 따라붙기 전 선제 진입 후보로 볼 수 있어요.`
    : `자금은 평소보다 ${fmtPct(s.flowChangePct)} 빠져나가는데 뉴스 언급은 ${fmtPct(s.newsChangePct)}예요. 시장이 눈치채기 전 이탈 조짐일 수 있어요.`;
  const barPct = (v) => Math.min(100, (Math.abs(v) / 150) * 100);
  return `
    <div class="signal-card">
      <div class="signal-top">
        <div class="signal-name"><span class="sector-icon">${s.icon}</span>${s.name}</div>
        <span class="signal-score">괴리 ${s.divergence > 0 ? '+' : ''}${s.divergence}%p</span>
      </div>
      <div class="signal-desc">${desc}</div>
      <div class="signal-bars">
        <div class="signal-bar-item">
          <div class="signal-bar-label"><span>자금 (평소 대비)</span><span>${fmtPct(s.flowChangePct)}</span></div>
          <div class="signal-bar-track"><div class="signal-bar-fill" style="width:${barPct(s.flowChangePct)}%;background:${isInflow ? 'var(--up)' : 'var(--down)'}"></div></div>
        </div>
        <div class="signal-bar-item">
          <div class="signal-bar-label"><span>뉴스 (평소 대비)</span><span>${fmtPct(s.newsChangePct)}</span></div>
          <div class="signal-bar-track"><div class="signal-bar-fill" style="width:${barPct(s.newsChangePct)}%;background:var(--primary)"></div></div>
        </div>
      </div>
      <div class="signal-foot">수급 기준일 ${s.flowDate || '—'} · 시세는 실시간, 수급은 전 거래일 확정치</div>
    </div>
  `;
}

/* ============================================================
   섹터 상세 모달
   ============================================================ */

function openSectorDetail(id) {
  const s = SECTORS.find((x) => x.id === id);
  if (!s) return;
  const box = document.getElementById('modalBox');
  box.innerHTML = `
    <div class="modal-head">
      <div class="modal-title"><span class="sector-icon">${s.icon}</span>${s.name}</div>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    ${hasFlowData(s)
      ? `<span class="pill ${pillClass(s.netFlow)}">${fmtFlow(s.netFlow)} · 평소 대비 ${fmtPct(s.flowChangePct)}</span>
         <div class="modal-note">수급은 ${s.flowDate || '—'} 확정치예요. 등락률은 실시간이라 기준일이 다릅니다.</div>`
      : `<span class="pill pill-neutral">수급 데이터 없음</span>
         <div class="modal-note">국내 상장 종목이 없어 외국인·기관 순매매 공개 데이터가 없어요.</div>`}
    <table class="detail-stock-table">
      <thead>
        <tr><th>종목</th><th>등락률</th><th>순매매(억)</th></tr>
      </thead>
      <tbody>
        ${s.stocks.map((st) => `
          <tr>
            <td>${st.name} <span style="color:var(--text-faint)">${st.market}</span></td>
            <td class="${st.changePct >= 0 ? 'val-up' : 'val-down'}">${fmtPct(st.changePct)}</td>
            <td class="${st.flow == null ? '' : (st.flow >= 0 ? 'val-up' : 'val-down')}">${st.flow == null ? '—' : fmtFlow(st.flow)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="section-title" style="margin-top:20px;">관련 뉴스${connStatus === 'live' ? '' : ' (샘플)'}</div>
    <div class="news-list">
      ${mockNewsFor(s).map((n) => `
        <div class="news-item">
          <div class="news-item-title">${n.title}</div>
          <div class="news-item-meta">${n.source} · ${n.time}</div>
        </div>
      `).join('')}
    </div>
  `;
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

function mockNewsFor(s) {
  return [
    { title: `${s.name} 섹터, 외국인 순매수 전환 조짐`, source: '샘플뉴스', time: '32분 전' },
    { title: `${s.stocks[0].name}, 실적 기대감에 강세`, source: '샘플뉴스', time: '1시간 전' },
    { title: `${s.name} 관련 종목 수급 동향 정리`, source: '샘플뉴스', time: '3시간 전' },
  ];
}

/* ============================================================
   설정 모달 (GAS 연동)
   ============================================================ */

function openSettingsModal() {
  const c = loadConfig();
  const box = document.getElementById('modalBox');
  box.innerHTML = `
    <div class="modal-head">
      <div class="modal-title">⚙️ 데이터 연동 설정</div>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    <p class="settings-desc">Google Apps Script(Code.gs)를 웹앱으로 배포한 뒤, 그 URL과 SECRET_KEY를 입력하면 실시간 데이터로 전환됩니다.</p>
    <div class="form-group">
      <label class="form-label">웹앱 URL</label>
      <input type="text" class="form-control" id="cfgUrl" placeholder="https://script.google.com/macros/s/.../exec" value="${c.url}">
    </div>
    <div class="form-group">
      <label class="form-label">SECRET KEY</label>
      <input type="text" class="form-control" id="cfgKey" placeholder="Code.gs의 SECRET_KEY 값" value="${c.key}">
    </div>
    <div class="settings-actions">
      <button class="btn btn-ghost" id="cfgClearBtn">연결 해제 (샘플로)</button>
      <button class="btn btn-primary" id="cfgSaveBtn">저장하고 연결 테스트</button>
    </div>
    <div id="cfgTestResult" class="settings-result"></div>

    <div class="kakao-box">
      <div class="kakao-title">🔔 브라우저 알림</div>
      <div class="kakao-desc">이 페이지를 열어두면 새 신호가 뜰 때 브라우저 알림으로 알려드려요. 아이폰은 홈 화면에 추가한 경우에만 동작합니다.</div>
      <div class="settings-actions">
        <button class="btn btn-primary" id="notifyBtn">알림 허용하기</button>
      </div>
      <div id="notifyResult" class="settings-result"></div>
    </div>

    <div id="kakaoSection"></div>
  `;
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('cfgSaveBtn').addEventListener('click', onSaveConfig);

  const notifyBtn = document.getElementById('notifyBtn');
  const notifyResult = document.getElementById('notifyResult');
  const paintNotifyState = () => {
    if (!('Notification' in window)) {
      notifyBtn.disabled = true;
      notifyResult.textContent = '이 브라우저는 알림을 지원하지 않아요.';
      notifyResult.className = 'settings-result';
    } else if (Notification.permission === 'granted') {
      notifyBtn.disabled = true;
      notifyBtn.textContent = '알림 허용됨';
      notifyResult.textContent = '✅ 새 신호가 뜨면 알려드릴게요.';
      notifyResult.className = 'settings-result ok';
    } else if (Notification.permission === 'denied') {
      notifyResult.textContent = '브라우저에서 차단돼 있어요. 주소창의 자물쇠 아이콘에서 알림을 허용해주세요.';
      notifyResult.className = 'settings-result err';
    }
  };
  paintNotifyState();
  notifyBtn.addEventListener('click', async () => {
    await requestNotifyPermission();
    paintNotifyState();
  });

  renderKakaoSection();
  document.getElementById('cfgClearBtn').addEventListener('click', () => {
    saveConfig('', '');
    connStatus = 'demo';
    SECTORS = MOCK_SECTORS;
    EVENTS = MOCK_EVENTS;
    localStorage.removeItem(CACHE_KEY);
    closeModal();
    render();
  });
  document.getElementById('modalOverlay').classList.add('open');
}

async function onSaveConfig() {
  const url = document.getElementById('cfgUrl').value.trim();
  const key = document.getElementById('cfgKey').value.trim();
  const resultEl = document.getElementById('cfgTestResult');
  if (!url || !key) {
    resultEl.textContent = 'URL과 키를 모두 입력해주세요.';
    resultEl.className = 'settings-result err';
    return;
  }
  saveConfig(url, key);
  resultEl.textContent = '연결 테스트 중…';
  resultEl.className = 'settings-result';
  const ok = await fetchDashboard();
  if (ok) {
    resultEl.textContent = '✅ 연결 성공! 실시간 데이터로 전환했어요.';
    resultEl.className = 'settings-result ok';
    setTimeout(closeModal, 900);
  } else {
    resultEl.textContent = '❌ 연결에 실패했어요. URL/키를 확인해주세요. (샘플 데이터 유지)';
    resultEl.className = 'settings-result err';
  }
  render();
}

/* ============================================================
   카카오톡 알림 연결
   ============================================================ */

function gasUrl(action) {
  const c = loadConfig();
  return `${c.url}?action=${action}&key=${encodeURIComponent(c.key)}`;
}

async function renderKakaoSection() {
  const el = document.getElementById('kakaoSection');
  if (!el) return;
  if (!isConfigured()) {
    el.innerHTML = `<div class="kakao-box muted">GAS 웹앱을 먼저 연결하면 카톡 알림을 설정할 수 있어요.</div>`;
    return;
  }

  el.innerHTML = `<div class="kakao-box muted">카톡 연결 상태 확인 중…</div>`;
  let st;
  try {
    const res = await fetch(gasUrl('kakaoStatus'));
    st = await res.json();
    if (st.error) throw new Error(st.error);
  } catch (err) {
    el.innerHTML = `<div class="kakao-box muted">카톡 상태를 불러오지 못했어요. GAS를 최신 코드로 다시 배포했는지 확인해주세요.</div>`;
    return;
  }

  if (!st.hasRestKey) {
    el.innerHTML = `
      <div class="kakao-box">
        <div class="kakao-title">💬 카톡 알림</div>
        <div class="kakao-desc">GAS 스크립트 속성에 <b>KAKAO_REST_KEY</b>를 먼저 저장해주세요. 카카오 개발자센터에서 앱을 만들고 REST API 키를 복사하면 됩니다.</div>
      </div>`;
    return;
  }

  if (!st.connected) {
    el.innerHTML = `
      <div class="kakao-box">
        <div class="kakao-title">💬 카톡 알림</div>
        <div class="kakao-desc">과도한 하락이나 선제 신호가 뜨면 카톡으로 보내드려요. 아래 버튼을 누르면 카카오 로그인 창이 열립니다.</div>
        <div class="settings-actions">
          <button class="btn btn-primary" id="kakaoConnectBtn">카톡 알림 연결</button>
        </div>
        <div class="kakao-desc" style="margin-top:10px">카카오 개발자센터의 Redirect URI에 아래 주소가 등록돼 있어야 해요.<br><code class="kakao-uri">${st.redirectUri}</code></div>
      </div>`;
    document.getElementById('kakaoConnectBtn').addEventListener('click', () => {
      window.open(gasUrl('kakaoAuth'), '_blank');
    });
    return;
  }

  el.innerHTML = `
    <div class="kakao-box">
      <div class="kakao-title">💬 카톡 알림 <span class="pill pill-up">연결됨</span></div>
      <div class="kakao-desc">하락(${'-2.5'}% 이하)이나 선제 신호가 감지되면 알려드려요. 같은 날 같은 사유로는 중복 발송하지 않습니다.</div>
      <div class="settings-actions">
        <button class="btn btn-ghost" id="kakaoOffBtn">연결 해제</button>
        <button class="btn btn-primary" id="kakaoTestBtn">테스트 발송</button>
      </div>
      <div id="kakaoResult" class="settings-result"></div>
    </div>`;

  document.getElementById('kakaoTestBtn').addEventListener('click', async () => {
    const r = document.getElementById('kakaoResult');
    r.textContent = '보내는 중…';
    r.className = 'settings-result';
    try {
      const res = await fetch(gasUrl('kakaoTest'));
      const data = await res.json();
      r.textContent = data.ok ? '✅ 카톡을 확인해보세요.' : `❌ 실패: ${data.error}`;
      r.className = data.ok ? 'settings-result ok' : 'settings-result err';
    } catch (err) {
      r.textContent = '❌ 요청에 실패했어요.';
      r.className = 'settings-result err';
    }
  });

  document.getElementById('kakaoOffBtn').addEventListener('click', async () => {
    try { await fetch(gasUrl('kakaoOff')); } catch (err) { /* 무시하고 상태 갱신 */ }
    renderKakaoSection();
  });
}

/* ============================================================
   실데이터 fetch
   ============================================================ */

async function fetchDashboard() {
  const c = loadConfig();
  if (!c.url || !c.key) return false;
  connStatus = 'loading';
  try {
    const res = await fetch(`${c.url}?action=dashboard&key=${encodeURIComponent(c.key)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (!data.sectors || !data.sectors.length) throw new Error('empty sectors');

    flashIds = new Set(diffSectorIds(SECTORS, data.sectors));
    const prevIds = new Set(ALERTS.map((a) => a.id));
    SECTORS = data.sectors;
    EVENTS = data.events || [];
    ALERTS = data.alerts || [];
    newsEnabled = data.newsEnabled !== false;
    lastUpdated = new Date();
    connStatus = 'live';
    localStorage.setItem(CACHE_KEY, JSON.stringify({ sectors: SECTORS, events: EVENTS, alerts: ALERTS, savedAt: lastUpdated.toISOString() }));

    const fresh = ALERTS.filter((a) => !prevIds.has(a.id));
    if (fresh.length) notifyNewAlerts(fresh);
    return true;
  } catch (err) {
    connStatus = 'error';
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        SECTORS = parsed.sectors;
        EVENTS = parsed.events;
        if (parsed.alerts) ALERTS = parsed.alerts;
      } catch (e) { /* 캐시 파싱 실패 시 기존 데이터 유지 */ }
    }
    return false;
  }
}

/* 브라우저 알림 — 페이지를 열어두면 탭이 뒤에 있어도 새 신호를 알려준다.
   (iOS Safari는 홈 화면에 추가한 경우에만 동작) */
function notifyNewAlerts(fresh) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && currentPage === 'alerts') return;
  fresh.slice(0, 3).forEach((a) => {
    const lines = String(a.body).split('\n');
    try {
      new Notification(lines[0] || '새 신호', { body: lines.slice(1).join(' · '), tag: a.id });
    } catch (e) { /* 일부 브라우저는 SW 없이 Notification 생성 불가 */ }
  });
}

async function requestNotifyPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try { return await Notification.requestPermission(); }
  catch (e) { return 'denied'; }
}

function diffSectorIds(oldList, newList) {
  const oldMap = {};
  oldList.forEach((s) => (oldMap[s.id] = s.netFlow));
  return newList.filter((s) => oldMap[s.id] !== undefined && oldMap[s.id] !== s.netFlow).map((s) => s.id);
}

function applyFlash() {
  if (flashIds.size === 0) return;
  setTimeout(() => { flashIds = new Set(); }, 1200);
}

/* ============================================================
   새로고침 (연결 안 됐을 때는 데모용으로 숫자만 살짝 흔듦)
   ============================================================ */

function jitterData() {
  SECTORS = SECTORS.map((s) => {
    const flowAvailable = hasFlowData(s);
    return {
      ...s,
      netFlow: flowAvailable ? s.netFlow + Math.round((Math.random() - 0.5) * 80) : 0,
      flowChangePct: flowAvailable ? +(s.flowChangePct + (Math.random() - 0.5) * 12).toFixed(1) : 0,
      newsChangePct: +(s.newsChangePct + (Math.random() - 0.5) * 8).toFixed(1),
      stocks: s.stocks.map((st) => ({
        ...st,
        changePct: +(st.changePct + (Math.random() - 0.5) * 0.4).toFixed(1),
        flow: st.flow == null ? null : st.flow + Math.round((Math.random() - 0.5) * 20),
      })),
    };
  });
}

async function doRefresh() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  setTimeout(() => btn.classList.remove('spinning'), 700);

  if (isConfigured()) {
    await fetchDashboard();
  } else {
    jitterData();
    lastUpdated = new Date();
  }
  render();
}

/* ============================================================
   초기화
   ============================================================ */

function init() {
  document.querySelectorAll('.tab-btn, .bottom-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn, .bottom-nav-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll(`[data-page="${btn.dataset.page}"]`).forEach((b) => b.classList.add('active'));
      currentPage = btn.dataset.page;
      render();
    });
  });

  document.getElementById('refreshBtn').addEventListener('click', doRefresh);
  document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });

  const cached = localStorage.getItem(CACHE_KEY);
  if (cached && isConfigured()) {
    try {
      const parsed = JSON.parse(cached);
      SECTORS = parsed.sectors;
      EVENTS = parsed.events;
      connStatus = 'live';
    } catch (e) { /* 무시 */ }
  }

  render();

  if (isConfigured()) {
    fetchDashboard().then(render);
  }

  setInterval(doRefresh, AUTO_REFRESH_MS);
  setInterval(() => {
    document.getElementById('updateTime').textContent = timeAgoLabel();
  }, 30 * 1000);
}

document.addEventListener('DOMContentLoaded', init);
