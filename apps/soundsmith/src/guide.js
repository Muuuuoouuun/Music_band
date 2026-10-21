// 처음 쓰는 사람 안내와 도움말.
// - 처음 안내 카드(예배 무대 맨 위): 네 가지만 해 보면 되도록. 한 것은 저절로 체크되고, 다 하거나 닫으면 다시 안 나옴.
// - 도움말 창(머리글의 '?' 또는 ? 키): 기능 찾기(어디에 있는지 + 바로 가기)와 단축키.
import { h } from './ui.js';
import * as store from './store.js';

const STEPS = [
  { id: 'power', title: '소리 켜기', hint: '브라우저는 한 번 눌러야 소리를 낼 수 있어요.', act: '소리 켜기' },
  { id: 'note', title: '건반 쳐 보기', hint: '아래 건반을 누르거나 컴퓨터 A·S·D… 키, MIDI 건반으로 쳐요.', act: 'C 코드 들어 보기' },
  { id: 'pad', title: '패드로 음색 바꾸기', hint: '음색 패드를 누르거나 숫자 키 1–8. 판을 밀면 밝기·공간이 바뀌어요.', act: '2번 패드 고르기' },
  { id: 'arranger', title: '반주 만들기 열어 보기', hint: '코드만 적으면 루퍼에 예배 반주가 깔려요. band2sheet 코드도 불러와요.', act: '반주 만들기 열기' },
];

export function GuideCard(app) {
  const saved = store.load('ui', {}) ?? {};
  const state = { done: new Set(Array.isArray(saved.guideDone) ? saved.guideDone : []), hidden: saved.guideHidden === true };
  const persist = () => {
    const ui = store.load('ui', {}) ?? {};
    store.save('ui', { ...ui, guideDone: [...state.done], guideHidden: state.hidden });
  };
  const list = h('ol', { class: 'guide-steps' });
  const title = h('h2', {});
  const closeBtn = h('button', { type: 'button', class: 'quiet small guide-close', onclick: () => { state.hidden = true; persist(); render(); } }, '다음에 보지 않기');
  const el = h('section', { class: 'guide', 'aria-label': '처음 안내' },
    h('div', { class: 'guide-head' }, title, closeBtn), list);

  const run = {
    power: () => document.getElementById('power').click(),
    note: async () => {
      await app.ensureAudio();
      const now = app.studio.ctx.currentTime;
      for (const m of [48, 60, 64, 67]) {
        app.live.noteOn(m, 0.7, now);
        app.live.noteOff(m, now + 1.6);
      }
      mark('note');
    },
    pad: () => { app.showTab('stage'); app.stage.pickPad(1); },
    arranger: () => { app.showTab('stage'); app.stage.openLooper(); app.looper.openArranger(); },
  };
  function mark(id) {
    if (state.done.has(id)) return;
    state.done.add(id);
    persist();
    render();
  }
  function render() {
    const left = STEPS.filter((x) => !state.done.has(x.id)).length;
    el.hidden = state.hidden;
    title.textContent = left ? `처음이세요? 네 가지만 해 보세요 · ${STEPS.length - left}/${STEPS.length}` : '다 해 봤어요! 이제 우리 팀 곡을 세트 리스트에 넣어 보세요';
    closeBtn.textContent = left ? '다음에 보지 않기' : '닫기';
    list.replaceChildren(...STEPS.map((x, i) => {
      const done = state.done.has(x.id);
      return h('li', { class: `guide-step${done ? ' is-done' : ''}` },
        h('span', { class: 'guide-no', 'aria-hidden': 'true' }, done ? '✓' : String(i + 1)),
        h('div', { class: 'guide-text' }, h('strong', {}, x.title), h('span', {}, x.hint)),
        done ? h('span', { class: 'guide-ok' }, '했어요') : h('button', { type: 'button', class: 'small', onclick: () => run[x.id]() }, x.act));
    }));
  }
  // 한 것은 저절로 체크
  const presetAtStart = app.presetId;
  app.on('audio', () => mark('power'));
  app.on('note', ({ on }) => { if (on) mark('note'); });
  app.on('patch', ({ phase } = {}) => { if (phase === 'change' && app.presetId !== presetAtStart && app.tab === 'stage') mark('pad'); });
  app.on('arranger', () => mark('arranger'));
  render();
  return { el, reset() { state.done.clear(); state.hidden = false; persist(); render(); } };
}

/** 도움말 창: 기능 찾기(어디 있는지 + 바로 가기)와 단축키 */
export function HelpDialog(app) {
  const FEATURES = [
    ['세트 리스트·곡 추가', '예배 무대 → 세트 편집', () => { app.showTab('stage'); app.stage.focus('set'); }],
    ['음색 패드 바꾸기', '예배 무대 → 패드 바꾸기', () => { app.showTab('stage'); app.stage.focus('pads'); }],
    ['전환 효과음 (라이저·임팩트…)', '예배 무대 → 전환 효과음', () => { app.showTab('stage'); app.stage.focus('fx'); }],
    ['드론 깔기', '예배 무대 → 드론', () => { app.showTab('stage'); app.stage.focus('drone'); }],
    ['루퍼 녹음', '예배 무대 → 트랙 펼치기', () => { app.showTab('stage'); app.stage.focus('looper'); }],
    ['반주 만들기 (코드 → 반주)', '예배 무대 → 루퍼 줄 → 반주 만들기', () => { app.showTab('stage'); app.stage.openLooper(); app.looper.openArranger(); }],
    ['band2sheet 코드 불러오기', '반주 만들기 → 넣기 → band2sheet 코드 진행 불러오기', () => { app.showTab('stage'); app.stage.openLooper(); app.looper.openArranger(); requestAnimationFrame(() => document.querySelector('.arr-import')?.scrollIntoView({ block: 'center' })); }],
    ['음색 고르기·찾기', '실험실 → 고르기', () => { app.showTab('lab'); app.lab.go('pick'); }],
    ['음색 겹치기·나누기 (하이브리드)', '실험실 → 겹치기·나누기', () => { app.showTab('lab'); app.lab.go('hybrid'); }],
    ['밝기·따뜻함·공간·움직임', '실험실 → 다듬기', () => { app.showTab('lab'); app.lab.go('shape'); }],
    ['내 음색 저장·무대 패드에 올리기', '실험실 → 다듬기 아래', () => { app.showTab('lab'); app.lab.go('shape'); }],
    ['오르간 드로바·로터리', '실험실 → 자세히 → 소리 재료 \'오르간\'', () => { app.showTab('lab'); app.lab.go('detail'); }],
    ['필터·엔벨로프·배음 그리기', '실험실 → 자세히', () => { app.showTab('lab'); app.lab.go('detail'); }],
    ['샘플러·루프 지점·SFZ', '실험실 → 자세히 → 소리 재료 \'샘플\'', () => { app.showTab('lab'); app.lab.openSample(); }],
    ['톤 맞추기·레퍼런스 음원', '톤 맞추기', () => app.showTab('tone')],
    ['A4·음률·조옮김 (튜닝)', '톤 맞추기 → 음 높이 자세히', () => { app.showTab('tone'); app.tone.openPitch(); }],
    ['샘플 패드 (자르기·비트 찍기)', '샘플 패드', () => app.showTab('pads')],
  ];
  const KEYS = [
    ['A W S E D F T G Y H U J K O L P', '건반 (A = C4). 샘플 패드 화면에서는 패드 1–16'],
    ['Z · X', '건반 한 옥타브 아래 · 위'],
    ['1 – 8', '예배 무대에서 음색 패드'],
    ['화살표', '노브·드로바·나누는 점·건반 지도·휠 조절'],
    ['두 번 누르기', '노브를 기본값으로'],
    ['?', '이 도움말 열기 · 닫기 (Esc)'],
    ['MIDI CC64 · CC1', '서스테인 페달 · 모듈레이션 휠(로터리 빠르게)'],
  ];
  const find = h('input', { type: 'search', class: 'text-input help-find', placeholder: '기능 찾기 — 예: 드론, 튜닝, 코드', 'aria-label': '기능 찾기', autocomplete: 'off' });
  const list = h('ul', { class: 'help-list' });
  const close = () => dlg.close();
  function render() {
    const q = find.value.trim().toLowerCase();
    const rows = FEATURES.filter(([name, where]) => !q || `${name} ${where}`.toLowerCase().includes(q));
    list.replaceChildren(...rows.map(([name, where, go]) => h('li', {},
      h('button', { type: 'button', class: 'help-go', onclick: () => { close(); go(); } },
        h('strong', {}, name), h('span', {}, where), h('span', { class: 'help-arrow', 'aria-hidden': 'true' }, '바로 가기 ›')))));
    if (!rows.length) list.append(h('li', { class: 'panel-hint' }, '맞는 기능이 없어요. 다른 말로 찾아보세요.'));
  }
  find.addEventListener('input', render);
  const dlg = h('dialog', { class: 'help', 'aria-labelledby': 'help-h' },
    h('div', { class: 'help-head' }, h('h2', { id: 'help-h' }, '도움말 · 기능 찾기'), h('button', { type: 'button', class: 'quiet small', onclick: close, 'aria-label': '도움말 닫기' }, '닫기 ×')),
    find, list,
    h('h3', {}, '단축키'),
    h('dl', { class: 'help-keys' }, ...KEYS.flatMap(([k, v]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, v)])),
    h('div', { class: 'help-foot' },
      h('button', { type: 'button', class: 'quiet small', onclick: () => { close(); app.guide?.reset(); app.showTab('stage'); window.scrollTo(0, 0); } }, '처음 안내 다시 보기')));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  const open = () => {
    if (dlg.open) return;
    find.value = '';
    render();
    dlg.showModal();
    find.focus();
  };
  window.addEventListener('keydown', (e) => {
    const typing = e.target?.closest?.('input, textarea, select, [contenteditable]');
    if (e.key === '?' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (dlg.open) close();
      else open();
    }
  });
  return { open, close, el: dlg };
}
