// 기본 음색: 예배 건반에서 자주 쓰는 소리 위주. 비운 값은 BASE_PATCH(담백한 소리)로 채운다.
import { normalizePatch } from './patch.js';

const RAW = [
  {
    name: '워십 패드', category: 'pad',
    osc: [{ wave: 'sawtooth', unison: 5, spread: 16, level: 0.55 }, { wave: 'warm', octave: -1, level: 0.35 }],
    filter: { cutoff: 1400, q: 0.6, env: 0.8, keytrack: 0.4 },
    ampEnv: { a: 1.4, d: 2, s: 0.9, r: 3.2 }, filterEnv: { a: 2.5, d: 3, s: 0.6, r: 3 },
    lfo: { target: 'filter', rate: 0.18, depth: 0.25 },
    fx: { chorus: 0.5, delay: 0.12, delayBeats: 0.75, feedback: 0.35, reverb: 0.55, size: 5 },
  },
  {
    name: '공기 패드', category: 'pad',
    osc: [{ wave: 'choir', unison: 3, spread: 10, level: 0.6 }, { wave: 'triangle', octave: 1, level: 0.2 }],
    noise: 0.06,
    filter: { cutoff: 3200, q: 1.2, env: 0.5 },
    ampEnv: { a: 2.2, d: 2, s: 0.85, r: 4 }, filterEnv: { a: 3, d: 3, s: 0.7, r: 3 },
    lfo: { target: 'filter', rate: 0.09, depth: 0.4 },
    fx: { chorus: 0.6, delay: 0.2, reverb: 0.7, size: 7 },
  },
  {
    name: '스웰 스트링', category: 'strings',
    osc: [{ wave: 'sawtooth', unison: 4, spread: 12, level: 0.6 }, { wave: 'sawtooth', octave: -1, unison: 2, spread: 8, level: 0.3 }],
    filter: { cutoff: 2600, q: 0.5, env: 0.6, keytrack: 0.6 },
    ampEnv: { a: 0.45, d: 1, s: 0.85, r: 0.9 }, filterEnv: { a: 0.6, d: 1, s: 0.7, r: 1 },
    lfo: { target: 'pitch', rate: 5.2, depth: 0.12, delay: 0.5 },
    fx: { chorus: 0.3, reverb: 0.45, size: 3 },
  },
  {
    name: '브라스 스웰', category: 'strings',
    osc: [{ wave: 'sawtooth', unison: 2, spread: 6, level: 0.65 }],
    filter: { cutoff: 900, q: 1.5, env: 1.6, keytrack: 0.5 },
    ampEnv: { a: 0.08, d: 0.3, s: 0.85, r: 0.25 }, filterEnv: { a: 0.25, d: 0.6, s: 0.6, r: 0.3 },
    lfo: { target: 'pitch', rate: 5, depth: 0.06, delay: 0.4 },
    fx: { reverb: 0.3, size: 2.5 },
  },
  {
    name: 'DX 일렉피아노', category: 'keys',
    osc: [{ wave: 'sine', level: 0.8 }],
    fm: { amount: 0.45, ratio: 1, decay: 0.9, sustain: 0.05 },
    filter: { cutoff: 6000, keytrack: 0 },
    ampEnv: { a: 0.002, d: 2.8, s: 0, r: 0.5 },
    lfo: { target: 'amp', rate: 4.5, depth: 0.15 },
    fx: { chorus: 0.35, reverb: 0.25, size: 2.2 },
  },
  {
    name: '교회 오르간', category: 'keys',
    osc: [{ wave: 'organ', level: 0.7 }],
    filter: { cutoff: 7000, q: 0.3, keytrack: 0 },
    ampEnv: { a: 0.01, d: 0.1, s: 1, r: 0.12 },
    lfo: { target: 'amp', rate: 6.2, depth: 0.1 },
    fx: { chorus: 0.45, reverb: 0.5, size: 3.5 },
  },
  {
    name: 'FM 벨', category: 'bell',
    osc: [{ wave: 'sine', level: 0.75 }],
    fm: { amount: 0.5, ratio: 3.5, decay: 2.5, sustain: 0.1 },
    filter: { cutoff: 9000, keytrack: 0 },
    ampEnv: { a: 0.002, d: 4, s: 0, r: 3 },
    fx: { delay: 0.2, delayBeats: 0.75, reverb: 0.5, size: 4 },
  },
  {
    name: '유리 벨 패드', category: 'bell',
    osc: [{ wave: 'sine', level: 0.6 }, { wave: 'choir', octave: -1, unison: 3, spread: 12, level: 0.3 }],
    fm: { amount: 0.35, ratio: 7, decay: 1.5, sustain: 0.12 },
    filter: { cutoff: 5000, keytrack: 0.2 },
    ampEnv: { a: 0.01, d: 3, s: 0.45, r: 3.5 },
    lfo: { target: 'filter', rate: 0.2, depth: 0.2 },
    fx: { chorus: 0.4, delay: 0.25, reverb: 0.6, size: 6 },
  },
  {
    name: '신스 베이스', category: 'bass', mono: true, glide: 0.06,
    osc: [{ wave: 'sawtooth', octave: -1, level: 0.6 }, { wave: 'square', octave: -2, level: 0.4 }],
    filter: { cutoff: 380, q: 4, env: 2.2, keytrack: 0.3 },
    filterEnv: { a: 0.002, d: 0.35, s: 0.15, r: 0.15 }, ampEnv: { a: 0.003, d: 0.4, s: 0.7, r: 0.12 },
    fx: { drive: 0.25, reverb: 0.05 },
  },
  {
    name: '서브 베이스', category: 'bass', mono: true, glide: 0.03,
    osc: [{ wave: 'sine', octave: -1, level: 0.9 }, { wave: 'triangle', octave: -1, level: 0.25 }],
    filter: { cutoff: 900, keytrack: 0 },
    ampEnv: { a: 0.01, d: 0.2, s: 0.9, r: 0.2 },
    fx: { reverb: 0 },
  },
  {
    name: '부드러운 리드', category: 'lead', mono: true, glide: 0.08,
    osc: [{ wave: 'square', level: 0.5 }, { wave: 'sawtooth', detune: 7, level: 0.35 }],
    filter: { cutoff: 2400, q: 2, env: 1.2 },
    filterEnv: { a: 0.01, d: 0.6, s: 0.4, r: 0.3 }, ampEnv: { a: 0.02, d: 0.3, s: 0.85, r: 0.3 },
    lfo: { target: 'pitch', rate: 5.5, depth: 0.1, delay: 0.35 },
    fx: { delay: 0.3, delayBeats: 0.75, feedback: 0.4, reverb: 0.3 },
  },
  {
    name: '디지털 플럭', category: 'pluck',
    osc: [{ wave: 'sawtooth', unison: 2, spread: 8, level: 0.6 }, { wave: 'square', octave: 1, level: 0.2 }],
    filter: { cutoff: 500, q: 3, env: 3.2, keytrack: 0.5 },
    filterEnv: { a: 0.001, d: 0.25, s: 0, r: 0.2 }, ampEnv: { a: 0.001, d: 0.6, s: 0, r: 0.4 },
    fx: { delay: 0.35, delayBeats: 0.75, feedback: 0.45, reverb: 0.35 },
  },
  {
    name: '어쿠스틱 기타', category: 'pluck', source: 'pluck',
    pluck: { bright: 0.8, decay: 3, pick: 0.18, body: 0.65 },
    filter: { cutoff: 12000, keytrack: 0 },
    ampEnv: { a: 0.001, d: 1, s: 1, r: 0.35 },
    fx: { reverb: 0.2, size: 1.8 },
  },
  {
    name: '하프', category: 'pluck', source: 'pluck',
    pluck: { bright: 0.55, decay: 4, pick: 0.45, body: 0.3 },
    filter: { cutoff: 12000, keytrack: 0 },
    ampEnv: { a: 0.001, d: 1, s: 1, r: 0.8 },
    fx: { reverb: 0.45, size: 3.5 },
  },
  // ---- 피아노 (합성) --------------------------------------------------------
  // 릴(@studiocvrg)에 나온 유료 피아노 3종의 '분위기만' 이 앱 엔진으로 흉내 낸 소리. 샘플·원음은 쓰지 않는다.
  // 피아노 음색 공통: 배음 줄이기(custom) + 같은 줄 두 가닥의 맥놀이(겹치기 2, 미세 음정) + 해머 딱 소리(짧은 FM)
  // + 치면 줄어드는 소리(서스테인 0) + 높은 음일수록 밝게(건반 따라가기).
  {
    name: '그랜듀어풍 그랜드', category: 'piano',
    osc: [{ wave: 'custom', unison: 2, spread: 5, level: 0.62 }, { wave: 'triangle', level: 0.16, detune: 3 }],
    custom: [1, 0.78, 0.52, 0.4, 0.26, 0.2, 0.12, 0.1, 0.07, 0.05, 0.04, 0.03, 0.02, 0.02, 0.01, 0.01, 0.01, 0, 0, 0, 0, 0, 0, 0],
    fm: { amount: 0.1, ratio: 7, decay: 0.1, sustain: 0 },
    filter: { cutoff: 4800, q: 0.5, env: 1.1, keytrack: 0.7 },
    filterEnv: { a: 0.001, d: 0.4, s: 0.15, r: 0.3 },
    ampEnv: { a: 0.002, d: 5, s: 0, r: 0.4 },
    fx: { drive: 0, chorus: 0, reverb: 0.22, size: 2.4 },
    tone: { mud: -1.5, clarity: 1.5, air: 1, lowcut: 30 },
    volume: 1,
  },
  {
    name: '블루 빈티지풍 재즈', category: 'piano',
    osc: [{ wave: 'custom', unison: 2, spread: 8, level: 0.6 }, { wave: 'sine', level: 0.2 }],
    custom: [1, 0.6, 0.3, 0.2, 0.1, 0.07, 0.04, 0.03, 0.02, 0.01, 0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    fm: { amount: 0.06, ratio: 3, decay: 0.08, sustain: 0 },
    noise: 0.05,
    filter: { cutoff: 2300, q: 0.6, env: 0.8, keytrack: 0.5 },
    filterEnv: { a: 0.001, d: 0.5, s: 0.2, r: 0.3 },
    ampEnv: { a: 0.004, d: 3.6, s: 0, r: 0.5 },
    lfo: { target: 'pitch', rate: 0.6, depth: 0.06, delay: 0.2 },
    fx: { drive: 0.28, chorus: 0.15, reverb: 0.3, size: 1.8 },
    tone: { bass: 2, mud: -1, clarity: -2, air: -5, lowcut: 40 },
    volume: 0.22, // 드라이브로 커지는 만큼 낮춰 다른 음색과 크기를 맞춤
  },
  {
    name: '키스케이프풍 팝 건반', category: 'piano',
    osc: [{ wave: 'custom', unison: 3, spread: 9, level: 0.58 }, { wave: 'triangle', octave: 1, level: 0.15 }],
    custom: [1, 0.85, 0.7, 0.55, 0.42, 0.32, 0.24, 0.18, 0.13, 0.1, 0.07, 0.05, 0.04, 0.03, 0.02, 0.02, 0.01, 0.01, 0, 0, 0, 0, 0, 0],
    fm: { amount: 0.2, ratio: 4, decay: 0.2, sustain: 0 },
    filter: { cutoff: 8500, q: 0.5, env: 1.5, keytrack: 0.8 },
    filterEnv: { a: 0.001, d: 0.3, s: 0.3, r: 0.25 },
    ampEnv: { a: 0.002, d: 3, s: 0.05, r: 0.3 },
    fx: { drive: 0.05, chorus: 0.35, reverb: 0.2, size: 1.6 },
    tone: { bass: -1, clarity: 2, air: 2.5, lowcut: 60 },
  },
  // ---- 로컬 샘플 피아노 (저장소에는 샘플이 없음. 내 컴퓨터의 local-samples/ 폴더에 둔 파일을 불러온다) ----
  // 샘플이 이미 자연스럽게 줄어들므로 서스테인 1 로 두고, 놓을 때만 짧게 닫는다.
  {
    name: '우드랜드 피아노 (로컬 샘플)', category: 'piano', source: 'sample',
    filter: { cutoff: 16000, q: 0.5, keytrack: 0 },
    ampEnv: { a: 0.002, d: 1, s: 1, r: 0.45 },
    fx: { reverb: 0.18, size: 2.2 },
    tone: { bass: 0.5, air: 0.5, lowcut: 30 },
  },
  {
    name: '살라만더 그랜드 (로컬 샘플)', category: 'piano', source: 'sample',
    filter: { cutoff: 16000, q: 0.5, keytrack: 0 },
    ampEnv: { a: 0.002, d: 1, s: 1, r: 0.4 },
    fx: { reverb: 0.15, size: 2 },
    tone: { lowcut: 30 },
  },
];

// 쓰임새: 실험실에서 '어떤 자리에 쓸까요?'로 고를 때
export const USES = [
  { id: 'all', label: '전체' },
  { id: 'lead-under', label: '찬양 인도 밑에 깔기' },
  { id: 'prayer', label: '기도회·묵상' },
  { id: 'band', label: '밴드 합주' },
  { id: 'hymn', label: '찬송가 반주' },
  { id: 'solo', label: '솔로 멜로디' },
];

// 이름 -> [고정 id, 한 줄 설명, 쓰임새]. id 는 저장된 세트 리스트·무대 패드가 가리키므로 바꾸지 않는다.
const META = {
  '워십 패드': ['worship-pad', '천천히 커지고 길게 남는 따뜻한 패드. 인도자 목소리 밑에 깔기 좋아요.', ['lead-under', 'prayer']],
  '공기 패드': ['air-pad', '숨소리가 섞인 높은 패드. 기도회·묵상 배경으로.', ['prayer']],
  '스웰 스트링': ['swell-strings', '현악 합주처럼 부풀었다 사라져요. 후렴 빌드업에.', ['lead-under', 'band']],
  '브라스 스웰': ['brass-swell', '금관이 밀고 올라오는 소리. 절정 부분에 짧게.', ['band']],
  'DX 일렉피아노': ['dx-ep', '맑게 울리고 서서히 줄어드는 80년대 일렉피아노.', ['band', 'solo']],
  '교회 오르간': ['church-organ', "파이프 오르간 8'·4'·2⅔' 스톱을 합친 소리. 찬송가 반주에.", ['hymn']],
  'FM 벨': ['fm-bell', '종처럼 맑게 치고 오래 울려요. 전주·간주 포인트로.', ['solo', 'prayer']],
  '유리 벨 패드': ['glass-bell-pad', '벨 소리 위에 합창 패드를 얹었어요. 잔잔한 묵상 곡에.', ['prayer', 'lead-under']],
  '신스 베이스': ['synth-bass', '한 음씩 짧게 미끄러지는 베이스. 밴드에 베이스가 없을 때.', ['band']],
  '서브 베이스': ['sub-bass', '귀보다 몸으로 느끼는 낮은 소리. 패드 밑을 받쳐요.', ['band', 'lead-under']],
  '부드러운 리드': ['soft-lead', '노래하듯 이어지는 멜로디 소리. 간주 솔로에.', ['solo']],
  '디지털 플럭': ['digital-pluck', '짧게 톡 튀고 딜레이가 따라와요. 리듬 아르페지오에.', ['band']],
  '어쿠스틱 기타': ['acoustic-guitar', '줄을 실제로 계산해 뜯는 소리. 잔잔한 아르페지오에.', ['band', 'solo']],
  '하프': ['harp', '길게 울리는 하프. 찬송가 전주나 분산화음에.', ['hymn', 'prayer']],
  '그랜듀어풍 그랜드': ['clean-grand', '또렷하고 단정한 그랜드 피아노 느낌. 군더더기 없이 맑게 울려요. (유료 The Grandeur 분위기를 합성으로 흉내)', ['band', 'solo', 'hymn']],
  '블루 빈티지풍 재즈': ['blue-vintage', '따뜻하고 어두운 빈티지 재즈 피아노. 테이프 잡음과 약한 흔들림이 살짝. (유료 Piano in Blue 분위기를 합성으로 흉내)', ['prayer', 'solo']],
  '키스케이프풍 팝 건반': ['pop-keys', '밝고 넓게 퍼지는 팝 건반. 밴드 안에서도 묻히지 않아요. (유료 Keyscape 분위기를 합성으로 흉내)', ['band', 'lead-under']],
  '우드랜드 피아노 (로컬 샘플)': ['woodland-piano-local', '따뜻하고 포근한 업라이트 피아노(ockpii 무료 배포). 내 컴퓨터의 local-samples/woodland-piano 폴더에 샘플이 있을 때만 소리가 나요.', ['prayer', 'solo'], { localSet: 'woodland-piano' }],
  '살라만더 그랜드 (로컬 샘플)': ['salamander-grand-local', '야마하 C5 그랜드 피아노(Alexander Holm, CC BY 3.0). 내 컴퓨터의 local-samples/salamander-grand 폴더에 샘플이 있을 때만 소리가 나요.', ['band', 'solo', 'hymn'], { localSet: 'salamander-grand' }],
};

export const FACTORY = RAW.map((p) => {
  const [id, desc, uses, extra = {}] = META[p.name];
  // localSet: 이 음색이 쓰는 로컬 샘플 세트 이름 (local-samples/<localSet>/set.json). 없으면 합성 음색.
  return { id, factory: true, desc, uses, ...extra, patch: normalizePatch(p) };
});

export const factoryById = (id) => FACTORY.find((f) => f.id === id) ?? null;
