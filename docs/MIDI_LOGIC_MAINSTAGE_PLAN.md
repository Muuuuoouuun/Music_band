# MIDI 연결과 Logic Pro·MainStage 벤치마킹 — 가져올 것과 포기할 것

음악공방 앱(band2sheet · AirChoir)에 MIDI를 연결하고 Logic Pro·MainStage의 기능 중 무엇을 구현하고 무엇을 포기할지 정리한 기획 문서입니다. 코드는 바꾸지 않았습니다. 2026-10-20 기준 공개 자료로 조사했습니다. 음색 쪽은 [비싼 음색·튜닝 가이드](PREMIUM_TONE_GUIDE.md)와 함께 봅니다.

표기: **[확인]** 공식 문서·출처로 확인 · **[추정]** 우리 판단, 실기기 확인 필요

---

## 0. 결론

**MainStage를 대체하지 않고, MainStage와 함께 쓰는 "준비·연습·가벼운 라이브" 도구로 둡니다.**

- 우리 강점은 Logic·MainStage에 없거나 비싼 **앞단 작업**입니다.
  - 영상에서 곡 구간 찾기
  - 코드·악보 뽑기
  - 키 바꾸기
  - 반주·화음 만들기
  - 손동작 합창
- Logic Pro 12(2026-01)의 `Chord ID → Chord Track → Session Players` 흐름은 band2sheet의 `코드 인식 → 반주 7가지`와 개념이 거의 같습니다. [확인] **방향이 맞다는 뜻이고, 코드 트랙을 "하나의 정답"으로 만드는 것이 다음 단계**입니다.
- 브라우저는 무대용 소리 엔진으로 쓰기에 구조적 한계가 있습니다.
  - 지연: 최선 약 14~30ms이고, Windows에는 ASIO가 없습니다.
  - 플러그인을 쓸 수 없습니다.
  - iPhone·iPad에서는 MIDI를 쓸 수 없습니다.
  - 그래서 "MainStage급 라이브 리그"는 목표로 잡지 않습니다.
- MIDI는 세 방향으로 연결합니다.
  - **건반 → 우리 앱**: 연주와 조작
  - **우리 앱 → 외부(MainStage·신스)**: 코드·클록·곡 전환 보내기
  - **파일**: `.mid` 주고받기

---

## 1. 먼저 알아야 할 제약

| 제약 | 사실 | 영향 |
|---|---|---|
| Web MIDI 지원 | Chrome 43+, Edge 79+, Firefox 108+. **Safari·iOS는 미지원**. Apple은 2020년 핑거프린팅 우려로 구현하지 않겠다고 밝혔음 [확인] | iPad 건반 주자는 MIDI를 쓸 수 없음. 오디오 전용 모드로 안내 |
| 권한 | HTTPS 또는 localhost 같은 보안 컨텍스트가 필요함. Chrome 124부터는 일반 MIDI도 권한을 물음. SysEx는 별도 권한 [확인] | 두 앱 모두 localhost라서 사용 가능. **SysEx는 요청하지 않음** |
| Firefox | 108에서 "사이트 권한 부가 기능" 설치가 필요했음. 지금도 필요한지는 미확인 [확인/미확인] | Chrome·Edge를 1순위로 지원 |
| 지연 | 브라우저 왕복 지연은 최선 약 30ms(Soundtrap 엔지니어). macOS 기본 설정에서는 Chrome 약 67ms이고, 마이크 처리 3종을 끄고 `latencyHint:0`이면 약 19ms [확인] | AirChoir는 이미 마이크 처리 3종을 끔. `latencyHint`를 `'interactive'`에서 `0`으로 바꾸는 실험 가치 있음 |
| Windows | Chrome은 공유 모드 WASAPI를 쓰고, ASIO를 요청할 웹 API가 없음 [확인] | Windows 라이브 저지연은 보장하지 않음 |
| 플러그인 | AU·VST는 호스팅할 수 없음. 대안은 Web Audio Modules 2.0 [확인] | 플러그인 생태계는 포기 |
| 백그라운드 탭 | 숨겨진 탭은 타이머가 제한됨. 소리가 나는 탭은 예외 [확인] | MIDI 클록은 `setInterval`이 아니라 오디오 시계로 스케줄해야 함 |
| 손 인식 | MediaPipe 추론 자체는 12~17ms(Pixel 6). 카메라 프레임 간격까지 더하면 50~100ms 예상 [확인/추정] | 손동작은 **코드 선택**에만 쓰고 **리듬 트리거**에는 쓰지 않음 |
| 메모리 | 디코딩한 오디오는 44.1kHz 스테레오 기준 분당 약 21MB [추정] | GB 단위 샘플 라이브러리는 불가능 |
| MIDI 2.0 | Web MIDI 표준은 아직 초안이고 MIDI 2.0은 논의 단계. Windows는 2026년부터 OS 지원을 배포 중 [확인] | MIDI 1.0만 지원 |

---

## 2. MIDI 연결 설계

### 2-1. 무엇을 주고받나

| 방향 | 메시지 | band2sheet | AirChoir |
|---|---|---|---|
| 입력 | Note On/Off, 벨로시티 | 악보 편집 중 음 입력, 반주 미리듣기, 키 패드 연주 | 코드 패드·화음 보이스의 코드를 건반으로 지정. 손 대신 건반으로 코드 휠 조작 |
| 입력 | CC64 서스테인 | 패드·피아노 서스테인 | 코드 유지(손을 떼도 유지) |
| 입력 | CC1/CC11 | 패드·현악 스웰(음량+필터) | 밝기·리버브(지금 손 높이 역할) |
| 입력 | Program Change, 풋스위치 CC | 셋리스트 다음/이전 곡 | 모드 전환, 오브 녹음 시작/정지 |
| 입력 | 노트(지정 건반) | 마커 점프(절/후렴) | 화음 프리셋 바꾸기 |
| 출력 | 노트 | 생성 반주의 각 파트를 외부 신스·MainStage로 보내기 | 지금 고른 코드를 외부 신스로 보내기 |
| 출력 | MIDI 클록, Start/Stop | 반주 재생과 외부 장비 템포 맞추기 | 오브 루프 길이에 맞춘 클록 |
| 출력 | Program Change | 곡이 바뀌면 MainStage 패치도 바꾸기 | — |
| 파일 | `.mid` | 이미 반주 `.mid`를 내보내고 MIDI를 가져올 수 있음 → **코드 트랙·마커·템포 맵도 포함** | 오브 연주를 `.mid`로 내보내기(코드 시점) |

### 2-2. 연결 화면 (두 앱 공통 방식)
1. 처음에는 MIDI를 요청하지 않습니다. 사용자가 **"건반 연결"을 누를 때만** 권한을 묻습니다(AirChoir의 "데모로 시작"이 권한 없이 시작하는 원칙과 같습니다).
2. 입력·출력 장치 목록과 **신호 표시등**을 보여 줍니다. 건반을 누르면 깜빡여서 연결을 바로 확인할 수 있습니다.
3. 장치를 뽑고 꽂으면 자동으로 다시 연결합니다(`statechange` 이벤트). 연주 중에 끊기면 소리는 멈추되 녹음·재생은 계속합니다.
4. 지원하지 않는 브라우저(Safari, iOS)에서는 버튼 대신 한 줄로 안내합니다. 예: "건반 연결은 Chrome·Edge에서 됩니다."

### 2-3. MIDI Learn — MainStage 스크린 컨트롤의 핵심만
- 화면의 아무 조절기나 길게 누른 뒤 → 건반의 노브·페달·건반을 움직이면 → 연결됩니다.
- 연결 목록을 보여 주고 지울 수 있게 합니다. 장치 이름별로 저장합니다(브라우저 저장소).
- 기본 매핑을 제공합니다. CC64 서스테인, CC1 스웰, CC11 표현, 풋스위치(CC64/CC66/CC67)로 다음 곡.

### 2-4. 타이밍 원칙 [확인된 API, 설계는 추정]
- MIDI 입력 시각은 `performance.now()` 시계를 씁니다. 오디오는 `AudioContext` 시계를 씁니다. `getOutputTimestamp()`로 두 시계를 맞춥니다.
- **연주(건반으로 패드·코드 치기)는 즉시** 소리를 냅니다.
- **아르페지에이터·클록·반주 재생은 앞을 내다보고(lookahead) 예약**합니다. `MIDIOutput.send(data, timestamp)`로 미리 보냅니다.
- 백엔드(Python)는 `.mid` 파일 읽기·쓰기에만 `mido`를 씁니다. 실시간 MIDI는 브라우저가 맡습니다.
- 지연 보정: AirChoir에 있는 왕복 지연 측정을 MIDI 출력에도 씁니다. 외부 신스가 늦으면 앞당기는 오프셋을 둡니다.

---

## 3. 가져올 것 (구현)

| 우선 | Logic·MainStage 기능 | 우리 버전 | 앱 | 이유 |
|---|---|---|---|---|
| 1 | Web MIDI 입력 + MIDI Learn (MainStage 스크린 컨트롤) | 2장 설계 | 두 앱 | 모든 라이브 기능의 기반 |
| 2 | **Chord Track** (Logic 11·12) | 곡마다 편집 가능한 코드 트랙 하나. 악보·코드표·반주·화음·AirChoir가 모두 이것을 따름 | band2sheet → AirChoir | 지금은 인식 결과가 기능마다 따로 쓰임. 한 곳만 고치면 전부 바뀌어야 함 |
| 3 | **Concert / Set / Patch** (MainStage) | **셋리스트 → 곡 → 장면**. 곡은 키·템포·코드 트랙·반주 스템·패드 음색을 묶음. 장면은 절/후렴처럼 같은 곡 안의 소리 변화 | band2sheet | 예배 실황 곡 나누기·조옮김 기능과 바로 연결됨 |
| 4 | 다음 곡 전환 (Program Change·풋스위치), 패치 바꿀 때 꼬리 유지 | 다음 곡으로 넘어가도 **누르던 음·리버브·패드는 유지**하고 크로스페이드. MainStage도 서스테인으로 잡은 음은 끊기는 약점이 있으므로 우리는 유지하도록 함 | band2sheet | 예배 흐름이 끊기지 않는 것이 핵심 |
| 5 | Tonic Pad·키별 앰비언트 패드 (Sunday Keys, Worship Tutorials) | 12키 패드, 키 바꾸면 자동 크로스페이드, 저역 컷(투명도) 노브, 탭 템포 | 두 앱 | 예배 건반 주자가 가장 많이 씀 [추정] |
| 6 | **Playback 플러그인** (마커 이동) | 반주 스템 + 곡 구조 마커(전주/절/후렴/브리지). 마커로 점프하고 "후렴 한 번 더"처럼 반복 | band2sheet | 이미 곡 구조 바가 있음 → 라이브용으로 확장 |
| 7 | 키 스플릿·레이어 (음역·벨로시티 범위) | 왼손 패드 / 오른손 피아노. 범위는 건반으로 눌러서 지정 | 두 앱 | 예배 건반의 기본 패치 형태 |
| 8 | **Chord Trigger** (Single/Multi) | 한 건반 = 한 코드. Multi 모드는 곡의 코드 트랙에서 자동으로 채움(그 곡 코드만 건반 7개에) | AirChoir | 손동작 코드 휠의 건반 버전. 초보 반주자에게 강력함 |
| 9 | Transposer | 앱 전체 이조(건반은 C로 치고 소리는 곡 키로) | 두 앱 | 이미 조옮김이 있어 연결만 하면 됨 |
| 10 | Arpeggiator (템포 동기) | 코드 트랙 + 탭 템포로 펼친화음. 패턴 4~6개만 | 두 앱 | 패드 + 아르페지오 = 워십 키보드 표준 |
| 11 | **Synth Player의 Simple/Modulated Pad 스타일** (Logic 12) | 반주 스타일에 "심플 패드 / 움직이는 패드" 추가 | band2sheet | 지금 pad 스타일을 둘로 나누기 |
| 12 | MIDI 출력 + 클록 + Program Change 송신 | 반주 각 파트·코드를 외부 신스·MainStage로 보냄. 곡이 바뀌면 MainStage 패치도 바꿈 | band2sheet | "MainStage와 함께 쓰기"의 핵심 연결 |
| 13 | `.mid` 내보내기 강화 | 코드 트랙(텍스트 이벤트)·마커·템포 맵·키를 포함한 `.mid`. Logic에 끌어다 놓으면 바로 Chord Track이 됨(가능한지 확인 필요) | band2sheet | Logic 사용자에게 가장 쉬운 연결 |
| 14 | Loopback (루프 녹음 → Playback 파일) | AirChoir 오브를 WAV로 내보내 band2sheet 셋리스트의 "트랙"으로 넣기 | 두 앱 연결 | 두 앱을 잇는 첫 연결 고리 |

### 바꿔서 가져올 것 (간단하게)
| 원래 기능 | 그대로 가져오지 않는 이유 | 우리 방식 |
|---|---|---|
| Flex Pitch | 노트 단위 오디오 편집기는 규모가 큼 | 오토튠 결과 그래프에서 노트별 강도만 조절 (음색 가이드 2장) |
| Smart Tempo | 이미 템포·박 인식이 있음 | 인식 템포를 셋리스트 곡의 "탭 템포 기본값"으로 사용 |
| Stem Splitter | 이미 Demucs 분리가 있음 | 품질만 비교 기준으로 삼음 |
| Mastering Assistant | 장르별 AI 마스터는 규모가 큼 | "스트리밍용 -14 LUFS / 원본 다이내믹" 두 버튼 (음색 가이드 9장) |
| Space Designer·ChromaVerb·Quantec | 고급 리버브 엔진 | 실제 홀·플레이트 IR 3~4개를 ConvolverNode로 |
| Session Players 전체(드럼·베이스·건반 연주자 성격) | 연주자 성격 모델은 규모가 큼 | 반주 스타일마다 "단순 ↔ 바쁨" 한 축만 |
| Logic Remote | 별도 iOS 앱 필요 | 휴대폰 브라우저를 같은 와이파이의 리모컨으로(다음 곡·마커 버튼만). MIDI 없이 WebSocket |
| Live Loops | 그리드형 루프 런처 전체는 과함 | AirChoir 오브로 충분 |

---

## 4. 포기할 것

| 포기 | 이유 | 대안 |
|---|---|---|
| AU·VST 플러그인 호스팅 | 브라우저에서 불가 [확인] | 내장 음색만. 필요하면 나중에 WAM 2.0 검토 |
| Auto Sampler, GB 단위 샘플 라이브러리 | 메모리·다운로드·라이선스 | 물리 모델·합성 확장, 작은 IR |
| MainStage급 무대 리그(수십 패치, 즉시 전환, 무결점 오디오) | 브라우저 지연·탭 제한·드라이버 한계 | 무대 소리는 MainStage가 맡고, 우리는 MIDI로 곡 전환·코드를 보냄 |
| Windows 저지연 라이브 모니터링 보장 | ASIO 없음 [확인] | 지연을 측정해 보여 주고, 반주 재생·연습용으로 안내 |
| iPhone·iPad에서 MIDI | Safari 미지원, iOS는 모든 브라우저가 WebKit [확인/추정] | iPad는 오디오만(패드·반주 재생·셋리스트). 네이티브 앱은 이번 범위 밖 |
| SysEx | 별도 권한, 핑거프린팅 우려, 쓸 곳 없음 | 요청하지 않음 |
| MIDI 2.0 / MPE 고해상도 | 웹 표준 미정 [확인] | MIDI 1.0. MPE는 나중에 검토 |
| 브라우저 안 Ableton Link | UDP 멀티캐스트라 브라우저 단독 불가 [추정] | MIDI 클록. 정말 필요하면 Python 브리지 옵션 |
| Scripter (사용자 JS 스크립트) | 보안·지원 비용 | 고정 MIDI FX 몇 개 |
| Flex Time 수준 오디오 편집, 전체 DAW 편집기 | 범위 밖. 우리는 DAW가 아님 | `.mid`·스템을 Logic으로 넘김 |
| 손동작으로 리듬 정밀 트리거 | 50~100ms 지연 [추정] | 손동작은 코드 선택·스웰만, 리듬은 건반·자동 |
| 432Hz 같은 근거 없는 튜닝 모드 | 근거 없음 | 기준음 438~445 조절만 |

---

## 5. 단계 계획

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **M1 연결** | 두 앱에 "건반 연결" 화면, 입력 표시등, CC64·CC1, 장치 재연결, 미지원 브라우저 안내 | Chrome·Edge에서 USB 건반으로 AirChoir 코드 패드 연주. 뽑았다 꽂아도 복구. 권한 거부 시에도 앱 정상 |
| **M2 코드 트랙** | band2sheet 코드를 하나의 편집 가능한 트랙으로. 반주·화음·악보·AirChoir가 같은 트랙을 따름. `.mid`에 코드·마커·템포 포함 | 코드 하나를 고치면 반주·화음·코드표가 같이 바뀜. 내보낸 `.mid`를 Logic에서 열 때 코드·마커가 보임 |
| **M3 셋리스트·패드** | 셋리스트 → 곡 → 장면, 키별 패드 크로스페이드, 탭 템포, 풋스위치·PC로 다음 곡, 꼬리 유지, 마커 점프 | 곡 3개 셋리스트를 풋스위치만으로 끝까지 진행. 전환할 때 소리 끊김 0회 |
| **M4 MIDI FX·출력** | Chord Trigger(Multi는 코드 트랙 자동), 스플릿/레이어, 아르페지에이터, MIDI 출력·클록·PC 송신 | MainStage(Mac)가 우리 앱의 PC로 패치를 바꾸고 클록에 맞춰 아르페지오가 동기됨 |
| **M5 연결 고리** | AirChoir 오브 → WAV/`.mid` → band2sheet 셋리스트 트랙, 휴대폰 리모컨 | 오브로 만든 루프를 셋리스트 곡의 트랙으로 재생 |

M1과 M2는 서로 독립이라 동시에 진행할 수 있습니다. M3는 M2의 곡 데이터가 필요합니다.

---

## 6. 확인 방법

- **실기기 표**: 아래 조합으로 시험하고 결과를 `docs/VALIDATION.md`에 기록합니다.
  - 장치: USB 건반 1종, 패드 컨트롤러 1종, 풋스위치, BLE MIDI 1종
  - 브라우저: macOS Chrome, Windows Chrome/Edge, Android Chrome, Firefox
  - **BLE MIDI와 Android는 근거 자료가 오래되어 직접 확인이 필수**입니다.
- **지연 측정**
  - 건반을 누르고 소리가 나기까지를 녹음으로 잽니다. 건반 소리와 스피커 소리를 마이크 하나로 받습니다.
  - 목표: 패드 연주 30ms 이하(macOS Chrome), 손동작 코드 선택 100ms 이하.
- **자동 검사**
  - 가짜 MIDI 장치(`navigator.requestMIDIAccess` 대체)로 다음을 검사합니다: 노트 입력, CC 매핑, 장치 연결과 해제, 권한 거부, 곡 전환 때 꼬리 유지(출력 RMS가 0이 아님).
  - 지금 AirChoir 브라우저 검사가 가상 카메라를 쓰는 방식과 같습니다.
- **현장 시험**: 예배팀 건반 주자 2~3명에게 셋리스트 기능을 리허설에서 써 보게 합니다. "MainStage 옆에 같이 켜 둘 만한가"를 묻습니다.

---

## 7. 정해야 할 것 (사용자 결정)

1. **주 사용자의 기기**: 예배팀 건반 주자가 Mac(MainStage)인지 iPad인지에 따라 M3·M4의 무게가 달라집니다. iPad가 많다면 MIDI보다 오디오 전용 패드·셋리스트가 먼저입니다.
2. **"MainStage와 함께" vs "MainStage 없이"**
   - "함께"를 택하면 우리 앱은 MainStage에 MIDI를 보내는 쪽에 무게를 둡니다(M4 출력).
   - "없이"를 택하면 우리 앱의 내장 음색 품질에 더 투자해야 합니다(음색 가이드 로드맵 1~10).
3. **두 앱 연결 범위**: 셋리스트를 band2sheet에만 둘지, AirChoir도 셋리스트의 한 "곡 장면"으로 넣을지 정해야 합니다.

---

## 8. 출처

**Web MIDI·브라우저**
- Chrome Web MIDI 권한 프롬프트 · https://developer.chrome.com/blog/web-midi-permission-prompt
- MDN requestMIDIAccess · https://developer.mozilla.org/en-US/docs/Web/API/Navigator/requestMIDIAccess
- MDN MIDIOutput.send · https://developer.mozilla.org/en-US/docs/Web/API/MIDIOutput/send
- MDN getOutputTimestamp · https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp
- Firefox 108 릴리스 노트 · https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/108
- WebKit Web MIDI 버그 · https://bugs.webkit.org/show_bug.cgi?id=107250
- Apple의 미구현 API 목록 보도 · https://www.theregister.com/2020/06/29/apple_web_developers/
- W3C Web MIDI 초안 · https://www.w3.org/TR/2024/WD-webmidi-20240712/
- MIDI 2.0 이슈 · https://github.com/WebAudio/web-midi-api/issues/211
- Windows MIDI 2.0 · https://midi.org/midi-2-0-coming-to-windows-11
- 브라우저 오디오 지연 측정 · https://jefftkaufman.substack.com/p/browser-audio-latency
- W3C 2021 지연 발표 · https://w3.org/2021/03/media-production-workshop/talks/ulf-hammarqvist-audio-latency.html
- 출력 지연 API · https://web.dev/articles/audio-output-latency
- 백그라운드 탭 제한 · https://developer.chrome.com/blog/background_tabs
- MediaPipe Hand Landmarker · https://ai.google.dev/mediapipe/solutions/vision/hand_landmarker
- Web Audio Modules 2.0 · https://zenodo.org/record/6769098

**MainStage·Logic Pro**
- MainStage 릴리스 노트 · https://support.apple.com/en-gb/101568
- MainStage 4 업데이트 · https://logicstudiotraining.com/mainstage-4-update/
- MainStage MIDI FX · https://support.apple.com/en-lb/guide/mainstage/lgceb57e806c/mac
- MainStage Playback · https://support.apple.com/en-au/guide/mainstage/mstgb23bc9fc/mac
- 패치 전환 때 서스테인 유지 · https://brianli.com/how-to-sustain-sound-over-patch-changes-in-mainstage/
- Logic Pro 11 · https://www.soundonsound.com/techniques/logic-pro-session-players
- Logic Pro 11.2 · https://support.apple.com/en-ca/126835
- Logic Pro 12 · https://cdm.link/logic-pro-12-hands-on/ , https://synthanatomy.com/2026/06/apple-logic-pro-12.html

**예배 건반·비교 제품**
- Sunday Keys · https://sundaysounds.com/sunday-keys
- Tonic 패드 패치 전환 · https://support.sundaysounds.com/article/3317-sunday-keys-for-mainstage-2020-automate-tonic-parameters-on-patch-change
- Worship Tutorials Pads Player · https://worshiptutorials.com/?p=259934
- PraiseCharts WorshipKeys · https://www.praisecharts.com/wk-mainstage
- Soundtrap 지연 · https://support.soundtrap.com/hc/en-us/articles/26663690434066-Latency
- BandLab 데스크톱/모바일 · https://www.audeobox.com/learn/bandlab/bandlab-mobile-vs-desktop/
- Moises · https://apps.apple.com/us/app/1515796612
