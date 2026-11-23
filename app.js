/* Klangfeed – TikTok-artiger Musik-Entdecker.
 * Datenquellen (ohne API-Key, CORS: Access-Control-Allow-Origin: *):
 *  - iTunes-Charts (Legacy-RSS) je Land und Genre:
 *    https://itunes.apple.com/<land>/rss/topsongs/limit=50[/genre=<id>]/json
 *    → enthält Titel, Künstler, Cover, Genre, Datum und Preview-URL direkt.
 *  - iTunes Search API: https://itunes.apple.com/search?term=…&media=music&entity=song
 *  Fallback bei Fetch-Fehler: JSONP (callback=…), beide Endpunkte unterstützen das.
 */
'use strict';

// ---------------------------------------------------------------- Konfiguration
const CHART_COUNTRIES = ['de', 'us', 'gb', 'fr', 'br', 'jp', 'kr', 'es', 'it', 'se', 'mx', 'nl', 'au', 'ca', 'at', 'ch'];
const SEARCH_COUNTRIES = ['de', 'us', 'gb'];
const GENRES = [
  { key: 'pop', label: 'Pop', rss: 14, terms: ['pop', 'synth pop', 'indie pop', 'dance pop', 'electropop'] },
  { key: 'hiphop', label: 'Hip-Hop', rss: 18, terms: ['hip hop', 'rap', 'trap', 'boom bap', 'lofi hip hop'] },
  { key: 'rock', label: 'Rock', rss: 21, terms: ['rock', 'classic rock', 'punk rock', 'grunge', 'garage rock'] },
  { key: 'indie', label: 'Indie', rss: 20, terms: ['indie', 'indie rock', 'indie folk', 'dream pop', 'shoegaze', 'bedroom pop'] },
  { key: 'electronic', label: 'Electronic', rss: 7, terms: ['electronic', 'house', 'techno', 'drum and bass', 'ambient', 'synthwave'] },
  { key: 'dance', label: 'Dance', rss: 17, terms: ['dance', 'edm', 'eurodance', 'deep house'] },
  { key: 'jazz', label: 'Jazz', rss: 11, terms: ['jazz', 'smooth jazz', 'jazz piano', 'bebop', 'nu jazz', 'jazz vocal'] },
  { key: 'rnb', label: 'R&B', rss: 15, terms: ['r&b', 'soul', 'neo soul', 'funk', 'motown'] },
  { key: 'latin', label: 'Latin', rss: 12, terms: ['reggaeton', 'latin pop', 'salsa', 'bachata', 'cumbia'], countries: ['us', 'mx', 'es', 'br', 'de'] },
  { key: 'kpop', label: 'K-Pop', rss: 51, terms: ['k-pop', 'kpop', 'korean pop', 'k-pop girl group', 'k-pop boy group'], countries: ['us', 'de', 'gb', 'jp', 'fr'] },
  { key: 'metal', label: 'Metal', rss: 1153, terms: ['metal', 'heavy metal', 'metalcore', 'power metal', 'death metal'] },
  { key: 'klassik', label: 'Klassik', rss: 5, terms: ['klassik', 'piano sonata', 'symphony', 'violin concerto', 'string quartet'] },
  { key: 'deutschrap', label: 'Deutschrap', rss: 18, countries: ['de', 'at', 'ch'], terms: ['deutschrap', 'deutsch rap', 'straßenrap', 'cloud rap deutsch'], searchCountries: ['de'] },
  { key: 'country', label: 'Country', rss: 6, terms: ['country', 'americana', 'bluegrass'], countries: ['us', 'ca', 'au', 'gb'] },
  { key: 'reggae', label: 'Reggae', rss: 24, terms: ['reggae', 'dancehall', 'dub'] },
  { key: 'singer', label: 'Singer/Songwriter', rss: 10, terms: ['singer songwriter', 'acoustic', 'folk'] },
  { key: 'schlager', label: 'Schlager', rss: null, terms: ['schlager', 'deutscher schlager', 'party schlager'], searchCountries: ['de'] },
  { key: 'charts', label: 'Charts', rss: 0, hidden: true, terms: [] }, // Gesamt-Charts mehrerer Länder (nur in „Alle“)
];
const GENRE_BY_KEY = Object.fromEntries(GENRES.map(g => [g.key, g]));
const WINDOW = 2;           // Karten ober-/unterhalb der aktuellen (→ max. 5 im DOM)
const PREFETCH_AHEAD = 6;   // nachladen, wenn weniger als so viele Songs übrig
const FLAGS = { de: '🇩🇪', us: '🇺🇸', gb: '🇬🇧', fr: '🇫🇷', br: '🇧🇷', jp: '🇯🇵', kr: '🇰🇷', es: '🇪🇸', it: '🇮🇹', se: '🇸🇪', mx: '🇲🇽', nl: '🇳🇱', au: '🇦🇺', ca: '🇨🇦', at: '🇦🇹', ch: '🇨🇭' };

// ---------------------------------------------------------------- Zustand
const $ = s => document.querySelector(s);
const feedEl = $('#feed'), trackEl = $('#track');
const audio = new Audio();
audio.preload = 'auto';

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* voll/privat */ } },
};
let likes = LS.get('kf_likes', []);            // [{id,title,artist,art,preview,url,genre,year,gk}]
let weights = LS.get('kf_weights', {});        // genreKey → Gewicht
let likedIds = new Set(likes.map(s => s.id));

let songs = [];             // aktueller Feed (nur kleine Datenobjekte)
let cur = 0;                // Index der sichtbaren Karte
let H = feedEl.clientHeight || window.innerHeight;
let filter = 'all';
let unlocked = false;       // iOS: Audio erst nach Nutzergeste
let userPaused = false;
let panelSong = null;       // Song, der gerade im „Gemerkt“-Screen spielt
const cards = new Map();    // index → Element (nur Fenster um cur)
const seen = new Set();     // Duplikate vermeiden (ID + normalisiert Künstler/Titel)
const buckets = {};         // genreKey → [songs] (Vorrat, noch nicht im Feed)
const srcState = {};        // genreKey → {list, i}
const inflight = {};        // genreKey → Promise
let filling = null;
let listen = null;          // {song, maxT}
let feedGen = 0;            // erhöht sich bei Filterwechsel

// ---------------------------------------------------------------- Hilfen
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]|feat\..*$|[^a-z0-9äöüß]+/g, ' ').trim();
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.random() * a.length | 0];
const art = (url, size) => url ? url.replace(/\/\d+x\d+bb(\.\w+)$/, `/${size}x${size}bb$1`) : '';
const spotifyUrl = s => 'https://open.spotify.com/search/' + encodeURIComponent(`${s.artist} ${s.title}`);

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

let jpN = 0;
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = '__kfjp' + (++jpN);
    const s = document.createElement('script');
    const done = () => { clearTimeout(timer); delete window[cb]; s.remove(); };
    const timer = setTimeout(() => { done(); reject(new Error('JSONP-Timeout')); }, 9000);
    window[cb] = d => { done(); resolve(d); };
    s.onerror = () => { done(); reject(new Error('JSONP-Fehler')); };
    s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
    document.head.appendChild(s);
  });
}
async function getJSON(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    if (!navigator.onLine) throw e;
    return jsonp(url); // Fallback, falls CORS mal fehlt
  }
}

// ---------------------------------------------------------------- Datenquellen
function mapGenre(name) {
  const n = (name || '').toLowerCase();
  if (/k-pop|kpop/.test(n)) return 'kpop';
  if (/hip|rap/.test(n)) return 'hiphop';
  if (/metal/.test(n)) return 'metal';
  if (/rock|punk/.test(n)) return 'rock';
  if (/alternative|indie/.test(n)) return 'indie';
  if (/electro|house|techno/.test(n)) return 'electronic';
  if (/dance/.test(n)) return 'dance';
  if (/jazz/.test(n)) return 'jazz';
  if (/r&b|soul|funk/.test(n)) return 'rnb';
  if (/latin|reggaeton|urbano/.test(n)) return 'latin';
  if (/klassik|classical|klassische/.test(n)) return 'klassik';
  if (/country/.test(n)) return 'country';
  if (/reggae/.test(n)) return 'reggae';
  if (/schlager/.test(n)) return 'schlager';
  if (/singer|songwriter|folk/.test(n)) return 'singer';
  if (/pop/.test(n)) return 'pop';
  return 'charts';
}

function fromRss(e, gk, country) {
  try {
    const links = [].concat(e.link || []);
    const enc = links.find(l => l.attributes && l.attributes.rel === 'enclosure');
    const imgs = [].concat(e['im:image'] || []);
    const img = imgs.length ? imgs[imgs.length - 1].label : '';
    const genre = e.category?.attributes?.label || '';
    return {
      id: String(e.id?.attributes?.['im:id'] || e.id?.label),
      title: e['im:name']?.label || '',
      artist: e['im:artist']?.label || '',
      art: img,
      preview: enc?.attributes?.href || '',
      url: e.id?.label || '',
      genre,
      year: (e['im:releaseDate']?.label || '').slice(0, 4),
      gk: gk === 'charts' ? mapGenre(genre) : gk,
      src: `Charts ${FLAGS[country] || country.toUpperCase()}`,
    };
  } catch { return null; }
}
function fromSearch(r, gk, label) {
  return {
    id: String(r.trackId),
    title: r.trackName || '',
    artist: r.artistName || '',
    art: r.artworkUrl100 || '',
    preview: r.previewUrl || '',
    url: r.trackViewUrl || '',
    genre: r.primaryGenreName || '',
    year: (r.releaseDate || '').slice(0, 4),
    gk: gk || mapGenre(r.primaryGenreName),
    src: label,
  };
}

function sourcesFor(g) {
  const list = [];
  if (g.rss !== null) {
    for (const c of (g.countries || CHART_COUNTRIES)) list.push({ t: 'rss', c, g: g.rss });
  }
  for (const term of g.terms) list.push({ t: 'search', term, c: pick(g.searchCountries || SEARCH_COUNTRIES) });
  return shuffle(list);
}

async function fetchSource(gk, s) {
  if (s.t === 'rss') {
    const url = `https://itunes.apple.com/${s.c}/rss/topsongs/limit=50${s.g ? '/genre=' + s.g : ''}/json`;
    const d = await getJSON(url);
    const entries = [].concat(d?.feed?.entry || []);
    return entries.map(e => fromRss(e, gk, s.c));
  }
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(s.term)}&media=music&entity=song&limit=50&country=${s.c}`;
  const d = await getJSON(url);
  const all = (d?.results || []).map(r => fromSearch(r, gk, 'Entdeckung'));
  // Suchtreffer sind nicht immer genre-genau → bevorzugt passende Genres behalten
  const ok = { deutschrap: ['hiphop'], schlager: ['pop', 'dance'], indie: ['rock'], dance: ['electronic'], electronic: ['dance'], singer: ['pop'] }[gk] || [];
  const fit = all.filter(x => { const m = mapGenre(x.genre); return m === gk || ok.includes(m); });
  return fit.length >= 8 ? fit : all;
}

function isNew(s) {
  if (!s || !s.preview || !s.id || !s.title) return false;
  const k = norm(s.artist) + '|' + norm(s.title);
  if (seen.has(s.id) || seen.has(k)) return false;
  seen.add(s.id); seen.add(k);
  return true;
}

// Holt die nächste Quelle eines Genres in dessen Vorrat
function refill(gk) {
  if (inflight[gk]) return inflight[gk];
  const g = GENRE_BY_KEY[gk];
  if (!srcState[gk]) srcState[gk] = { list: sourcesFor(g), i: 0 };
  const st = srcState[gk];
  const p = (async () => {
    for (let tries = 0; tries < 3; tries++) {
      if (st.i >= st.list.length) { st.list = sourcesFor(g); st.i = 0; } // neu mischen, Endlos
      const s = st.list[st.i++];
      try {
        const got = (await fetchSource(gk, s)).filter(isNew);
        if (got.length) {
          // Nicht ganze Charts der Reihe nach: mischen, aber Top-Hälfte leicht bevorzugen
          (buckets[gk] ||= []).push(...shuffle(got));
          return got.length;
        }
      } catch (e) { console.warn('Quelle fehlgeschlagen', s, e); }
    }
    return 0;
  })().finally(() => { delete inflight[gk]; });
  inflight[gk] = p;
  return p;
}

// ---------------------------------------------------------------- Lernen / Gewichte
const w = gk => weights[gk] ?? 1;
function bump(gk, d) {
  if (!gk) return;
  weights[gk] = Math.min(10, Math.max(0.2, w(gk) + d));
  LS.set('kf_weights', weights);
}
function chooseGenre() {
  if (filter !== 'all') return filter;
  const pool = GENRES.map(g => g.key);
  if (Math.random() < 0.25) return pick(pool); // Erkundung: Zufall
  let total = 0;
  for (const k of pool) total += w(k) * (k === 'charts' ? 1.5 : 1);
  let r = Math.random() * total;
  for (const k of pool) { r -= w(k) * (k === 'charts' ? 1.5 : 1); if (r <= 0) return k; }
  return pool[0];
}

// Feed um n Songs verlängern
function fill(n = 10) {
  if (filling) return filling;
  const gen = feedGen;
  const p = (async () => {
    let added = 0, fails = 0;
    while (added < n && fails < 8 && gen === feedGen) {
      const gk = chooseGenre();
      let b = buckets[gk];
      if (!b || !b.length) {
        const got = await refill(gk);
        if (gen !== feedGen) break;
        b = buckets[gk];
        if (!got && (!b || !b.length)) { fails++; continue; }
      } else if (b.length < 5) refill(gk); // im Hintergrund nachfüllen
      // Genre-Streaks vermeiden: in „Alle“ höchstens 2 gleiche hintereinander
      if (filter === 'all' && songs.length >= 2 && songs[songs.length - 1].gk === gk && songs[songs.length - 2].gk === gk && fails < 4) { fails++; continue; }
      songs.push(b.shift());
      added++;
    }
    if (gen === feedGen) layout();
    return added;
  })().finally(() => { if (filling === p) filling = null; });
  filling = p;
  return p;
}

// ---------------------------------------------------------------- Rendering (Fenster)
const ICON_APPLE = '<svg viewBox="0 0 24 24"><path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.5-1-2.5-3.9zM14 5.4c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z"/></svg>';
const ICON_SPOTIFY = '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.6 14.4a.6.6 0 0 1-.9.2c-2.4-1.5-5.4-1.8-8.9-1a.6.6 0 1 1-.3-1.2c3.9-.9 7.2-.5 9.9 1.1.3.2.4.6.2.9zm1.2-2.7a.8.8 0 0 1-1.1.3c-2.7-1.7-6.9-2.2-10.1-1.2a.8.8 0 1 1-.5-1.5c3.7-1.1 8.3-.6 11.4 1.3.4.2.5.7.3 1.1zm.1-2.8C14.7 9 9.4 8.8 6.3 9.7a1 1 0 1 1-.5-1.8c3.5-1.1 9.4-.9 13.1 1.3a1 1 0 0 1-1 1.7z"/></svg>';

function makeCard(i) {
  const s = songs[i];
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.i = i;
  el.style.top = (i * H) + 'px';
  el.style.height = H + 'px';
  const liked = likedIds.has(s.id);
  const gl = GENRE_BY_KEY[s.gk]?.label;
  el.innerHTML = `
    <img class="bg" src="${esc(art(s.art, 100))}" alt="" decoding="async">
    <div class="shade"></div>
    <div class="stage"><img class="cover" alt="" decoding="async" loading="lazy" src="${esc(art(s.art, 600))}"></div>
    <div class="pp">▶︎</div>
    <div class="meta">
      <h2 class="title">${esc(s.title)}</h2>
      <p class="artist">${esc(s.artist)}</p>
      <div class="tags">
        ${s.genre ? `<span class="tag">${esc(s.genre)}</span>` : (gl ? `<span class="tag">${esc(gl)}</span>` : '')}
        ${s.year ? `<span class="tag">${esc(s.year)}</span>` : ''}
        ${s.src ? `<span class="tag src">${esc(s.src)}</span>` : ''}
      </div>
    </div>
    <div class="actions">
      <button class="act like ${liked ? 'on' : ''}" data-a="like"><span class="ic">${liked ? '❤️' : '🤍'}</span><span class="lbl">Merken</span></button>
      <button class="act more" data-a="more"><span class="ic">✨</span><span>Mehr davon</span></button>
      <a class="act" data-a="link" href="${esc(s.url)}" target="_blank" rel="noopener"><span class="ic">${ICON_APPLE}</span><span>Apple Music</span></a>
      <a class="act" data-a="link" href="${esc(spotifyUrl(s))}" target="_blank" rel="noopener"><span class="ic" style="color:#1ed760">${ICON_SPOTIFY}</span><span>Spotify</span></a>
    </div>
    <div class="progress"><div class="bar"></div></div>`;
  const cover = el.querySelector('.cover');
  cover.onload = () => cover.classList.add('loaded');
  cover.onerror = () => { cover.src = art(s.art, 100); };
  return el;
}

function disposeCard(el) {
  // Bilder freigeben (iOS hält dekodierte Bilder sonst länger im Speicher)
  el.querySelectorAll('img').forEach(img => { img.onload = img.onerror = null; img.removeAttribute('src'); });
  el.remove();
}

function renderWindow(center) {
  const lo = Math.max(0, center - WINDOW), hi = Math.min(songs.length - 1, center + WINDOW);
  for (const [i, el] of cards) if (i < lo || i > hi) { disposeCard(el); cards.delete(i); }
  for (let i = lo; i <= hi; i++) {
    if (!cards.has(i)) { const el = makeCard(i); cards.set(i, el); trackEl.appendChild(el); }
  }
}

function layout() {
  H = feedEl.clientHeight || window.innerHeight;
  trackEl.style.height = (songs.length * H) + 'px';
  for (const [i, el] of cards) { el.style.top = (i * H) + 'px'; el.style.height = H + 'px'; }
  renderWindow(cur);
  $('#loader').hidden = !(filling && cur >= songs.length - 1);
}

function resetCards(fromIndex = 0) {
  for (const [i, el] of cards) if (i >= fromIndex) { disposeCard(el); cards.delete(i); }
}

// ---------------------------------------------------------------- Scroll / Aktivierung
let scrollRaf = 0, settleTimer = 0;
feedEl.addEventListener('scroll', () => {
  if (!scrollRaf) scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    const idx = Math.max(0, Math.min(songs.length - 1, Math.round(feedEl.scrollTop / H)));
    renderWindow(idx);
  });
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settle, 140);
}, { passive: true });
if ('onscrollend' in window) feedEl.addEventListener('scrollend', settle);

function settle() {
  clearTimeout(settleTimer);
  if (!songs.length) return;
  const idx = Math.max(0, Math.min(songs.length - 1, Math.round(feedEl.scrollTop / H)));
  if (idx !== cur || !listen) activate(idx);
  if (songs.length - idx < PREFETCH_AHEAD) {
    fill(10).then(() => { $('#loader').hidden = true; });
    if (idx >= songs.length - 1) $('#loader').hidden = false;
  }
}

function goTo(i, smooth = true) {
  i = Math.max(0, Math.min(songs.length - 1, i));
  feedEl.scrollTo({ top: i * H, behavior: smooth ? 'smooth' : 'auto' });
}

function finishListen() {
  if (!listen || !unlocked) { listen = null; return; }
  const t = listen.maxT;
  if (t > 20) bump(listen.song.gk, 0.5);
  else if (t < 5) bump(listen.song.gk, -0.25);
  listen = null;
}

function activate(i) {
  finishListen();
  cur = i;
  renderWindow(i);
  const s = songs[i];
  if (!s) return;
  for (const [, el] of cards) el.classList.remove('paused');
  setBar(i, 0);
  listen = { song: s, maxT: 0 };
  userPaused = false;
  if (unlocked && !panelSong) playSong(s);
}

function playSong(s) {
  if (audio.dataset.id !== s.id) {
    audio.src = s.preview;
    audio.dataset.id = s.id;
  }
  const p = audio.play();
  if (p) p.catch(err => { if (err.name !== 'AbortError') console.warn(err); });
  setMediaSession(s);
}

function setBar(i, frac) {
  const el = cards.get(i);
  if (el) el.querySelector('.bar').style.transform = `scaleX(${frac})`;
}

audio.addEventListener('timeupdate', () => {
  if (panelSong) return;
  const d = audio.duration || 30;
  if (listen && listen.song.id === audio.dataset.id) listen.maxT = Math.max(listen.maxT, audio.currentTime);
  setBar(cur, Math.min(1, audio.currentTime / d));
});
audio.addEventListener('ended', () => {
  if (panelSong) { panelSong = null; renderSaved(); return; }
  // Vorschau zu Ende → automatisch zum nächsten Song
  if (cur < songs.length - 1) goTo(cur + 1);
});
audio.addEventListener('error', () => {
  if (!audio.src || panelSong) return;
  toast('Vorschau nicht verfügbar – weiter');
  setTimeout(() => { if (songs[cur]?.id === audio.dataset.id) goTo(cur + 1); }, 700);
});
audio.addEventListener('pause', () => {
  const el = cards.get(cur);
  if (el && !panelSong && !audio.ended && audio.currentTime > 0 && audio.dataset.id === songs[cur]?.id) el.classList.add('paused');
});
audio.addEventListener('play', () => { const el = cards.get(cur); if (el) el.classList.remove('paused'); });

function setMediaSession(s) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: s.title, artist: s.artist, album: 'Klangfeed',
      artwork: [{ src: art(s.art, 600), sizes: '600x600', type: 'image/jpeg' }],
    });
  } catch { /* ältere Browser */ }
}
if ('mediaSession' in navigator) {
  try {
    navigator.mediaSession.setActionHandler('nexttrack', () => goTo(cur + 1));
    navigator.mediaSession.setActionHandler('previoustrack', () => goTo(cur - 1));
  } catch { /* nicht unterstützt */ }
}

// ---------------------------------------------------------------- Interaktion
trackEl.addEventListener('click', e => {
  const card = e.target.closest('.card');
  if (!card) return;
  const i = +card.dataset.i;
  const btn = e.target.closest('[data-a]');
  if (btn) {
    const a = btn.dataset.a;
    if (a === 'like') toggleLike(songs[i], btn);
    else if (a === 'more') moreLikeThis(i, btn);
    else if (a === 'link') { if (!audio.paused) audio.pause(); }
    return;
  }
  if (i !== cur) return;
  if (audio.paused) { userPaused = false; playSong(songs[cur]); }
  else { userPaused = true; audio.pause(); }
});

function toggleLike(s, btn) {
  if (likedIds.has(s.id)) {
    likes = likes.filter(x => x.id !== s.id); likedIds.delete(s.id);
    bump(s.gk, -1);
  } else {
    likes.unshift({ id: s.id, title: s.title, artist: s.artist, art: s.art, preview: s.preview, url: s.url, genre: s.genre, year: s.year, gk: s.gk });
    likedIds.add(s.id);
    bump(s.gk, 1.5);
    toast('Gemerkt ❤️');
  }
  LS.set('kf_likes', likes);
  updateLikeButtons(s.id);
  updateSavedCount();
}
function updateLikeButtons(id) {
  for (const [i, el] of cards) {
    if (songs[i].id !== id) continue;
    const b = el.querySelector('.like'); const on = likedIds.has(id);
    b.classList.toggle('on', on); b.querySelector('.ic').textContent = on ? '❤️' : '🤍';
  }
}

async function moreLikeThis(i, btn) {
  const s = songs[i];
  btn.classList.add('on');
  bump(s.gk, 2);
  toast(`Mehr ${GENRE_BY_KEY[s.gk]?.label || 'davon'} & ${s.artist}`);
  const gen = feedGen;
  // 1) Songs des Künstlers direkt als nächstes einschieben
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(s.artist)}&media=music&entity=song&limit=30&country=de`;
    const d = await getJSON(url);
    if (gen !== feedGen) return;
    const mainArtist = norm(s.artist.split(/,|&| feat\.?| x | und /i)[0]);
    const extra = [];
    for (const r of shuffle((d?.results || []).filter(r => norm(r.artistName).includes(mainArtist)))) {
      const x = fromSearch(r, s.gk, 'Mehr davon');
      if (isNew(x)) extra.push(x);
      if (extra.length >= 3) break;
    }
    // 2) plus Songs aus demselben Genre
    if (!buckets[s.gk]?.length) await refill(s.gk);
    const g = (buckets[s.gk] || []).splice(0, 3);
    const mix = [];
    for (let k = 0; k < 3; k++) { if (extra[k]) mix.push(extra[k]); if (g[k]) mix.push(g[k]); }
    if (!mix.length) return;
    const at = cur + 1;
    songs.splice(at, 0, ...mix);
    resetCards(at);
    layout();
  } catch (e) { console.warn(e); }
}

// ---------------------------------------------------------------- Genre-Chips
function renderChips() {
  const chips = $('#chips');
  chips.innerHTML = [`<button class="chip active" data-g="all">Alle</button>`]
    .concat(GENRES.filter(g => !g.hidden).map(g => `<button class="chip" data-g="${g.key}">${esc(g.label)}</button>`)).join('');
  chips.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    chips.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === b));
    b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    setFilter(b.dataset.g);
  });
}

async function setFilter(g) {
  if (g === filter) return;
  finishListen();
  filter = g;
  feedGen++;
  // Noch nicht gesehene Songs zurück in den Vorrat legen
  for (let i = cur + 1; i < songs.length; i++) (buckets[songs[i].gk] ||= []).push(songs[i]);
  songs = [];
  resetCards(0);
  cur = 0;
  feedEl.scrollTop = 0;
  audio.pause();
  layout();
  $('#loader').hidden = false;
  filling = null;
  await fill(8);
  $('#loader').hidden = true;
  if (!songs.length) { toast('Keine Songs gefunden – Netz prüfen'); return; }
  feedEl.scrollTop = 0;
  activate(0);
}

// ---------------------------------------------------------------- Gemerkt-Screen
function updateSavedCount() { $('#savedCount').textContent = likes.length; }
function renderSaved() {
  const list = $('#savedList');
  $('#savedEmpty').hidden = likes.length > 0;
  list.innerHTML = likes.map(s => `
    <li class="saved-item ${panelSong && panelSong.id === s.id && !audio.paused ? 'playing' : ''}" data-id="${esc(s.id)}">
      <img src="${esc(art(s.art, 100))}" alt="" loading="lazy" decoding="async">
      <div class="txt">
        <div class="t">${esc(s.title)}</div>
        <div class="a">${esc(s.artist)}${s.year ? ' · ' + esc(s.year) : ''}</div>
        <div class="links"><a href="${esc(s.url)}" target="_blank" rel="noopener">Apple Music</a><a href="${esc(spotifyUrl(s))}" target="_blank" rel="noopener">Spotify</a></div>
      </div>
      <button class="sbtn play" data-a="play" aria-label="Abspielen">${panelSong && panelSong.id === s.id && !audio.paused ? '❚❚' : '▶︎'}</button>
      <button class="sbtn" data-a="del" aria-label="Entfernen">✕</button>
    </li>`).join('');
}
$('#savedList').addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const id = b.closest('.saved-item').dataset.id;
  const s = likes.find(x => x.id === id); if (!s) return;
  if (b.dataset.a === 'play') {
    if (panelSong && panelSong.id === id && !audio.paused) audio.pause();
    else { panelSong = s; unlocked = true; playSong(s); }
    renderSaved();
  } else if (b.dataset.a === 'del') {
    if (panelSong && panelSong.id === id) { audio.pause(); panelSong = null; }
    likes = likes.filter(x => x.id !== id); likedIds.delete(id);
    LS.set('kf_likes', likes);
    updateSavedCount(); updateLikeButtons(id); renderSaved();
  }
});
$('#savedBtn').addEventListener('click', () => {
  audio.pause();
  $('#saved').hidden = false;
  renderSaved();
});
$('#savedClose').addEventListener('click', () => {
  $('#saved').hidden = true;
  $('#savedList').innerHTML = ''; // Bilder freigeben
  if (panelSong) { panelSong = null; audio.pause(); }
  if (unlocked && songs[cur]) { userPaused = false; playSong(songs[cur]); }
});

// ---------------------------------------------------------------- Tastatur (Desktop)
document.addEventListener('keydown', e => {
  if (!$('#saved').hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); goTo(cur + 1); }
  else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); goTo(cur - 1); }
  else if (e.key === ' ') { e.preventDefault(); audio.paused ? playSong(songs[cur]) : audio.pause(); }
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { layout(); feedEl.scrollTop = cur * H; }, 100);
});

// ---------------------------------------------------------------- Start
$('#startBtn').addEventListener('click', () => {
  unlocked = true;
  $('#startOverlay').classList.add('hide');
  setTimeout(() => $('#startOverlay').remove(), 400);
  const s = songs[cur];
  if (s) { listen = { song: s, maxT: 0 }; playSong(s); } // synchron in der Geste → iOS erlaubt Audio
});

async function init() {
  renderChips();
  updateSavedCount();
  // Parallel ein paar Genres vorladen, damit der Mix sofort bunt ist
  const first = ['charts', ...shuffle(GENRES.filter(g => !g.hidden).map(g => g.key)).slice(0, 4)];
  srcState.charts = { list: shuffle(CHART_COUNTRIES.map(c => ({ t: 'rss', c, g: 0 }))), i: 0 };
  // Deutsche Charts zuerst
  srcState.charts.list.sort((a, b) => (b.c === 'de') - (a.c === 'de'));
  await Promise.allSettled(first.map(refill));
  await fill(10);
  const btn = $('#startBtn');
  if (!songs.length) {
    btn.textContent = 'Keine Verbindung – erneut versuchen';
    btn.disabled = false;
    btn.onclick = () => location.reload();
    return;
  }
  layout();
  activate(0);
  btn.disabled = false;
  btn.textContent = 'Tippen zum Starten';
}
init();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
