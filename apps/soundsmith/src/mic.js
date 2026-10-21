// 마이크 녹음 단추: 누르면 녹음, 다시 누르면(또는 최대 길이에서) 멈추고 읽은 AudioBuffer 를 넘긴다.
// 실험실 샘플러와 샘플 패드가 같이 쓴다.
export function micButton(app, btn, { maxSec = 10, idleLabel = btn.textContent, recordingLabel, hint, onBuffer }) {
  let recorder = null;
  btn.addEventListener('click', async () => {
    if (recorder) {
      recorder.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      app.notice('이 브라우저(또는 이 화면)에서는 마이크를 쓸 수 없어요. 파일을 불러오거나 데모 소리를 쓰세요.', 'bad');
      return;
    }
    let stream;
    try {
      const ctx = await app.ensureAudio();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearTimeout(recorder.limit);
        recorder = null;
        btn.textContent = idleLabel;
        btn.classList.remove('recording');
        try {
          onBuffer(await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer()));
        } catch {
          app.notice('녹음한 소리를 읽지 못했어요. 다시 녹음해 보세요.', 'bad');
        }
      };
      recorder.start();
      recorder.limit = setTimeout(() => recorder?.stop(), maxSec * 1000);
      btn.textContent = recordingLabel ?? `■ 녹음 멈추기 (최대 ${maxSec}초)`;
      btn.classList.add('recording');
      if (hint) app.notice(hint);
    } catch {
      stream?.getTracks().forEach((t) => t.stop());
      recorder = null;
      app.notice('마이크를 열지 못했어요. 브라우저의 마이크 권한을 확인하거나, 파일을 불러오세요.', 'bad');
    }
  });
}
