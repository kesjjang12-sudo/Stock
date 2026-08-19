/**
 * Android 11(API 30)+ 패키지 가시성(package visibility) 대응 config plugin.
 *
 * 원리:
 *   Android 11부터는 내 앱이 "다른 앱이 깔려 있는지" 조회하려면
 *   AndroidManifest.xml 에 <queries> 로 대상 앱을 미리 선언해야 한다.
 *   선언하지 않으면 Linking.canOpenURL() 이 앱 설치 여부와 무관하게 항상 false 를 돌려주고,
 *   PackageManager 조회도 NameNotFoundException 이 난다.
 *
 * 주의:
 *   config plugin 은 prebuild(= EAS Build / expo prebuild) 때만 적용된다.
 *   Expo Go 로 실행할 때는 Expo Go 앱의 매니페스트가 쓰이므로 이 선언이 반영되지 않는다.
 *   그래서 src/safetyReport.js 는 canOpenURL 결과를 "참고"로만 쓰고,
 *   실패하더라도 실제 openURL 을 한 번 더 시도하는 방어 로직을 갖고 있다.
 */
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

// 조회하려는 외부 앱들 (패키지명 / 스킴)
const PACKAGES = ['kr.go.safereport', 'kr.go.safepeople'];
const SCHEMES = ['safereport', 'safetyreport'];

module.exports = function withExternalAppQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.queries = manifest.queries ?? [{}];
    const queries = manifest.queries[0];

    queries.package = [
      ...(queries.package ?? []),
      ...PACKAGES.map((name) => ({ $: { 'android:name': name } })),
    ];

    // scheme 기반 조회도 함께 열어 둔다 (VIEW intent 로 스킴을 처리하는 앱 탐색)
    queries.intent = [
      ...(queries.intent ?? []),
      ...SCHEMES.map((scheme) => ({
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        data: [{ $: { 'android:scheme': scheme } }],
      })),
    ];

    return cfg;
  });
};

// AndroidConfig 는 사용하지 않지만, 확장 시 참고용으로 남겨 둔다.
void AndroidConfig;
