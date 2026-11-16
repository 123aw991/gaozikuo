/**
 * AI 生图（OpenMOSS-Team/MOSS-Image） + 语音识别（SenseVoiceSmall ASR） 页面逻辑
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const el = {
    tabs: document.querySelectorAll('.rec-tab'),
    imageCtrl: $('#imageCtrl'), speechCtrl: $('#speechCtrl'),
    imagePanel: $('#imagePanel'), speechPanel: $('#speechPanel'),
    recTitle: $('#recTitle'), recMeta: $('#recMeta'),
    prompt: $('#promptInput'), imgSize: $('#imgSize'), steps: $('#stepsInput'), guidance: $('#guidanceInput'),
    genBtn: $('#genBtn'), quick: $('#quickPrompts'),
    imageEmpty: $('#imageEmpty'), genResult: $('#genResult'), genImg: $('#genImg'),
    genParams: $('#genParams'), downloadImg: $('#downloadImg'), imgBadge: $('#imgBadge'),
    audioDrop: $('#audioDrop'), audioInput: $('#audioInput'), audioInfo: $('#audioInfo'),
    recStart: $('#recStart'), recStop: $('#recStop'), recStatus: $('#recStatus'),
    transBtn: $('#transBtn'), asrBadge: $('#asrBadge'),
    speechEmpty: $('#speechEmpty'), speechResult: $('#speechResult'),
    transcript: $('#transcript'), analyzeBtn: $('#analyzeBtn'), speechCards: $('#speechCards'),
    toast: $('#toast')
  };

  let audioFile = null;
  let browserTranscript = '';
  let recognition = null;

  function toast(msg, err) {
    el.toast.textContent = msg;
    el.toast.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.toast.className = 'toast'), 2600);
  }
  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ---------- Tab ---------- */
  el.tabs.forEach((tab) => tab.addEventListener('click', () => {
    el.tabs.forEach((t) => t.classList.toggle('active', t === tab));
    const isImage = tab.dataset.tab === 'image';
    el.imageCtrl.hidden = !isImage; el.speechCtrl.hidden = isImage;
    el.imagePanel.hidden = !isImage; el.speechPanel.hidden = isImage;
    el.recTitle.textContent = isImage
      ? 'AI 生图 · OpenMOSS-Team/MOSS-Image'
      : '语音识别 · FunAudioLLM/SenseVoiceSmall';
    el.recMeta.textContent = '等待输入…';
  }));

  /* ---------- 生图 ---------- */
  el.quick.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') { el.prompt.value = e.target.textContent; el.prompt.focus(); }
  });

  el.genBtn.addEventListener('click', async () => {
    const prompt = el.prompt.value.trim();
    if (!prompt) { toast('请输入提示词', true); return; }
    el.genBtn.disabled = true;
    el.genBtn.textContent = '生成中…';
    el.recMeta.textContent = '正在请求 OpenMOSS 生图…';
    try {
      const res = await API.json('POST', '/api/recognition/image/generate', {
        prompt,
        imageSize: el.imgSize.value,
        steps: Number(el.steps.value) || 20,
        guidance: Number(el.guidance.value) || 7.5
      });
      if (res.code !== 0) throw new Error(res.msg || '生成失败');
      const d = res.data;
      el.imageEmpty.hidden = true;
      el.genResult.hidden = false;
      el.genImg.src = d.imageUrl;
      el.genParams.textContent = JSON.stringify({
        model: d.model, mode: d.mode, prompt: d.prompt, imageSize: d.imageSize,
        steps: d.steps, guidance: d.guidance, count: d.count, usage: d.usage
      }, null, 2);
      el.downloadImg.href = d.imageUrl;
      el.downloadImg.download = 'openmoss-' + Date.now() + '.png';
      el.imgBadge.textContent = d.mode;
      el.recMeta.textContent = d.mode + (d.usage ? ' · ' + d.usage.total_tokens + ' tokens' : '');
      toast('生成完成（' + d.mode + '）');
    } catch (e) {
      el.recMeta.textContent = '生成失败';
      toast('生成失败：' + (e.msg || e.message), true);
    } finally {
      el.genBtn.disabled = false;
      el.genBtn.textContent = '✨ 生成图片';
    }
  });

  /* ---------- 音频选择 ---------- */
  function pickAudio(file) {
    if (!/^audio\//i.test(file.type) && !/\.(mp3|wav|m4a|webm|ogg|flac)$/i.test(file.name)) {
      toast('请选择音频文件', true); return;
    }
    audioFile = file;
    el.transBtn.disabled = false;
    el.audioInfo.textContent = '已选择：' + file.name + '\n大小：' + (file.size / 1024).toFixed(1) + ' KB';
    el.audioInfo.style.whiteSpace = 'pre-line';
  }
  el.audioDrop.addEventListener('click', () => el.audioInput.click());
  el.audioInput.addEventListener('change', (e) => { if (e.target.files[0]) pickAudio(e.target.files[0]); });
  ['dragenter', 'dragover'].forEach((t) => el.audioDrop.addEventListener(t, (e) => { e.preventDefault(); el.audioDrop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((t) => el.audioDrop.addEventListener(t, (e) => { e.preventDefault(); el.audioDrop.classList.remove('drag'); }));
  el.audioDrop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) pickAudio(e.dataTransfer.files[0]); });

  /* ---------- 浏览器录音（Web Speech API，转写备选） ---------- */
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRec) {
    recognition = new SpeechRec();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => {
      el.recStatus.textContent = '● 正在聆听…';
      el.recStart.disabled = true; el.recStop.disabled = false;
    };
    recognition.onresult = (e) => {
      let final = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      if (final) browserTranscript += final;
      el.transcript.value = browserTranscript + (interim ? '\n' + interim : '');
      el.speechEmpty.hidden = true; el.speechResult.hidden = false;
    };
    recognition.onerror = (e) => { el.recStatus.textContent = '识别错误：' + e.error; };
    recognition.onend = () => {
      el.recStatus.textContent = '已停止 · 浏览器转写 ' + browserTranscript.length + ' 字';
      el.recStart.disabled = false; el.recStop.disabled = true;
      if (el.transcript.value.trim()) el.transBtn.disabled = false;
    };
  } else {
    el.recStart.disabled = true;
    el.recStatus.textContent = '当前浏览器不支持 Web Speech API，可直接上传音频文件识别。';
  }
  el.recStart.addEventListener('click', () => {
    browserTranscript = '';
    try { recognition.start(); } catch (e) { toast('启动失败：' + e.message, true); }
  });
  el.recStop.addEventListener('click', () => { if (recognition) recognition.stop(); });

  /* ---------- 语音识别请求 ---------- */
  el.transBtn.addEventListener('click', async () => {
    if (!audioFile && !el.transcript.value.trim()) { toast('请上传音频或先录音', true); return; }
    el.transBtn.disabled = true;
    el.transBtn.textContent = '识别中…';
    el.recMeta.textContent = '正在请求 SenseVoiceSmall 识别…';
    el.speechEmpty.hidden = true; el.speechResult.hidden = false;
    try {
      let res;
      if (audioFile) {
        res = await API.upload('/api/recognition/speech/transcribe', audioFile, null, {
          fallbackText: el.transcript.value.trim()
        });
      } else {
        res = await API.json('POST', '/api/recognition/speech/transcribe', {
          fallbackText: el.transcript.value.trim()
        });
      }
      if (res.code !== 0) throw new Error(res.msg || '识别失败');
      const d = res.data;
      el.transcript.value = d.text;
      browserTranscript = d.text;
      el.asrBadge.textContent = d.mode;
      el.recMeta.textContent = d.mode + (d.usage ? ' · ' + d.usage.total_tokens + ' tokens' : '');
      toast('识别完成（' + d.mode + '）');
    } catch (e) {
      el.recMeta.textContent = '识别失败';
      toast('识别失败：' + (e.msg || e.message), true);
    } finally {
      el.transBtn.disabled = false;
      el.transBtn.textContent = '🎤 识别语音';
    }
  });

  /* ---------- 文本整理 ---------- */
  el.analyzeBtn.addEventListener('click', async () => {
    const text = el.transcript.value.trim();
    if (!text) { toast('转写文本为空', true); return; }
    el.analyzeBtn.disabled = true;
    el.analyzeBtn.textContent = '整理中…';
    try {
      const res = await API.json('POST', '/api/recognition/speech/analyze', { text });
      if (res.code !== 0) throw new Error(res.msg || '整理失败');
      const d = res.data;
      el.speechCards.innerHTML =
        '<div class="speech-card"><h4>摘要</h4><p>' + escapeHtml(d.summary || '无') + '</p></div>' +
        '<div class="speech-card"><h4>意图</h4><p class="intent">' + escapeHtml(d.intent || '其他') + '</p></div>' +
        '<div class="speech-card wide"><h4>关键词</h4><div class="chips">' +
        ((d.keywords || []).map((k) => '<span class="chip">' + escapeHtml(k) + '</span>').join('') || '<span class="muted">无</span>') +
        '</div></div>';
      toast('整理完成（' + d.mode + '）');
    } catch (e) {
      toast('整理失败：' + (e.msg || e.message), true);
    } finally {
      el.analyzeBtn.disabled = false;
      el.analyzeBtn.textContent = '🧠 整理摘要/关键词/意图';
    }
  });

  /* 初始化状态查询 */
  API.json('GET', '/api/recognition/status').then((res) => {
    if (res.code === 0 && res.data) {
      el.imgBadge.textContent = res.data.imageModel;
      el.asrBadge.textContent = res.data.speechModel;
      if (!res.data.apiKeySet) el.recMeta.textContent = '演示模式（未配置 SF_API_KEY）';
    }
  });
})();
