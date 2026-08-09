# 배포

## 프론트 (index.html / app.js / styles.css)
`main`에 push하면 GitHub Pages가 자동 배포한다. 할 일 없음.

## GAS (Code.gs)

### 최초 1회 준비
컴퓨터에서 (폰으로는 안 된다):

```bash
npm i -g @google/clasp
clasp login                       # 브라우저가 열린다 — kesjjang4545@gmail.com 으로 로그인
```

Apps Script API도 한 번 켜야 한다: https://script.google.com/home/usersettings → **Google Apps Script API: 사용**

그리고 `.clasp.json`의 `scriptId`를 채운다. 값은 Apps Script 편집기 주소창에 있다:
```
https://script.google.com/home/projects/①이_값/edit
```

### 그 다음부터
```bash
git pull
bash deploy.sh
```

끝이다. 편집기에 들어가거나 복사·붙여넣기 할 일이 없다.

`deploy.sh`가 하는 일:
1. `clasp pull` — 배포된 매니페스트(`appsscript.json`)를 받아온다. 웹앱 접근 권한 설정을 덮어쓰지 않으려는 것
2. 같이 딸려온 `Code.js`를 지우고 `Code.gs`를 git 버전으로 되돌린다
3. `clasp push` — `.claspignore` 덕에 `Code.gs`만 올라간다
4. `clasp deploy -i <기존 배포 ID>` — **기존 배포를 새 버전으로 갱신**한다

### 주의
- `clasp deploy`에서 `-i`를 빼면 **새 배포가 생기고 `/exec` 주소가 바뀐다.** 그러면 `app.js`의 `DEFAULT_GAS_URL`과 어긋나서 대시보드 연결이 끊긴다. `deploy.sh`의 `DEPLOYMENT_ID`를 건드리지 말 것
- `clasp pull`에 `-f`나 `-d`를 붙이면 "원격에 없는 로컬 파일 삭제"라서 `app.js`·`index.html`까지 날아간다

### 트리거를 새로 추가했을 때
`setupTrigger()`를 고친 배포라면 한 번 실행해야 반영된다:
```
https://script.google.com/macros/s/<배포ID>/exec?action=setup&key=<SECRET_KEY>
```

### 상태 확인
```
.../exec?action=status&key=<SECRET_KEY>
```
`triggerReady`(트리거 생존), `lastSnapshotAgeMin`(시트가 몇 분 전에 갱신됐는지), `sectorDailyFrom/To`(추이 데이터 범위)를 돌려준다.
