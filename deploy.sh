#!/usr/bin/env bash
# GAS 배포 — 편집기에 들어가지 않고 Code.gs를 올린다.
#   준비(최초 1회): npm i -g @google/clasp && clasp login
#   사용:           bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

# 기존 배포를 "새 버전"으로 갱신한다. 새 배포를 만들면 /exec 주소가 바뀌어
# app.js의 DEFAULT_GAS_URL과 어긋나므로 이 ID를 절대 바꾸지 말 것.
DEPLOYMENT_ID="AKfycbyHgBuQl15qxuy3YXSy73uVIBN8TLvH_G_L9lqnZ5s2futWEwjfC5TEXAr67CFprYFFgg"

if ! command -v clasp >/dev/null 2>&1; then
  echo "clasp가 없습니다.  npm i -g @google/clasp  실행 후 다시 시도하세요." >&2
  exit 1
fi

if grep -q PUT_SCRIPT_ID_HERE .clasp.json; then
  echo "먼저 .clasp.json의 scriptId를 채우세요." >&2
  echo "  Apps Script 편집기 주소창: script.google.com/home/projects/<이 값>/edit" >&2
  exit 1
fi

if [ -n "$(git status --porcelain Code.gs)" ]; then
  echo "Code.gs에 커밋 안 된 변경이 있습니다. 먼저 커밋하세요 (아래에서 되돌려집니다)." >&2
  exit 1
fi

# 배포된 매니페스트를 그대로 유지하려고 먼저 받아온다. 여기서 Code.gs도 같이
# 덮여쓰이므로 곧바로 git에서 우리 버전으로 되돌린다.
# pull에 -f/-d를 붙이면 "원격에 없는 로컬 파일 삭제"라서 app.js·index.html까지 날아간다
echo "→ 원격 매니페스트 동기화"
clasp pull >/dev/null
rm -f Code.js
git checkout -- Code.gs

echo "→ 코드 업로드"
clasp push -f

echo "→ 기존 배포를 새 버전으로 갱신"
clasp deploy -i "$DEPLOYMENT_ID" -d "$(git rev-parse --short HEAD) $(date +%F)"

echo
echo "완료. /exec 주소는 그대로입니다."
echo "확인:  https://script.google.com/macros/s/$DEPLOYMENT_ID/exec?action=status&key=stockflow-2026!"
