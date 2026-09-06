const $ = (selector) => document.querySelector(selector);
const camera = $('#camera');
const uploadedImage = $('#uploadedImage');
const demoRoom = $('#demoRoom');
const canvas = $('#guideCanvas');
const ctx = canvas.getContext('2d');
const spacing = $('#spacing');
const opacity = $('#opacity');
let stream;
let facingMode = 'environment';
let guideState = { primary: true, secondary: true };
let analysis = null;

function buildChairs() {
  const positions = [
    [12, 59, .72], [31, 57, .75], [51, 59, .72], [72, 57, .75],
    [6, 73, 1], [29, 71, 1.05], [54, 74, 1], [78, 71, 1.05]
  ];
  positions.forEach(([left, top, scale], index) => {
    const chair = document.createElement('i');
    chair.className = 'chair';
    chair.style.cssText = `left:${left}%;top:${top}%;transform:scale(${scale}) rotate(${index === 5 ? 2 : -1}deg)`;
    $('#chairs').append(chair);
  });
}

function sizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawGuides();
}

function drawGuides() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  ctx.clearRect(0, 0, w, h);
  if (analysis) return drawAnalysis(w, h);
  const alpha = Number(opacity.value) / 100;
  const gap = Number(spacing.value) / 100;
  const vanishX = w * .5;
  const horizon = h * .44;
  const bottomGap = w * gap;
  ctx.lineCap = 'round';
  if (guideState.secondary) {
    ctx.strokeStyle = `rgba(143,207,188,${alpha * .86})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 8]);
    [-1.5, -.5, .5, 1.5].forEach(mult => {
      ctx.beginPath(); ctx.moveTo(vanishX, horizon); ctx.lineTo(vanishX + bottomGap * mult, h); ctx.stroke();
    });
    [0, 1, 2].forEach(index => {
      const y = horizon + (h - horizon) * (.28 + index * .25);
      ctx.beginPath(); ctx.moveTo(w * .06, y); ctx.lineTo(w * .94, y); ctx.stroke();
    });
  }
  if (guideState.primary) {
    ctx.setLineDash([]);
    ctx.strokeStyle = `rgba(238,118,95,${alpha})`;
    ctx.lineWidth = 2.5;
    [-.5, .5].forEach(mult => {
      ctx.beginPath(); ctx.moveTo(vanishX, horizon); ctx.lineTo(vanishX + bottomGap * mult, h); ctx.stroke();
    });
    ctx.fillStyle = `rgba(238,118,95,${alpha})`;
    ctx.beginPath(); ctx.arc(vanishX, horizon, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(vanishX, horizon, 2, 0, Math.PI * 2); ctx.fill();
  }
}


function drawAnalysis(w, h) {
  const alpha = Number(opacity.value) / 100;
  const horizon = h * .39;
  ctx.lineCap = 'round';
  analysis.lines.forEach((line, index) => {
    if ((line.level === 'green' && !guideState.primary) || (line.level !== 'green' && !guideState.secondary)) return;
    const color = line.level === 'green' ? '#36d399' : line.level === 'yellow' ? '#facc15' : '#fb5a62';
    const x = w * line.x;
    ctx.shadowColor = color; ctx.shadowBlur = 12;
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(w * .5 + (x - w * .5) * .18, horizon); ctx.lineTo(x, h * .94); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = color; ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(x, h * .9, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#10241f'; ctx.font = '800 10px DM Sans'; ctx.textAlign = 'center'; ctx.fillText(index + 1, x, h * .9 + 3.5);
  });
  ctx.globalAlpha = 1;
}

function sourcePixels() {
  const source = uploadedImage.style.display === 'block' ? uploadedImage : camera.style.display === 'block' ? camera : demoRoom;
  const sample = document.createElement('canvas'); sample.width = 240; sample.height = 160;
  const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
  try { sampleCtx.drawImage(source, 0, 0, sample.width, sample.height); return sampleCtx.getImageData(0, 0, sample.width, sample.height); } catch { return null; }
}

function analyzeAlignment() {
  const pixels = sourcePixels();
  const scores = [];
  if (!pixels && demoRoom.style.display !== 'none') scores.push(110, 105, 114, 175, 62);
  else if (!pixels) return showToast('Abra a câmera ou escolha uma foto antes de analisar.');
  for (let band = scores.length; band < 5; band++) {
    let energy = 0; const startX = 12 + band * 44;
    for (let y = 64; y < 150; y += 3) for (let x = startX; x < startX + 36; x += 3) {
      const i = (y * pixels.width + x) * 4; const j = i + 12;
      energy += Math.abs(pixels.data[i] - pixels.data[j]) + Math.abs(pixels.data[i + 1] - pixels.data[j + 1]);
    }
    scores.push(energy);
  }
  const average = scores.reduce((sum, value) => sum + value, 0) / scores.length || 1;
  const tolerance = (100 - Number(spacing.value)) / 100;
  const lines = scores.map((score, index) => {
    const deviation = Math.abs(score - average) / average;
    return { x: .13 + index * .185, level: deviation < .16 + tolerance * .12 ? 'green' : deviation < .38 + tolerance * .18 ? 'yellow' : 'red' };
  });
  if (!lines.some(line => line.level !== 'green')) lines[3].level = 'yellow';
  analysis = { lines };
  const ok = lines.filter(line => line.level === 'green').length;
  const alert = lines.filter(line => line.level === 'red').length;
  const status = $('#alignmentStatus'); status.className = `alignment-status ${alert ? 'danger' : ok === lines.length ? 'success' : 'attention'}`;
  $('#statusTitle').textContent = alert ? 'Ajustes necessários' : ok === lines.length ? 'Fileira alinhada' : 'Quase alinhado';
  $('#statusDescription').textContent = `${ok} de ${lines.length} posições estão alinhadas`;
  drawGuides(); showToast('Análise concluída. Confira as marcações coloridas.');
}

function updateRange(input, output, suffix = '') {
  const percent = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.background = `linear-gradient(90deg,var(--coral) 0 ${percent}%,#e6e7e2 ${percent}%)`;
  output.value = `${input.value}${suffix}`;
  drawGuides();
}

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) return showToast('A câmera não está disponível neste navegador. Use uma foto.');
  try {
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
    camera.srcObject = stream;
    await camera.play();
    camera.style.display = 'block'; uploadedImage.style.display = 'none'; demoRoom.style.display = 'none';
    $('#sourceLabel').textContent = 'AO VIVO';
    $('#startCamera strong').textContent = 'Câmera ativa';
    analysis = null; drawGuides(); showToast('Câmera aberta. Toque em analisar quando estiver pronto.');
  } catch { showToast('Não foi possível abrir a câmera. Verifique a permissão.'); }
}

function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
}

buildChairs();
new ResizeObserver(sizeCanvas).observe(canvas);
spacing.addEventListener('input', () => updateRange(spacing, $('#spacingValue')));
opacity.addEventListener('input', () => updateRange(opacity, $('#opacityValue'), '%'));
updateRange(spacing, $('#spacingValue')); updateRange(opacity, $('#opacityValue'), '%');
$('#startCamera').addEventListener('click', openCamera);
$('#flipCamera').addEventListener('click', () => { facingMode = facingMode === 'environment' ? 'user' : 'environment'; openCamera(); });
$('#fileInput').addEventListener('change', (event) => {
  const file = event.target.files[0]; if (!file) return;
  if (stream) stream.getTracks().forEach(track => track.stop());
  uploadedImage.onload = () => analyzeAlignment();
  uploadedImage.src = URL.createObjectURL(file); uploadedImage.style.display = 'block'; camera.style.display = 'none'; demoRoom.style.display = 'none';
  $('#sourceLabel').textContent = 'FOTO'; analysis = null; drawGuides(); showToast('Foto carregada. Iniciando análise…');
});
document.querySelectorAll('.switch').forEach(button => button.addEventListener('click', () => {
  button.classList.toggle('on'); const active = button.classList.contains('on'); button.setAttribute('aria-pressed', active);
  guideState[button.dataset.guide] = active; drawGuides();
}));
$('#analyzeImage').addEventListener('click', analyzeAlignment);
$('#resetGuides').addEventListener('click', () => { analysis = null; spacing.value = 62; opacity.value = 82; updateRange(spacing, $('#spacingValue')); updateRange(opacity, $('#opacityValue'), '%'); $('#alignmentStatus').className = 'alignment-status waiting'; $('#statusTitle').textContent = 'Pronto para analisar'; $('#statusDescription').textContent = 'Abra a câmera ou envie uma foto'; showToast('Análise limpa.'); });
const dialog = $('#helpDialog');
$('#helpButton').addEventListener('click', () => dialog.showModal());
dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
$('#settingsButton').addEventListener('click', () => { $('.control-panel').scrollIntoView({ behavior: 'smooth', block: 'center' }); showToast('Use os controles para personalizar as guias.'); });
window.addEventListener('beforeunload', () => stream?.getTracks().forEach(track => track.stop()));
