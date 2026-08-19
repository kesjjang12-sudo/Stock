import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { MOCK_CLIP, analyzeClip, buildReportDraft } from './src/mockAnalysis';
import { openSafetyReport } from './src/safetyReport';

/* ---------------------------------------------------------------------------
 * 디자인 토큰
 * NativeWind 대신 StyleSheet 를 골랐다. MVP 는 "복사 → 바로 실행"이 목적이라
 * babel/metro 설정 추가 없이 Expo Go 에서 그대로 돌아가는 쪽이 낫다.
 * -------------------------------------------------------------------------*/
const C = {
  bg: '#F4F6FA',
  card: '#FFFFFF',
  ink: '#0F172A',
  sub: '#64748B',
  line: '#E5E9F0',
  brand: '#2563EB',
  brandDim: '#93B4F7',
  warn: '#F59E0B',
  danger: '#EF4444',
  ok: '#10B981',
};

const ANALYSIS_STEPS = [
  '영상 프레임 추출 중…',
  '차량 객체 탐지 중…',
  '번호판 OCR 판독 중…',
];

/* =========================================================================
 * 가상 썸네일 — 이미지 에셋 없이 View 만으로 그린 블랙박스 화면
 * (실제 앱이라면 expo-video-thumbnails 로 클립 첫 프레임을 뽑아 <Image> 로 표시)
 * =======================================================================*/
function MockThumbnail({ timeText }) {
  return (
    <View style={s.thumb}>
      <View style={s.thumbSky} />
      <View style={s.thumbRoad}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[s.laneDash, { bottom: 10 + i * 26, width: 26 - i * 4 }]} />
        ))}
      </View>

      {/* 앞차 (위반 차량) */}
      <View style={s.thumbCar}>
        <View style={s.thumbCarRoof} />
        <View style={s.thumbCarPlate}>
          <Text style={s.thumbCarPlateText}>12가 3456</Text>
        </View>
      </View>

      {/* 블랙박스 OSD */}
      <View style={s.osdTopLeft}>
        <View style={s.recDot} />
        <Text style={s.osdText}>REC</Text>
      </View>
      <Text style={s.osdTopRight}>{timeText}</Text>
      <Text style={s.osdBottomLeft}>FRONT · 1440p</Text>
      <View style={s.osdBottomRight}>
        <Text style={s.osdText}>{MOCK_CLIP.durationSec}초</Text>
      </View>
    </View>
  );
}

function Row({ label, value, mono, accent }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text
        style={[s.rowValue, mono && s.mono, accent && { color: C.brand }]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

export default function App() {
  const [status, setStatus] = useState('idle'); // idle | analyzing | done
  const [stepIdx, setStepIdx] = useState(0);
  const [result, setResult] = useState(null);
  const [toast, setToast] = useState(null);

  const nowText = useRef(
    new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  ).current;

  /* 새 영상 알림 배지 깜빡임 */
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  /* 분석 중 단계 텍스트 롤링 (2초 동안 3단계) */
  useEffect(() => {
    if (status !== 'analyzing') return undefined;
    setStepIdx(0);
    const t = setInterval(() => setStepIdx((i) => Math.min(i + 1, ANALYSIS_STEPS.length - 1)), 650);
    return () => clearInterval(t);
  }, [status]);

  /* 토스트 자동 소멸 */
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const handleAnalyze = useCallback(async () => {
    setStatus('analyzing');
    setResult(null);
    const r = await analyzeClip(MOCK_CLIP); // 2초 지연 후 mock 결과
    setResult(r);
    setStatus('done');
  }, []);

  /**
   * "안전신문고로 접수하기"
   * 요구사항대로 두 액션을 한 번의 탭에서 연달아 수행한다.
   *   ① 클립보드 복사 — 앱 전환 전에 반드시 끝나야 하므로 await 로 순서를 보장
   *   ② 안전신문고 실행 (스킴 → 인텐트 → 스토어 → 웹 폴백)
   * 중간에 Alert 같은 모달을 끼우면 "원클릭" 경험이 깨지므로,
   * 안내는 화면 위 토스트로만 띄우고 앱 전환을 막지 않는다.
   */
  const handleSubmit = useCallback(async () => {
    if (!result) return;

    const draft = buildReportDraft(result);

    // ① 클립보드
    try {
      await Clipboard.setStringAsync(draft);
      setToast('신고 내용이 복사됐어요. 입력란에서 길게 눌러 붙여넣기 하세요.');
    } catch (e) {
      setToast('클립보드 복사에 실패했어요. 내용을 직접 옮겨 적어 주세요.');
    }

    // ② 앱 실행
    const where = await openSafetyReport();

    if (where === 'store' || where === 'store-search') {
      Alert.alert(
        '안전신문고 앱이 없어요',
        '설치 페이지로 이동합니다. 설치 후 다시 시도하면 바로 열려요.\n(신고 내용은 이미 복사돼 있습니다)'
      );
    } else if (where === 'web') {
      Alert.alert('모바일 웹으로 이동', '앱과 스토어를 열 수 없어 안전신문고 웹으로 이동합니다.');
    } else if (where === 'failed') {
      Alert.alert(
        '앱을 열 수 없어요',
        '안전신문고 앱/스토어/웹 모두 열리지 않았습니다.\n신고 내용은 클립보드에 복사돼 있으니 직접 접속해 붙여넣어 주세요.'
      );
    }
  }, [result]);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* 헤더 */}
        <View style={s.header}>
          <View>
            <Text style={s.appName}>블박신고</Text>
            <Text style={s.appDesc}>블랙박스 → 안전신문고 원클릭 도우미</Text>
          </View>
          <View style={s.demoBadge}>
            <Text style={s.demoBadgeText}>DEMO</Text>
          </View>
        </View>

        {/* 1. 최근 영상 알림 */}
        <View style={s.card}>
          <View style={s.cardHead}>
            <Animated.View
              style={[
                s.liveDot,
                { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) },
              ]}
            />
            <Text style={s.cardHeadText}>새 영상 도착</Text>
            <Text style={s.cardHeadTime}>{MOCK_CLIP.receivedAgoMin}분 전</Text>
          </View>

          <MockThumbnail timeText={nowText} />

          <View style={s.clipMeta}>
            <Text style={s.clipTitle}>{MOCK_CLIP.deviceName}</Text>
            <Text style={s.clipSub}>
              {MOCK_CLIP.durationSec}초 · {MOCK_CLIP.sizeMb}MB · Wi-Fi 자동 전송 완료
            </Text>
          </View>

          {/* 2. 분석 버튼 */}
          <Pressable
            onPress={handleAnalyze}
            disabled={status === 'analyzing'}
            style={({ pressed }) => [
              s.btn,
              s.btnPrimary,
              status === 'analyzing' && s.btnDisabled,
              pressed && s.btnPressed,
            ]}
          >
            {status === 'analyzing' ? (
              <View style={s.btnLoading}>
                <ActivityIndicator color="#fff" />
                <Text style={s.btnPrimaryText}>{ANALYSIS_STEPS[stepIdx]}</Text>
              </View>
            ) : (
              <Text style={s.btnPrimaryText}>
                {status === 'done' ? '다시 분석하기' : 'AI 영상 분석 및 번호판 추출'}
              </Text>
            )}
          </Pressable>
        </View>

        {/* 분석 중 스켈레톤 */}
        {status === 'analyzing' && (
          <View style={[s.card, s.center]}>
            <ActivityIndicator size="large" color={C.brand} />
            <Text style={s.analyzingTitle}>영상을 분석하고 있어요</Text>
            <Text style={s.analyzingSub}>{ANALYSIS_STEPS[stepIdx]}</Text>
          </View>
        )}

        {/* 3. 분석 결과 */}
        {status === 'done' && result && (
          <>
            <View style={s.card}>
              <View style={s.cardHead}>
                <Text style={s.cardHeadText}>분석 결과</Text>
                <View style={s.confBadge}>
                  <Text style={s.confBadgeText}>
                    신뢰도 {Math.round(result.confidence * 100)}%
                  </Text>
                </View>
              </View>

              {/* 번호판 — 실제 번호판 룩으로 강조 */}
              <View style={s.plate}>
                <Text style={s.plateText}>{result.plateNumber}</Text>
              </View>

              <View style={s.divider} />

              <Row label="위반 시간" value={result.violatedAtText} mono />
              <Row label="위반 장소" value={result.location} />
              <Row label="위반 유형" value={result.violationType.label} accent />
              <Row label="차량" value={result.vehicle} />
            </View>

            {/* 클립보드에 담길 초안 미리보기 */}
            <View style={s.card}>
              <Text style={s.cardHeadText}>안전신문고에 붙여넣을 내용</Text>
              <View style={s.draftBox}>
                <Text style={s.draftText}>{buildReportDraft(result)}</Text>
              </View>
              <Text style={s.hint}>
                접수하기를 누르면 이 내용이 클립보드에 복사되고, 안전신문고 앱이 바로 열립니다.
              </Text>
            </View>
          </>
        )}

        <Text style={s.disclaimer}>
          이 화면의 번호판·시간·장소는 MVP 데모용 가상 데이터입니다. 실제 AI 분석이나 신고
          접수는 이루어지지 않으며, 최종 신고 내용의 확인 책임은 신고자에게 있습니다.
        </Text>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* 토스트 */}
      {toast && (
        <View style={s.toast} pointerEvents="none">
          <Text style={s.toastText}>{toast}</Text>
        </View>
      )}

      {/* 하단 고정 CTA */}
      <View style={s.bottomBar}>
        <Pressable
          onPress={handleSubmit}
          disabled={status !== 'done'}
          style={({ pressed }) => [
            s.btn,
            s.btnSubmit,
            status !== 'done' && s.btnDisabled,
            pressed && s.btnPressed,
          ]}
        >
          <Text style={s.btnPrimaryText}>안전신문고로 접수하기</Text>
        </Pressable>
        <Text style={s.bottomHint}>
          {status === 'done'
            ? '탭 한 번으로 복사 + 앱 실행이 함께 진행돼요'
            : '먼저 영상 분석을 완료해 주세요'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, paddingTop: Platform.OS === 'android' ? 24 : 8 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  appName: { fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: -0.5 },
  appDesc: { fontSize: 13, color: C.sub, marginTop: 2 },
  demoBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  demoBadgeText: { fontSize: 11, fontWeight: '800', color: '#B45309', letterSpacing: 0.5 },

  card: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  center: { alignItems: 'center', paddingVertical: 28 },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardHeadText: { fontSize: 15, fontWeight: '700', color: C.ink, flex: 1 },
  cardHeadTime: { fontSize: 12, color: C.sub },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.danger,
    marginRight: 8,
  },

  /* 썸네일 */
  thumb: {
    height: 190,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#1E293B',
  },
  thumbSky: { height: 70, backgroundColor: '#334155' },
  thumbRoad: { flex: 1, backgroundColor: '#475569', alignItems: 'center' },
  laneDash: {
    position: 'absolute',
    height: 5,
    borderRadius: 3,
    backgroundColor: '#E2E8F0',
    opacity: 0.75,
  },
  thumbCar: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 52,
    width: 108,
    height: 62,
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 7,
  },
  thumbCarRoof: {
    position: 'absolute',
    top: 6,
    width: 76,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#94A3B8',
  },
  thumbCarPlate: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#0F172A',
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  thumbCarPlateText: { fontSize: 9, fontWeight: '800', color: '#0F172A' },

  osdTopLeft: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  recDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.danger,
    marginRight: 5,
  },
  osdText: { color: '#F8FAFC', fontSize: 11, fontWeight: '700' },
  osdTopRight: {
    position: 'absolute',
    top: 10,
    right: 10,
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
  },
  osdBottomLeft: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    color: '#F8FAFC',
    fontSize: 11,
    opacity: 0.9,
  },
  osdBottomRight: {
    position: 'absolute',
    bottom: 8,
    right: 10,
    backgroundColor: 'rgba(15,23,42,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },

  clipMeta: { marginTop: 12, marginBottom: 14 },
  clipTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
  clipSub: { fontSize: 12.5, color: C.sub, marginTop: 3 },

  /* 버튼 */
  btn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: C.brand },
  btnSubmit: { backgroundColor: '#111827' },
  btnDisabled: { backgroundColor: C.brandDim },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.995 }] },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnLoading: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  analyzingTitle: { marginTop: 14, fontSize: 16, fontWeight: '700', color: C.ink },
  analyzingSub: { marginTop: 6, fontSize: 13, color: C.sub },

  /* 결과 */
  confBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  confBadgeText: { fontSize: 11.5, fontWeight: '700', color: C.ok },
  plate: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: C.ink,
    borderRadius: 8,
    paddingHorizontal: 26,
    paddingVertical: 10,
    marginVertical: 6,
  },
  plateText: { fontSize: 30, fontWeight: '900', color: C.ink, letterSpacing: 2 },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 14 },

  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 7 },
  rowLabel: { width: 80, fontSize: 13.5, color: C.sub },
  rowValue: { flex: 1, fontSize: 14.5, color: C.ink, fontWeight: '600' },
  mono: { fontVariant: ['tabular-nums'] },

  draftBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    padding: 13,
    marginTop: 4,
  },
  draftText: { fontSize: 13, lineHeight: 20, color: '#334155' },
  hint: { fontSize: 12, color: C.sub, marginTop: 10, lineHeight: 17 },

  disclaimer: {
    fontSize: 11.5,
    lineHeight: 17,
    color: '#94A3B8',
    paddingHorizontal: 6,
    marginTop: 2,
  },

  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 130,
    backgroundColor: 'rgba(15,23,42,0.93)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  toastText: { color: '#F8FAFC', fontSize: 13, lineHeight: 19 },

  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  bottomHint: { textAlign: 'center', fontSize: 12, color: C.sub, marginTop: 8 },
});
