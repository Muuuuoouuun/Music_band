# 새 앱 구상: 우리 신스·가상악기·음색 만들기 (2026년 10월 조사)

> 질문: 신디나 메인 건반의 가상악기·음색을 우리가 직접 만들 수 없나? 무료·오픈소스로 무엇을 조합할 수 있나?

**결론: 만들 수 있습니다.** 이 저장소에는 이미 직접 짠 합성기가 두 개 있습니다(아래 0번). 새 앱은 그걸 "음색을 만들고, 저장하고, 건반으로 연주하는" 도구로 꺼내는 일입니다. 필요한 부품은 거의 다 무료·오픈소스로 구할 수 있고, 2025년 10월 VST 3 SDK가 MIT 라이선스로 바뀌면서 **DAW용 플러그인(VST3·CLAP)까지 라이선스 비용 없이** 만들 수 있게 됐습니다.

표기는 [band2sheet 오픈소스 조사](../apps/band2sheet/docs/OPEN_SOURCE.md)와 같습니다. **✅ 추천** = 바로 쓸 만함, **🔜 후보** = 다음 단계에 검토, **⚠️ 주의** = 라이선스 조건 확인 필요.

> 라이선스는 2026-10 기준 각 저장소의 LICENSE 파일과 공식 발표로 확인했습니다. **GPL 코드를 섞으면 우리 앱 전체를 GPL로 소스 공개해야 합니다.** 판매나 비공개 배포 가능성을 남기려면 MIT·BSD·ISC·Apache·zlib 계열과 CC0 음원 위주로 고르세요. 법률 판단이 필요하면 따로 확인해야 합니다.

## 0. 이미 가지고 있는 것

| 위치 | 이미 있는 음색 기술 |
|---|---|
| `apps/band2sheet/band2sheet/sound.py` | Karplus-Strong 뜯는 현(분수 지연으로 음정 정확, 밝기·울림·뜯는 위치 조절), RBJ 이퀄라이저, 대역별로 다르게 사라지는 홀 잔향, 미리 보는 리미터 |
| `apps/band2sheet/band2sheet/backing.py` | 대역 제한 웨이브테이블(saw·warm·horn) 여러 겹 + 디튠·비브라토·연주자별 음정 흔들림 → 현악·첼로·호른·패드. 비조화 배음 피아노(세게 칠수록 밝음, 세 줄 맥놀이). 킥·브러시·라이드·팀파니·비트박스, '우~' 베이스 보컬 |
| `apps/band2sheet/band2sheet/synth.py` | FluidSynth + GM 사운드폰트(.sf2)로 악보 연주 |
| `apps/airchoir/src/accompaniment.js` | Web Audio 패드(배음 표로 만든 파형, 음마다 몇 cent 디튠) |
| `apps/airchoir/core/worklet.js` | AudioWorklet 실시간 처리(하모나이저) — 브라우저에서 지연 적은 DSP가 이미 돌아감 |

즉 **합성(오실레이터·필터·엔벨로프), 물리 모델(뜯는 현), 공간계(잔향), 마스터(리미터), 실시간 브라우저 오디오**가 모두 있습니다. 없는 것은 ① 소리를 손으로 다듬는 화면, ② 음색을 저장하는 형식(프리셋), ③ 건반·MIDI로 실시간 연주, ④ 샘플(녹음한 소리) 재생입니다.

## 1. 음색을 만드는 네 가지 방법

| 방법 | 원리 | 잘 맞는 소리 | 우리에게 |
|---|---|---|---|
| **합성 (신스)** | 오실레이터 → 필터 → 엔벨로프·LFO → 이펙트 | 패드, 리드, 신스 베이스, 오르간, 벨, 앰비언트 | 코드로 다 만들 수 있고 소리 저작권이 100% 우리 것. 워십 패드가 바로 이 영역 |
| **샘플 기반** | 실제 악기를 음높이·세기별로 녹음해 재생 | 그랜드 피아노, 현악, 기타, 드럼 | 직접 녹음하거나 CC0 음원을 씀. 사실적인 소리가 가장 빠름 |
| **물리 모델링** | 현·관·막의 진동을 수식으로 흉내 | 뜯는 현, 타악기, 관악기, 공명 | 이미 Karplus-Strong 있음. Mutable Instruments 코드(MIT)로 확장 |
| **AI 음색** | 신경망이 음색을 배움 → 다른 소리를 그 음색으로 바꿈 | 허밍 → 바이올린·플루트, 기타 앰프 톤 복제 | AirChoir(허밍)와 궁합이 가장 좋음 |

실제 상용 가상악기도 대부분 이 넷을 섞습니다(예: 샘플 피아노 + 합성 패드 레이어).

## 2. 직접 합성 엔진 — DSP 코드·언어

| 프로젝트 | 하는 일 | 라이선스 | 상태 | 메모 |
|---|---|---|---|---|
| Web Audio API + AudioWorklet | 브라우저 표준 오디오 | 표준 | ✅ | AirChoir가 이미 씀. 설치 없음 |
| [Faust](https://faust.grame.fr) | 신호 흐름을 짧은 코드로 쓰면 C++·WebAssembly·플러그인 코드로 변환 | 컴파일러 LGPL-2.1+, [faustwasm](https://github.com/grame-cncm/faustwasm) LGPL-2.1 | ✅ | **한 번 써서 웹과 플러그인 둘 다**. 생성 코드는 함께 쓰는 아키텍처 파일의 조건을 확인 |
| [Mutable Instruments eurorack](https://github.com/pichenettes/eurorack) (Plaits·Rings·Elements·Clouds) | 유명 모듈 신스의 실제 펌웨어 DSP | STM32 코드 MIT | ✅ | 물리 모델 현(Rings), 여러 합성 방식을 한 모듈에 담은 매크로 오실레이터(Plaits), 그래뉼러(Clouds). 그대로 가져와도 됨 |
| [DaisySP](https://github.com/electro-smith/DaisySP) | 오실레이터·필터·엔벨로프·이펙트 C++ 모음 | MIT | ✅ | 하드웨어(Daisy)에도 올라감 |
| [STK](https://github.com/thestk/stk) (Synthesis ToolKit) | 물리 모델 악기 고전(관·현·타악) | MIT 계열 | 🔜 | 오래됐지만 알고리즘 교과서 |
| [Elementary Audio](https://github.com/elemaudio/elementary) | JS로 오디오 그래프 작성, 웹·네이티브 | MIT | 🔜 | React처럼 선언형 |
| [Tone.js](https://github.com/Tonejs/Tone.js) | 웹 신스·시퀀서·이펙트 | MIT | 🔜 | 시제품을 아주 빨리 만들 때 |
| [Cmajor](https://github.com/cmajor-lang/cmajor) | 오디오 전용 언어 → C++·WASM·플러그인 | GPLv3 / 상용(무료 개인 등급 있음) | ⚠️ | 엔진을 앱에 넣으면 GPL 또는 상용 라이선스. 생성한 C++은 우리 것 |

## 3. DAW용 플러그인 만들기 (VST3 · CLAP · AU)

"신디·메인 건반의 가상악기"를 큐베이스·로직·Ableton·MainStage 같은 프로그램에서 쓰게 하려면 플러그인 형식이 필요합니다.

| 프로젝트 | 라이선스 | 출력 형식 | 상태 | 메모 |
|---|---|---|---|---|
| [VST 3 SDK](https://sonicstate.com/news/2025/10/30/vst-3-now-available-under-mit-license) (Steinberg, 3.8부터) | **MIT** (2025-10 변경, 예전 GPLv3) | VST3 | ✅ | 이제 Steinberg와 계약할 필요 없음. VST2는 해당 없음 |
| [CLAP](https://github.com/free-audio/clap) | MIT | CLAP | ✅ | Bitwig·Reaper 등 지원하는 새 공개 형식 |
| [iPlug2](https://github.com/iPlug2/iPlug2) | zlib 계열 (WDL) | CLAP·VST3·AUv2·**AUv3(iOS)**·AAX·웹(WAM)·단독 앱 | ✅ 1순위 | 한 C++ 코드로 데스크톱·아이폰/아이패드·웹. MainStage(AU)도 됨 |
| [DPF](https://github.com/DISTRHO/DPF) (DISTRHO) | ISC | CLAP·VST3·VST2·LV2·LADSPA | ✅ | 가볍고 리눅스에 강함. AU 없음 |
| [JUCE](https://github.com/juce-framework/JUCE) | AGPLv3 / 상용 [JUCE 9 EULA](https://juce.com/legal/juce-9-licence/) | VST3·AU·AUv3·AAX·단독 | ⚠️ | 업계 표준이고 자료가 가장 많음. JUCE 8 기준 무료 Starter는 [연 매출 2만 달러 이하](https://forum.juce.com/t/important-changes-to-the-juce-end-user-licence-agreement-for-juce-8/61265); JUCE 9 조건은 EULA로 다시 확인 |
| [NIH-plug](https://github.com/robbert-vdh/nih-plug) (Rust) | 프레임워크 ISC, VST3 바인딩 GPLv3 | CLAP·VST3 | ⚠️ | CLAP만 내보내면 ISC로 충분. VST3를 내면 GPL 조건 |

## 4. 참고할 오픈소스 신스 (읽고 배우거나, GPL로 공개할 때 포크)

전부 무료로 받아서 바로 쓸 수 있는 완성형 신스입니다. **코드를 우리 앱에 가져오면 GPL**이 되므로, 비공개 배포 계획이 있으면 구조·알고리즘만 참고하세요.

| 신스 | 종류 | 라이선스 | 배울 점 |
|---|---|---|---|
| [Surge XT](https://github.com/surge-synthesizer/surge) | 하이브리드(웨이브테이블·FM·가상 아날로그) | GPL-3.0 | 필터·이펙트 품질, 프리셋 수천 개 |
| [Vital](https://github.com/mtytel/vital) | 웨이브테이블 | GPL-3.0 | 파형을 그려서 만드는 UI, 모듈레이션 드래그 |
| [Dexed](https://github.com/asb2m10/dexed) | FM (DX7 복제) | GPL-3.0 | 80년대 일렉 피아노(DX EP)·벨 — 워십 건반 단골 음색 |
| [Odin 2](https://github.com/TheWaveWarden/odin2) | 가상 아날로그·세미 모듈러 | GPL-3.0 | 아날로그 필터 모델링 |

GPL로 소스를 공개해도 괜찮다면 **Surge XT나 Vital을 포크해 우리 프리셋·UI를 얹는 것이 가장 빠른 길**입니다.

## 5. 샘플 기반 악기: 재생 엔진과 무료 음원

### 재생 엔진

| 프로젝트 | 형식 | 라이선스 | 상태 | 메모 |
|---|---|---|---|---|
| [FluidSynth](https://github.com/FluidSynth/fluidsynth) | SF2/SF3 | LGPL-2.1 | ✅ 이미 사용 | band2sheet 악보 소리 |
| [SpessaSynth](https://github.com/spessasus/spessasynth_lib) | SF2·SF3·DLS, 브라우저 | Apache-2.0 | ✅ | 웹 앱에서 사운드폰트 실시간 연주 |
| [smplr](https://github.com/danigb/smplr) | 브라우저 샘플 악기 | MIT | 🔜 | 피아노·드럼 머신 등 간단한 샘플러 |
| [sfizz](https://github.com/sfztools/sfizz) | SFZ (C++ 라이브러리) | BSD-2-Clause | 🔜 | 플러그인 단계에서 SFZ 재생 엔진. 플러그인은 [sfizz-ui](https://github.com/sfztools/sfizz-ui)로 분리됨 |
| [WebAudioFont](https://github.com/surikov/webaudiofont) | 브라우저 GM 음색 | GPL-3.0 | ⚠️ | 편하지만 GPL |

### 무료 음원

| 음원 | 내용 | 라이선스 | 메모 |
|---|---|---|---|
| [VSCO 2 Community Edition](https://versilian-studios.com/vsco-community/) | 실내악 오케스트라(현·목관·금관·타악) | **CC0** | 앱에 넣어 배포해도 됨, SFZ 제공 |
| [VCSL](https://github.com/sgossner/VCSL) (Versilian Community Sample Library) | 건반·타악·민속 악기 등 약 5GB | **CC0** | 위와 같은 제작사 |
| [Salamander Grand Piano](https://github.com/sfzinstruments/SalamanderGrandPiano) | 야마하 C5 그랜드 피아노 | CC-BY 3.0 | 크레딧(Alexander Holm) 표기 필요 |
| [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS) | GM/GS 사운드폰트 261음색, 30MB | 자체 라이선스: 음악 제작·소프트웨어 포함 자유 | 가벼운 기본 음색 |
| MuseScore_General | GM 사운드폰트 (FluidR3 기반) | MIT | MuseScore 기본 음색 |
| [Sonatina Symphonic Orchestra](https://os.zynthian.org/factory_sfz/Other/sonatina/Sonatina%20Symphonic%20Orchestra/Readme.html) | 오케스트라 | CC Sampling Plus 1.0 | ⚠️ 음원 자체 재배포 조건 확인 |
| Freesound | 효과음·한 음 샘플 | 파일마다 CC0/CC-BY/NC | ⚠️ 파일별 확인 |

> 음원 라이선스는 두 경우가 다릅니다. **(1) 그 소리로 만든 음악을 배포** — 위 목록은 대부분 자유. **(2) 샘플 파일 자체를 앱에 넣어 배포** — CC0·MIT·GeneralUser GS는 가능, CC-BY는 크레딧 필요, Sampling Plus·NC는 제한.

### 가장 우리다운 방법: 우리 밴드 악기를 직접 샘플링

교회 피아노·기타·베이스·싱어 목소리를 음마다 녹음해 **"우리 팀 음색 팩"** 을 만들 수 있습니다. band2sheet에는 이미 음 시작 검출과 pYIN/CREPE 음높이 인식이 있어서, 한 번에 쭉 녹음한 파일을

1. 음 단위로 자르고 (시작·끝 검출)
2. 음높이와 세기를 자동으로 읽고 (pYIN·CREPE, RMS)
3. 앞뒤 무음을 다듬고 음량을 맞춘 뒤 (지속음은 루프 지점 찾기)
4. **SFZ 파일로 자동 매핑**

하는 "자동 샘플러"를 만들 수 있습니다. 결과물은 sfizz·Sforzando 같은 무료 SFZ 플레이어와 우리 앱에서 모두 열리고, 저작권도 우리 것입니다.

## 6. AI 음색

| 프로젝트 | 하는 일 | 라이선스 | 상태 | 메모 |
|---|---|---|---|---|
| [DDSP](https://github.com/magenta/ddsp) / [DDSP-VST](https://magenta.tensorflow.org/ddsp-vst) (Google Magenta) | 허밍·노래 → 바이올린·플루트·색소폰 등. **몇 분 녹음으로 우리 악기 모델 학습** | Apache-2.0 (코드·플러그인) | ✅ | AirChoir 허밍 → 악기 소리. 가볍고 실시간 |
| [Neural Amp Modeler](https://github.com/sdatkinson/neural-amp-modeler) | 기타 앰프·페달 톤 복제 | MIT | 🔜 | 일렉 기타 톤 |
| [Neutone SDK](https://github.com/Neutone/neutone_sdk) | PyTorch 음색 모델을 플러그인으로 | LGPL-2.1 | 🔜 | 직접 만든 모델 배포용 |
| [RAVE](https://github.com/acids-ircam/RAVE) (IRCAM) | 실시간 음색 변환, 고품질 | **CC BY-NC 4.0** | ⚠️ | 비상업만 |
| Stable Audio Open 계열 (Stability AI) | 글로 효과음·한 음 샘플 생성 | [Stability AI Community License](https://stability.ai/explainers/stable-audio-vs-competitors-licensing-export-rights-and-self-hosting-compared) | ⚠️ | 연 매출 100만 달러 미만은 상업 사용 무료로 안내됨. 모델 카드 확인 |

모델은 기존 조사와 마찬가지로 **코드 라이선스와 가중치(학습된 모델) 라이선스가 다를 수 있습니다.** DDSP는 우리가 녹음한 소리로 직접 학습하면 이 걱정이 없습니다.

## 7. 앱 구상: 음색 공방 (가칭)

AirChoir처럼 **브라우저에서 설치 없이** 시작하고, 같은 DSP를 나중에 플러그인으로 옮기는 순서를 제안합니다.

> **진행 (2026-10-20):** 1단계(웹 신스)와 2단계(기본 음색 45개, 쉬머·아날로그 흔들림·어택 소리·24dB 필터·맞춤 EQ·스테레오 폭), 3단계 일부(한 소리 샘플러, 루프 지점, 거꾸로·늘리기 가공, SFZ 내보내기), 루퍼·튜닝 화면을 [apps/soundsmith](../apps/soundsmith/README.md)에 만들었습니다. 6단계(AI 음색) 대신 먼저 **신호 분석으로 '음원 따라 만들기'** 를 넣었습니다: 음원 파일·유튜브 링크의 구간을 재서(배음·엔벨로프·비브라토·숨소리·잔향·톤 균형) 한 음은 배음으로 다시 합성하고, 화음·믹스는 가장 닮은 음색 + 맞춤 EQ 로 맞춥니다. 학습 모델·외부 라이브러리 없이 직접 짠 코드라 라이선스 제약이 없고, 유튜브 받기만 선택 도구(yt-dlp·ffmpeg)를 씁니다.
>
> **진행 (2026-10-23):** 음원 따라 만들기에 MIDI 함께 불러오기(템포 맵·키스위치 거르기·한 음 구간·같은 음으로 비교 연주)를 넣고, 실제 데모 멀티트랙(국악기·Pigments)을 재서 국악기 9개·약음 현·신스 9개를 기본 음색에 더했습니다(64개). 엔진에 음정 엔벨로프와 LFO 모양·BPM 맞춤을 더했습니다. 원본 음원은 라이선스(비상업·재배포 금지) 때문에 저장소에 넣지 않았습니다.

| 단계 | 만드는 것 | 쓰는 부품 | 이 저장소에서 가져올 것 |
|---|---|---|---|
| **1. 웹 신스** | 오실레이터 2~3개 + 필터 + 엔벨로프 + LFO + 코러스·딜레이·잔향, 프리셋 저장(JSON), PC 키보드·Web MIDI 건반 연주 | AudioWorklet (의존성 없음) | `backing.py` 웨이브테이블·디튠·흔들림, `sound.py` 잔향·리미터, AirChoir 패드·워클릿 구조 |
| **2. 워십 음색 팩** | 패드·일렉 피아노(FM)·스트링·벨 기본 프리셋 20~30개 | 위 엔진 + Mutable Instruments(MIT) 일부 | AirChoir 패드 배음 표 |
| **3. 샘플러 + 자동 샘플링** | SF2/SFZ 재생, 우리 악기 녹음 → 자동 SFZ | SpessaSynth, CC0 음원, 자체 SFZ 로더 | band2sheet 음 시작·음높이 인식 |
| **4. 다른 앱과 공유** | 같은 프리셋을 band2sheet 반주 스타일과 AirChoir 코드 신스에서 사용 | 공통 프리셋 형식 | `backing.py` 스타일, `accompaniment.js` |
| **5. 플러그인** | MainStage·DAW용 VST3·CLAP·AU, 아이패드 AUv3 | iPlug2(또는 DPF) + VST3 SDK(MIT) + CLAP(MIT), DSP는 C++ 또는 Faust | 1~3단계 DSP를 C++로 옮김 |
| **6. AI 음색** | 허밍 → 악기, 우리 악기로 학습한 모델 | DDSP | AirChoir 마이크 입력·음높이 |

### 기술 선택 제안

- **웹 1단계는 의존성 없이 직접 작성.** AirChoir가 이미 "npm 설치 없이 실행"하는 구조라 맞추기 쉽고, 우리 코드라 라이선스 걱정이 없습니다.
- **웹과 플러그인 양쪽을 바로 노리면 DSP를 Faust나 C++로 한 번만 작성**하고 WebAssembly(웹)와 iPlug2(플러그인)로 각각 빌드합니다. iPlug2 하나로 CLAP·VST3·AU·iOS AUv3·웹(WAM)이 다 나옵니다.
- **라이선스 방침을 먼저 정하기.** 비공개·판매 가능성을 남김 → MIT/BSD/ISC/Apache/zlib + CC0 음원. 오픈소스 공개 → Surge XT·Vital 포크와 JUCE(AGPL)까지 선택지가 넓어집니다.

## 출처

- VST 3 SDK MIT 전환: [Sonicstate (2025-10-30)](https://sonicstate.com/news/2025/10/30/vst-3-now-available-under-mit-license), [Steinberg 보도자료](https://ocl-steinberg-live.steinberg.net/_storage/asset/819253/storage/master/Press%20Release%20-%202025-10-29%20-%20VST%203.8%20-%20EN.pdf), [Steinberg 포럼 라이선스 글](https://forums.steinberg.net/t/vst-3-sdk-license/201637)
- JUCE 등급: [JUCE 8 EULA 변경 공지](https://forum.juce.com/t/important-changes-to-the-juce-end-user-licence-agreement-for-juce-8/61265), JUCE 저장소 `LICENSE.md`(JUCE 9 EULA 안내)
- Cmajor·Faust·NIH-plug·iPlug2·DPF·CLAP·DaisySP·STK·Mutable Instruments·Surge·Vital·Dexed·Odin 2·sfizz·SpessaSynth·smplr·WebAudioFont·DDSP·DDSP-VST·Neural Amp Modeler·Neutone·RAVE·VCSL·GeneralUser GS: 각 GitHub 저장소의 `LICENSE`·`README`·`package.json` (2026-10-20 확인)
- VSCO 2 CE: [Versilian Studios](https://versilian-studios.com/vsco-community/) · Salamander: [SFZ 판 저장소](https://github.com/sfzinstruments/SalamanderGrandPiano), [원 공개 글(CC-BY)](https://lists.linuxaudio.org/archives/linux-audio-user/2010-May/069663.html) · MuseScore_General: [MuseScore 안내](https://musescore.org/en/handbook/soundfonts) · Sonatina: [Readme](https://os.zynthian.org/factory_sfz/Other/sonatina/Sonatina%20Symphonic%20Orchestra/Readme.html)
- DDSP-VST 학습: [Magenta](https://magenta.tensorflow.org/ddsp-vst) · Stable Audio 라이선스: [Stability AI 설명](https://stability.ai/explainers/stable-audio-vs-competitors-licensing-export-rights-and-self-hosting-compared)
