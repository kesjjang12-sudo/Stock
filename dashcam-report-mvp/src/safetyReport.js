import { Linking, Platform } from 'react-native';

/* ============================================================================
 * 안전신문고 앱 호출(딥링크 / 인텐트) 모듈
 * ============================================================================
 *
 * ▸ 왜 딥링크인가?
 *   안전신문고는 외부 앱이 신고를 대신 접수해 주는 공개 API 를 제공하지 않는다.
 *   (행정안전부 신고 시스템이라 인증/본인확인이 앱 안에서 끝나야 한다.)
 *   따라서 서드파티 앱이 할 수 있는 최선은
 *     ① 신고에 필요한 텍스트를 클립보드에 미리 담아 두고
 *     ② 안전신문고 앱을 "열어 주는" 것
 *   까지다. 사용자는 붙여넣기 한 번으로 입력을 끝낸다.
 *   → 이 MVP 가 검증하려는 "원클릭 신고 경험"의 핵심이 바로 이 앱 간 데이터 전달이다.
 *
 * ▸ 앱을 여는 3가지 방식과 선택 기준
 *   1) URL Scheme  : `safereport://` 처럼 앱이 스스로 등록한 커스텀 스킴.
 *                    iOS/Android 공통으로 동작하고 Expo Go 에서도 쓸 수 있어 1순위.
 *   2) Android Intent : 패키지명을 직접 지정해 실행 (`expo-intent-launcher`,
 *                    또는 Chrome 이 해석하는 `intent://...#Intent;package=...;end` 문법).
 *                    스킴이 없거나 바뀌어도 패키지명만 맞으면 뜬다. 아래 launchViaAndroidIntent 참고.
 *   3) App Link / Universal Link : `https://` 주소를 앱이 가로채는 방식.
 *                    앱이 없으면 브라우저(모바일 웹)로 열려서 "설치 안내"까지 자연히 해결된다.
 *                    → 그래서 최종 폴백으로 둔다.
 *
 * ▸ Linking.canOpenURL() 의 함정
 *   - Android 11+ : <queries> 선언이 없으면 앱이 깔려 있어도 무조건 false.
 *     (plugins/withExternalAppQueries.js 로 선언하지만 Expo Go 에서는 반영 안 됨)
 *   - iOS         : Info.plist 의 LSApplicationQueriesSchemes 에 없는 스킴은 항상 false.
 *     (app.json 의 ios.infoPlist 에 등록해 뒀다)
 *   ⇒ 결론: canOpenURL 은 "true 면 확실히 열린다" 정도의 힌트로만 쓰고,
 *     false 여도 openURL 을 실제로 한 번 던져 본 뒤 예외를 잡는 게 현실적으로 가장 잘 뜬다.
 *     아래 tryOpen() 이 그 전략을 구현한다.
 *
 * ▸ ⚠️ 스킴/패키지명은 반드시 실기기에서 검증할 것
 *   안전신문고의 커스텀 스킴과 패키지명은 앱 업데이트로 바뀔 수 있고 공식 문서도 없다.
 *   확인 방법:
 *     - Android 패키지명 : Play 스토어 웹 주소 `.../details?id=<여기가 패키지명>`
 *                          또는 `adb shell pm list packages | grep -i safe`
 *     - Android 스킴      : `adb shell dumpsys package <패키지명> | grep -i scheme`
 *     - iOS 스킴          : Safari 주소창에 `스킴://` 입력해 앱이 뜨는지 확인,
 *                          또는 App Store 앱의 Info.plist(CFBundleURLTypes) 확인
 *   아래 값들은 후보군이며, 하나라도 맞으면 열리도록 배열로 순차 시도한다.
 *   전부 실패해도 스토어 → 모바일 웹 순으로 떨어지므로 사용자 경험은 끊기지 않는다.
 * ==========================================================================*/

export const SAFETY_REPORT = {
  // 커스텀 스킴 후보 (앞에서부터 순차 시도)
  schemes: ['safereport://', 'safetyreport://', 'safepeople://'],

  // Android 패키지명 후보
  androidPackages: ['kr.go.safereport', 'kr.go.safepeople'],

  // iOS App Store 앱 ID (숫자만). 확인 방법: App Store 공유 → 링크 복사 → `id` 뒤 숫자
  iosAppStoreId: '1188917174',

  // 최종 폴백: 안전신문고 모바일 웹 (앱이 없으면 브라우저로 신고 가능)
  webUrl: 'https://www.safetyreport.go.kr/#safereport',

  // 스토어 검색 폴백 (패키지명/앱ID 가 틀렸을 때도 반드시 뜨는 안전판)
  androidStoreSearch: 'https://play.google.com/store/search?q=%EC%95%88%EC%A0%84%EC%8B%A0%EB%AC%B8%EA%B3%A0&c=apps',
  iosStoreSearch: 'https://apps.apple.com/kr/search?term=%EC%95%88%EC%A0%84%EC%8B%A0%EB%AC%B8%EA%B3%A0',
};

/**
 * openURL 을 안전하게 시도한다.
 * canOpenURL 이 false 여도(위의 함정 참고) 일단 던져 보고 예외로 판정한다.
 * @returns {Promise<boolean>} 실제로 열렸으면 true
 */
async function tryOpen(url) {
  try {
    // 힌트 용도: true 면 곧바로 열고, false 면 아래에서 그래도 한 번 시도한다.
    const supported = await Linking.canOpenURL(url).catch(() => false);
    if (supported) {
      await Linking.openURL(url);
      return true;
    }
  } catch (_) {
    // canOpenURL 자체가 던지는 경우도 있으므로 무시하고 진행
  }

  try {
    await Linking.openURL(url);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Android 전용: 패키지명을 직접 지정해 실행.
 *
 * `intent://` 문법은 Android 의 Intent.parseUri() 규격이다.
 *   intent://<host/path>#Intent;
 *     scheme=<스킴>;
 *     package=<패키지명>;
 *     S.browser_fallback_url=<앱이 없을 때 열 URL(인코딩)>;
 *   end
 * 브라우저(Chrome/삼성인터넷)가 이 문법을 해석해 앱을 띄우고,
 * 앱이 없으면 browser_fallback_url 로 알아서 넘어간다 —— 폴백까지 OS 가 처리해 주는 게 장점.
 *
 * 다만 RN 의 Linking.openURL 은 이 URI 를 그대로 ACTION_VIEW 로 던지기 때문에
 * 이를 해석해 줄 앱(브라우저)이 잡히지 않으면 실패할 수 있다. 그래서 "보조 수단"으로만 쓴다.
 *
 * 네이티브 빌드(EAS/dev client)라면 아래 방식이 더 확실하다:
 *
 *   import * as IntentLauncher from 'expo-intent-launcher';
 *   await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
 *     packageName: 'kr.go.safereport',
 *     category: 'android.intent.category.LAUNCHER',
 *   });
 *
 * (Expo Go 에서는 <queries> 선언이 없어 패키지 조회가 막히므로 이 MVP 기본 경로에서는 제외)
 */
async function launchViaAndroidIntent(pkg) {
  const fallback = encodeURIComponent(SAFETY_REPORT.webUrl);
  const intentUrl =
    `intent://#Intent;package=${pkg};S.browser_fallback_url=${fallback};end`;
  return tryOpen(intentUrl);
}

/** 스토어(설치 페이지)로 보낸다. 앱 스토어 앱 → 웹 스토어 순으로 폴백. */
async function openStore() {
  if (Platform.OS === 'android') {
    const pkg = SAFETY_REPORT.androidPackages[0];
    // market:// 는 Play 스토어 "앱"을 직접 연다 (웹 리다이렉트 한 단계 절약)
    if (await tryOpen(`market://details?id=${pkg}`)) return 'store';
    if (await tryOpen(`https://play.google.com/store/apps/details?id=${pkg}`)) return 'store';
    if (await tryOpen(SAFETY_REPORT.androidStoreSearch)) return 'store-search';
    return null;
  }

  if (Platform.OS === 'ios') {
    const id = SAFETY_REPORT.iosAppStoreId;
    // itms-apps:// 는 App Store "앱"을 직접 연다
    if (await tryOpen(`itms-apps://apps.apple.com/kr/app/id${id}`)) return 'store';
    if (await tryOpen(`https://apps.apple.com/kr/app/id${id}`)) return 'store';
    if (await tryOpen(SAFETY_REPORT.iosStoreSearch)) return 'store-search';
    return null;
  }

  return null;
}

/**
 * 안전신문고 열기 — 전체 폴백 체인.
 *
 *   1. 커스텀 스킴 (safereport:// …)        → 앱이 있으면 즉시 실행
 *   2. Android intent:// (패키지 지정)      → 스킴이 바뀌었어도 실행
 *   3. 스토어 (market:// / itms-apps://)    → 앱 미설치 시 설치 페이지
 *   4. 모바일 웹 (safetyreport.go.kr)       → 스토어조차 막힌 환경의 최종 안전판
 *
 * @returns {Promise<'app'|'store'|'store-search'|'web'|'failed'>} 어디로 보냈는지
 */
export async function openSafetyReport() {
  // 1. 커스텀 스킴
  for (const scheme of SAFETY_REPORT.schemes) {
    if (await tryOpen(scheme)) return 'app';
  }

  // 2. Android 인텐트
  if (Platform.OS === 'android') {
    for (const pkg of SAFETY_REPORT.androidPackages) {
      if (await launchViaAndroidIntent(pkg)) return 'app';
    }
  }

  // 3. 스토어
  const store = await openStore();
  if (store) return store;

  // 4. 모바일 웹
  if (await tryOpen(SAFETY_REPORT.webUrl)) return 'web';

  return 'failed';
}
