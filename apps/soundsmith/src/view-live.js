// 연주 화면: 세트리스트. 곡마다 음색·조옮김·BPM·메모를 담아 두고, 무대에서 화살표·페이지 넘김 페달·숫자·
// MIDI 프로그램 체인지로 다음 곡으로 넘긴다. 이 화면에 있는 동안은 화면이 꺼지지 않게 한다(되는 브라우저에서).
import { h, panel, nextId } from './ui.js';
import { FACTORY } from './presets.js';
import { normalizeSetlist, normalizeSong, moveSong, keyLabel, MAX_SONGS } from './setlist.js';
import * as store from './store.js';

const isTyping = (el) => el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

export function LiveView(root, app) {
  let list = normalizeSetlist(store.load('setlist', []));
  let current = -1;
  const save = () => {
    if (!store.save('setlist', list)) app.notice('이 화면은 저장이 막혀 있어 새로고침하면 세트리스트가 사라져요. 파일로 내보내 두세요.');
  };

  // ---- 무대 카드: 지금 곡·다음 곡·넘기기 ----
  const count = h('p', { class: 'live-count' });
  const title = h('h2', { class: 'live-title' });
  const meta = h('p', { class: 'live-meta' });
  const memo = h('p', { class: 'live-memo' });
  const nextLine = h('p', { class: 'live-next' });
  const prevBtn = h('button', { type: 'button', class: 'live-nav-btn', onclick: () => step(-1) }, '← 이전 곡');
  const nextBtn = h('button', { type: 'button', class: 'live-nav-btn primary', onclick: () => step(1) }, '다음 곡 →');
  const stage = h('section', { class: 'live-stage', 'aria-label': '지금 곡', 'aria-live': 'polite' },
    h('div', { class: 'live-now' }, count, title, meta, memo),
    h('div', { class: 'live-nav' }, prevBtn, nextBtn,
      h('button', { type: 'button', class: 'quiet', onclick: () => app.panic(), title: '울리고 있는 소리를 모두 멈춤' }, '모두 멈춤')),
    nextLine);

  // ---- 세트리스트 ----
  const songsEl = h('ol', { class: 'songs' });
  const importInput = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id: nextId('setimp') });
  importInput.addEventListener('change', async () => {
    const f = importInput.files?.[0];
    importInput.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const songs = normalizeSetlist(Array.isArray(data) ? data : data?.songs);
      if (!songs.length) throw new Error('empty');
      list = songs;
      current = -1;
      save();
      render();
      app.notice(`세트리스트 ${songs.length}곡을 불러왔어요.`, 'good');
    } catch {
      app.notice('세트리스트 파일(JSON)을 읽지 못했어요. 음색 공방에서 내보낸 파일인지 확인하세요.', 'bad');
    }
  });
  const addBtn = h('button', { type: 'button', class: 'primary', onclick: addCurrent }, '지금 음색으로 곡 추가');
  const tools = h('div', { class: 'btn-row' },
    addBtn,
    h('button', { type: 'button', class: 'quiet', onclick: exportList }, '파일로 내보내기'),
    h('label', { class: 'quiet file-btn', for: importInput.id }, '불러오기', importInput));
  const empty = h('div', { class: 'empty-state' },
    h('strong', {}, '아직 곡이 없어요'),
    h('p', {}, '음색 만들기에서 음색을 고르고 조옮김(튜닝 화면)을 맞춘 뒤 ‘지금 음색으로 곡 추가’를 누르세요. 곡마다 음색·조옮김·BPM·메모가 함께 담겨요.'),
    h('div', { class: 'btn-row' }, h('button', { type: 'button', onclick: exampleSet }, '예시 세트리스트 만들기')));

  const wakeState = h('p', { class: 'link-state' });
  const help = panel('무대에서', { hint: '이 화면을 열어 두면 아래 단축키로 곡을 넘겨요. 넘기면 음색·조옮김·BPM 이 한 번에 바뀌어요.' },
    h('dl', { class: 'facts' },
      h('dt', {}, '다음 곡'), h('dd', {}, '→ · PageDown · ] (페이지 넘김 페달)'),
      h('dt', {}, '이전 곡'), h('dd', {}, '← · PageUp · ['),
      h('dt', {}, 'n번째 곡'), h('dd', {}, '숫자 1~9'),
      h('dt', {}, 'MIDI 건반'), h('dd', {}, '프로그램 체인지 1번 = 첫 곡 (어느 화면에서나)'),
      h('dt', {}, '소리가 안 멈출 때'), h('dd', {}, '모두 멈춤')),
    wakeState);

  root.append(h('div', { class: 'live-layout' },
    stage,
    panel('세트리스트', { cls: 'live-list', actions: tools }, songsEl, empty),
    help));

  function songMeta(s) {
    return [s.patch.name, keyLabel(s.transpose), s.bpm ? `BPM ${s.bpm}` : null].filter(Boolean).join(' · ');
  }

  function go(i, { quiet = false } = {}) {
    const s = list[i];
    if (!s) return;
    current = i;
    app.setPatch(s.patch, { phase: 'change', presetId: null });
    if (app.tuning.transpose !== s.transpose) app.setTuning({ ...app.tuning, transpose: s.transpose });
    if (s.bpm && s.bpm !== app.studio.bpm) app.setTempo(s.bpm);
    render();
    if (!quiet && root.hidden) app.notice(`${i + 1}. ${s.title} · ${songMeta(s)}`);
  }

  function step(d) {
    if (!list.length) return;
    const i = current < 0 ? 0 : Math.min(list.length - 1, Math.max(0, current + d));
    if (i !== current) go(i);
  }

  function addCurrent() {
    if (list.length >= MAX_SONGS) return app.notice(`세트리스트는 ${MAX_SONGS}곡까지 담을 수 있어요.`, 'bad');
    list.push(normalizeSong({ title: app.patch.name, patch: app.patch, transpose: app.tuning.transpose, bpm: app.studio.bpm }));
    current = list.length - 1;
    save();
    render();
    songsEl.lastElementChild?.querySelector('.song-title-input')?.focus();
  }

  function exampleSet() {
    const by = (n) => FACTORY.find((f) => f.patch.name === n).patch;
    list = normalizeSetlist([
      { title: '여는 찬양', patch: by('워십 패드'), transpose: 0, bpm: 72, memo: '전주 패드만 4마디, 1절부터 건반' },
      { title: '빠른 곡', patch: by('로즈 피아노'), transpose: 2, bpm: 128, memo: '후렴 두 번째에 크게' },
      { title: '기도 시간', patch: by('쉬머 패드'), transpose: -3, bpm: 60, memo: '홀드 켜고 길게, 말씀 끝날 때까지' },
    ]);
    current = -1;
    save();
    render();
  }

  async function exportList() {
    const json = JSON.stringify({ app: 'soundsmith', kind: 'setlist', songs: list }, null, 2);
    const r = await store.saveFile('세트리스트.json', json, 'application/json');
    if (r !== 'saved') app.notice((await store.copyText(json)) ? '파일 저장을 쓸 수 없어 JSON 을 클립보드에 복사했어요.' : '이 화면에서는 파일을 저장할 수 없어요.');
  }

  function update(i, changes) {
    list[i] = normalizeSong({ ...list[i], ...changes });
    save();
    if (i === current && ('transpose' in changes || 'bpm' in changes || 'patch' in changes)) go(i, { quiet: true });
    else render();
  }

  function songRow(s, i) {
    const titleId = nextId('song');
    const titleInput = h('input', { id: titleId, class: 'text-input song-title-input', value: s.title, maxlength: '60', autocomplete: 'off' });
    titleInput.addEventListener('change', () => update(i, { title: titleInput.value }));
    const bpmInput = h('input', { type: 'number', class: 'text-input num-input', min: 40, max: 200, step: 1, value: s.bpm ?? '', placeholder: '그대로', 'aria-label': `${s.title} BPM` });
    bpmInput.addEventListener('change', () => update(i, { bpm: bpmInput.value === '' ? null : Number(bpmInput.value) }));
    const memoInput = h('textarea', { class: 'text-input song-memo', rows: 2, maxlength: '300', placeholder: '메모 (예: 전주 4마디 패드만)', 'aria-label': `${s.title} 메모` });
    memoInput.value = s.memo;
    memoInput.addEventListener('change', () => update(i, { memo: memoInput.value }));
    const on = i === current;
    return h('li', { class: 'song', 'aria-current': String(on) },
      h('button', { type: 'button', class: 'song-go', onclick: () => go(i), 'aria-label': `${i + 1}번 ${s.title} 연주하기` },
        h('span', { class: 'song-num' }, String(i + 1)),
        h('span', { class: 'song-name' }, h('strong', {}, s.title), h('span', {}, songMeta(s)))),
      h('details', { class: 'song-edit' },
        h('summary', {}, '고치기'),
        h('div', { class: 'song-fields' },
          h('label', { class: 'label', for: titleId }, '곡 이름'), titleInput,
          h('span', { class: 'label' }, '조옮김'),
          h('div', { class: 'stepper' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': '반음 내리기', onclick: () => update(i, { transpose: s.transpose - 1 }) }, '−'),
            h('output', { class: 'step-out' }, keyLabel(s.transpose)),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': '반음 올리기', onclick: () => update(i, { transpose: s.transpose + 1 }) }, '+')),
          h('span', { class: 'label' }, 'BPM'), bpmInput,
          h('span', { class: 'label' }, '메모'), memoInput),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'small', onclick: () => update(i, { patch: app.patch }), title: '이 곡의 음색을 지금 음색으로' }, '지금 음색으로 바꾸기'),
          h('button', { type: 'button', class: 'small', disabled: i === 0, onclick: () => reorder(i, -1) }, '위로'),
          h('button', { type: 'button', class: 'small', disabled: i === list.length - 1, onclick: () => reorder(i, 1) }, '아래로'),
          h('button', { type: 'button', class: 'small quiet', onclick: () => remove(i) }, '빼기'))));
  }

  function reorder(i, d) {
    const id = list[current]?.id;
    list = moveSong(list, i, d);
    current = list.findIndex((s) => s.id === id);
    save();
    render();
  }

  function remove(i) {
    const id = list[current]?.id;
    list.splice(i, 1);
    current = list.findIndex((s) => s.id === id);
    save();
    render();
  }

  function render() {
    const s = list[current];
    count.textContent = list.length ? (s ? `${current + 1} / ${list.length}` : `${list.length}곡 · 아직 고르지 않음`) : '세트리스트 없음';
    title.textContent = s ? s.title : list.length ? '첫 곡을 고르세요' : '곡을 담아 두면 여기서 넘겨요';
    meta.textContent = s ? songMeta(s) : list.length ? '‘다음 곡 →’ 이나 → 키를 누르면 1번 곡이 걸려요' : '';
    memo.textContent = s?.memo ?? '';
    const n = list[current + 1];
    nextLine.textContent = n ? `다음: ${current + 2}. ${n.title} · ${songMeta(n)}` : s ? '마지막 곡이에요' : '';
    prevBtn.disabled = current <= 0;
    nextBtn.disabled = !list.length || current >= list.length - 1;
    songsEl.replaceChildren(...list.map(songRow));
    empty.hidden = list.length > 0;
    addBtn.disabled = list.length >= MAX_SONGS;
  }

  // ---- 단축키·MIDI ----
  window.addEventListener('keydown', (e) => {
    if (root.hidden || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    const next = ['ArrowRight', 'PageDown', ']'].includes(e.key);
    const prev = ['ArrowLeft', 'PageUp', '['].includes(e.key);
    if (next || prev) {
      e.preventDefault();
      step(next ? 1 : -1);
    } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= list.length) {
      e.preventDefault();
      go(Number(e.key) - 1);
    }
  });
  app.on('program', (n) => {
    if (n < list.length) go(n);
  });

  // ---- 화면 꺼짐 방지: 이 화면에 있는 동안만 ----
  let lock = null;
  async function wake(on) {
    if (!('wakeLock' in navigator)) {
      wakeState.textContent = '이 브라우저는 화면 꺼짐 방지를 지원하지 않아요. 기기 설정에서 자동 잠금을 꺼 두세요.';
      return;
    }
    try {
      if (on && !lock) {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { lock = null; });
      } else if (!on && lock) {
        await lock.release();
        lock = null;
      }
      wakeState.textContent = lock ? '이 화면에 있는 동안 화면이 꺼지지 않아요.' : '';
      wakeState.dataset.state = lock ? 'on' : 'off';
    } catch {
      wakeState.textContent = '화면 꺼짐 방지를 켜지 못했어요 (이 화면이 앞에 있어야 해요).';
    }
  }
  app.on('show', (id) => wake(id === 'live'));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !root.hidden) wake(true);
  });

  render();
  return { state: () => ({ list, current }), go, step };
}
