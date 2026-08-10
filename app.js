/* ============================================================
   설정 (GAS 연동)
   ============================================================ */

const CFG_URL_KEY = 'stock_gas_url';
const CFG_SECRET_KEY = 'stock_gas_secret';
const CFG_OFF_KEY = 'stock_gas_off';
const CACHE_KEY = 'stock_dashboard_cache';
const AUTO_REFRESH_MS = 8 * 60 * 1000;

/* 기기마다 설정을 다시 입력하지 않도록 기본 연결값을 앱에 넣어둔다.
   (저장소가 공개라 이 키는 공개값이다 — 소유자가 감수하기로 한 트레이드오프.
   키를 바꾸려면 Code.gs의 SECRET_KEY와 여기를 함께 고쳐야 한다) */
const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbyHgBuQl15qxuy3YXSy73uVIBN8TLvH_G_L9lqnZ5s2futWEwjfC5TEXAr67CFprYFFgg/exec';
const DEFAULT_GAS_KEY = 'stockflow-2026!';

function loadConfig() {
  const url = localStorage.getItem(CFG_URL_KEY);
  const key = localStorage.getItem(CFG_SECRET_KEY);
  // 사용자가 직접 "연결 해제"를 누른 경우에만 기본값 폴백을 끈다
  if (localStorage.getItem(CFG_OFF_KEY) === '1') return { url: url || '', key: key || '' };
  return { url: url || DEFAULT_GAS_URL, key: key || DEFAULT_GAS_KEY };
}
function saveConfig(url, key) {
  localStorage.setItem(CFG_URL_KEY, url.trim());
  localStorage.setItem(CFG_SECRET_KEY, key.trim());
  localStorage.removeItem(CFG_OFF_KEY);
}
function clearConfig() {
  localStorage.removeItem(CFG_URL_KEY);
  localStorage.removeItem(CFG_SECRET_KEY);
  localStorage.setItem(CFG_OFF_KEY, '1');
}
function isConfigured() {
  const c = loadConfig();
  return !!(c.url && c.key);
}

/* ============================================================
   상태
   ============================================================ */

const SEEN_KEY = 'stock_seen_alerts';

let SECTORS = [];
let EVENTS = [];
let ALERTS = [];
let newsEnabled = true;
let currentPage = 'flow';
let sortMode = 'flow'; // flow | change | news
let connStatus = 'loading'; // loading | live | error | off
let lastUpdated = new Date();
let flashIds = new Set();

const MARKET_KEY = 'stock_market_filter';
let marketFilter = localStorage.getItem(MARKET_KEY) || 'all'; // all | kr | us

const MARKET_LABEL = { all: '전체', kr: '국장', kospi: '코스피', kosdaq: '코스닥', us: '미장' };

const TREND_PERIOD_KEY = 'stock_trend_period';
const TREND_METRIC_KEY = 'stock_trend_metric';
let trendPeriod = localStorage.getItem(TREND_PERIOD_KEY) || 'month'; // day | month | year
let trendMetric = localStorage.getItem(TREND_METRIC_KEY) || 'flow';  // flow | price | news
let trendSector = 'all';
const TREND_INVESTOR_KEY = 'stock_trend_investor';
let trendInvestor = localStorage.getItem(TREND_INVESTOR_KEY) || 'net'; // net | frgn | org | indi
let trendFrom = '';
let trendTo = '';
let TREND = null;
let trendState = 'idle'; // idle | loading | ready | error
let trendCache = {};

const PERIOD_LABEL = { day: '일별', month: '월별', year: '연도별' };
const METRIC_LABEL = { flow: '수급', price: '등락률', news: '뉴스' };
const INVESTOR_LABEL = { net: '외인+기관', frgn: '외국인', org: '기관', indi: '개인' };

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

/* 백엔드는 한 섹터에 국내·미국 종목을 함께 담아 내려준다.
   국장/미장 탭은 그 종목 배열을 시장별로 갈라서 지표를 다시 집계한 뷰다.
   원본 SECTORS는 건드리지 않으므로 탭을 바꿔도 원 데이터는 그대로 남는다. */
/* 백엔드는 종목 시장을 KOSPI/KOSDAQ/US로 준다.
   '국장'은 코스피+코스닥을 함께 본다. */
function matchesMarket_(stockMarket, filter) {
  if (filter === 'all') return true;
  if (filter === 'kr') return stockMarket === 'KOSPI' || stockMarket === 'KOSDAQ';
  if (filter === 'kospi') return stockMarket === 'KOSPI';
  if (filter === 'kosdaq') return stockMarket === 'KOSDAQ';
  if (filter === 'us') return stockMarket === 'US';
  return true;
}

function isKrFilter_(filter) {
  return filter === 'kr' || filter === 'kospi' || filter === 'kosdaq';
}

function viewSectors() {
  if (marketFilter === 'all') return SECTORS;
  return SECTORS
    .map((s) => {
      const stocks = (s.stocks || []).filter((st) => matchesMarket_(st.market, marketFilter));
      if (!stocks.length) return null;
      const isKr = isKrFilter_(marketFilter);
      const newsCount = isKr ? s.newsKr : s.newsUs;
      return {
        ...s,
        stocks,
        netFlow: isKr ? stocks.reduce((a, st) => a + (st.flow || 0), 0) : 0,
        flowChangePct: isKr ? s.flowChangePct : 0,
        avgChangePct: +(stocks.reduce((a, st) => a + st.changePct, 0) / stocks.length).toFixed(2),
        newsVolume: newsCount != null ? newsCount : s.newsVolume,
      };
    })
    .filter(Boolean);
}

function computeSignals() {
  return viewSectors()
    .filter((s) => hasFlowData(s) && s.newsBaselineReady)
    .map((s) => ({ ...s, divergence: +(s.flowChangePct - s.newsChangePct).toFixed(1) }))
    .filter((s) => Math.abs(s.divergence) >= SIGNAL_THRESHOLD)
    .sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence));
}

function avgChangeOf(s) {
  if (s.avgChangePct != null) return s.avgChangePct;
  const list = s.stocks || [];
  if (!list.length) return 0;
  return list.reduce((a, st) => a + st.changePct, 0) / list.length;
}

/* 미장은 외국인·기관 수급 공개 데이터가 없어 자금 기준 정렬이 무의미하다 */
function availableSortModes() {
  return marketFilter === 'us' ? ['price', 'news'] : ['flow', 'change', 'price', 'news'];
}

function effectiveSortMode() {
  const modes = availableSortModes();
  return modes.includes(sortMode) ? sortMode : modes[0];
}

function sortedSectors() {
  const arr = viewSectors().slice();
  const mode = effectiveSortMode();
  // 수급 데이터가 없는 섹터는 자금 기준 정렬에서 항상 뒤로 보낸다
  const flowRank = (s) => (hasFlowData(s) ? 0 : 1);
  if (mode === 'flow') arr.sort((a, b) => flowRank(a) - flowRank(b) || b.netFlow - a.netFlow);
  else if (mode === 'change') arr.sort((a, b) => flowRank(a) - flowRank(b) || b.flowChangePct - a.flowChangePct);
  else if (mode === 'price') arr.sort((a, b) => avgChangeOf(b) - avgChangeOf(a));
  else if (mode === 'news') arr.sort((a, b) => b.newsVolume - a.newsVolume);
  return arr;
}

/* ============================================================
   렌더링
   ============================================================ */

function render() {
  renderStatusBanner();
  // 알림/히스토리는 시장 구분이 없는 데이터라 세그먼트를 숨긴다
  document.getElementById('marketSeg').hidden = (currentPage === 'alerts' || currentPage === 'history');
  const el = document.getElementById('pageContainer');
  el.innerHTML = '';
  if (currentPage === 'flow') renderFlowPage(el);
  else if (currentPage === 'alerts') renderAlertsPage(el);
  else if (currentPage === 'risk') renderRiskPage(el);
  else if (currentPage === 'experiment') renderTargetPage(el);
  else if (currentPage === 'trend') renderTrendPage(el);
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
      <div class="section-title">알림 — 왜 떴는지 근거까지 같이 보여줘요</div>
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

const ALERT_META = {
  inflow:    { label: '자금 유입', icon: '💰' },
  outflow:   { label: '자금 이탈', icon: '🚪' },
  drop:      { label: '급락', icon: '📉' },
  turn_buy:  { label: '수급 전환 · 매수', icon: '🔄' },
  turn_sell: { label: '수급 전환 · 매도', icon: '🔄' },
  signal:    { label: '선제 신호', icon: '⚠️' },
};

const DIRECTION_META = {
  positive: { label: '긍정', cls: 'dir-positive' },
  negative: { label: '부정', cls: 'dir-negative' },
  caution:  { label: '주의', cls: 'dir-caution' },
};

function alertCardHtml(a, isNew) {
  const meta = ALERT_META[a.type] || { label: a.type, icon: '🔔' };
  const dir = DIRECTION_META[a.direction] || DIRECTION_META.caution;
  const basis = Array.isArray(a.basis) ? a.basis : [];

  // 옛 알림은 basis가 없어 body를 그대로 보여준다
  const bodyLines = basis.length
    ? ''
    : String(a.body || '').split('\n').slice(1).map((l) => `<div class="alert-line">${l}</div>`).join('');

  const basisHtml = basis.length
    ? `<div class="alert-basis">
         ${basis.map((b) => `
           <div class="basis-row">
             <span class="basis-label">${b.label}</span>
             <span class="basis-value">${b.value}</span>
             ${b.note ? `<span class="basis-note">${b.note}</span>` : ''}
           </div>`).join('')}
       </div>`
    : '';

  const newsHtml = a.headline
    ? `<div class="alert-news">
         ${a.link ? `<a href="${a.link}" target="_blank" rel="noopener" class="alert-news-title">${a.headline}</a>`
                  : `<span class="alert-news-title">${a.headline}</span>`}
         <span class="alert-news-src">${a.source || '출처 미상'}</span>
       </div>`
    : '';

  return `
    <div class="alert-card ${dir.cls} ${isNew ? 'alert-new' : ''}">
      <div class="alert-top">
        <span class="alert-head">${meta.icon} ${a.sectorName || ''} · ${meta.label}</span>
        <span class="alert-time">${isNew ? '<span class="alert-dot"></span>' : ''}${alertTimeLabel(a.at)}</span>
      </div>
      <div class="alert-dir"><span class="pill ${dir.cls}-pill">${dir.label}</span></div>
      ${basisHtml}
      ${bodyLines}
      ${newsHtml}
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
    el.innerHTML = `<span class="demo-banner-badge badge-error">오류</span><span class="demo-banner-text">서버 연결에 실패했어요. 아래는 <b>마지막으로 받은 실데이터</b>이며 지금 시점이 아닙니다. <button class="banner-link" id="openSettingsFromBanner">설정 확인</button></span>`;
  } else if (connStatus === 'loading') {
    el.className = 'demo-banner status-loading';
    el.innerHTML = `<span class="demo-banner-badge">연결중</span><span class="demo-banner-text">데이터를 불러오는 중이에요…</span>`;
  } else {
    el.className = 'demo-banner';
    el.innerHTML = `<span class="demo-banner-badge">연결 안 됨</span><span class="demo-banner-text">⚙️ 설정에서 GAS 웹앱을 연결하면 데이터가 표시됩니다. <b>표시되는 숫자는 모두 실데이터이며 샘플은 없습니다.</b></span>`;
  }
  const link = document.getElementById('openSettingsFromBanner');
  if (link) link.addEventListener('click', openSettingsModal);
}

const SORT_LABEL = { flow: '자금유입순', change: '자금변화율순', price: '등락률순', news: '뉴스언급순' };

function renderFlowPage(el) {
  const list = sortedSectors();
  const mode = effectiveSortMode();
  const title = marketFilter === 'us'
    ? '🇺🇸 미장 섹터 — 등락률·뉴스 흐름'
    : isKrFilter_(marketFilter)
      ? `${MARKET_LABEL[marketFilter]} 섹터 — 외국인·기관 수급`
      : '섹터별 자금흐름';
  const usNote = marketFilter === 'us'
    ? `<div class="signal-note">미국 시장은 외국인·기관 순매매 같은 공개 수급 데이터가 없어요. 등락률과 뉴스 언급량으로만 봅니다.</div>`
    : '';
  el.innerHTML = `
    <div class="section-title-row">
      <div class="section-title">${title}</div>
      <div class="sort-bar">
        ${availableSortModes().map((m) => `<button class="sort-btn ${mode === m ? 'active' : ''}" data-sort="${m}">${SORT_LABEL[m]}</button>`).join('')}
      </div>
    </div>
    ${usNote}
    ${list.length
      ? `<div class="sector-grid">${list.map(sectorCardHtml).join('')}</div>`
      : `<div class="empty-state"><div class="empty-icon">${connStatus === 'loading' ? '⏳' : '📭'}</div>${
          connStatus === 'loading' ? '데이터를 불러오는 중이에요…'
          : connStatus === 'off' ? 'GAS를 연결하면 데이터가 표시됩니다.'
          : '표시할 데이터가 없어요. 잠시 후 다시 시도해주세요.'}</div>`}
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
  const priceView = marketFilter === 'us' || !flowAvailable;
  const avg = avgChangeOf(s);
  const newsSplit = (marketFilter === 'all' && s.newsKr != null && s.newsUs != null)
    ? ` (국내 ${s.newsKr} · 해외 ${s.newsUs})`
    : '';
  const newsLabel = !s.newsBaselineReady
    ? `뉴스 ${s.newsVolume}건${newsSplit} · 기준선 수집 중`
    : marketFilter === 'us' && !flowAvailable
      ? `뉴스 ${s.newsVolume}건${newsSplit}` // 평소 대비는 위 배지에 이미 있다
      : `뉴스 ${s.newsVolume}건${newsSplit} · 평소 대비 ${fmtPct(s.newsChangePct)}`;

  // 미장은 수급 자체가 없으므로 "수급 없음" 대신 뉴스 편차를 배지로 쓴다
  const headPill = flowAvailable
    ? `<span class="pill ${pillClass(s.flowChangePct)}">${arrow(s.flowChangePct)} ${fmtPct(s.flowChangePct)}</span>`
    : marketFilter === 'us'
      ? (s.newsBaselineReady
          ? `<span class="pill ${pillClass(s.newsChangePct)}">뉴스 ${fmtPct(s.newsChangePct)}</span>`
          : `<span class="pill pill-neutral">뉴스 기준선 수집중</span>`)
      : `<span class="pill pill-neutral">수급 없음</span>`;

  const amount = priceView
    ? `<div class="sector-flow-amt ${avg >= 0 ? 'val-up' : 'val-down'}">${fmtPct(avg)}</div>
       <div class="sector-flow-sub">${s.stocks.length}종목 평균 등락률 · 실시간</div>`
    : `<div class="sector-flow-amt ${s.netFlow >= 0 ? 'val-up' : 'val-down'}">${fmtFlow(s.netFlow)}</div>
       <div class="sector-flow-sub">외국인·기관 순매매${s.flowDate ? ` · ${s.flowDate} 확정` : ''}</div>`;

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
            <span class="mini-stock-name"><b>${st.name}</b>${marketFilter === 'all' ? ` ${st.market}` : ''}</span>
            <span class="${st.changePct >= 0 ? 'val-up' : 'val-down'}">${fmtPct(st.changePct)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/* ============================================================
   섹터 위험도 (검증 통과) + 수급 관측
   ============================================================ */

let RISK = null;
let riskState = 'idle';

async function fetchRisk(onLoading) {
  const mk = isKrFilter_(marketFilter) ? marketFilter : 'kr';
  if (RISK && RISK.market === mk) { riskState = 'ready'; return; }
  if (!isConfigured()) { riskState = 'error'; return; }
  riskState = 'loading';
  if (onLoading) onLoading();
  try {
    const res = await fetch(`${gasUrl('risk')}&market=${mk}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    RISK = data;
    riskState = 'ready';
  } catch (err) {
    riskState = 'error';
  }
}

const BAND_CLASS = { '높음': 'band-high', '보통': 'band-mid', '낮음': 'band-low' };

/* 변동성 막대는 0이 기준점이라 한쪽으로만 찬다 (z처럼 가운데를 두지 않는다).
   100%를 최대치로 잡으면 대부분 구간에서 눈에 보이는 차이가 난다. */
function volBar(vol, band) {
  const pct = Math.max(2, Math.min(100, (vol || 0)));
  return `<div class="zbar"><div class="zbar-fill ${BAND_CLASS[band] || 'band-mid'}"
    style="left:0;width:${pct}%"></div></div>`;
}

function renderRiskPage(el) {
  if (riskState === 'loading' || riskState === 'idle') {
    el.innerHTML = `<div class="section-title">섹터 위험도</div><div class="empty-state">계산 중이에요…</div>`;
    return;
  }
  if (riskState === 'error' || !RISK) {
    el.innerHTML = `<div class="section-title">섹터 위험도</div>
      <div class="empty-state"><div class="empty-icon">⚠️</div>위험도를 불러오지 못했어요. GAS를 최신 코드로 배포했는지 확인해주세요.</div>`;
    return;
  }
  if (marketFilter === 'us') {
    el.innerHTML = `<div class="section-title">섹터 위험도</div>
      <div class="empty-state"><div class="empty-icon">🇺🇸</div>위험도는 국내 일별 데이터로 계산해요. 미국 섹터는 아직 없습니다.</div>`;
    return;
  }

  const b = RISK.basis;
  const cards = RISK.sectors.map((s) => {
    const cal = (RISK.bands || []).filter((x) => x.band === s.band)[0];
    return `
    <div class="card score-card">
      <div class="score-head">
        <div class="score-rank">${s.rank}</div>
        <div class="score-name">${s.icon} ${s.name}</div>
        <div class="band-chip ${BAND_CLASS[s.band] || ''}">${s.band}</div>
      </div>
      <div class="score-factors">
        <div class="zrow">
          <span class="zlabel">변동성 60일</span>
          ${volBar(s.vol60, s.band)}
          <span class="zval">${s.vol60 == null ? '—' : s.vol60 + '%'}</span>
        </div>
        <div class="zrow">
          <span class="zlabel">변동성 20일</span>
          ${volBar(s.vol20, s.band)}
          <span class="zval">${s.vol20 == null ? '—' : s.vol20 + '%'}${s.rising ? ' ↑' : ''}</span>
        </div>
      </div>
      ${cal ? `<div class="risk-expect">이 구간이었을 때 이후 20거래일 실적 —
        평균 최대낙폭 <b>${cal.fdd}%</b> · 7% 넘게 빠진 경우 <b>${Math.round(cal.p7 * 100)}%</b></div>` : ''}
      <div class="score-detail">
        최근 60일 낙폭 ${s.dd60}% · 20일 등락 ${fmtPct(s.ret20)} ·
        20일 수급 ${fmtFlow(s.net20)} (순매수 ${s.buyDays}/20일) ·
        수급 변동성 ${s.flowVol20 == null ? '—' : fmtFlow(s.flowVol20)}
      </div>
    </div>`;
  }).join('');

  /* 장 전체가 흔들리면 전 섹터가 '높음'으로 몰린다. 게이지가 고장난 게 아니라
     그 자체가 읽어야 할 신호라서, 몇 개가 어느 밴드인지 먼저 보여준다. */
  const cnt = { '높음': 0, '보통': 0, '낮음': 0 };
  RISK.sectors.forEach((s) => { if (cnt[s.band] !== undefined) cnt[s.band]++; });
  const total = RISK.sectors.length;
  const overall = cnt['높음'] >= total * 0.7 ? '지금은 장 전체가 흔들리는 국면입니다'
    : cnt['낮음'] >= total * 0.7 ? '지금은 장 전체가 잔잔한 국면입니다'
    : '섹터별로 위험 수준이 갈립니다';

  el.innerHTML = `
    <div class="warn-box">
      <div class="warn-title">⚠️ 오를 섹터를 고르는 화면이 아닙니다</div>
      <div class="warn-body">${RISK.caveat}<br>
      위험도가 낮다고 오른다는 뜻이 아니고, 높다고 떨어진다는 뜻도 아닙니다.
      <b>얼마나 흔들릴지</b>만 봅니다.</div>
    </div>
    <div class="section-title">${MARKET_LABEL[isKrFilter_(marketFilter) ? marketFilter : 'kr']} 섹터 위험도 · ${RISK.asOf} 기준</div>
    <div class="card risk-overall">
      <div class="risk-overall-line">${overall}</div>
      <div class="risk-overall-sub">높음 ${cnt['높음']} · 보통 ${cnt['보통']} · 낮음 ${cnt['낮음']} (전체 ${total}개 섹터)</div>
    </div>
    ${cards}
    <div class="signal-note">
      순위는 60일 실현변동성(연율) 기준입니다. 구간은 ${RISK.cuts[0]}% 미만 낮음 /
      ${RISK.cuts[1]}% 이상 높음.<br>
      검증: 홀드아웃 ${b.holdout} 구간에서 ${b.note}. 이후 변동성 순위상관
      <b>+${b.icVol}</b> (t ${b.tVol}), 최대낙폭 <b>+${b.icDd}</b> (t ${b.tDd}).
      학습 구간과 홀드아웃을 나눠 검증했고, 같은 방식으로 돌린 수익률 예측
      108개 가설은 전부 탈락했습니다.<br>
      "이후 20거래일 실적"은 홀드아웃 구간에서 그 밴드에 있던 섹터들의 실제
      결과입니다. 예언이 아니라 과거 기록입니다.<br>
      구간 경계는 고정값이라 장 전체가 흔들리면 대부분 섹터가 '높음'에 몰립니다.
      그럴 땐 밴드보다 <b>섹터 간 순서와 변동성 숫자</b>를 보세요.
    </div>
  `;
}

/* ============================================================
   실험 · 매수 관점 스코어 (검증 탈락 — 기록용)
   ============================================================ */

/* 이 화면은 "이 방법은 안 통했다"를 남겨두는 곳이다.
   지우지 않고 남기는 이유는, 같은 아이디어를 나중에 또 떠올렸을 때
   이미 해봤고 왜 안 됐는지 바로 확인하기 위해서다.
   매수 후보로 읽히지 않도록 경고를 맨 위에 크게 둔다. */

let TARGET = null;
let targetState = 'idle';

async function fetchTarget(onLoading) {
  if (TARGET) { targetState = 'ready'; return; }
  if (!isConfigured()) { targetState = 'error'; return; }
  targetState = 'loading';
  if (onLoading) onLoading();
  try {
    const res = await fetch(gasUrl('target'));
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    TARGET = data;
    targetState = 'ready';
  } catch (err) {
    targetState = 'error';
  }
}

function expBar(pct, cls) {
  const w = Math.max(0, Math.min(100, pct || 0));
  return `<div class="zbar"><div class="zbar-fill ${cls}" style="left:0;width:${w}%"></div></div>`;
}

function renderTargetPage(el) {
  if (targetState === 'loading' || targetState === 'idle') {
    el.innerHTML = `<div class="section-title">실험 · 매수 관점 스코어</div>
      <div class="empty-state">
        <div class="empty-icon">🧪</div>
        62개 종목의 70거래일 이력을 새로 받는 중이에요.<br>
        처음 열면 <b>2~3분</b> 걸리고, 그 뒤 한 시간은 바로 뜹니다.
      </div>`;
    return;
  }
  if (targetState === 'error' || !TARGET) {
    el.innerHTML = `<div class="section-title">실험 · 매수 관점 스코어</div>
      <div class="empty-state"><div class="empty-icon">⚠️</div>
        불러오지 못했어요. 시간이 오래 걸려 끊겼을 수 있으니 다시 시도해주세요.</div>`;
    return;
  }

  const bt = TARGET.backtest || {};
  const sectorCards = (TARGET.sectors || []).map((s) => `
    <div class="card score-card">
      <div class="score-head">
        <div class="score-rank">${s.rank}</div>
        <div class="score-name">${s.icon} ${s.name}</div>
        <div class="score-value">${s.score.toFixed(1)}</div>
      </div>
      <div class="score-factors">
        <div class="zrow"><span class="zlabel">변동성 압축</span>${expBar(s.squeeze, 'band-low')}<span class="zval">${s.squeeze.toFixed(0)}</span></div>
        <div class="zrow"><span class="zlabel">수급 다이버전스</span>${expBar(s.divergence, 'band-low')}<span class="zval">${s.divergence.toFixed(0)}</span></div>
        <div class="zrow"><span class="zlabel">패널티</span>${expBar(s.penalty, 'band-high')}<span class="zval">${s.penalty ? '−' + s.penalty.toFixed(0) : '0'}</span></div>
      </div>
      <div class="score-detail">
        vol20/vol60 ${s.volRatio}${s.expanding ? ' (발산)' : ''} ·
        최근 60일 낙폭 <b>${s.dd60}%</b> ·
        20일 수급 ${fmtFlow(s.net20)}
      </div>
    </div>`).join('');

  const rows = (TARGET.targets || []).slice(0, 15).map((t, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><b>${t.name}</b><div class="exp-sub">${t.sectorName}</div></td>
      <td class="num">${t.buyScore.toFixed(1)}</td>
      <td class="num">${t.detail.smart.toFixed(0)}</td>
      <td class="num">${t.detail.resilience.toFixed(0)}</td>
      <td class="num">${t.detail.dd60 == null ? '—' : t.detail.dd60 + '%'}</td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="warn-box">
      <div class="warn-title">🧪 검증에서 탈락한 실험입니다 — 매수 후보가 아닙니다</div>
      <div class="warn-body">
        아래 점수가 높다고 오르지 않습니다. 오히려 <b>이후에 더 빠졌습니다</b>.<br>
        지우지 않고 남겨둔 건, 같은 아이디어를 다시 떠올렸을 때 이미 해봤다는 걸
        바로 확인하기 위해서입니다.
      </div>
    </div>

    <div class="card exp-verdict">
      <div class="card-title">백테스트 결과 · 코스피 185종목 3.2년</div>
      <div class="exp-grid">
        <div><span class="exp-k">이후 20일 수익률</span><span class="exp-v bad">IC ${bt.fwdReturnIC}</span></div>
        <div><span class="exp-k">손익비 (수익÷변동성)</span><span class="exp-v bad">IC ${bt.fwdSharpeIC}</span></div>
        <div><span class="exp-k">이후 20일 최대낙폭</span><span class="exp-v warn">IC +${bt.fwdDrawdownIC}</span></div>
        <div><span class="exp-k">위험도(vol60) 대비 증분</span><span class="exp-v bad">+${bt.incrementalOverVol60}</span></div>
      </div>
      <div class="exp-why">
        <b>왜 안 됐나</b> — 수급 다이버전스가 "최근 60일에 10% 이상 빠졌을 것"을 필수 조건으로 겁니다.
        저가 매수 기회를 잡으려던 건데, 이 데이터에서 가장 확실하게 검증된 사실이
        <b>"많이 빠진 종목은 앞으로도 더 빠진다"</b>였습니다. 그래서 저가 매수 필터가 아니라
        위험 종목 필터로 작동했습니다. "기관이 사고 있다"는 조건이 이걸 상쇄해줘야 했는데,
        수급의 수익률 예측력은 108개 가설에서 전부 0으로 나왔습니다.<br>
        점수 상위 1/3이 하위 1/3보다 이후 20일 최대낙폭이 <b>1.72%p 더 컸습니다</b>
        (홀드아웃 ${bt.holdout}, 시점의 81%에서 같은 방향).
      </div>
    </div>

    <div class="section-title">Phase 1 · 섹터 국면 점수 · ${TARGET.asOf} 기준</div>
    ${sectorCards}

    <div class="section-title">Phase 2 · 상위 3개 섹터의 종목 점수</div>
    <div class="table-wrap">
      <table class="exp-table">
        <thead><tr><th>#</th><th>종목</th><th class="num">최종</th><th class="num">스마트머니</th><th class="num">회복력</th><th class="num">낙폭</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div class="signal-note">
      섹터 40% + 종목 60%로 결합한 0~100점입니다.
      섹터 = 변동성 압축 40% + 수급 다이버전스 60% − 패널티,
      종목 = 스마트머니 안정성 65% + 낙폭 회복력 35%.<br>
      가중치는 GAS의 <code>TARGET_W</code> 상수에 모여 있습니다.
      재검증하려면 학습 구간에서만 조정하고 홀드아웃은 새 데이터가 쌓인 뒤 한 번만 여세요.
    </div>
  `;
}

/* ============================================================
   추이 (일/월/연)
   ============================================================ */

/* onLoading은 실제로 네트워크를 타는 경우에만 불린다.
   이게 없으면 GAS 응답이 6~15초 걸리는 동안 화면이 멈춘 것처럼 보인다. */
const TREND_STORE_KEY = 'stock_trend_store';
const TREND_STORE_TTL = 3 * 3600 * 1000;

function trendStore() {
  try { return JSON.parse(localStorage.getItem(TREND_STORE_KEY) || '{}'); } catch (e) { return {}; }
}

function trendStoreGet(key) {
  const box = trendStore()[key];
  if (!box || Date.now() - box.at > TREND_STORE_TTL) return null;
  return box.data;
}

/* 응답이 커서 다 담으면 localStorage 한도를 넘는다. 최근 것만 남긴다. */
function trendStorePut(key, data) {
  try {
    const all = trendStore();
    all[key] = { at: Date.now(), data: data };
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, 8);
    const trimmed = {};
    keys.forEach((k) => { trimmed[k] = all[k]; });
    localStorage.setItem(TREND_STORE_KEY, JSON.stringify(trimmed));
  } catch (e) { /* 용량 초과는 무시 */ }
}

async function fetchTrend(onLoading) {
  const cacheKey = `${trendPeriod}|${marketFilter}|${trendMetric}|${trendInvestor}|${trendFrom}|${trendTo}`;
  if (trendCache[cacheKey]) {
    TREND = trendCache[cacheKey];
    trendState = 'ready';
    return;
  }
  // 지난번 응답이 남아 있으면 먼저 그려주고, 아래에서 새로 받아 덮어쓴다
  const stored = trendStoreGet(cacheKey);
  if (stored) {
    trendCache[cacheKey] = stored;
    TREND = stored;
    trendState = 'ready';
    onLoading = null;
  }
  if (!isConfigured()) {
    trendState = 'error';
    return;
  }
  trendState = 'loading';
  if (onLoading) onLoading();
  try {
    const res = await fetch(`${gasUrl('history')}&period=${trendPeriod}&market=${marketFilter}&metric=${trendMetric}`
      + `&investor=${trendInvestor}&from=${trendFrom}&to=${trendTo}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    trendCache[cacheKey] = data;
    trendStorePut(cacheKey, data);
    TREND = data;
    trendState = 'ready';
  } catch (err) {
    if (!stored) trendState = 'error';
  }
}

/* '전체'는 섹터를 하나로 접어서 한 줄만 그린다 — 6개 시리즈를 겹쳐 그리면
   막대든 선이든 읽을 수가 없다. 섹터별로 보려면 칩으로 골라 들어간다. */
function trendPoints(sectorId) {
  if (!TREND) return [];
  if (sectorId !== 'all') {
    const s = TREND.series.find((x) => x.sectorId === sectorId);
    return s ? s.points : [];
  }
  return TREND.buckets.map((_, i) => {
    const vals = TREND.series.map((s) => s.points[i]).filter((v) => v !== null && v !== undefined);
    if (!vals.length) return null;
    const sum = vals.reduce((a, b) => a + b, 0);
    return TREND.metric === 'price' ? +(sum / vals.length).toFixed(2) : Math.round(sum);
  });
}

function trendValueLabel(v) {
  if (v === null || v === undefined) return '—';
  if (!TREND) return String(v);
  if (TREND.metric === 'flow') return fmtFlow(v);
  if (TREND.metric === 'price') return fmtPct(v);
  return `${v}건`;
}

function bucketLabel(b) {
  if (trendPeriod === 'year') return b;
  if (trendPeriod === 'month') {
    const [y, m] = b.split('-');
    return `${y.slice(2)}.${Number(m)}`;
  }
  const [, m, d] = b.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/* 라이브러리 없이 인라인 SVG로 그린다. 막대는 viewBox로 폭에 맞춰 늘어나지만
   축 라벨까지 같이 축소되면 폰에서 못 읽는다 — 라벨만 HTML로 얹어 실제 px을 유지한다. */
function trendChart(buckets, points) {
  const W = 720;
  const H = 200;
  const padX = 6;

  const vals = points.filter((v) => v !== null && v !== undefined);
  if (!vals.length) return '';

  const maxV = Math.max(...vals, 0);
  const minV = Math.min(...vals, 0);
  const span = (maxV - minV) || 1;
  const zeroY = H * (maxV / span);
  const n = buckets.length;
  const slot = (W - padX * 2) / n;
  const barW = Math.max(2, Math.min(72, slot * 0.55));

  const bars = points.map((v, i) => {
    if (v === null || v === undefined) return '';
    const cx = padX + slot * i + slot / 2;
    const h = Math.abs(v) / span * H;
    const y = v >= 0 ? zeroY - h : zeroY;
    return `<rect class="${v >= 0 ? 'trend-bar-up' : 'trend-bar-down'}" x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2"><title>${buckets[i]} · ${trendValueLabel(v)}</title></rect>`;
  }).join('');

  // 라벨이 겹치지 않을 만큼만 남긴다
  const step = Math.max(1, Math.ceil(n / 8));
  const labels = buckets.map((b, i) => {
    if (i % step !== 0 && i !== n - 1) return '';
    const pct = ((i + 0.5) / n) * 100;
    return `<span class="trend-xlab" style="left:${pct.toFixed(2)}%">${bucketLabel(b)}</span>`;
  }).join('');

  return `
    <svg class="trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
      <line class="trend-zero" x1="0" y1="${zeroY.toFixed(1)}" x2="${W}" y2="${zeroY.toFixed(1)}" />
      ${bars}
    </svg>
    <div class="trend-xrow">${labels}</div>
  `;
}

/* 수급은 합계로, 등락률은 복리로 누적한다 */
function cumulativeOf(points, metric) {
  let acc = metric === 'price' ? 1 : 0;
  return points.map((v) => {
    if (v === null || v === undefined) return null;
    if (metric === 'price') {
      acc *= 1 + v / 100;
      return +((acc - 1) * 100).toFixed(2);
    }
    acc += v;
    return Math.round(acc);
  });
}

function renderTrendPage(el) {
  const investorSeg = trendMetric === 'flow'
    ? `<div class="sort-bar">
         ${['net', 'frgn', 'org', 'indi'].map((iv) => `<button class="sort-btn ${trendInvestor === iv ? 'active' : ''}" data-investor="${iv}">${INVESTOR_LABEL[iv]}</button>`).join('')}
       </div>`
    : '';

  const segs = `
    <div class="trend-controls">
      <div class="sort-bar">
        ${['day', 'month', 'year'].map((p) => `<button class="sort-btn ${trendPeriod === p ? 'active' : ''}" data-period="${p}">${PERIOD_LABEL[p]}</button>`).join('')}
      </div>
      <div class="sort-bar">
        ${['flow', 'price', 'news'].map((m) => `<button class="sort-btn ${trendMetric === m ? 'active' : ''}" data-metric="${m}">${METRIC_LABEL[m]}</button>`).join('')}
      </div>
      ${investorSeg}
    </div>
    <div class="range-bar">
      <label class="range-label">기간</label>
      <input type="date" class="range-input" id="trFrom" value="${trendFrom}">
      <span class="range-sep">~</span>
      <input type="date" class="range-input" id="trTo" value="${trendTo}">
      ${(trendFrom || trendTo) ? '<button class="sort-btn" id="trClear">전체</button>' : ''}
    </div>
  `;

  if (trendState === 'loading' || trendState === 'idle') {
    el.innerHTML = `<div class="section-title">추이</div>${segs}<div class="empty-state">불러오는 중이에요…</div>`;
    bindTrendControls(el);
    return;
  }

  if (trendState === 'error') {
    el.innerHTML = `
      <div class="section-title">추이</div>${segs}
      <div class="empty-state"><div class="empty-icon">⚠️</div>추이 데이터를 불러오지 못했어요. GAS를 최신 코드로 다시 배포했는지 확인해주세요.</div>`;
    bindTrendControls(el);
    return;
  }

  if (trendMetric === 'flow' && marketFilter === 'us') {
    el.innerHTML = `
      <div class="section-title">추이</div>${segs}
      <div class="empty-state"><div class="empty-icon">🇺🇸</div>미장은 외국인·기관 순매매 공개 데이터가 없어요.<br>등락률이나 뉴스로 보거나, 국장 탭에서 확인하세요.</div>`;
    bindTrendControls(el);
    return;
  }

  const buckets = (TREND && TREND.buckets) || [];
  if (!buckets.length) {
    const backfillLink = isConfigured()
      ? `<div class="signal-note">아직 쌓인 기록이 없어요. <a class="banner-link" href="${gasUrl('backfill')}" target="_blank" rel="noopener">과거 데이터 채우기</a>를 열면 작년치까지 채워집니다. (안 끝나면 새로고침해서 이어서 진행)</div>`
      : `<div class="signal-note">GAS를 먼저 연결해주세요.</div>`;
    el.innerHTML = `
      <div class="section-title">추이</div>${segs}
      <div class="empty-state"><div class="empty-icon">📈</div>${trendMetric === 'news' ? '뉴스 언급량은 연동한 날부터 쌓여요.' : '이 기간에는 기록이 없어요.'}</div>
      ${trendMetric === 'news' ? '' : backfillLink}`;
    bindTrendControls(el);
    return;
  }

  const points = trendPoints(trendSector);
  const cum = cumulativeOf(points, TREND.metric);
  const vals = points.filter((v) => v !== null && v !== undefined);
  const total = vals.reduce((a, b) => a + b, 0);
  const lastCum = cum.filter((v) => v !== null).slice(-1)[0];
  const summary = TREND.metric === 'price'
    ? `누적 ${fmtPct(lastCum || 0)}`
    : `합계 ${trendValueLabel(TREND.metric === 'flow' ? Math.round(total) : total)}`;

  const chips = [{ sectorId: 'all', name: '전체', icon: '📊' }].concat(TREND.series)
    .map((s) => `<button class="market-btn ${trendSector === s.sectorId ? 'active' : ''}" data-sector="${s.sectorId}">${s.icon} ${s.name}</button>`)
    .join('');

  const rows = buckets.map((b, i) => ({ b, v: points[i], c: cum[i] }))
    .filter((r) => r.v !== null && r.v !== undefined)
    .reverse()
    .slice(0, 15);

  const metricHead = TREND.metric === 'flow' ? `${INVESTOR_LABEL[trendInvestor]} 수급` : METRIC_LABEL[TREND.metric];

  el.innerHTML = `
    <div class="section-title-row">
      <div class="section-title">${MARKET_LABEL[marketFilter]} · ${metricHead} ${PERIOD_LABEL[trendPeriod]} 추이</div>
    </div>
    ${segs}
    <div class="market-seg trend-chips">${chips}</div>
    <div class="card trend-card">
      <div class="trend-head">
        <div class="trend-title">${trendSector === 'all' ? '전체 섹터' : (TREND.series.find((s) => s.sectorId === trendSector) || {}).name || ''}</div>
        <div class="trend-summary">${summary}</div>
      </div>
      ${trendChart(buckets, points)}
      <div class="trend-foot">${buckets[0]} ~ ${buckets[buckets.length - 1]} · ${buckets.length}개 구간</div>
    </div>
    <div class="section-title">기간별 값</div>
    <div class="table-wrap">
      <table class="detail-stock-table">
        <thead><tr><th>기간</th><th>${metricHead}</th><th>누적</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${r.b}</td>
              <td class="${r.v >= 0 ? 'val-up' : 'val-down'}">${trendValueLabel(r.v)}</td>
              <td class="${r.c >= 0 ? 'val-up' : 'val-down'}">${trendValueLabel(r.c)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${constituentsHtml()}
    ${TREND.metric === 'price' ? `<div class="signal-note">월·연도 등락률은 일별 수익률을 곱해 누적한 값이에요 (단순 합계가 아닙니다).</div>` : ''}
    ${TREND.metric === 'flow' ? `<div class="signal-note">수급은 국내 상장 종목만 집계돼요. 미국 종목은 공개 데이터가 없습니다.</div>` : ''}
  `;

  bindTrendControls(el);
  el.querySelectorAll('[data-sector]').forEach((btn) => {
    btn.addEventListener('click', () => {
      trendSector = btn.dataset.sector;
      render();
    });
  });
}

/* 어떤 종목으로 집계했는지 보여준다 — ETF 리밸런싱으로 구성이 바뀌므로 확인이 필요하다 */
function constituentsHtml() {
  const c = TREND && TREND.constituents;
  if (!c) return '';

  const ids = trendSector === 'all' ? TREND.series.map((s) => s.sectorId) : [trendSector];
  const blocks = ids.map((id) => {
    const info = c[id];
    if (!info) return '';
    const sec = TREND.series.find((s) => s.sectorId === id) || {};
    const list = [];
    if (isKrFilter_(marketFilter) || marketFilter === 'all') list.push(...(info.kr || []));
    if (marketFilter === 'us' || marketFilter === 'all') list.push(...(info.us || []));
    if (!list.length) return '';
    return `
      <div class="const-row">
        <div class="const-head">${sec.icon || ''} ${sec.name || id}${info.etf ? ` <span class="const-etf">${info.etf}</span>` : ''}</div>
        <div class="const-list">${list.join(' · ')}</div>
      </div>`;
  }).filter(Boolean).join('');

  if (!blocks) return '';
  return `
    <div class="section-title">집계에 쓴 종목</div>
    <div class="card const-card">${blocks}</div>
    <div class="signal-note">ETF가 있는 섹터는 그 ETF의 구성종목 상위 10개를 씁니다. 리밸런싱되면 자동으로 바뀌고, 바뀐 날짜는 시트에 남습니다.</div>`;
}

function bindTrendControls(el) {
  const reload = async () => { await fetchTrend(render); render(); };

  el.querySelectorAll('[data-period]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      trendPeriod = btn.dataset.period;
      localStorage.setItem(TREND_PERIOD_KEY, trendPeriod);
      await reload();
    });
  });
  el.querySelectorAll('[data-metric]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      trendMetric = btn.dataset.metric;
      localStorage.setItem(TREND_METRIC_KEY, trendMetric);
      await reload();
    });
  });
  el.querySelectorAll('[data-investor]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      trendInvestor = btn.dataset.investor;
      localStorage.setItem(TREND_INVESTOR_KEY, trendInvestor);
      await reload();
    });
  });

  const from = el.querySelector('#trFrom');
  const to = el.querySelector('#trTo');
  if (from) from.addEventListener('change', async () => { trendFrom = from.value; await reload(); });
  if (to) to.addEventListener('change', async () => { trendTo = to.value; await reload(); });
  const clear = el.querySelector('#trClear');
  if (clear) clear.addEventListener('click', async () => { trendFrom = ''; trendTo = ''; await reload(); });
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
  if (marketFilter === 'us') {
    el.innerHTML = `
      <div class="section-title">선제 신호</div>
      <div class="empty-state">
        <div class="empty-icon">🇺🇸</div>
        미장은 외국인·기관 수급 공개 데이터가 없어 자금-뉴스 괴리를 계산할 수 없어요.<br>선제 신호는 <b>국장</b> 탭에서 확인하세요.
      </div>
    `;
    return;
  }

  const signals = computeSignals();
  const skipped = viewSectors().filter((s) => !hasFlowData(s) || !s.newsBaselineReady);
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
  const s = viewSectors().find((x) => x.id === id);
  if (!s) return;
  const showFlowCol = marketFilter !== 'us' && hasFlowData(s);
  const marketTag = marketFilter === 'all' ? '' : ` <span class="pill pill-neutral">${MARKET_LABEL[marketFilter]}</span>`;
  const box = document.getElementById('modalBox');
  box.innerHTML = `
    <div class="modal-head">
      <div class="modal-title"><span class="sector-icon">${s.icon}</span>${s.name}${marketTag}</div>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    ${hasFlowData(s)
      ? `<span class="pill ${pillClass(s.netFlow)}">${fmtFlow(s.netFlow)} · 평소 대비 ${fmtPct(s.flowChangePct)}</span>
         <div class="modal-note">수급은 ${s.flowDate || '—'} 확정치예요. 등락률은 실시간이라 기준일이 다릅니다.</div>`
      : `<span class="pill ${pillClass(avgChangeOf(s))}">평균 ${fmtPct(avgChangeOf(s))}</span>
         <div class="modal-note">${marketFilter === 'us'
           ? '미국 시장은 외국인·기관 순매매 공개 데이터가 없어 등락률·뉴스로만 봅니다.'
           : '국내 상장 종목이 없어 외국인·기관 순매매 공개 데이터가 없어요.'}</div>`}
    <table class="detail-stock-table">
      <thead>
        <tr><th>종목</th><th>등락률</th>${showFlowCol ? '<th>순매매(억)</th>' : ''}</tr>
      </thead>
      <tbody>
        ${s.stocks.map((st) => `
          <tr>
            <td>${st.name}${marketFilter === 'all' ? ` <span style="color:var(--text-faint)">${st.market}</span>` : ''}</td>
            <td class="${st.changePct >= 0 ? 'val-up' : 'val-down'}">${fmtPct(st.changePct)}</td>
            ${showFlowCol ? `<td class="${st.flow == null ? '' : (st.flow >= 0 ? 'val-up' : 'val-down')}">${st.flow == null ? '—' : fmtFlow(st.flow)}</td>` : ''}
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="section-title" style="margin-top:20px;">관련 뉴스</div>
    <div class="news-list">${sectorNewsHtml(s)}</div>
  `;
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

/* 집계에 쓰인 기사와 같은 목록이라 화면의 건수와 기사 목록이 어긋나지 않는다 */
function sectorNewsHtml(s) {
  const items = (s.newsItems || []).filter((n) => n && n.title);
  if (!items.length) {
    return `<div class="news-filtered">최근 24시간 안에 증시와 관련된 기사가 없어요.</div>`;
  }
  const filtered = s.newsRaw && s.newsRaw > s.newsVolume
    ? `<div class="news-filtered">증시와 무관하거나 중복인 기사 ${s.newsRaw - s.newsVolume}건은 집계에서 뺐어요.</div>`
    : '';
  return items.map((n) => `
    <div class="news-item">
      ${n.link ? `<a class="news-item-title news-link" href="${n.link}" target="_blank" rel="noopener">${n.title}</a>`
               : `<div class="news-item-title">${n.title}</div>`}
      <div class="news-item-meta">${n.source || '출처 미상'} · ${n.lang === 'en' ? '해외' : '국내'} · ${newsAgo(n.pubDate)}</div>
    </div>`).join('') + filtered;
}

function newsAgo(pubDate) {
  const t = new Date(pubDate).getTime();
  if (!isFinite(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
  return `${Math.floor(m / 1440)}일 전`;
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
    <p class="settings-desc">기본 연결값이 이미 들어 있어서 어느 기기에서든 주소만 열면 바로 실시간 데이터가 뜹니다. 아래 값은 GAS를 새로 배포했을 때만 바꾸면 돼요.</p>
    <div class="form-group">
      <label class="form-label">웹앱 URL</label>
      <input type="text" class="form-control" id="cfgUrl" placeholder="https://script.google.com/macros/s/.../exec" value="${c.url}">
    </div>
    <div class="form-group">
      <label class="form-label">SECRET KEY</label>
      <input type="text" class="form-control" id="cfgKey" placeholder="Code.gs의 SECRET_KEY 값" value="${c.key}">
    </div>
    <div class="settings-actions">
      <button class="btn btn-ghost" id="cfgClearBtn">연결 해제</button>
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
    clearConfig();
    connStatus = 'off';
    SECTORS = [];
    EVENTS = [];
    ALERTS = [];
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
    resultEl.textContent = '❌ 연결에 실패했어요. URL/키를 확인해주세요.';
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
   새로고침
   ============================================================ */

async function doRefresh() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  setTimeout(() => btn.classList.remove('spinning'), 700);

  if (isConfigured()) {
    await fetchDashboard();
    trendCache = {};
    if (currentPage === 'trend') await fetchTrend(render);
  }
  render();
}

/* ============================================================
   초기화
   ============================================================ */

function init() {
  document.querySelectorAll('.tab-btn, .bottom-nav-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.tab-btn, .bottom-nav-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll(`[data-page="${btn.dataset.page}"]`).forEach((b) => b.classList.add('active'));
      currentPage = btn.dataset.page;
      render();
      if (currentPage === 'trend' && trendState !== 'ready') {
        await fetchTrend(render);
        render();
      }
      if (currentPage === 'experiment') {
        await fetchTarget(render);
      }
      if (currentPage === 'risk') {
        await fetchRisk(render);
        render();
      }
    });
  });

  document.querySelectorAll('#marketSeg .market-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.market === marketFilter);
    btn.addEventListener('click', async () => {
      marketFilter = btn.dataset.market;
      localStorage.setItem(MARKET_KEY, marketFilter);
      document.querySelectorAll('#marketSeg .market-btn').forEach((b) => b.classList.toggle('active', b.dataset.market === marketFilter));
      render();
      if (currentPage === 'trend') {
        await fetchTrend(render);
        render();
      }
      if (currentPage === 'risk') {
        RISK = null;
        await fetchRisk(render);
        render();
      }
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
      SECTORS = parsed.sectors || [];
      EVENTS = parsed.events || [];
      ALERTS = parsed.alerts || [];
      connStatus = 'live';
    } catch (e) { /* 무시 */ }
  }

  render();

  if (isConfigured()) {
    fetchDashboard().then(() => {
      render();
      // 추이 탭을 누르기 전에 미리 받아둔다 (첫 조회가 GAS에서 6초 넘게 걸린다)
      if (currentPage !== 'trend') {
        fetchTrend().then(() => { if (currentPage === 'trend') render(); });
      }
    });
  }

  setInterval(doRefresh, AUTO_REFRESH_MS);
  setInterval(() => {
    document.getElementById('updateTime').textContent = timeAgoLabel();
  }, 30 * 1000);
}

document.addEventListener('DOMContentLoaded', init);
