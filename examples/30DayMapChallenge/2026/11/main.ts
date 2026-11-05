import { audioParameters } from './soundscape.ts';
import { channelAt, mount, projectLocation, type SoundMap } from './renderer.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const status = document.getElementById('status')!;
const locationLabel = document.getElementById('location')!;
const meter = document.getElementById('model-values')!;
const audioButton = document.getElementById('audio-toggle') as HTMLButtonElement;
let map: SoundMap;
let audio: AudioContext | null = null;
let trafficGain: GainNode | null = null;
let railGain: GainNode | null = null;
let trafficFilter: BiquadFilterNode | null = null;
let railOscillator: OscillatorNode | null = null;
let audioEnabled = false;
let selectedName = '新宿駅';

function describe(point: { x: number; y: number }, name = '選択地点') {
  if (!map) return;
  selectedName = name;
  const raw = channelAt(map.grid, point.x, point.y);
  const road = Math.log1p(raw.road) / Math.log1p(map.stats.maxRoad);
  const rail = Math.log1p(raw.rail) / Math.log1p(map.stats.maxRail);
  locationLabel.textContent = `${name} · 道路 ${Math.round(road * 100)}% · 鉄道 ${Math.round(rail * 100)}%`;
  meter.style.setProperty('--road', `${Math.round(road * 100)}%`);
  meter.style.setProperty('--rail', `${Math.round(rail * 100)}%`);
  meter.setAttribute('aria-label', `道路モデル ${Math.round(road * 100)}%、鉄道モデル ${Math.round(rail * 100)}%`);
  if (audioEnabled && audio && trafficGain && railGain && trafficFilter && railOscillator) {
    const now = audio.currentTime;
    const params = audioParameters(road, rail);
    trafficGain.gain.setTargetAtTime(params.trafficGain, now, 0.08);
    railGain.gain.setTargetAtTime(params.railGain, now, 0.08);
    trafficFilter.frequency.setTargetAtTime(params.trafficCutoffHz, now, 0.08);
    railOscillator.frequency.setTargetAtTime(params.railFrequencyHz, now, 0.08);
  }
}

async function startAudio() {
  if (audioEnabled && audio) {
    await audio.suspend(); audioEnabled = false; audioButton.textContent = '音を再生'; audioButton.setAttribute('aria-pressed', 'false'); return;
  }
  audio ??= new AudioContext();
  if (!trafficGain || !railGain || !trafficFilter || !railOscillator) {
    const noise = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
    const samples = noise.getChannelData(0);
    let seed = 0x30da11;
    for (let i = 0; i < samples.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; samples[i] = ((seed / 0xffffffff) * 2 - 1) * 0.35; }
    const source = audio.createBufferSource(); source.buffer = noise; source.loop = true;
    trafficFilter = audio.createBiquadFilter(); trafficFilter.type = 'lowpass'; trafficFilter.frequency.value = 900;
    trafficGain = audio.createGain(); trafficGain.gain.value = 0.001;
    source.connect(trafficFilter).connect(trafficGain).connect(audio.destination); source.start();
    railOscillator = audio.createOscillator(); railOscillator.type = 'sine'; railOscillator.frequency.value = 52;
    railGain = audio.createGain(); railGain.gain.value = 0.001;
    railOscillator.connect(railGain).connect(audio.destination); railOscillator.start();
  }
  audioEnabled = true; await audio.resume(); audioButton.textContent = '音を停止'; audioButton.setAttribute('aria-pressed', 'true');
  if (map.selected) describe(map.selected, selectedName);
}

audioButton.addEventListener('click', () => void startAudio().catch((error) => { status.textContent = `音声を開始できません: ${String(error)}`; }));

try {
  map = await mount(canvas, '../../../../data/baked/30DayMapChallenge-2026-11');
  const stats = map.stats;
  document.getElementById('counts')!.textContent = `${stats.roadWays.toLocaleString()} 道路 · ${stats.railWays.toLocaleString()} 鉄道路線 · 320 × 320 セル`;
  document.getElementById('source-counts')!.textContent = `OSM ${stats.sourceDate} · 道路 ${stats.roadCells.toLocaleString()} セル / 鉄道 ${stats.railCells.toLocaleString()} セル`;
  const center = projectLocation(139.7005, 35.6896, stats.bounds);
  map.select(center); describe(center, '新宿駅');
  canvas.addEventListener('soundscape-select', (event) => describe((event as CustomEvent<{ x: number; y: number }>).detail));
  const places = [
    { name: '東京駅', lon: 139.7675, lat: 35.6812 },
    { name: '新宿駅', lon: 139.7005, lat: 35.6896 },
    { name: '渋谷駅', lon: 139.7013, lat: 35.6580 },
    { name: '上野駅', lon: 139.7774, lat: 35.7138 },
  ];
  for (const place of places) {
    const button = document.createElement('button'); button.textContent = place.name;
    button.addEventListener('click', () => {
      const point = projectLocation(place.lon, place.lat, stats.bounds);
      map.select(point); describe(point, place.name);
    });
    document.getElementById('places')!.append(button);
  }
  status.textContent = '地図をクリックして地点を選び、「音を再生」を押すとモデル音が鳴ります';
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts'); await run(map);
  }
} catch (error) {
  console.error(error); status.textContent = `データ読み込みエラー: ${String(error)}`;
}
