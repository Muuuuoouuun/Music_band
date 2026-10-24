// 사용법: 머리의 '사용법' 단추(또는 ? 키)로 여는 안내 창과, 처음 온 사람에게 음색 만들기 위에 보여 주는 시작 카드.
// 안내 창의 '이 화면으로' 단추는 바로 그 화면을 연다.
import { h } from './ui.js';

const SECTIONS = [
  {
    id: 'start', title: '처음 3분',
    body: () => [
      h('ol', { class: 'guide-steps' },
        h('li', {}, h('strong', {}, '소리 켜기'), ' — 오른쪽 위 단추. 브라우저는 한 번 눌러야 소리를 낼 수 있어요.'),
        h('li', {}, h('strong', {}, '음색 고르기'), ' — 음색 만들기의 서랍에서 패드·건반·국악기… 64개 중 하나.'),
        h('li', {}, h('strong', {}, '쳐 보기'), ' — 아래 화면 건반, 컴퓨터 자판 A S D F…(검은 건반 W E T Y U), Z·X 로 옥타브. USB·블루투스 MIDI 건반은 꽂으면 바로 돼요(크롬·엣지).'),
        h('li', {}, h('strong', {}, '다듬고 저장'), ' — 도우미 슬라이더와 고민별 다듬기로 맞추고 ‘내 음색으로 저장’.')),
      h('p', { class: 'guide-note' }, '소리가 안 나면: 기기 음소거·볼륨, 마스터 슬라이더, ‘소리 켜짐’ 표시를 확인하세요. 소리가 멈추지 않으면 ‘모두 멈춤’.'),
    ],
  },
  {
    id: 'screens', title: '화면마다',
    body: (go) => [
      h('dl', { class: 'guide-screens' },
        ...[
          ['synth', '음색 만들기', '기본 음색 고르기, 도우미·고민별 다듬기, 처음에는 ‘간단히’ 보기로 꼭 필요한 패널만. ‘모두’ 로 바꾸면 오실레이터·LFO·이펙트까지.'],
          ['live', '연주 · 세트리스트', '곡마다 음색·조옮김·BPM·메모를 담아 두고 무대에서 화살표·페달·MIDI 로 넘겨요.'],
          ['match', '음원 따라 만들기', '음원 파일·유튜브 링크의 한 구간을 재서 닮은 음색을 만들어요. 악기가 혼자 나오는 곳을 고르면 가장 닮아요.'],
          ['sampler', '샘플러 · 루프 지점', '녹음하거나 불러온 소리를 건반 전체로. 루프 지점·거꾸로·이펙트 굽기, SFZ 로 내보내기.'],
          ['looper', '루퍼', '4트랙을 박에 맞춰 겹쳐 녹음. 트랙마다 음색이 따로예요.'],
          ['tuning', '튜닝', '기준음(A4)·조옮김·음률. 마이크로 다른 악기를 듣고 기준음을 맞출 수 있어요.'],
        ].flatMap(([id, name, text]) => [
          h('dt', {}, h('button', { type: 'button', class: 'link-btn', onclick: () => go(id) }, `${name} →`)),
          h('dd', {}, text),
        ])),
    ],
  },
  {
    id: 'shape', title: '음색 다듬는 법',
    body: () => [
      h('ol', { class: 'guide-steps' },
        h('li', {}, h('strong', {}, '비슷한 음색에서 출발'), ' — 서랍, 음원 따라 만들기, 랜덤 만들기. 처음부터 만드는 것보다 빨라요.'),
        h('li', {}, h('strong', {}, '들어 보기'), ' — 건반 없이 한 음·화음·아르페지오·끊어 치기. 값을 바꿀 때마다 다시 눌러 견주세요.'),
        h('li', {}, h('strong', {}, '도우미로 큰 방향'), ' — 밝기·따뜻함·공간·움직임. 가운데가 지금 소리예요.'),
        h('li', {}, h('strong', {}, '고민별 다듬기'), ' — ‘먹먹해요’ ‘뭉개져요’ ‘밴드에 묻혀요’ 같은 고민을 누르면 어떤 값을 얼마나 바꿨는지 보여 줘요. 한 번 더 누르면 더.'),
        h('li', {}, h('strong', {}, '자세히'), ' — ‘모두’ 보기에서 필터(밝기)·엔벨로프(시작과 끝)·잔향(공간)을 직접. 엔벨로프 그림이 소리의 모양이에요.'),
        h('li', {}, h('strong', {}, 'A/B 와 저장'), ' — ‘이펙트 끄고 듣기’로 이펙트가 하는 일을 확인하고 저장. 되돌리기는 60번까지.')),
      h('p', { class: 'guide-note' }, '예배 반주 팁: 패드는 어택·릴리즈를 길게, 저음은 비워(베이스·킥과 안 부딪히게) 두고, 회중 노래를 덮지 않게 2~4kHz 를 너무 올리지 마세요.'),
    ],
  },
  {
    id: 'tune', title: '음높이 맞추기',
    body: (go) => [
      h('ol', { class: 'guide-steps' },
        h('li', {}, h('strong', {}, '함께 칠 악기에 맞추기'), ' — 튜닝 화면의 마이크 튜너를 켜고 피아노·오르간의 A(라) 음을 길게 치면, ‘이 소리에 기준음 맞추기’로 기준음이 그 악기에 맞춰져요. 피아노는 440~442Hz 가 흔해요.'),
        h('li', {}, h('strong', {}, '노래 키에 맞추기'), ' — 조옮김 ± 반음. 손은 익숙한 C 자리로 치고 소리는 D 로. 세트리스트에 곡마다 저장돼요.'),
        h('li', {}, h('strong', {}, '음률'), ' — 보통은 12평균율. 한 조에 오래 머무는 패드·오르간 곡에서 순정률을 쓰려면 기준 조를 곡의 조로 두고 ‘번갈아 듣기’로 맥놀이를 견줘 보세요.')),
      h('p', {}, h('button', { type: 'button', class: 'link-btn', onclick: () => go('tuning') }, '튜닝 화면 열기 →')),
    ],
  },
  {
    id: 'live', title: '실제 연주에서',
    body: (go) => [
      h('ul', { class: 'guide-list' },
        h('li', {}, '곡 순서대로 ‘지금 음색으로 곡 추가’ → 무대에서는 연주 화면을 열어 두고 →·PageDown(페이지 넘김 페달)·숫자 1~9·MIDI 프로그램 체인지로 넘겨요.'),
        h('li', {}, '연주 화면을 열어 두면 화면이 꺼지지 않게 해요(되는 브라우저에서). 노트북은 전원을 연결해 두세요.'),
        h('li', {}, '블루투스 이어폰·스피커는 소리가 늦게 와요. 유선 이어폰이나 오디오 인터페이스를 쓰세요.'),
        h('li', {}, '건반은 아래 ‘건반 접기’로 접을 수 있어요. 접어도 컴퓨터 자판·MIDI 건반은 그대로 돼요.'),
        h('li', {}, '내 음색·세트리스트·튜닝은 이 브라우저에만 남아요. 다른 기기로 옮기거나 백업하려면 ‘파일로 내보내기’.')),
      h('p', {}, h('button', { type: 'button', class: 'link-btn', onclick: () => go('live') }, '연주 화면 열기 →')),
    ],
  },
  {
    id: 'keys', title: '단축키',
    body: () => [
      h('table', { class: 'guide-keys' },
        h('tbody', {},
          ...[
            ['A S D F G H J K L ; \'', '흰 건반 (A = C4)'],
            ['W E T Y U O P', '검은 건반'],
            ['Z · X', '한 옥타브 아래·위'],
            ['?', '이 사용법 열기'],
            ['→ · PageDown · ]', '연주 화면: 다음 곡'],
            ['← · PageUp · [', '연주 화면: 이전 곡'],
            ['1 ~ 9', '연주 화면: 그 번호의 곡'],
            ['Esc', '이 창 닫기'],
          ].map(([k, v]) => h('tr', {}, h('th', {}, h('kbd', {}, k)), h('td', {}, v))))),
    ],
  },
];

let dialog = null;

/** 안내 창 열기. section: 처음 보여 줄 절 id */
export function openGuide(app, section = 'start') {
  dialog = dialog ?? document.getElementById('guide');
  if (!dialog) return;
  const go = (id) => {
    dialog.close();
    app.showTab(id);
  };
  const tabs = SECTIONS.map((s) => h('button', { type: 'button', class: 'guide-tab', 'aria-pressed': 'false', dataset: { id: s.id } }, s.title));
  const body = h('div', { class: 'guide-body' });
  const show = (id) => {
    const s = SECTIONS.find((x) => x.id === id) ?? SECTIONS[0];
    tabs.forEach((t) => t.setAttribute('aria-pressed', String(t.dataset.id === s.id)));
    body.replaceChildren(h('h3', {}, s.title), ...s.body(go));
  };
  tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.id)));
  dialog.replaceChildren(
    h('header', { class: 'guide-head' },
      h('h2', { id: 'guide-title' }, '음색 공방 사용법'),
      h('button', { type: 'button', class: 'quiet small', onclick: () => dialog.close(), 'aria-label': '사용법 닫기' }, '닫기')),
    h('nav', { class: 'guide-tabs', 'aria-label': '사용법 목차' }, ...tabs),
    body);
  show(section);
  if (!dialog.open) dialog.showModal();
  if (!dialog.dataset.bound) {
    dialog.dataset.bound = '1';
    // 창 바깥(어두운 곳)을 누르면 닫힘
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  }
}

/** 처음 온 사람에게 보이는 시작 카드. 닫으면 다시 안 나온다 (사용법 단추로 언제든) */
export function StartCard(app) {
  const card = h('section', { class: 'start-card', 'aria-label': '시작 안내' },
    h('div', { class: 'start-head' },
      h('h3', {}, '처음이라면'),
      h('button', { type: 'button', class: 'quiet small', onclick: () => app.setUi({ startDismissed: true }) }, '닫기')),
    h('ol', { class: 'start-steps' },
      h('li', {}, h('button', { type: 'button', class: 'link-btn', onclick: () => app.ensureAudio() }, '소리 켜기'), h('span', {}, '한 번만 누르면 돼요')),
      h('li', {}, h('strong', {}, '음색 고르기'), h('span', {}, '왼쪽(휴대폰은 위) 서랍')),
      h('li', {}, h('strong', {}, '쳐 보기'), h('span', {}, '아래 건반이나 A S D F 자판')),
      h('li', {}, h('strong', {}, '다듬고 저장'), h('span', {}, '도우미·고민별 다듬기 → 내 음색으로 저장'))),
    h('p', { class: 'start-more' },
      h('button', { type: 'button', class: 'link-btn', onclick: () => openGuide(app, 'start') }, '사용법 전체 보기'), ' · ',
      h('button', { type: 'button', class: 'link-btn', onclick: () => openGuide(app, 'live') }, '무대에서 쓰는 법')));
  const sync = () => { card.hidden = Boolean(app.ui.startDismissed); };
  app.on('ui', sync);
  sync();
  return card;
}
