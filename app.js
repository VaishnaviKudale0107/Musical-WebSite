// Simple audio player wiring

const audio = document.getElementById('audio');
const playPauseBtn = document.getElementById('playPauseBtn');
const nextBtn = document.getElementById('nextBtn');
const prevBtn = document.getElementById('prevBtn');
const seek = document.getElementById('seek');
const volume = document.getElementById('volume');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const playerTitle = document.getElementById('playerTitle');
const playerArtist = document.getElementById('playerArtist');
const playerCover = document.getElementById('playerCover');

// Track list from DOM elements
const selectableSelectors = ['#recentList .track', '#savedList .track', '#popular .card'];
let trackNodes = [];

function gatherTrackNodes(){
  trackNodes = [];
  selectableSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(node => trackNodes.push(node));
  });
}

gatherTrackNodes();

// default audio settings
audio.crossOrigin = 'anonymous';
audio.volume = 0.8;
volume.value = '0.8';

// simple toast helper
const toastEl = document.getElementById('toast');
function showToast(message){
  if(!toastEl) return;
  toastEl.textContent = message;
  toastEl.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> toastEl.style.display = 'none', 3000);
}

let currentIndex = 0; // index within trackNodes order
let currentNode = null;

function formatTime(seconds){
  if (!isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + ':' + (s < 10 ? '0' + s : s);
}

function loadFromNode(node){
  if(!node) return;
  const src = node.getAttribute('data-src');
  const title = node.getAttribute('data-title');
  const artist = node.getAttribute('data-artist');
  const cover = node.getAttribute('data-cover');

  audio.src = src || '';
  try { audio.load(); } catch(e) {}
  playerTitle.textContent = title || '';
  playerArtist.textContent = artist || '';
  if (cover) playerCover.src = cover;
  // reset UI to play until audio actually starts
  playPauseBtn.textContent = '▶';
  currentNode = node;

  // visual state
  trackNodes.forEach(n => n.classList.remove('is-playing'));
  node.classList.add('is-playing');
}

function findIndexForNode(node){
  return trackNodes.findIndex(n => n === node);
}

function playNode(node){
  loadFromNode(node);
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.then === 'function'){
    playPromise.then(()=>{
      // UI will also be synced by 'play' event
      playPauseBtn.textContent = '⏸';
      updateListButtons();
    }).catch((err)=>{
      playPauseBtn.textContent = '▶';
      showToast('Playback blocked. Press ▶ to play.');
      console.warn('playback error', err);
    });
  } else {
    // older browsers
    playPauseBtn.textContent = '⏸';
    updateListButtons();
  }
}

function playByIndex(index){
  if (index < 0) index = trackNodes.length - 1;
  if (index >= trackNodes.length) index = 0;
  currentIndex = index;
  playNode(trackNodes[currentIndex]);
}

// Wire play/save/download buttons (event delegation)
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-action="play"]');
  const saveBtn = e.target.closest('[data-action="save"]');
  const downloadBtn = e.target.closest('[data-action="download"]');
  const container = e.target.closest('.track, .card');
  
  if (btn) {
    if(!container) return;
    gatherTrackNodes();
    const idx = findIndexForNode(container);
    if (currentNode === container && !audio.paused) {
      audio.pause();
    } else {
      currentIndex = idx >= 0 ? idx : 0;
      playNode(container);
      addToRecent(container);
    }
  } else if (saveBtn) {
    if(!container) return;
    toggleSaved(container);
  } else if (downloadBtn) {
    if(!container) return;
    handleDownload(container);
  }
});

playPauseBtn.addEventListener('click', ()=>{
  if (audio.paused) {
    audio.play().then(()=>{
      playPauseBtn.textContent = '⏸';
    }).catch((err)=>{
      showToast('Could not start playback');
      console.warn(err);
    });
  } else {
    audio.pause();
    playPauseBtn.textContent = '▶';
  }
});

nextBtn.addEventListener('click', ()=> playByIndex(currentIndex + 1));
prevBtn.addEventListener('click', ()=> playByIndex(currentIndex - 1));

audio.addEventListener('loadedmetadata', ()=>{
  durationEl.textContent = formatTime(audio.duration);
  seek.max = Math.floor(audio.duration || 0);
});

audio.addEventListener('timeupdate', ()=>{
  currentTimeEl.textContent = formatTime(audio.currentTime);
  if (!isNaN(audio.duration)) {
    seek.value = Math.floor(audio.currentTime);
  }
});

let retryTimeout;
audio.addEventListener('error', ()=>{
  clearTimeout(retryTimeout);
  showToast('Audio failed to load. Retrying…');
  // one quick retry after 1s
  retryTimeout = setTimeout(()=>{
    const t = audio.currentTime || 0;
    try { audio.load(); } catch(e) {}
    audio.currentTime = t;
    audio.play().catch(()=>{});
  }, 1000);
});

// Keep button state in sync with the actual media state
audio.addEventListener('play', ()=>{
  playPauseBtn.textContent = '⏸';
  updateListButtons();
});
audio.addEventListener('pause', ()=>{
  playPauseBtn.textContent = '▶';
  updateListButtons();
});
audio.addEventListener('stalled', ()=>{
  showToast('Buffering…');
});

seek.addEventListener('input', ()=>{
  audio.currentTime = Number(seek.value || 0);
});

volume.addEventListener('input', ()=>{
  audio.volume = Number(volume.value);
});

audio.addEventListener('ended', ()=>{
  playByIndex(currentIndex + 1);
});

// Initialize with first playlist item if available (no autoplay)
const first = document.querySelector('#playlist .track');
if (first){
  loadFromNode(first);
}

function getPlayButton(node){
  return node ? node.querySelector('.track__play, .card__play') : null;
}

function updateListButtons(){
  // reset all to play
  trackNodes.forEach(n => {
    const b = getPlayButton(n);
    if (b) b.textContent = '▶';
  });
  // set current to pause if audio is playing
  if (currentNode && !audio.paused) {
    const b = getPlayButton(currentNode);
    if (b) b.textContent = '⏸';
  }
}

// Recent & Saved logic
const recentListEl = document.getElementById('recentList');
const savedListEl = document.getElementById('savedList');
const libTabs = document.getElementById('libTabs');

const RECENT_KEY = 'mw_recent_v1';
const SAVED_KEY = 'mw_saved_v1';

function readStore(key){
  try{ return JSON.parse(localStorage.getItem(key) || '[]'); }catch{return []}
}
function writeStore(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

function nodeToTrack(node){
  return {
    src: node.getAttribute('data-src'),
    title: node.getAttribute('data-title'),
    artist: node.getAttribute('data-artist'),
    cover: node.getAttribute('data-cover')
  };
}

function renderTrackItem(track, index){
  const li = document.createElement('li');
  li.className = 'track';
  li.setAttribute('data-src', track.src);
  li.setAttribute('data-title', track.title);
  li.setAttribute('data-artist', track.artist);
  li.setAttribute('data-cover', track.cover);
  li.innerHTML = `
    <span class="track__index">${String(index+1).padStart(2,'0')}</span>
    <img class="track__cover" src="${track.cover}" alt="${track.title} cover">
    <div class="track__meta">
      <div class="track__title">${track.title}</div>
      <div class="track__artist">${track.artist}</div>
    </div>
    <button class="track__play" data-action="play">▶</button>
    <button class="track__save" data-action="save" title="Save">＋</button>
    <button class="track__download" data-action="download" title="Download">⬇</button>
  `;
  return li;
}

function syncSavedIcons(){
  const saved = readStore(SAVED_KEY);
  const savedSet = new Set(saved.map(t=>t.src));
  document.querySelectorAll('.track, .card').forEach(el=>{
    const src = el.getAttribute('data-src');
    const saveBtn = el.querySelector('[data-action="save"]');
    if (saveBtn) saveBtn.textContent = savedSet.has(src) ? '✓' : '＋';
  });
}

function addToRecent(node){
  const recent = readStore(RECENT_KEY);
  const track = nodeToTrack(node);
  const filtered = recent.filter(t=>t.src !== track.src);
  filtered.unshift(track);
  const capped = filtered.slice(0, 20);
  writeStore(RECENT_KEY, capped);
  renderRecent();
}

function toggleSaved(node){
  const saved = readStore(SAVED_KEY);
  const track = nodeToTrack(node);
  const idx = saved.findIndex(t=>t.src === track.src);
  if (idx >= 0) saved.splice(idx,1); else saved.unshift(track);
  writeStore(SAVED_KEY, saved);
  renderSaved();
  syncSavedIcons();
}

// Download functionality with legal music sources
function handleDownload(node){
  const title = node.getAttribute('data-title');
  const artist = node.getAttribute('data-artist');
  
  // Legal music sources for downloads
  const legalSources = {
    'Free Music Archive': 'https://freemusicarchive.org/',
    'Freesound': 'https://freesound.org/',
    'YouTube Audio Library': 'https://www.youtube.com/audiolibrary/music',
    'Zapsplat': 'https://www.zapsplat.com/',
    'Pixabay Music': 'https://pixabay.com/music/',
    'Open Music Archive': 'https://openmusicarchive.org/',
    'Jamendo': 'https://www.jamendo.com/',
    'Bandcamp': 'https://bandcamp.com/',
    'SoundCloud': 'https://soundcloud.com/',
    'Spotify': 'https://open.spotify.com/'
  };
  
  // Create download options modal
  showDownloadOptions(title, artist, legalSources);
}

function showDownloadOptions(title, artist, sources){
  // Create modal for download options
  const modal = document.createElement('div');
  modal.className = 'download-modal';
  modal.innerHTML = `
    <div class="download-modal-content">
      <h3>Download "${title}" by ${artist}</h3>
      <p>Choose a legal music source:</p>
      <div class="download-sources">
        ${Object.entries(sources).map(([name, url]) => `
          <a href="${url}" target="_blank" class="download-source">
            <span class="source-name">${name}</span>
            <span class="source-arrow">→</span>
          </a>
        `).join('')}
      </div>
      <button class="close-modal">Close</button>
    </div>
  `;
  
  // Add modal styles
  const style = document.createElement('style');
  style.textContent = `
    .download-modal {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.8);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
    }
    .download-modal-content {
      background: #1a1a1a;
      padding: 30px;
      border-radius: 15px;
      max-width: 500px;
      width: 90%;
      border: 1px solid #333;
    }
    .download-modal h3 {
      color: #fff;
      margin: 0 0 15px 0;
      font-size: 20px;
    }
    .download-modal p {
      color: #ccc;
      margin: 0 0 20px 0;
    }
    .download-sources {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 20px;
    }
    .download-source {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 15px;
      background: #2a2a2a;
      border-radius: 8px;
      text-decoration: none;
      color: #fff;
      transition: background 0.2s ease;
    }
    .download-source:hover {
      background: #3a3a3a;
    }
    .source-name {
      font-weight: 500;
    }
    .source-arrow {
      color: #ff6b6b;
      font-size: 18px;
    }
    .close-modal {
      background: #ff6b6b;
      color: #fff;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 14px;
    }
    .close-modal:hover {
      background: #ff5252;
    }
  `;
  
  document.head.appendChild(style);
  document.body.appendChild(modal);
  
  // Close modal functionality
  modal.querySelector('.close-modal').addEventListener('click', () => {
    document.body.removeChild(modal);
    document.head.removeChild(style);
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
      document.head.removeChild(style);
    }
  });
}

function clearChildren(el){ while(el.firstChild) el.removeChild(el.firstChild); }

function renderRecent(){
  const items = readStore(RECENT_KEY);
  clearChildren(recentListEl);
  items.forEach((t,i)=> recentListEl.appendChild(renderTrackItem(t,i)));
  gatherTrackNodes();
  syncSavedIcons();
}

function renderSaved(){
  const items = readStore(SAVED_KEY);
  clearChildren(savedListEl);
  items.forEach((t,i)=> savedListEl.appendChild(renderTrackItem(t,i)));
  gatherTrackNodes();
  syncSavedIcons();
}

// Tabs
libTabs?.addEventListener('click', (e)=>{
  const a = e.target.closest('a[data-tab]');
  if(!a) return;
  e.preventDefault();
  libTabs.querySelectorAll('a').forEach(x=>x.classList.remove('is-active'));
  a.classList.add('is-active');
  const tab = a.getAttribute('data-tab');
  if (tab === 'recent'){
    recentListEl.classList.remove('hide');
    savedListEl.classList.add('hide');
  } else {
    // My Playlist should only show saved songs
    savedListEl.classList.remove('hide');
    recentListEl.classList.add('hide');
  }
});

// Initial render from current Popular cards into Recent for demo
if (readStore(RECENT_KEY).length === 0){
  const seed = Array.from(document.querySelectorAll('#popular .card')).slice(0,6).map(nodeToTrack);
  writeStore(RECENT_KEY, seed);
}
renderRecent();
renderSaved();

// Artist filtering with mood categories - Using free, legal music sources
const ARTIST_SONGS = {
  // Bollywood Artists
  'Arijit Singh': [
    {title:'Tum Hi Ho', artist:'Arijit Singh', cover:'assets/covers/tum-hi-ho.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-05.wav', mood:'romantic', downloadUrl:'https://freemusicarchive.org/'},
    {title:'Channa Mereya', artist:'Arijit Singh', cover:'assets/covers/channa-mereya.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-04.wav', mood:'sad', downloadUrl:'https://freemusicarchive.org/'},
    {title:'Kesariya', artist:'Arijit Singh', cover:'assets/covers/kesariya.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-03.wav', mood:'romantic', downloadUrl:'https://freemusicarchive.org/'},
    {title:'Ae Watan', artist:'Arijit Singh', cover:'assets/covers/ae-watan.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-02.wav', mood:'energetic', downloadUrl:'https://freemusicarchive.org/'},
    {title:'Tera Ban Jaunga', artist:'Arijit Singh', cover:'assets/covers/tera-ban-jaunga-arijit.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-01.wav', mood:'romantic', downloadUrl:'https://freemusicarchive.org/'},
    {title:'Gerua', artist:'Arijit Singh', cover:'assets/covers/gerua.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-06.wav', mood:'romantic', downloadUrl:'https://freemusicarchive.org/'}
  ],
  'Armaan Malik': [
    {title:'Main Hoon', artist:'Armaan Malik', cover:'assets/covers/main-hoon.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-07.wav', mood:'happy'},
    {title:'Bol Do Na Zara', artist:'Armaan Malik', cover:'assets/covers/bol-do-na-zara.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-08.wav', mood:'romantic'},
    {title:'Naina', artist:'Armaan Malik', cover:'assets/covers/naina.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-09.wav', mood:'sad'},
    {title:'Tere Sang Yaara', artist:'Armaan Malik', cover:'assets/covers/tere-sang-yaara.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-10.wav', mood:'romantic'},
    {title:'Sau Aasmaan', artist:'Armaan Malik', cover:'assets/covers/sau-aasmaan.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-11.wav', mood:'happy'}
  ],
  'Atif Aslam': [
    {title:'Tere Liye', artist:'Atif Aslam', cover:'assets/covers/tere-liye.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-12.wav', mood:'romantic'},
    {title:'Dil Diyan Gallan', artist:'Atif Aslam', cover:'assets/covers/dil-diyan-gallan.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-13.wav', mood:'happy'},
    {title:'Tere Sang Ishq', artist:'Atif Aslam', cover:'assets/covers/tere-sang-ishq.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-14.wav', mood:'romantic'},
    {title:'Jeena Jeena', artist:'Atif Aslam', cover:'assets/covers/jeena-jeena.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-15.wav', mood:'happy'},
    {title:'Pehli Dafa', artist:'Atif Aslam', cover:'assets/covers/pehli-dafa.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-16.wav', mood:'romantic'}
  ],
  'KK': [
    {title:'Tadap Tadap', artist:'KK', cover:'assets/covers/tadap-tadap.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-17.wav', mood:'sad'},
    {title:'Zara Sa', artist:'KK', cover:'assets/covers/zara-sa.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-18.wav', mood:'romantic'},
    {title:'Aankhon Mein Teri', artist:'KK', cover:'assets/covers/aankhon-mein-teri.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-19.wav', mood:'romantic'},
    {title:'Kya Mujhe Pyaar Hai', artist:'KK', cover:'assets/covers/kya-mujhe-pyaar-hai.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-20.wav', mood:'sad'},
    {title:'Tu Hi Meri Shab Hai', artist:'KK', cover:'assets/covers/tu-hi-meri-shab-hai.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-21.wav', mood:'romantic'}
  ],
  'A.R. Rahman': [
    {title:'Jai Ho', artist:'A.R. Rahman', cover:'assets/covers/jai-ho.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-22.wav', mood:'energetic'},
    {title:'Tere Bina', artist:'A.R. Rahman', cover:'assets/covers/tere-bina.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-23.wav', mood:'romantic'},
    {title:'Roja Janeman', artist:'A.R. Rahman', cover:'assets/covers/roja-janeman.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-24.wav', mood:'romantic'},
    {title:'Chaiyya Chaiyya', artist:'A.R. Rahman', cover:'assets/covers/chaiyya-chaiyya.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-25.wav', mood:'happy'},
    {title:'Dil Se Re', artist:'A.R. Rahman', cover:'assets/covers/dil-se-re.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-26.wav', mood:'energetic'}
  ],
  'Vishal Mishra': [
    {title:'Kaise Hua', artist:'Vishal Mishra', cover:'assets/covers/kaise-hua.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-27.wav', mood:'romantic'},
    {title:'Tera Ban Jaunga', artist:'Vishal Mishra', cover:'assets/covers/tera-ban-jaunga.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-28.wav', mood:'happy'},
    {title:'Tum Hi Aana', artist:'Vishal Mishra', cover:'assets/covers/tum-hi-aana.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-29.wav', mood:'romantic'},
    {title:'Dil Bechara', artist:'Vishal Mishra', cover:'assets/covers/dil-bechara.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-30.wav', mood:'sad'}
  ],
  
  // International Artists
  'Justin Bieber': [
    {title:'Sorry', artist:'Justin Bieber', cover:'assets/covers/sorry.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-31.wav', mood:'happy'},
    {title:'Love Yourself', artist:'Justin Bieber', cover:'assets/covers/love-yourself.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-32.wav', mood:'chill'},
    {title:'Baby', artist:'Justin Bieber', cover:'assets/covers/baby.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-33.wav', mood:'happy'},
    {title:'What Do You Mean?', artist:'Justin Bieber', cover:'assets/covers/what-do-you-mean.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-34.wav', mood:'happy'},
    {title:'Peaches', artist:'Justin Bieber', cover:'assets/covers/peaches.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-35.wav', mood:'chill'}
  ],
  'Selena Gomez': [
    {title:'Lose You To Love Me', artist:'Selena Gomez', cover:'assets/covers/lose-you-to-love-me.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-36.wav', mood:'sad'},
    {title:'Rare', artist:'Selena Gomez', cover:'assets/covers/rare.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-37.wav', mood:'happy'},
    {title:'Look At Her Now', artist:'Selena Gomez', cover:'assets/covers/look-at-her-now.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-38.wav', mood:'energetic'},
    {title:'Single Soon', artist:'Selena Gomez', cover:'assets/covers/single-soon.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-39.wav', mood:'happy'}
  ],
  'Zayn': [
    {title:'Pillowtalk', artist:'Zayn', cover:'assets/covers/pillowtalk.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-40.wav', mood:'romantic'},
    {title:'Dusk Till Dawn', artist:'Zayn', cover:'assets/covers/dusk-till-dawn.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-41.wav', mood:'chill'},
    {title:'Let Me', artist:'Zayn', cover:'assets/covers/let-me.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-42.wav', mood:'romantic'},
    {title:'Still Got Time', artist:'Zayn', cover:'assets/covers/still-got-time.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-43.wav', mood:'happy'}
  ],
  'Taylor Swift': [
    {title:'Anti-Hero', artist:'Taylor Swift', cover:'assets/covers/anti-hero.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-44.wav', mood:'sad'},
    {title:'Shake It Off', artist:'Taylor Swift', cover:'assets/covers/shake-it-off.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-45.wav', mood:'happy'},
    {title:'Blank Space', artist:'Taylor Swift', cover:'assets/covers/blank-space.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-46.wav', mood:'happy'},
    {title:'Love Story', artist:'Taylor Swift', cover:'assets/covers/love-story.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-47.wav', mood:'romantic'},
    {title:'You Belong With Me', artist:'Taylor Swift', cover:'assets/covers/you-belong-with-me.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-48.wav', mood:'romantic'}
  ],
  
  // EDM/Electronic Artists
  'Zedd': [
    {title:'Clarity', artist:'Zedd', cover:'assets/covers/clarity.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-49.wav', mood:'energetic'},
    {title:'Stay', artist:'Zedd', cover:'assets/covers/stay.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-50.wav', mood:'chill'},
    {title:'The Middle', artist:'Zedd', cover:'assets/covers/the-middle.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-51.wav', mood:'happy'},
    {title:'Beautiful Now', artist:'Zedd', cover:'assets/covers/beautiful-now.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-52.wav', mood:'energetic'}
  ],
  'Dzeko': [
    {title:'Lose It', artist:'Dzeko', cover:'assets/covers/lose-it.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-53.wav', mood:'party'},
    {title:'Survive', artist:'Dzeko', cover:'assets/covers/survive.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-54.wav', mood:'energetic'},
    {title:'Diamond Heart', artist:'Dzeko', cover:'assets/covers/diamond-heart.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-55.wav', mood:'party'},
    {title:'Break My Heart', artist:'Dzeko', cover:'assets/covers/break-my-heart.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-56.wav', mood:'energetic'}
  ],
  'Borgeous': [
    {title:'Tsunami', artist:'Borgeous', cover:'assets/covers/tsunami.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-57.wav', mood:'party'},
    {title:'Invincible', artist:'Borgeous', cover:'assets/covers/invincible.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-58.wav', mood:'energetic'},
    {title:'Wildfire', artist:'Borgeous', cover:'assets/covers/wildfire.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-59.wav', mood:'party'},
    {title:'This Could Be Love', artist:'Borgeous', cover:'assets/covers/this-could-be-love.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-60.wav', mood:'energetic'}
  ],
  'Cash Cash': [
    {title:'Take Me Home', artist:'Cash Cash', cover:'assets/covers/take-me-home.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-61.wav', mood:'happy'},
    {title:'Finest Hour', artist:'Cash Cash', cover:'assets/covers/finest-hour.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-62.wav', mood:'energetic'},
    {title:'How To Love', artist:'Cash Cash', cover:'assets/covers/how-to-love.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-63.wav', mood:'happy'},
    {title:'Belong', artist:'Cash Cash', cover:'assets/covers/belong.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-64.wav', mood:'chill'}
  ],
  'Sophie Francis': [
    {title:'Take Me Away', artist:'Sophie Francis', cover:'assets/covers/take-me-away.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-65.wav', mood:'chill'},
    {title:'Drop It', artist:'Sophie Francis', cover:'assets/covers/drop-it.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-66.wav', mood:'party'},
    {title:'Lost In The Music', artist:'Sophie Francis', cover:'assets/covers/lost-in-the-music.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-67.wav', mood:'chill'},
    {title:'Feel The Beat', artist:'Sophie Francis', cover:'assets/covers/feel-the-beat.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-68.wav', mood:'energetic'}
  ],
  'Dante Klein': [
    {title:'All Night', artist:'Dante Klein', cover:'assets/covers/all-night.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-69.wav', mood:'party'},
    {title:'Feel It', artist:'Dante Klein', cover:'assets/covers/feel-it.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-70.wav', mood:'energetic'},
    {title:'Dance With Me', artist:'Dante Klein', cover:'assets/covers/dance-with-me.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-71.wav', mood:'party'},
    {title:'Midnight City', artist:'Dante Klein', cover:'assets/covers/midnight-city.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-72.wav', mood:'chill'}
  ],
  'Alec Benjamin': [
    {title:'Let Me Down Slowly', artist:'Alec Benjamin', cover:'assets/covers/let-me-down-slowly.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-73.wav', mood:'sad'},
    {title:'The Way You Felt', artist:'Alec Benjamin', cover:'assets/covers/the-way-you-felt.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-74.wav', mood:'chill'},
    {title:'If We Have Each Other', artist:'Alec Benjamin', cover:'assets/covers/if-we-have-each-other.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-75.wav', mood:'romantic'},
    {title:'Water Fountain', artist:'Alec Benjamin', cover:'assets/covers/water-fountain.svg', src:'https://www.soundjay.com/misc/sounds/bell-ringing-76.wav', mood:'happy'}
  ]
};

const artistSongsSection = document.getElementById('artistSongsSection');
const artistSongsTitle = document.getElementById('artistSongsTitle');
const artistSongsEl = document.getElementById('artistSongs');

function renderArtistSongs(artist){
  const list = ARTIST_SONGS[artist] || [];
  artistSongsTitle.textContent = `${artist} Songs`;
  if (list.length) {
    artistSongsSection.classList.remove('section--hidden');
  } else {
    artistSongsSection.classList.add('section--hidden');
  }
  artistSongsEl.innerHTML = '';
  list.forEach(track=>{
    const card = document.createElement('article');
    card.className = 'card';
    card.setAttribute('data-src', track.src);
    card.setAttribute('data-title', track.title);
    card.setAttribute('data-artist', track.artist);
    card.setAttribute('data-cover', track.cover);
    card.setAttribute('data-mood', track.mood || '');
    card.innerHTML = `
      <img src="${track.cover}" alt="${track.title}">
      <h3>${track.title}</h3>
      <p>${track.artist}</p>
      <button class="card__play" data-action="play">▶</button>
      <button class="card__save" data-action="save" title="Save">＋</button>
      <button class="card__download" data-action="download" title="Download">⬇</button>
    `;
    artistSongsEl.appendChild(card);
  });
  gatherTrackNodes();
  syncSavedIcons();
}

document.getElementById('artistBar')?.addEventListener('click', (e)=>{
  const img = e.target.closest('.artist[data-artist]');
  if(!img) return;
  const artist = img.getAttribute('data-artist');
  renderArtistSongs(artist);
});

// Artists scroll navigation
const artistsContainer = document.getElementById('artistBar');
const artistsPrevBtn = document.getElementById('artistsPrevBtn');
const artistsNextBtn = document.getElementById('artistsNextBtn');

function updateArtistsNavButtons() {
  if (!artistsContainer || !artistsPrevBtn || !artistsNextBtn) return;
  
  const scrollLeft = artistsContainer.scrollLeft;
  const maxScroll = artistsContainer.scrollWidth - artistsContainer.clientWidth;
  
  artistsPrevBtn.disabled = scrollLeft <= 0;
  artistsNextBtn.disabled = scrollLeft >= maxScroll - 1; // -1 for rounding issues
}

artistsPrevBtn?.addEventListener('click', () => {
  artistsContainer.scrollBy({ left: -200, behavior: 'smooth' });
});

artistsNextBtn?.addEventListener('click', () => {
  artistsContainer.scrollBy({ left: 200, behavior: 'smooth' });
});

artistsContainer?.addEventListener('scroll', updateArtistsNavButtons);

// Initialize button states
updateArtistsNavButtons();

// Mood filtering functionality
const moodButtons = document.querySelectorAll('.mood-btn');
const popularSection = document.getElementById('popular');

moodButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    // Update active button
    moodButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Filter songs by mood
    const selectedMood = btn.getAttribute('data-mood');
    const allCards = popularSection.querySelectorAll('.card');
    
    allCards.forEach(card => {
      const cardMood = card.getAttribute('data-mood');
      if (selectedMood === 'all' || cardMood === selectedMood) {
        card.style.display = 'block';
      } else {
        card.style.display = 'none';
      }
    });
  });
});

