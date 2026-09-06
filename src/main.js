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
let detector = null;
let detectionLoop = null;
let detecting = false;

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
  ctx.lineCap = 'round';
  analysis.chairs.forEach((chair, index) => {
    if ((chair.level === 'green' && !guideState.primary) || (chair.level !== 'green' && !guideState.secondary)) return;
    const color = chair.level === 'green' ? '#36d399' : chair.level === 'yellow' ? '#facc15' : '#fb5a62';
    const { x, y, width, height } = chair.displayBox;
    ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 3;
    ctx.strokeRect(x, y, width, height); ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.fillStyle = color;
    const label = chair.level === 'green' ? `Cadeira ${index + 1}` : chair.level === 'yellow' ? 'Verificar' : 'Desalinhada';
    ctx.font = '700 11px DM Sans'; const labelWidth = ctx.measureText(label).width + 14;
    ctx.fillRect(x, Math.max(0, y - 23), labelWidth, 23); ctx.fillStyle = '#10241f'; ctx.textAlign = 'left'; ctx.fillText(label, x + 7, Math.max(15, y - 7));
  });
  ctx.globalAlpha = 1;
}

function setModelState(state, title, detail) {
  const element = $('#modelState'); element.className = `model-state ${state}`;
  element.querySelector('b').textContent = title; element.querySelector('small').textContent = detail;
}

async function loadDetector() {
  if (detector) return detector;
  if (!window.cocoSsd) throw new Error('Biblioteca de visão computacional indisponível');
  setModelState('loading', 'Carregando detector…', 'Primeira execução pode levar alguns segundos');
  detector = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
  setModelState('ready', 'Detector pronto', 'Análise local e contínua ativada');
  return detector;
}

function mapBoxToCanvas(box, source) {
  const sourceWidth = source.videoWidth || source.naturalWidth;
  const sourceHeight = source.videoHeight || source.naturalHeight;
  const scale = Math.max(canvas.clientWidth / sourceWidth, canvas.clientHeight / sourceHeight);
  const offsetX = (canvas.clientWidth - sourceWidth * scale) / 2;
  const offsetY = (canvas.clientHeight - sourceHeight * scale) / 2;
  return { x: box[0] * scale + offsetX, y: box[1] * scale + offsetY, width: box[2] * scale, height: box[3] * scale };
}

function classifyAlignment(predictions, source) {
  const chairs = predictions.filter(item => item.class === 'chair' && item.score >= .45).map(item => {
    const [x, y, width, height] = item.bbox;
    return { ...item, centerX: x + width / 2, footY: y + height, displayBox: mapBoxToCanvas(item.bbox, source) };
  }).sort((a, b) => a.centerX - b.centerX);
  if (chairs.length < 2) return chairs.map(chair => ({ ...chair, level: 'yellow' }));
  const first = chairs[0]; const last = chairs.at(-1);
  const slope = (last.footY - first.footY) / Math.max(1, last.centerX - first.centerX);
  const expectedY = chair => first.footY + slope * (chair.centerX - first.centerX);
  const typicalHeight = chairs.map(chair => chair.bbox[3]).sort((a, b) => a - b)[Math.floor(chairs.length / 2)];
  const sensitivity = Number(spacing.value) / 100;
  const greenLimit = typicalHeight * (.18 - sensitivity * .1);
  return chairs.map(chair => {
    const deviation = Math.abs(chair.footY - expectedY(chair));
    return { ...chair, level: deviation <= greenLimit ? 'green' : deviation <= greenLimit * 2.1 ? 'yellow' : 'red' };
  });
}

async function analyzeAlignment({ quiet = false } = {}) {
  const source = uploadedImage.style.display === 'block' ? uploadedImage : camera.style.display === 'block' ? camera : null;
  if (!source) return showToast('Abra a câmera ou escolha uma foto antes de analisar.');
  if (detecting) return;
  detecting = true;
  try {
    const model = await loadDetector();
    const chairs = classifyAlignment(await model.detect(source, 20, .35), source);
    analysis = { chairs };
    const ok = chairs.filter(chair => chair.level === 'green').length;
    const alert = chairs.filter(chair => chair.level === 'red').length;
    const summary = $('#detectionSummary'); summary.hidden = false; summary.textContent = `${chairs.length} cadeira${chairs.length === 1 ? '' : 's'} detectada${chairs.length === 1 ? '' : 's'}`;
    const status = $('#alignmentStatus');
    status.className = `alignment-status ${alert ? 'danger' : chairs.length > 1 && ok === chairs.length ? 'success' : 'attention'}`;
    $('#statusTitle').textContent = !chairs.length ? 'Nenhuma cadeira encontrada' : alert ? 'Ajustes necessários' : chairs.length === 1 ? 'Enquadre mais cadeiras' : ok === chairs.length ? 'Fileira alinhada' : 'Quase alinhado';
    $('#statusDescription').textContent = !chairs.length ? 'Aproxime-se ou melhore a iluminação' : `${ok} de ${chairs.length} cadeiras estão alinhadas`;
    drawGuides(); if (!quiet) showToast('Análise concluída. Confira as caixas coloridas.');
  } catch (error) {
    setModelState('error', 'Detector indisponível', 'Verifique sua conexão e tente novamente');
    if (!quiet) showToast(error.message || 'Não foi possível carregar o detector.');
  } finally { detecting = false; }
}

function startLiveDetection() {
  clearInterval(detectionLoop);
  analyzeAlignment({ quiet: true });
  detectionLoop = setInterval(() => analyzeAlignment({ quiet: true }), 900);
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
    analysis = null; drawGuides(); startLiveDetection(); showToast('Câmera aberta. Detecção ao vivo iniciada.');
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
  clearInterval(detectionLoop); uploadedImage.onload = () => analyzeAlignment();
  uploadedImage.src = URL.createObjectURL(file); uploadedImage.style.display = 'block'; camera.style.display = 'none'; demoRoom.style.display = 'none';
  $('#sourceLabel').textContent = 'FOTO'; analysis = null; drawGuides(); showToast('Foto carregada. Iniciando análise…');
});
document.querySelectorAll('.switch').forEach(button => button.addEventListener('click', () => {
  button.classList.toggle('on'); const active = button.classList.contains('on'); button.setAttribute('aria-pressed', active);
  guideState[button.dataset.guide] = active; drawGuides();
}));
$('#analyzeImage').addEventListener('click', () => analyzeAlignment());
$('#resetGuides').addEventListener('click', () => { analysis = null; spacing.value = 62; opacity.value = 82; updateRange(spacing, $('#spacingValue')); updateRange(opacity, $('#opacityValue'), '%'); $('#detectionSummary').hidden = true; $('#alignmentStatus').className = 'alignment-status waiting'; $('#statusTitle').textContent = 'Pronto para analisar'; $('#statusDescription').textContent = 'Abra a câmera ou envie uma foto'; showToast('Análise limpa.'); });
const dialog = $('#helpDialog');
$('#helpButton').addEventListener('click', () => dialog.showModal());
dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
$('#settingsButton').addEventListener('click', () => { $('.control-panel').scrollIntoView({ behavior: 'smooth', block: 'center' }); showToast('Use os controles para personalizar as guias.'); });
window.addEventListener('beforeunload', () => { clearInterval(detectionLoop); stream?.getTracks().forEach(track => track.stop()); });
