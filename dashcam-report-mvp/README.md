# 블박신고 — 블랙박스 교통위반 자동 신고 도우미 (MVP)

블랙박스에서 넘어온 영상을 "AI가 분석했다고 가정"하고, 추출된 위반 정보를
클립보드에 담아 **안전신문고 앱으로 바로 넘겨주는** 원클릭 신고 경험의 프로토타입.

백엔드도 AI도 없다. 검증 목표는 딱 둘이다.
1. 사용자가 느끼는 흐름(알림 → 분석 → 접수)이 실제로 "원클릭"처럼 느껴지는가
2. 앱 간 데이터 전달(클립보드 + 딥링크)이 실기기에서 실제로 동작하는가

## 실행

```bash
cd dashcam-report-mvp
npm install
npx expo start
```

Expo Go 앱으로 QR 코드를 스캔하면 바로 뜬다.
딥링크 동작은 **에뮬레이터가 아니라 안전신문고가 설치된 실기기**에서 확인할 것.

## 파일 구조

| 파일 | 역할 |
|---|---|
| `App.js` | 화면 전체(알림 카드 · 가상 썸네일 · 분석 로딩 · 결과 · 하단 CTA) |
| `src/mockAnalysis.js` | 가짜 AI 분석(2초 지연 + 고정 결과), 신고 초안 생성 |
| `src/safetyReport.js` | 안전신문고 실행 로직 — 스킴 → 인텐트 → 스토어 → 웹 폴백 |
| `plugins/withExternalAppQueries.js` | Android 11+ `<queries>` 선언용 config plugin |

## 앱 간 연동이 동작하는 원리

안전신문고는 외부 앱이 신고를 대신 접수할 수 있는 공개 API를 제공하지 않는다.
서드파티가 할 수 있는 최선은 **입력 부담을 없애 주는 것**이고, 그래서 접수 버튼은
두 가지를 한 번의 탭에서 연달아 실행한다.

1. **클립보드 복사** — `expo-clipboard`의 `setStringAsync()`로 신고 초안을 담는다.
   앱 전환 전에 반드시 끝나야 하므로 `await`으로 순서를 보장한다.
2. **안전신문고 실행** — `Linking` API로 아래 순서를 시도하고, 하나라도 성공하면 멈춘다.

```
① 커스텀 스킴  safereport:// …          → 앱이 있으면 즉시 실행
② Android 인텐트 intent://…;package=…;end → 스킴이 바뀌었어도 패키지명으로 실행
③ 스토어      market:// / itms-apps://   → 미설치 시 설치 페이지
④ 모바일 웹   safetyreport.go.kr         → 스토어까지 막힌 환경의 최종 안전판
```

`Linking.canOpenURL()`은 신뢰할 수 없다는 점이 핵심이다.
- Android 11+는 `<queries>` 선언이 없으면 앱이 깔려 있어도 항상 `false`
- iOS는 `LSApplicationQueriesSchemes`에 없는 스킴이면 항상 `false`

그래서 `canOpenURL`은 힌트로만 쓰고, `false`여도 `openURL`을 실제로 던져 본 뒤
예외로 성패를 판정한다(`src/safetyReport.js`의 `tryOpen`).

## ⚠️ 실기기 검증이 필요한 값

안전신문고의 커스텀 스킴/패키지명은 공식 문서가 없고 업데이트로 바뀔 수 있다.
`src/safetyReport.js`의 `SAFETY_REPORT` 상수를 실측값으로 교체할 것.

```bash
# Android 패키지명
adb shell pm list packages | grep -i safe
# 또는 Play 스토어 주소의 ?id= 뒤 문자열

# Android 스킴
adb shell dumpsys package <패키지명> | grep -i scheme

# iOS 스킴: Safari 주소창에 `스킴://` 입력해 앱이 뜨는지 확인
```

값이 틀려도 ③④ 폴백 덕분에 사용자 흐름은 끊기지 않는다.

## 다음 단계 (MVP 이후)

- `src/mockAnalysis.js`의 `analyzeClip()` 내부만 실제 API 호출로 교체(시그니처 유지)
- 블랙박스 Wi-Fi 연동 / 갤러리 선택으로 실제 클립 입력
- EAS dev client 빌드 후 `expo-intent-launcher`로 패키지 직접 실행 경로 추가
- 영상 파일 자체를 넘기려면 Android `ACTION_SEND` + `FileProvider` 공유 시트 필요
