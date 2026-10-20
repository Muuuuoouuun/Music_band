// 이 브라우저에만 남는 값(내 음색, 튜닝, 마지막 화면)과 파일 저장.
// 저장이 막힌 환경(사생활 보호 창 등)에서도 앱은 그대로 동작한다.

const KEYS = { presets: 'soundsmith.presets.v1', tuning: 'soundsmith.tuning.v1', patch: 'soundsmith.patch.v1' };

export function load(name, fallback) {
  try {
    const raw = localStorage.getItem(KEYS[name]);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function save(name, value) {
  try {
    localStorage.setItem(KEYS[name], JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * 파일 내려받기. claude.ai 화면 안에서는 downloads 기능으로(사용자 확인 창), 그 밖에서는 일반 다운로드.
 * 돌려주는 값: 'saved' | 'declined' | 'unavailable'
 */
export async function saveFile(filename, data, mime = 'application/octet-stream') {
  const viewer = typeof window !== 'undefined' && window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (viewer) {
    try {
      await viewer.save({ filename, data: data instanceof Uint8Array ? data.slice(0) : data });
      return 'saved';
    } catch (e) {
      return e?.code === 'declined' ? 'declined' : 'unavailable';
    }
  }
  if (window.claude?.use) return 'unavailable';
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'saved';
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
