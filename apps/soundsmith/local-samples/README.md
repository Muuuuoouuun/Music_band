# local-samples — 내 컴퓨터에만 두는 피아노 샘플

이 폴더의 샘플 파일은 **git 에 올라가지 않습니다**(`.gitignore`). 라이선스상 저장소에 넣을 수 없거나 용량이 큰 샘플을
내 컴퓨터에서만 쓰기 위한 자리입니다. 앱은 같은 주소(`local-samples/…`)의 파일만 읽고 서버로 보내는 것은 없습니다.

## 쓰는 법 (3단계)

1. **샘플 놓기** — 세트마다 폴더를 하나 만들고 오디오 파일(wav · flac · ogg)을 넣습니다. 파일 이름에 음 이름이 있어야 합니다.
   - 읽는 이름: `C4.wav` · `F#3.flac` · `Bb2.wav` · `Ds1v8.flac`(s = 샤프, `v8` = 벨로시티 층 8) · `Woodland_A4_v2.ogg` · `60.wav`(MIDI 번호). C4 = 60.
   - 음마다 한 파일이면 충분합니다(없는 음은 가장 가까운 녹음을 늘리고 줄여 씁니다). 벨로시티 층이 여러 개면 가운데 층 하나만 씁니다.
   - 릴리즈 트리거·페달·해머 소리 파일(`rel`, `pedal`, `hammer`, `noise` 가 이름에 든 것)은 자동으로 건너뜁니다.
2. **set.json 만들기**
   ```bash
   cd apps/soundsmith
   node tools/make-sample-set.mjs local-samples/woodland-piano --name "우드랜드 피아노" --credit "ockpii · Woodland Piano" --license "개인 사용"
   ```
3. **실행** — `npm start` 로 켜고 `http://localhost:8010` 에서 실험실 → 피아노 카드 **'우드랜드 피아노 (로컬 샘플)'** 을 고르면 불러옵니다.
   폴더가 없으면 "샘플이 없어요" 안내가 뜨고 소리는 나지 않습니다. (`file://` 로 열면 읽을 수 없으니 `npm start` 로 여세요.)

세트 이름(폴더 이름)은 카드가 정해 둡니다.

| 카드 | 폴더 | 샘플 구하는 곳 | 라이선스 |
|---|---|---|---|
| 우드랜드 피아노 (로컬 샘플) | `local-samples/woodland-piano/` | ockpii 의 [Woodland Piano](https://ockpii.gumroad.com/l/woodland-piano) (Gumroad, 0원 이상 직접 정함, 약 2.4 GB, Kontakt 용) | **재배포 금지**. 내 컴퓨터에서만. 아래 주의 참고 |
| 살라만더 그랜드 (로컬 샘플) | `local-samples/salamander-grand/` | [FreePats](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html) 의 SFZ WAV 44.1kHz 16bit (394 MiB) 또는 [sfzinstruments/SalamanderGrandPiano](https://github.com/sfzinstruments/SalamanderGrandPiano) | CC BY 3.0 (Alexander Holm) — 쓰려면 이름 표시 |

## 주의

- **Woodland Piano 는 Kontakt 전용 악기**입니다. 받은 압축 안에 일반 wav/flac 파일이 들어 있는지는 직접 확인해야 하고(Kontakt 전용 압축 `.ncw` 면 이 앱에서 쓸 수 없습니다),
  이 저장소 작업에서는 내려받아 확인하지 않았습니다. 샘플을 다른 악기용으로 바꿔 나누는 것은 허용되지 않으니(Pianobook·Spitfire 계열 약관과 같은 취지) **내 컴퓨터에서 혼자 쓰는 용도**로만 쓰세요.
  배포자(ockpii)의 사용 조건은 구매 페이지에서 직접 확인하세요.
- **살라만더**는 CC BY 3.0 이라 재배포가 허락되지만 용량(394 MiB~1.2 GiB) 때문에 저장소에 넣지 않았습니다. 다시 올리거나 나누려면 `Piano samples by Alexander Holm (CC BY 3.0)` 표시가 필요합니다. `set.json` 의 `--credit` 에 적어 두면 선택할 때 화면에 보입니다.
- 샘플은 한 음마다 한 층(가운데 벨로시티)만 쓰므로 세게/여리게 쳐도 음색은 같고 크기만 달라집니다.
