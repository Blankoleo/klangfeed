/* Klangfeed 2 – Musik entdecken im Wisch-Feed.
 *
 * Drei Arten von Songs, im „Mix“ nach einstellbarem Verhältnis gemischt:
 *  - dir   „In meiner Richtung“: ähnliche Künstler zu Lieblingen (importierte Mediathek, Gemerktes, Gelerntes)
 *          über Deezer (/search/artist, /artist/{id}/related, /artist/{id}/radio, /artist/{id}/top).
 *          Ohne Profil: Playlists zu den gewählten Richtungen (Deezer-Playlist-Suche).
 *  - new   „Ganz neu“: Nischen-Genres und Länder außerhalb des Profils (Deezer-Playlists, iTunes-Suche als Ersatz).
 *  - chart „Charts“: iTunes-Charts je Land (RSS, CORS offen).
 * Deezer sendet kein CORS → JSONP (output=jsonp&callback=…). Deezer-Vorschau-Links laufen nach ~15 Min ab
 * (exp= im Link) und werden dann über /track/{id} erneuert.
 * Die Mediathek (geschmack.json) wird nur lokal importiert (localStorage) und nie mit dem Code ausgeliefert.
 */
'use strict';

// ---------------------------------------------------------------- Speicher
const LS = {
  get(k, d) { try { const v = localStorage.getItem('kf.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('kf.' + k, JSON.stringify(v)); } catch { /* voll/privat */ } },
  del(k) { try { localStorage.removeItem('kf.' + k); } catch {} },
};
const $ = s => document.querySelector(s);

// ---------------------------------------------------------------- Konfiguration
const MODES = { dir: 'In meiner Richtung', new: 'Ganz neu', chart: 'Charts' };
const DEFAULT_MIX = { dir: 50, new: 35, chart: 15 };

// Richtungen (ohne Künstlernamen): Grundlage für „In meiner Richtung“, wenn wenig über Lieblinge bekannt ist.
// w = Grundgewicht ohne Import (grob nach Leos Geschmack), g = passende Genres in der Mediathek.
const STYLES = [
  { key: 'altrap', label: 'Alternative Rap', q: ['alternative hip hop', 'jazz rap', 'experimental hip hop', 'conscious hip hop'], w: 3, g: /hip-hop|rap/i },
  { key: 'rap', label: 'Hip-Hop', q: ['hip hop new', 'underground rap', 'melodic rap'], w: 2.2, g: /hip-hop|rap/i },
  { key: 'bedroom', label: 'Bedroom-Pop', q: ['bedroom pop', 'dream pop', 'indie pop chill'], w: 1.7, g: /pop|alternative/i },
  { key: 'neosoul', label: 'Neo-Soul & R&B', q: ['neo soul', 'alternative r&b', 'soul new'], w: 1.5, g: /r&b|soul/i },
  { key: 'indie', label: 'Indie & Alternative', q: ['indie alternative', 'indie rock new', 'slacker rock'], w: 1.4, g: /alternative|indie/i },
  { key: 'psych', label: 'Psychedelic', q: ['psychedelic rock', 'neo psychedelia', 'psych pop'], w: 1, g: /rock/i },
  { key: 'pop', label: 'Pop', q: ['pop new music', 'alt pop'], w: 1.1, g: /^pop$|singer/i },
  { key: 'rock', label: 'Rock', q: ['classic rock deep cuts', 'alternative rock'], w: .6, g: /rock/i },
  { key: 'jazz', label: 'Jazz', q: ['nu jazz', 'jazz hip hop', 'modern jazz'], w: .4, g: /jazz/i },
  { key: 'reggae', label: 'Reggae', q: ['roots reggae', 'dub reggae'], w: .35, g: /reggae/i },
  { key: 'electronic', label: 'Electronic', q: ['electronic chill', 'deep house'], w: .35, g: /electronic|dance|house/i },
  { key: 'latin', label: 'Latin', q: ['latin alternative', 'musica mexicana'], w: .3, g: /latin|mexicana|tropical|samba/i },
  { key: 'french', label: 'Französisch', q: ['french pop', 'nouvelle chanson', 'rap francais'], w: .3, g: /french/i },
];
const STYLE_BY = Object.fromEntries(STYLES.map(s => [s.key, s]));

// „Ganz neu“: Nischen, Genres und Länder außerhalb des Profils.
const NICHES = [
  ['afrobeats', 'Afrobeats', 'afrobeats'], ['amapiano', 'Amapiano', 'amapiano'], ['highlife', 'Highlife', 'highlife'],
  ['citypop', 'City Pop', 'japanese city pop'], ['bossa', 'Bossa Nova', 'bossa nova'], ['mpb', 'MPB', 'musica popular brasileira'],
  ['tropicalia', 'Tropicália', 'tropicalia'], ['shoegaze', 'Shoegaze', 'shoegaze'], ['kraut', 'Krautrock', 'krautrock'],
  ['anatolian', 'Turkish Psych', 'anatolian psychedelic rock'], ['ethio', 'Ethio-Jazz', 'ethiopian jazz'], ['chicha', 'Chicha', 'chicha cumbia psicodelica'],
  ['desert', 'Desert Blues', 'tuareg desert blues'], ['zamrock', 'Zamrock', 'zamrock'], ['baile', 'Baile Funk', 'baile funk'],
  ['gqom', 'Gqom', 'gqom'], ['rai', 'Raï', 'rai algerien'], ['fado', 'Fado', 'fado'], ['kindie', 'K-Indie', 'korean indie'],
  ['thai', 'Thai Funk', 'thai funk'], ['bolly', 'Bollywood Retro', 'bollywood retro'], ['qawwali', 'Qawwali', 'qawwali'],
  ['balkan', 'Balkan Brass', 'balkan brass'], ['ukg', 'UK Garage', 'uk garage'], ['dnb', 'Liquid DnB', 'liquid drum and bass'],
  ['postpunk', 'Post-Punk', 'post punk'], ['triphop', 'Trip-Hop', 'trip hop'], ['ukjazz', 'London Jazz', 'uk jazz'],
  ['gnawa', 'Gnawa', 'gnawa'], ['italo', 'Italo Disco', 'italo disco'], ['ambient', 'Ambient', 'ambient'], ['math', 'Math Rock', 'math rock'],
  ['kayo', 'Kayōkyoku', 'kayokyoku showa'], ['afrohouse', 'Afro House', 'afro house'], ['cumbia', 'Cumbia', 'cumbia'],
  ['arabic', 'Arabic Indie', 'arabic indie'], ['nordic', 'Nordic Folk', 'nordic folk'], ['congo', 'Soukous', 'soukous rumba congolaise'],
  ['jjazz', 'Japan Jazz', 'japanese jazz fusion'], ['mandarin', 'Mandopop Indie', 'chinese indie'], ['cvb', 'Kapverden', 'cape verde morna'],
].map(([key, label, q]) => ({ key, label, q }));
const NICHE_BY = Object.fromEntries(NICHES.map(n => [n.key, n]));

const COUNTRIES = { de: ['🇩🇪', 'Deutschland'], us: ['🇺🇸', 'USA'], gb: ['🇬🇧', 'UK'], fr: ['🇫🇷', 'Frankreich'], br: ['🇧🇷', 'Brasilien'],
  jp: ['🇯🇵', 'Japan'], kr: ['🇰🇷', 'Südkorea'], mx: ['🇲🇽', 'Mexiko'], es: ['🇪🇸', 'Spanien'], it: ['🇮🇹', 'Italien'], ng: ['🇳🇬', 'Nigeria'],
  za: ['🇿🇦', 'Südafrika'], se: ['🇸🇪', 'Schweden'], nl: ['🇳🇱', 'Niederlande'], au: ['🇦🇺', 'Australien'], in: ['🇮🇳', 'Indien'], tr: ['🇹🇷', 'Türkei'] };
const DEFAULT_COUNTRIES = ['us', 'gb', 'fr', 'br', 'jp', 'kr', 'mx', 'ng', 'za', 'de'];

const WINDOW = 2;       // Karten ober-/unterhalb der aktuellen im DOM (→ max. 5)
const AHEAD = 6;        // nachladen, wenn weniger als so viele Songs vor einem liegen
const STALE_MS = 60e3;  // Deezer-Link so lange vor Ablauf erneuern

// ---------------------------------------------------------------- Zustand
let likes = LS.get('likes', null);
if (!likes) { // Übernahme aus Version 1
  try { likes = (JSON.parse(localStorage.getItem('kf_likes')) || []).map(s => ({ ...s, id: 'it:' + s.id, mode: 'chart' })); } catch { likes = []; }
  localStorage.removeItem('kf_likes'); localStorage.removeItem('kf_weights');
  LS.set('likes', likes);
}
let likedIds = new Set(likes.map(s => s.id));
let mix = { ...DEFAULT_MIX, ...LS.get('mix', {}) };
let filter = LS.get('filter', 'mix');
let myStyles = LS.get('styles', null);       // gewählte Richtungen (null = Standard)
let countries = LS.get('countries', DEFAULT_COUNTRIES);
let learned = { mw: {}, aw: {}, nw: {}, sw: {}, ...LS.get('learned', {}) }; // Modus-, Künstler-, Nischen-, Richtungsgewichte
let autonext = LS.get('autonext', true);
let profile = null, knownSet = new Set(), songSet = new Set();
let seenKeys = LS.get('seen', []);
const seenStore = new Set(seenKeys);          // dauerhaft gesehen (über Neustarts)
const seenSession = new Set();                // in dieser Sitzung schon im Vorrat
let dzIds = LS.get('dzid', {});

let songs = [];
let cur = 0, shown = -1;
const cards = new Map();
const feedEl = $('#feed'), trackEl = $('#track');
let H = feedEl.clientHeight || innerHeight;
const buckets = { dir: [], new: [], chart: [] };
const inflight = {};
let filling = null, feedGen = 0, lastErr = '';
let listen = null;
let savedPlaying = null;
let pendingReload = false;   // neue App-Version wartet, bis gerade nichts spielt

// ---------------------------------------------------------------- Hilfen
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.random() * a.length | 0];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s-\s.*$/, ' ').replace(/\b(feat|ft)\b.*$/, ' ').replace(/[^a-z0-9ß]+/g, ' ').trim();
const splitArtists = a => String(a || '').split(/\s*(?:,|&|\+|\/|\bfeat\.?|\bft\.?|\bx\b|\bwith\b|\bund\b|\band\b)\s*/i).map(norm).filter(Boolean);
const mainArtist = a => String(a || '').split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\sx\s|\bwith\b)\s*/i)[0].trim() || a;
const songKey = s => norm(mainArtist(s.artist)) + '|' + norm(s.title);
const spotifyUrl = s => 'https://open.spotify.com/search/' + encodeURIComponent(`${mainArtist(s.artist)} ${s.title}`);
const appleSearch = s => 'https://music.apple.com/de/search?term=' + encodeURIComponent(`${mainArtist(s.artist)} ${s.title}`);
// Direkter Song-Link statt Album-Link (…/album/x/123?i=456 öffnet in der Musik-App nur das Album)
const amSong = url => { const m = /[?&]i=(\d+)/.exec(url || '') || /\/song\/(?:[^/?]+\/)?(\d+)/.exec(url || ''); return m ? 'https://music.apple.com/de/song/' + m[1] : url; };
const amLink = s => s.url ? amSong(s.url) : appleSearch(s);
const itArt = (url, size) => url ? url.replace(/\/\d+x\d+bb(\.\w+)$/, `/${size}x${size}bb$1`) : '';
const dzArt = (md5, size) => md5 ? `https://cdn-images.dzcdn.net/images/cover/${md5}/${size}x${size}-000000-80-0-0.jpg` : '';
const dzExp = url => { const m = /exp=(\d{9,})/.exec(url || ''); return m ? m[1] * 1000 : 0; };

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), Math.min(4500, 1500 + Math.max(0, msg.length - 30) * 45));
}
// Leichtes Tipp-Feedback (iPhone: unsichtbarer System-Schalter ab iOS 17.4, Android: Vibration) – wie WikiFeed.
function haptic() {
  try {
    if (navigator.vibrate) { navigator.vibrate(8); return; }
    const label = document.createElement('label'); label.style.display = 'none';
    const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('switch', '');
    label.append(input); document.head.append(label); label.click(); label.remove();
  } catch {}
}

// ---------------------------------------------------------------- Netz
async function getJSON(url, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
let jpN = 0;
function jsonp(url, ms = 9000) {
  return new Promise((resolve, reject) => {
    const cb = '__kf' + (++jpN);
    const s = document.createElement('script');
    const done = () => { clearTimeout(timer); window[cb] = () => {}; setTimeout(() => { delete window[cb]; }, 30000); s.remove(); };
    const timer = setTimeout(() => { done(); reject(new Error('Zeitüberschreitung')); }, ms);
    window[cb] = d => { done(); resolve(d); };
    s.onerror = () => { done(); reject(new Error('Netzfehler')); };
    s.src = url + (url.includes('?') ? '&' : '?') + 'output=jsonp&callback=' + cb;
    document.head.appendChild(s);
  });
}
// Deezer: höchstens ~8 Anfragen pro Sekunde (Grenze sind 50 je 5 s)
let dzNext = 0;
async function dz(path) {
  const now = Date.now(), wait = Math.max(0, dzNext - now);
  dzNext = Math.max(now, dzNext) + 125;
  if (wait) await sleep(wait);
  const d = await jsonp('https://api.deezer.com' + path);
  if (d && d.error) throw new Error('Deezer: ' + (d.error.message || d.error.type));
  return d;
}
const itunes = url => getJSON(url).catch(e => { if (!navigator.onLine) throw e; return jsonp(url); });

// ---------------------------------------------------------------- Mediathek-Profil
function buildProfile(p) {
  profile = p; knownSet = new Set(); songSet = new Set();
  if (!p) return;
  for (const name of [...(p.known || []), ...(p.top || [])]) {
    knownSet.add(norm(name));
    for (const part of splitArtists(name)) knownSet.add(part);
  }
  for (const s of p.songs || []) {
    const i = s.indexOf('|'); if (i < 0) continue;
    const a = s.slice(0, i), t = norm(s.slice(i + 1));
    songSet.add(norm(mainArtist(a)) + '|' + t);
    for (const part of splitArtists(a)) songSet.add(part + '|' + t);
  }
}
buildProfile(LS.get('profile', null));
function validProfile(p) {
  return p && typeof p === 'object' && Array.isArray(p.known) && Array.isArray(p.top) && (p.genres == null || typeof p.genres === 'object');
}
function importProfileText(text) {
  let p;
  try { p = JSON.parse(text); } catch { toast('Die Datei ist kein gültiges JSON.'); return false; }
  if (!validProfile(p)) { toast('Das sieht nicht nach geschmack.json aus.'); return false; }
  const clean = {
    v: 1, at: Date.now(),
    genres: Object.fromEntries(Object.entries(p.genres || {}).filter(([k, v]) => typeof v === 'number').slice(0, 80)),
    top: p.top.filter(x => typeof x === 'string').slice(0, 200),
    known: p.known.filter(x => typeof x === 'string').slice(0, 5000),
    songs: (p.songs || []).filter(x => typeof x === 'string').slice(0, 20000),
  };
  LS.set('profile', clean);
  buildProfile(clean);
  purgeKnown();
  renderProfileState();
  toast(`Mediathek importiert: ${clean.known.length} Künstler, ${clean.songs.length} Songs`);
  return true;
}
function deleteProfile() {
  LS.del('profile'); buildProfile(null); renderProfileState();
  buckets.dir.length = 0;
  toast('Profil gelöscht');
}
// Was jetzt als bekannt gilt, aus Vorrat und den noch nicht gezeigten Karten entfernen
function purgeKnown() {
  for (const m of ['dir', 'new']) buckets[m] = buckets[m].filter(s => !knownArtist(s) && !inLibrary(s));
  buckets.chart = buckets.chart.filter(s => !inLibrary(s));
  const keep = songs.slice(0, cur + 2);
  const rest = songs.slice(cur + 2).filter(s => !inLibrary(s) && (s.mode === 'chart' || !knownArtist(s)));
  if (rest.length !== songs.length - keep.length) { songs = keep.concat(rest); resetCards(cur + 2); layout(); }
}
const inLibrary = s => songSet.size > 0 && (songSet.has(songKey(s)) || splitArtists(s.artist).some(a => songSet.has(a + '|' + norm(s.title))));
const knownArtist = s => knownSet.size > 0 && splitArtists(s.artist).some(a => knownSet.has(a));
const knownName = n => knownSet.has(norm(n));

// ---------------------------------------------------------------- Lernen
const lw = (tbl, k) => learned[tbl][k] ?? 1;
let learnTimer;
function nudge(tbl, k, f, lo = .2, hi = 4) {
  if (!k) return;
  learned[tbl][k] = +clamp(lw(tbl, k) * f, lo, hi).toFixed(3);
  clearTimeout(learnTimer); learnTimer = setTimeout(() => LS.set('learned', learned), 400);
}
// d > 0 mag, d < 0 mag nicht. Wirkt auf Modus, Künstler, Ausgangskünstler, Nische/Richtung.
function learn(s, d) {
  if (!s) return;
  nudge('mw', s.mode, 1 + .03 * d, .5, 2);
  nudge('aw', norm(mainArtist(s.artist)), 1 + .14 * d, .1, 5);
  if (s.seed) nudge('aw', norm(s.seed), 1 + .05 * d, .3, 5);
  if (s.niche) nudge('nw', s.niche, 1 + .12 * d);
  if (s.style) nudge('sw', s.style, 1 + .1 * d);
}
const blocked = s => lw('aw', norm(mainArtist(s.artist))) < .3;

// ---------------------------------------------------------------- Songs aus den Quellen
function fromDz(t, extra) {
  const md5 = t.md5_image || t.album?.md5_image;
  return {
    id: 'dz:' + t.id, dz: t.id, title: t.title_short || t.title || '', artist: t.artist?.name || '',
    art: md5 ? dzArt(md5, 600) : (t.album?.cover_big || ''), artS: md5 ? dzArt(md5, 120) : (t.album?.cover_medium || ''),
    preview: t.preview || '', exp: dzExp(t.preview), url: '', dzUrl: t.link || '', rank: t.rank || 0, ...extra,
  };
}
function fromItunes(r, extra) {
  return {
    id: 'it:' + r.trackId, title: r.trackName || '', artist: r.artistName || '',
    art: itArt(r.artworkUrl100, 600), artS: itArt(r.artworkUrl100, 120), preview: r.previewUrl || '', url: r.trackViewUrl || '',
    genre: r.primaryGenreName || '', year: (r.releaseDate || '').slice(0, 4), ...extra,
  };
}
function fromRss(e, c) {
  const enc = [].concat(e.link || []).find(l => l.attributes?.rel === 'enclosure');
  const imgs = [].concat(e['im:image'] || []);
  const img = imgs.length ? imgs[imgs.length - 1].label : '';
  return {
    id: 'it:' + (e.id?.attributes?.['im:id'] || e.id?.label), title: e['im:name']?.label || '', artist: e['im:artist']?.label || '',
    art: itArt(img, 600), artS: itArt(img, 120), preview: enc?.attributes?.href || '', url: e.id?.label || '',
    genre: e.category?.attributes?.label || '', year: (e['im:releaseDate']?.label || '').slice(0, 4),
    mode: 'chart', country: c, why: `Charts ${COUNTRIES[c]?.[0] || ''} ${COUNTRIES[c]?.[1] || c.toUpperCase()}`,
  };
}
// Taugt der Song für den Feed? (Vorschau da, nicht doppelt, nicht in der Mediathek, Künstler nicht abgewählt)
function fresh(s, allowKnown = false) {
  if (!s || !s.preview || !s.title || !s.artist) return false;
  const k = songKey(s);
  if (seenSession.has(s.id) || seenSession.has(k) || seenStore.has(k) || likedIds.has(s.id)) return false;
  if (inLibrary(s) || blocked(s)) return false;
  if (!allowKnown && knownArtist(s)) return false;
  return true;
}
function take(list, max, perArtist = 1) {
  const out = [], per = {};
  for (const s of list) {
    if (out.length >= max) break;
    const a = norm(mainArtist(s.artist));
    if ((per[a] || 0) >= perArtist) continue;
    per[a] = (per[a] || 0) + 1;
    seenSession.add(s.id); seenSession.add(songKey(s));
    out.push(s);
  }
  return out;
}

// Große Hits (hoher Deezer-Rang) nach hinten, solange genug Unbekannteres da ist
function preferSmall(list, max) {
  const small = list.filter(s => !s.rank || s.rank < max);
  return small.length >= 3 ? small.concat(list.filter(s => s.rank >= max)) : list;
}
// Gewichtete Auswahl aus [[wert, gewicht], …]
function weighted(pairs) {
  const tot = pairs.reduce((a, p) => a + Math.max(0, p[1]), 0);
  if (!tot) return pairs.length ? pairs[0][0] : null;
  let r = Math.random() * tot;
  for (const [v, w] of pairs) { r -= Math.max(0, w); if (r <= 0) return v; }
  return pairs[pairs.length - 1][0];
}

// Ausgangskünstler für „In meiner Richtung“: Mediathek-Lieblinge, Gemerktes, gut Gelerntes
const recentSeeds = [];
function seedPairs() {
  const m = new Map();
  const add = (name, w) => { const k = norm(name); if (!k) return; const e = m.get(k); if (e) e[1] += w; else m.set(k, [name, w]); };
  (profile?.top || []).forEach((n, i) => add(n, 3 * (1 - i / 90)));
  likes.slice(0, 60).forEach(s => add(mainArtist(s.artist), 2.5));
  for (const [k, w] of Object.entries(learned.aw)) if (w >= 1.6 && m.has(k)) m.get(k)[1] *= 1.3;
  for (const s of likes) { const k = norm(mainArtist(s.artist)); if (learned.aw[k] >= 1.6) add(mainArtist(s.artist), 1); }
  return [...m.entries()].filter(([k]) => lw('aw', k) >= .3 && !recentSeeds.includes(k)).map(([k, [n, w]]) => [n, w * clamp(lw('aw', k), .3, 3)]);
}
async function dzArtistId(name) {
  const k = norm(name);
  if (k in dzIds) return dzIds[k];
  const d = await dz('/search/artist?q=' + encodeURIComponent(name) + '&limit=8');
  const list = d.data || [];
  const exact = list.filter(a => norm(a.name) === k).sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0));
  const id = (exact[0] || list[0])?.id || 0; // gleichnamige Künstler: der bekannteste (meiste Fans) ist gemeint
  dzIds[k] = id;
  const keys = Object.keys(dzIds); if (keys.length > 600) delete dzIds[keys[0]];
  LS.set('dzid', dzIds);
  return id;
}
function stylePairs() {
  const sel = myStyles || STYLES.map(s => s.key);
  const g = profile?.genres || null;
  return sel.filter(k => STYLE_BY[k]).map(k => {
    const st = STYLE_BY[k];
    let w = st.w;
    if (g) { w = .15; for (const [name, v] of Object.entries(g)) if (st.g.test(name)) w += v * 10; }
    return [st, w * lw('sw', k)];
  });
}
const plCache = {};
async function playlistTracks(q) {
  let pls = plCache[q];
  if (!pls) {
    const d = await dz('/search/playlist?q=' + encodeURIComponent(q) + '&limit=15');
    pls = plCache[q] = shuffle((d.data || []).filter(p => (p.nb_tracks || 0) >= 12).slice(0, 10));
  }
  const p = pls.shift();
  if (!p) { delete plCache[q]; return []; }
  const d = await dz(`/playlist/${p.id}/tracks?limit=100`);
  return d.data || [];
}

async function refillStyle() {
  const st = weighted(stylePairs()) || STYLES[0];
  const tracks = await playlistTracks(pick(st.q));
  const list = shuffle(tracks.map(t => fromDz(t, { mode: 'dir', style: st.key, why: `Passt zu dir: ${st.label}` }))).filter(s => fresh(s));
  return take(list, 5);
}
async function refillDir() {
  const seeds = seedPairs();
  if (!seeds.length || Math.random() < (profile ? .1 : .2)) return refillStyle();
  const seed = weighted(seeds);
  recentSeeds.push(norm(seed)); if (recentSeeds.length > Math.min(8, seeds.length - 1)) recentSeeds.shift();
  const id = await dzArtistId(seed);
  if (!id) return refillStyle();
  const sk = norm(seed);
  const notSeed = s => !splitArtists(s.artist).includes(sk);
  if (Math.random() < .45) {
    // Radio des Lieblings: Songs ähnlicher Künstler in einem Rutsch
    const d = await dz(`/artist/${id}/radio?limit=50`);
    const list = preferSmall(shuffle((d.data || []).map(t => fromDz(t, { mode: 'dir', seed, why: `Weil du ${seed} magst` }))).filter(s => notSeed(s) && fresh(s)), 750000);
    const got = take(list, 4);
    if (got.length) return got;
  }
  // Verwandte Künstler – manchmal einen Schritt weiter (verwandte von verwandten), für mehr Tiefe
  const rel = (await dz(`/artist/${id}/related?limit=40`)).data || [];
  let pool = rel, why = `Weil du ${seed} magst`;
  if (rel.length && Math.random() < .3) {
    const via = pick(rel.slice(0, 10));
    const rel2 = (await dz(`/artist/${via.id}/related?limit=30`)).data || [];
    if (rel2.length) { pool = rel2; why = `Über ${via.name} · weil du ${seed} magst`; }
  }
  // Unbekannte bevorzugen: Künstler mit sehr vielen Fans nur, wenn sonst nichts übrig ist
  let cands = pool.filter(a => !knownName(a.name) && norm(a.name) !== sk && lw('aw', norm(a.name)) >= .3).slice(0, 30);
  const smallA = cands.filter(a => (a.nb_fan || 0) < 1.5e6);
  if (smallA.length >= 2) cands = smallA;
  const unknown = shuffle(cands).slice(0, 2);
  const out = [];
  for (const a of unknown) {
    const tops = (await dz(`/artist/${a.id}/top?limit=8`)).data || [];
    const list = shuffle(tops.slice(0, 6).map(t => fromDz(t, { mode: 'dir', seed, why }))).filter(s => fresh(s));
    out.push(...take(list, 2, 2));
  }
  return out;
}
const recentNiches = [];
async function refillNew() {
  const pairs = NICHES.filter(n => !recentNiches.includes(n.key)).map(n => [n, lw('nw', n.key)]);
  const n = weighted(pairs) || pick(NICHES);
  recentNiches.push(n.key); if (recentNiches.length > 6) recentNiches.shift();
  const why = `Ganz neu: ${n.label}`;
  let list = [];
  try {
    const tracks = await playlistTracks(n.q);
    list = shuffle(tracks.map(t => fromDz(t, { mode: 'new', niche: n.key, why }))).filter(s => fresh(s));
    list = preferSmall(list, 600000); // Unbekanntere bevorzugen: große Hits nach hinten
  } catch (e) { console.warn('Deezer-Nische', n.key, e); }
  if (list.length < 3) {
    const c = pick(['us', 'gb', 'br', 'jp', 'fr', 'de']);
    const d = await itunes(`https://itunes.apple.com/search?term=${encodeURIComponent(n.q)}&media=music&entity=song&limit=40&country=${c}`);
    list = list.concat(shuffle((d.results || []).map(r => fromItunes(r, { mode: 'new', niche: n.key, why }))).filter(s => fresh(s)));
  }
  return take(list, 5);
}
let chartQueue = [];
async function refillChart() {
  if (!chartQueue.length) chartQueue = shuffle((countries.length ? countries : DEFAULT_COUNTRIES).slice());
  const c = chartQueue.shift();
  const d = await itunes(`https://itunes.apple.com/${c}/rss/topsongs/limit=100/json`);
  const list = shuffle([].concat(d?.feed?.entry || []).map(e => fromRss(e, c))).filter(s => fresh(s, true));
  return take(list, 8);
}
const REFILL = { dir: refillDir, new: refillNew, chart: refillChart };
function refill(m) {
  if (inflight[m]) return inflight[m];
  const p = (async () => {
    for (let tries = 0; tries < 3; tries++) {
      try {
        const got = await REFILL[m]();
        if (got.length) { buckets[m].push(...got); lastErr = ''; return got.length; }
      } catch (e) { lastErr = e.message; console.warn('Quelle', m, e); if (!navigator.onLine) break; }
    }
    return 0;
  })().finally(() => { delete inflight[m]; });
  inflight[m] = p;
  return p;
}

// ---------------------------------------------------------------- Feed füllen
function chooseMode() {
  if (filter !== 'mix') return filter;
  return weighted(Object.keys(MODES).map(m => [m, (mix[m] || 0) * lw('mw', m)])) || 'dir';
}
// Nächsten Song aus einem Vorrat: Künstler nicht kurz hintereinander, Gründe abwechseln
function pull(m) {
  const b = buckets[m];
  if (!b.length) return null;
  const recentA = songs.slice(-6).map(s => norm(mainArtist(s.artist)));
  const last = songs[songs.length - 1];
  let idx = b.findIndex((s, i) => i < 8 && !recentA.includes(norm(mainArtist(s.artist))) && (!last || s.why !== last.why));
  if (idx < 0) idx = b.findIndex((s, i) => i < 8 && !recentA.includes(norm(mainArtist(s.artist))));
  if (idx < 0) idx = 0;
  return b.splice(idx, 1)[0];
}
function fill(n = 8) {
  if (filling) return filling;
  const gen = feedGen;
  const p = (async () => {
    let added = 0, fails = 0;
    while (added < n && fails < 6 && gen === feedGen) {
      let m = chooseMode();
      if (!buckets[m].length) {
        // Beim Start nicht warten, wenn eine andere Art schon bereit ist
        const ready = filter === 'mix' && songs.length - cur < 2 && Object.keys(buckets).find(k => buckets[k].length && mix[k] > 0);
        if (ready) { refill(m); m = ready; }
        else {
          const got = await refill(m);
          if (gen !== feedGen) break;
          if (!got) { fails++; if (!navigator.onLine) break; continue; }
        }
      }
      if (buckets[m].length < 3) refill(m);
      const s = pull(m);
      if (!s) { fails++; continue; }
      songs.push(s);
      added++;
      if (songs.length - cur <= 2) layout(); // erste Karte sofort zeigen
    }
    if (gen === feedGen) layout();
    return added;
  })().finally(() => { if (filling === p) filling = null; updateState(); });
  filling = p;
  updateState();
  return p;
}

// ---------------------------------------------------------------- Karten (Fenster mit max. 5 im DOM)
const IC = {
  heart: '<path d="M12 20.3s-7.4-4.5-9.2-9.1C1.5 7.9 3.5 4.6 7 4.6c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.5 0 5.5 3.3 4.2 6.6-1.8 4.6-9.2 9.1-9.2 9.1z"/>',
  more: '<path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z"/><path d="M18.5 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/>',
  less: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12h7"/>',
  share: '<path d="M12 3.5v11M7.5 8L12 3.5 16.5 8"/><path d="M5.5 12.5v6a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-6"/>',
  play: '<path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l12-7.2a1 1 0 0 0 0-1.72l-12-7.2A1 1 0 0 0 7 4.8z"/>',
  pause: '<rect x="6" y="4.5" width="4.2" height="15" rx="1.2"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  apple: '<path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.5-1-2.5-3.9zM14 5.4c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z"/>',
  spotify: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.6 14.4a.6.6 0 0 1-.9.2c-2.4-1.5-5.4-1.8-8.9-1a.6.6 0 1 1-.3-1.2c3.9-.9 7.2-.5 9.9 1.1.3.2.4.6.2.9zm1.2-2.7a.8.8 0 0 1-1.1.3c-2.7-1.7-6.9-2.2-10.1-1.2a.8.8 0 1 1-.5-1.5c3.7-1.1 8.3-.6 11.4 1.3.4.2.5.7.3 1.1zm.1-2.8C14.7 9 9.4 8.8 6.3 9.7a1 1 0 1 1-.5-1.8c3.5-1.1 9.4-.9 13.1 1.3a1 1 0 0 1-1 1.7z"/>',
};
const svg = (name, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${IC[name]}</svg>`;

function makeCard(i) {
  const s = songs[i];
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.i = i;
  el.dataset.m = s.mode || '';
  el.style.top = (i * H) + 'px';
  el.style.height = H + 'px';
  const liked = likedIds.has(s.id);
  const sub = [s.year, s.genre].filter(Boolean).join(' · ');
  el.innerHTML = `
    <div class="card-bg"></div>
    <div class="stage">
      <div class="cover-box"><img class="cover" alt="" decoding="async" crossorigin="anonymous"><b class="letter">${esc((s.artist || '?').trim()[0] || '?')}</b>
        <div class="pp">${svg('play')}</div><div class="hint">Tippen zum Abspielen</div></div>
      <div class="side">
        <button class="sb like ${liked ? 'on' : ''}" data-a="like" aria-label="Merken"><span class="sb-i">${svg('heart')}</span><small>Merken</small></button>
        <button class="sb more" data-a="more" aria-label="Mehr davon"><span class="sb-i">${svg('more')}</span><small>Mehr</small></button>
        <button class="sb less" data-a="less" aria-label="Weniger davon"><span class="sb-i">${svg('less')}</span><small>Weniger</small></button>
        <button class="sb share" data-a="share" aria-label="Teilen"><span class="sb-i">${svg('share')}</span><small>Teilen</small></button>
      </div>
    </div>
    <div class="card-body">
      <p class="why"><span>${esc(s.why || '')}</span><b class="eq"><i></i><i></i><i></i></b></p>
      <h2 class="title">${esc(s.title)}</h2>
      <p class="artist">${esc(s.artist)}${sub ? ` <small>· ${esc(sub)}</small>` : ''}</p>
      <div class="links">
        <a class="lnk am" data-a="link" href="${esc(amLink(s))}" target="_blank" rel="noopener">${svg('apple')}<span>Apple Music</span></a>
        <a class="lnk sp" data-a="link" href="${esc(spotifyUrl(s))}" target="_blank" rel="noopener">${svg('spotify')}<span>Spotify</span></a>
      </div>
      <div class="progress" data-a="seek"><i></i></div>
    </div>`;
  const box = el.querySelector('.cover-box'), img = el.querySelector('.cover');
  img.onload = () => img.classList.add('ready');
  img.onerror = () => {
    if (img.dataset.alt !== '1' && s.artS && img.src !== s.artS) { img.dataset.alt = '1'; img.src = s.artS; }
    else box.classList.add('ph');
  };
  if (s.art) img.src = s.art; else box.classList.add('ph');
  applyPalette(el, s);
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
    let el = cards.get(i);
    if (!el) { el = makeCard(i); cards.set(i, el); trackEl.appendChild(el); }
    el.classList.toggle('near', Math.abs(i - center) <= 1);
    el.classList.toggle('active', i === center);
  }
  shown = center;
  // Deezer-Links der nächsten Songs rechtzeitig erneuern
  for (let i = center; i <= Math.min(songs.length - 1, center + 2); i++) if (isStale(songs[i])) refreshDz(songs[i]).catch(() => {});
}
function layout() {
  H = feedEl.clientHeight || innerHeight;
  trackEl.style.height = ((songs.length + 1) * H) + 'px';
  for (const [i, el] of cards) { el.style.top = (i * H) + 'px'; el.style.height = H + 'px'; }
  renderWindow(Math.min(cur, Math.max(0, songs.length - 1)));
  updateState();
  if (songs.length && !listen && !savedPlaying) activate(cur);
}
function resetCards(from = 0) { for (const [i, el] of cards) if (i >= from) { disposeCard(el); cards.delete(i); } }

// Lade- bzw. Fehlerkarte hinter dem letzten Song: nie eine leere Fläche
const stateEl = document.createElement('div');
stateEl.className = 'state';
trackEl.appendChild(stateEl);
function updateState() {
  stateEl.style.top = (songs.length * H) + 'px';
  stateEl.style.height = H + 'px';
  const off = !navigator.onLine;
  const html = filling || (!off && !lastErr)
    ? '<div><div class="spinner"></div><p>Suche neue Songs …</p></div>'
    : `<div><p>${off ? 'Keine Internetverbindung.<br>Klangfeed lädt weiter, sobald du wieder online bist.' : 'Gerade kommen keine Songs an.'}</p><button class="btn" type="button" data-a="retry">Erneut versuchen</button></div>`;
  if (stateEl.dataset.h !== html) { stateEl.innerHTML = html; stateEl.dataset.h = html; }
}
stateEl.addEventListener('click', e => { if (e.target.closest('[data-a="retry"]')) { lastErr = ''; fill(8); } });
addEventListener('online', () => { lastErr = ''; if (songs.length - cur < AHEAD) fill(8); toast('Wieder online'); });
addEventListener('offline', () => { updateState(); toast('Offline – Vorschauen brauchen Internet'); });

// Farb-Nebel aus dem Cover (winziges 4×4-Bild auswerten), sonst aus dem Künstlernamen
const pcv = document.createElement('canvas'); pcv.width = pcv.height = 4;
const pctx = pcv.getContext('2d', { willReadFrequently: true });
function setPal(el, p) { ['--c1', '--c2', '--c3', '--c4', '--glow'].forEach((v, k) => el.style.setProperty(v, p[k])); }
function hashPal(name) {
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = h % 360;
  return [`hsl(${a} 55% 28%)`, `hsl(${(a + 40) % 360} 50% 26%)`, `hsl(${(a + 200) % 360} 45% 22%)`, `hsl(${(a + 320) % 360} 45% 24%)`, `hsl(${a} 85% 76%)`];
}
function applyPalette(el, s) {
  if (s.pal) return setPal(el, s.pal);
  setPal(el, hashPal(s.artist));
  if (!s.artS) return;
  const im = new Image();
  im.crossOrigin = 'anonymous';
  im.onload = () => {
    try {
      pctx.drawImage(im, 0, 0, 4, 4);
      const d = pctx.getImageData(0, 0, 4, 4).data;
      const at = (x, y) => { const i = (y * 4 + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
      const avg = pts => pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]);
      const q = [avg([at(0, 0), at(1, 0), at(0, 1), at(1, 1)]), avg([at(2, 0), at(3, 0), at(2, 1), at(3, 1)]),
        avg([at(0, 2), at(1, 2), at(0, 3), at(1, 3)]), avg([at(2, 2), at(3, 2), at(2, 3), at(3, 3)])];
      let best = null;
      const cols = q.map(([r, g, b]) => {
        let [hh, ss, ll] = rgbToHsl(r, g, b);
        if (ss < .1) { hh = 230; ss = .16; } else { if (!best || ss > best[1]) best = [hh, ss]; ss = clamp(ss * 1.4, .38, .85); }
        return `hsl(${hh | 0} ${(ss * 100) | 0}% ${(clamp(ll * .8, .17, .38) * 100) | 0}%)`;
      });
      s.pal = [...cols, best ? `hsl(${best[0] | 0} 90% 76%)` : 'hsl(224 75% 80%)'];
      if (el.isConnected) setPal(el, s.pal);
    } catch { /* ohne CORS: Namensfarben bleiben */ }
    im.onload = null; im.src = '';
  };
  im.src = s.artS;
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

// ---------------------------------------------------------------- Scrollen
let scrollRaf = 0, settleTimer = 0;
feedEl.addEventListener('scroll', () => {
  if (!scrollRaf) scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    const idx = clamp(Math.round(feedEl.scrollTop / H), 0, Math.max(0, songs.length - 1));
    if (idx !== shown) renderWindow(idx);
  });
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settle, 160);
}, { passive: true });
if ('onscrollend' in window) feedEl.addEventListener('scrollend', () => { clearTimeout(settleTimer); settle(); });
function settle() {
  if (!songs.length) return;
  const idx = clamp(Math.round(feedEl.scrollTop / H), 0, songs.length - 1);
  if (idx !== cur || !listen) activate(idx);
}
function goTo(i, smooth = true) {
  i = clamp(i, 0, songs.length); // songs.length = Ladekarte
  feedEl.scrollTo({ top: i * H, behavior: smooth ? 'smooth' : 'auto' });
}

// ---------------------------------------------------------------- Wiedergabe
// EIN Audio-Element für alles: iOS gibt nur das Element frei, das per Tipp gestartet wurde.
// (Zwei Elemente im Wechsel → das zweite blieb auf dem iPhone stumm und jeder Song wurde übersprungen.)
const players = [new Audio()];
for (const a of players) { a.preload = 'auto'; a.setAttribute('playsinline', ''); }
const pa = players[0];
let unlocked = false, gestureUnlocked = false, wantPlay = false, watchdog = 0, appleTimer = 0;

const isStale = s => s && s.dz && s.exp && Date.now() > s.exp - STALE_MS;
async function refreshDz(s) {
  if (s._refreshing) return s._refreshing;
  s._refreshing = dz('/track/' + s.dz).then(t => {
    if (t && t.preview) { s.preview = t.preview; s.exp = dzExp(t.preview); }
    if (t?.release_date && !s.year) s.year = t.release_date.slice(0, 4);
    const li = likes.find(x => x.id === s.id); if (li) { li.preview = s.preview; li.exp = s.exp; LS.set('likes', likes); }
    return s;
  }).finally(() => { s._refreshing = null; });
  return s._refreshing;
}
function loadInto(a, s) {
  if (a.dataset.id === s.id && a.dataset.src === s.preview) return;
  a.dataset.id = s.id; a.dataset.src = s.preview;
  a.src = s.preview;
}
function cardOf(s) { for (const [i, el] of cards) if (songs[i] === s) return el; return null; }
function setCardState(s, st) {
  const el = cardOf(s); if (!el) return;
  el.classList.toggle('loading', st === 'loading');
  el.classList.toggle('paused', st === 'paused');
  el.classList.toggle('playing', st === 'playing');
  el.classList.toggle('locked', st === 'locked');
}
function nowSong() { return savedPlaying || songs[cur]; }

function play(s) {
  if (!s) return;
  wantPlay = true;
  // Deezer-Song: erst die Apple-Vorschau holen (meist schon vorab erledigt). Nicht während der
  // Freigabe-Geste warten, sonst verweigert iOS das Abspielen.
  if (s.dz && !s.apl && !s.aplTried && !gestureUnlocked) {
    s.aplTried = true;
    if (pa.dataset.id !== s.id) pa.pause();
    setCardState(s, 'loading');
    useApplePreview(s).then(() => { if (nowSong() === s && wantPlay) play(s); });
    return;
  }
  if (isStale(s)) { setCardState(s, 'loading'); refreshDz(s).then(() => { if (nowSong() === s && wantPlay) play2(s); }, () => play2(s)); return; }
  play2(s);
}
function play2(s) {
  loadInto(pa, s);
  if (pa.ended || pa.currentTime > 0 && pa.dataset.id !== s.id) pa.currentTime = 0;
  if (pa.paused || pa.readyState < 3) setCardState(s, 'loading');
  clearTimeout(watchdog);
  watchdog = setTimeout(() => { if (nowSong() === s && pa.paused && wantPlay) failed(s, 'stall'); }, 10000);
  const p = pa.play();
  if (p) p.then(() => { unlocked = true; }).catch(err => {
    if (err.name === 'NotAllowedError') { unlocked = false; wantPlay = false; setCardState(s, 'locked'); clearTimeout(watchdog); }
    else if (err.name !== 'AbortError') console.warn(err);
  });
  setMediaSession(s);
}
function pause() { wantPlay = false; pa.pause(); clearTimeout(watchdog); }
function preloadNext() {
  const n = songs[cur + 1];
  if (!n || savedPlaying) return;
  useApplePreview(n, 8000);   // nur die Apple-Vorschau vorab heraussuchen – kein zweites Audio-Element
}
async function failed(s, why) {
  clearTimeout(watchdog);
  // Deezer-Vorschau kaputt (403/abgelaufen) → Apple-Vorschau versuchen, bevor übersprungen wird
  if (s.dz && !s.apl) { await useApplePreview(s, 5000); if (s.apl && s.exp === 0 && nowSong() === s) { pa.dataset.id = ''; return play2(s); } }
  if (s.dz && !s._retried) { s._retried = true; try { await refreshDz(s); if (nowSong() === s) { pa.dataset.id = ''; return play2(s); } } catch {} }
  if (nowSong() !== s) return;
  if (savedPlaying) { toast('Vorschau nicht verfügbar'); setSavedPlaying(null); return; }
  toast(navigator.onLine ? 'Vorschau lädt nicht – nächster Song' : 'Offline – Vorschau lädt nicht');
  setCardState(s, 'paused');
  if (navigator.onLine) setTimeout(() => { if (songs[cur] === s) goTo(cur + 1); }, 700);
}
for (const a of players) {
  a.addEventListener('timeupdate', () => {
    if (a !== pa) return;
    const s = nowSong(); if (!s || a.dataset.id !== s.id) return;
    if (listen && listen.song === s) listen.maxT = Math.max(listen.maxT, a.currentTime);
    const f = Math.min(1, a.currentTime / (a.duration || 30));
    if (savedPlaying) { const b = document.querySelector('#saved-list li.playing .prog i'); if (b) b.style.transform = `scaleX(${f})`; return; }
    const el = cardOf(s); if (el) el.querySelector('.progress i').style.transform = `scaleX(${f})`;
  });
  a.addEventListener('playing', () => {
    if (a !== pa) return;
    clearTimeout(watchdog);
    const s = nowSong(); if (s) setCardState(s, 'playing');
    if (!savedPlaying) setTimeout(preloadNext, 600);
    navigator.mediaSession && (navigator.mediaSession.playbackState = 'playing');
  });
  a.addEventListener('waiting', () => { if (a === pa && nowSong()) setCardState(nowSong(), 'loading'); });
  a.addEventListener('pause', () => {
    if (a !== pa || a.ended) return;
    const s = nowSong(); if (s && !wantPlay) setCardState(s, unlocked ? 'paused' : 'locked');
    navigator.mediaSession && (navigator.mediaSession.playbackState = 'paused');
    if (pendingReload && document.visibilityState === 'hidden') location.reload();
  });
  a.addEventListener('ended', () => {
    if (a !== pa) return;
    if (savedPlaying) { const i = likes.findIndex(x => x.id === savedPlaying.id); const n = autonext && likes[i + 1]; setSavedPlaying(n || null); return; }
    if (autonext) goTo(cur + 1);
    else { wantPlay = false; setCardState(songs[cur], 'paused'); }
  });
  a.addEventListener('error', () => {
    if (a !== pa || !a.getAttribute('src')) return;
    const s = nowSong(); if (s && a.dataset.id === s.id) failed(s, 'error');
  });
}
function togglePlay() {
  const s = nowSong(); if (!s) return;
  if (!pa.paused && pa.dataset.id === s.id) { pause(); setCardState(s, 'paused'); }
  else play(s);
}

function setMediaSession(s) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: s.artist, album: s.why || 'Klangfeed', artwork: [{ src: s.art, sizes: '600x600', type: 'image/jpeg' }] });
  } catch {}
}
if ('mediaSession' in navigator) {
  const h = (k, f) => { try { navigator.mediaSession.setActionHandler(k, f); } catch {} };
  h('play', () => play(nowSong()));
  h('pause', () => { pause(); const s = nowSong(); if (s) setCardState(s, 'paused'); });
  h('nexttrack', () => savedPlaying ? audioNextSaved(1) : goTo(cur + 1));
  h('previoustrack', () => savedPlaying ? audioNextSaved(-1) : goTo(cur - 1));
}

function finishListen() {
  if (!listen || !unlocked) { listen = null; return; }
  const { song, maxT } = listen;
  if (maxT >= 20) learn(song, 1);
  else if (maxT > 0 && maxT < 4) learn(song, -.6);
  listen = null;
}
function activate(i) {
  const s = songs[i];
  if (!s) return;
  if (i !== cur || !listen || listen.song !== s) finishListen();
  cur = i;
  renderWindow(i);
  for (const [k, el] of cards) if (k !== i) { el.classList.remove('playing', 'loading', 'locked', 'paused'); el.querySelector('.progress i').style.transform = 'scaleX(0)'; }
  listen = { song: s, maxT: 0 };
  markSeen(s);
  if (savedPlaying) { /* Gemerkt-Liste spielt gerade */ }
  else if (unlocked) play(s);
  else setCardState(s, 'locked');
  if (songs.length - i < AHEAD) fill(8);
  clearTimeout(appleTimer);
  if (!s.url) appleTimer = setTimeout(() => resolveApple(s), 1500);
  saveSnapSoon();
}
function markSeen(s) {
  const k = songKey(s);
  if (seenStore.has(k)) return;
  seenStore.add(k); seenKeys.push(k);
  if (seenKeys.length > 4000) seenKeys = seenKeys.slice(-3000);
  clearTimeout(markSeen.t); markSeen.t = setTimeout(() => LS.set('seen', seenKeys), 1500);
}
// Für Deezer-Songs den passenden Apple-Music-Link suchen (nur für die Karte, die gerade vorn bleibt)
const appleCache = {};
// Apple-Treffer zu einem Song (Link + stabile Apple-Vorschau). Ein Aufruf pro Song, gecacht.
const applePending = {};
function appleMatch(s) {
  const k = songKey(s);
  if (k in appleCache) return Promise.resolve(appleCache[k]);
  const sq = x => norm(x).replace(/[^a-z0-9]/g, '');
  const key = x => sq(x) || norm(x).replace(/\s+/g, '');
  const A = key(mainArtist(s.artist)), T = key(s.title).slice(0, 10);
  const find = country => itunes(`https://itunes.apple.com/search?term=${encodeURIComponent(mainArtist(s.artist) + ' ' + s.title)}&media=music&entity=song&limit=15&country=${country}`)
    .then(d => A && T && (d.results || []).find(r => r.previewUrl && key(r.artistName).includes(A) && key(r.trackName).startsWith(T)) || null);
  // Erst deutscher Store, sonst US-Store (Vorschauen von dort spielen auch hier)
  return applePending[k] ||= find('de').then(h => h || find('us'))
    .then(hit => appleCache[k] = hit ? { url: hit.trackViewUrl, year: (hit.releaseDate || '').slice(0, 4), preview: hit.previewUrl } : null, () => null)
    .finally(() => { delete applePending[k]; });
}
// Deezer-Vorschauen sind an die IP gebunden und laufen nach ~15 min ab (iPhone: Privat-Relay,
// WLAN↔Mobilfunk → 403 → Song wird übersprungen). Darum für Deezer-Songs die Apple-Vorschau nehmen.
async function useApplePreview(s, waitMs = 2500) {
  if (!s || !s.dz || s.apl) return s;
  const h = await Promise.race([appleMatch(s), new Promise(r => setTimeout(() => r(undefined), waitMs))]);
  if (h === undefined) return s;            // zu langsam – diesmal Deezer, Treffer landet trotzdem im Cache
  s.apl = true;
  if (h) {
    if (h.preview) { s.preview = h.preview; s.exp = 0; }
    if (!s.url && h.url) { s.url = h.url; const el = cardOf(s); if (el) el.querySelector('.lnk.am').href = amLink(s); }
    if (!s.year && h.year) s.year = h.year;
  }
  return s;
}
async function resolveApple(s) {
  if (s.url || songs[cur] !== s) return;
  const h = await appleMatch(s);
  if (!h || s.url) return;
  s.url = h.url;
  const el = cardOf(s); if (el) el.querySelector('.lnk.am').href = amLink(s);
}

// ---------------------------------------------------------------- Freigabe fürs Abspielen (iOS braucht eine Geste)
function unlockFromGesture() {
  if (unlocked) return false;
  unlocked = true; gestureUnlocked = true; setTimeout(() => { gestureUnlocked = false; }, 400);
  const s = nowSong();
  if (s) play(s);
  return true;
}
['touchend', 'click', 'keydown'].forEach(ev => document.getElementById('view-feed').addEventListener(ev, e => {
  if (unlocked || !songs.length || e.target.closest?.('.modes, a')) return;
  gestureUnlocked = unlockFromGesture();
  setTimeout(() => { gestureUnlocked = false; }, 400);
}, true));

// ---------------------------------------------------------------- Antippen, Doppeltippen, Knöpfe
let tapTimer = 0;
trackEl.addEventListener('click', e => {
  const card = e.target.closest('.card'); if (!card) return;
  const i = +card.dataset.i, s = songs[i];
  const btn = e.target.closest('[data-a]');
  if (btn) {
    const a = btn.dataset.a;
    if (a === 'link') { if (!btn.getAttribute('href') || btn.classList.contains('am') && !s.url) btn.href = amLink(s); pause(); return; }
    if (a === 'seek') return;
    haptic();
    if (a === 'like') { toggleLike(s); if (likedIds.has(s.id)) burst(btn, ['#ff3b5c', '#ff8fa3', '#ffd0da']); }
    else if (a === 'more') moreLikeThis(i, btn);
    else if (a === 'less') lessLikeThis(i, card);
    else if (a === 'share') shareSong(s);
    return;
  }
  if (i !== cur) return;
  if (tapTimer) { // Doppeltippen: Herz
    clearTimeout(tapTimer); tapTimer = 0;
    heartAt(card, e.clientX, e.clientY);
    if (!likedIds.has(s.id)) toggleLike(s);
    return;
  }
  const justUnlocked = gestureUnlocked;
  tapTimer = setTimeout(() => { tapTimer = 0; if (!justUnlocked) togglePlay(); }, 240);
});
function heartAt(card, x, y) {
  const r = card.getBoundingClientRect();
  const h = document.createElement('span');
  h.className = 'bigheart';
  h.innerHTML = svg('heart');
  h.style.left = (x - r.left) + 'px'; h.style.top = (y - r.top) + 'px';
  card.appendChild(h);
  setTimeout(() => h.remove(), 950);
  haptic();
}
// Funken aus dem Knopf (wie WikiFeed)
function burst(btn, colors) {
  btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !btn.animate) return;
  const r = btn.getBoundingClientRect();
  for (let i = 0; i < 10; i++) {
    const sp = document.createElement('span'); sp.className = 'spark';
    sp.style.background = colors[i % colors.length];
    sp.style.left = (r.left + r.width / 2) + 'px'; sp.style.top = (r.top + 22) + 'px';
    document.body.append(sp);
    const ang = -Math.PI / 2 + (Math.random() - .5) * 2.1, dist = 60 + Math.random() * 90;
    sp.animate([{ transform: 'translate(-50%, -50%) scale(.3)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(${.8 + Math.random() * .9})`, opacity: 0 }],
    { duration: 650 + Math.random() * 450, easing: 'cubic-bezier(.15,.8,.3,1)' }).onfinish = () => sp.remove();
  }
}
// Vorspulen auf der Fortschrittsleiste
trackEl.addEventListener('pointerdown', e => {
  const bar = e.target.closest('.progress'); if (!bar) return;
  const card = bar.closest('.card'); if (+card.dataset.i !== cur || pa.dataset.id !== songs[cur]?.id) return;
  const seek = ev => { const r = bar.getBoundingClientRect(); const f = clamp((ev.clientX - r.left) / r.width, 0, 1); if (pa.duration) pa.currentTime = f * pa.duration; };
  seek(e);
  bar.setPointerCapture?.(e.pointerId);
  bar.onpointermove = seek;
  bar.onpointerup = bar.onpointercancel = () => { bar.onpointermove = bar.onpointerup = null; };
});

const slim = s => ({ id: s.id, dz: s.dz || null, title: s.title, artist: s.artist, art: s.art, artS: s.artS, preview: s.preview, exp: s.exp || 0,
  url: s.url || '', dzUrl: s.dzUrl || '', year: s.year || '', genre: s.genre || '', why: s.why || '', mode: s.mode, seed: s.seed || '', niche: s.niche || '', style: s.style || '', at: Date.now() });
function toggleLike(s) {
  if (likedIds.has(s.id)) {
    likes = likes.filter(x => x.id !== s.id); likedIds.delete(s.id);
    learn(s, -2);
    toast('Nicht mehr gemerkt');
  } else {
    likes.unshift(slim(s)); likedIds.add(s.id);
    learn(s, 3);
    toast('Gemerkt');
    const b = $('#saved-count'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
  }
  LS.set('likes', likes);
  for (const [i, el] of cards) if (songs[i].id === s.id) el.querySelector('.like').classList.toggle('on', likedIds.has(s.id));
  updateSavedCount();
}
async function moreLikeThis(i, btn) {
  const s = songs[i];
  btn.classList.add('on');
  learn(s, 2);
  const artist = mainArtist(s.artist);
  toast(`Gleich kommt mehr wie ${artist}`);
  const gen = feedGen;
  try {
    const id = await dzArtistId(artist);
    if (!id) throw new Error('kein Künstler');
    const [top, radio] = await Promise.all([dz(`/artist/${id}/top?limit=10`), dz(`/artist/${id}/radio?limit=40`)]);
    if (gen !== feedGen) return;
    const why = `Mehr wie ${artist}`;
    const own = take(shuffle((top.data || []).map(t => fromDz(t, { mode: 'dir', seed: artist, why }))).filter(x => fresh(x, true)), 2, 2);
    const ak = norm(artist);
    const sim = take(shuffle((radio.data || []).map(t => fromDz(t, { mode: 'dir', seed: artist, why }))).filter(x => !splitArtists(x.artist).includes(ak) && fresh(x)), 3);
    const ins = [];
    for (let k = 0; k < 3; k++) { if (own[k]) ins.push(own[k]); if (sim[k]) ins.push(sim[k]); }
    if (!ins.length) { toast('Dazu gerade nichts Neues gefunden'); return; }
    songs.splice(cur + 1, 0, ...ins);
    resetCards(cur + 1);
    layout();
    preloadNext();
  } catch (e) { console.warn(e); toast('Gerade nicht erreichbar'); }
}
function lessLikeThis(i, card) {
  const s = songs[i];
  learn(s, -4);
  const a = norm(mainArtist(s.artist));
  nudge('aw', a, .5, .1, 5); // „Weniger“ wirkt beim Künstler deutlich: zweimal → ausgeblendet
  // Kommende Songs desselben Künstlers aus Vorrat und Feed nehmen
  for (const m of Object.keys(buckets)) buckets[m] = buckets[m].filter(x => norm(mainArtist(x.artist)) !== a);
  const before = songs.length;
  songs = songs.slice(0, i + 1).concat(songs.slice(i + 1).filter(x => norm(mainArtist(x.artist)) !== a));
  if (songs.length !== before) resetCards(i + 1);
  toast(s.niche ? `Weniger ${NICHE_BY[s.niche]?.label || 'davon'} und ${mainArtist(s.artist)}` : `Weniger wie ${mainArtist(s.artist)}`);
  card.classList.add('gone');
  layout();
  setTimeout(() => goTo(i + 1), 380);
  setTimeout(() => card.classList.remove('gone'), 1300);
}
async function shareSong(s) {
  const url = (s.url && amSong(s.url)) || s.dzUrl || spotifyUrl(s);
  const text = `${s.title} – ${s.artist}`;
  try {
    if (navigator.share) await navigator.share({ title: text, text: `${text} (entdeckt mit Klangfeed)`, url });
    else { await navigator.clipboard.writeText(`${text} ${url}`); toast('Link kopiert'); }
  } catch {}
}

// ---------------------------------------------------------------- Auswahl oben (Mix · Richtung · Ganz neu · Charts)
const modesEl = $('#modes');
function renderModes() {
  modesEl.querySelectorAll('button').forEach(b => { const on = b.dataset.m === filter; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  const on = modesEl.querySelector('button.on');
  if (on) { const ind = modesEl.querySelector('.mode-ind'); ind.style.width = on.offsetWidth + 'px'; ind.style.transform = `translateX(${on.offsetLeft}px)`; }
}
modesEl.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.dataset.m === filter) return;
  haptic();
  setFilter(b.dataset.m);
});
async function setFilter(m) {
  filter = m; LS.set('filter', m); renderModes();
  feedGen++; filling = null;
  // Noch nicht gesehene Songs zurück in ihren Vorrat, dann ab der nächsten Karte neu füllen
  for (const s of songs.slice(cur + 1).reverse()) if (buckets[s.mode]) buckets[s.mode].unshift(s);
  songs.length = Math.min(songs.length, cur + 1);
  resetCards(cur + 1);
  layout();
  toast({ mix: 'Mix aus allen drei', dir: 'In deiner Richtung', new: 'Ganz neu: außerhalb deines Profils', chart: 'Charts aus aller Welt' }[m]);
  const had = songs.length;
  await fill(6);
  if (songs.length > had && had) goTo(had);
}

// ---------------------------------------------------------------- Ansichten & Leiste unten
const views = { feed: $('#view-feed'), saved: $('#view-saved'), settings: $('#view-settings') };
let view = 'feed';
document.querySelector('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('button[data-view]'); if (!b) return;
  haptic();
  showView(b.dataset.view);
});
function showView(v) {
  if (v === view) { if (v !== 'feed') views[v].scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const prev = view; view = v;
  for (const [k, el] of Object.entries(views)) el.classList.toggle('active', k === v);
  document.querySelectorAll('.tabbar button').forEach((b, i) => { const on = b.dataset.view === v; b.classList.toggle('active', on); if (on) document.querySelector('.tabbar').style.setProperty('--i', i); });
  if (v === 'saved') renderSaved();
  else $('#saved-list').innerHTML = ''; // Bilder der Liste freigeben
  if (v === 'settings') renderSettings();
  if (v === 'feed') {
    if (prev === 'saved' && savedPlaying) { setSavedPlaying(null); if (songs[cur]) { listen = { song: songs[cur], maxT: 0 }; play(songs[cur]); } }
    requestAnimationFrame(() => { layout(); feedEl.scrollTop = cur * H; renderModes(); });
  }
}

// ---------------------------------------------------------------- Gemerkt
function updateSavedCount() {
  const b = $('#saved-count');
  b.hidden = !likes.length; b.textContent = likes.length > 99 ? '99+' : likes.length;
}
function renderSaved() {
  const list = $('#saved-list');
  $('#saved-empty').hidden = likes.length > 0;
  $('#saved-sub').textContent = likes.length ? `${likes.length} ${likes.length === 1 ? 'Song' : 'Songs'} · Antippen spielt die Vorschau` : '';
  list.innerHTML = likes.map(s => {
    const on = savedPlaying && savedPlaying.id === s.id;
    return `<li class="${on ? 'playing' : ''}" data-id="${esc(s.id)}">
      <button class="thumb" data-a="play" aria-label="${on ? 'Pause' : 'Abspielen'}"><img src="${esc(s.artS || s.art)}" alt="" loading="lazy" decoding="async"><b>${svg(on && !pa.paused ? 'pause' : 'play')}</b></button>
      <div class="t"><b>${esc(s.title)}</b><small>${esc(s.artist)}${s.why ? ' · ' + esc(s.why) : ''}</small>
        <div class="ln"><a href="${esc(amLink(s))}" target="_blank" rel="noopener">Apple Music</a><a href="${esc(spotifyUrl(s))}" target="_blank" rel="noopener">Spotify</a></div></div>
      <button class="del" data-a="del" aria-label="Entfernen">${svg('x')}</button>
    </li>`;
  }).join('');
}
$('#saved-list').addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b) { return; }
  const li = b.closest('li'); const id = li?.dataset.id;
  const s = likes.find(x => x.id === id); if (!s) return;
  if (b.dataset.a === 'play') {
    haptic();
    if (savedPlaying && savedPlaying.id === id && !pa.paused) { pause(); renderSaved(); }
    else setSavedPlaying(s);
  } else if (b.dataset.a === 'del') {
    if (savedPlaying && savedPlaying.id === id) setSavedPlaying(null);
    likes = likes.filter(x => x.id !== id); likedIds.delete(id);
    LS.set('likes', likes); updateSavedCount();
    for (const [i, el] of cards) if (songs[i].id === id) el.querySelector('.like').classList.remove('on');
    li.style.transition = 'opacity .25s, transform .25s'; li.style.opacity = '0'; li.style.transform = 'translateX(30px)';
    setTimeout(renderSaved, 250);
  }
});
function setSavedPlaying(s) {
  if (!s) { savedPlaying = null; pause(); renderSaved(); return; }
  finishListen();
  for (const [, el] of cards) el.classList.remove('playing', 'loading');
  savedPlaying = s; unlocked = true;
  play(s);
  renderSaved();
}
function audioNextSaved(d) {
  const i = likes.findIndex(x => x.id === savedPlaying?.id);
  const n = likes[i + d]; if (n) setSavedPlaying(n);
}
for (const a of players) ['play', 'pause'].forEach(ev => a.addEventListener(ev, () => { if (savedPlaying && view === 'saved' && a === pa) renderSavedIcons(); }));
function renderSavedIcons() {
  document.querySelectorAll('#saved-list li').forEach(li => {
    const on = savedPlaying && li.dataset.id === savedPlaying.id;
    li.classList.toggle('playing', !!on);
    li.querySelector('.thumb b').innerHTML = svg(on && !pa.paused ? 'pause' : 'play');
  });
}

// ---------------------------------------------------------------- Einstellungen
const THEMES = [
  { id: 'nacht', name: 'Nacht', bg: '#07080d', sw: 'linear-gradient(135deg, #0b0d18 30%, #3448d6 70%, #7d35c9)' },
  { id: 'sand', name: 'Sand', bg: '#efe6d8', sw: 'linear-gradient(135deg, #f6e9d6 30%, #eec39c 70%, #e7b3a6)' },
  { id: 'salbei', name: 'Salbei', bg: '#e5eadb', sw: 'linear-gradient(135deg, #edf1e3 30%, #b9d6b0 70%, #a9cfc4)' },
  { id: 'himmel', name: 'Himmel', bg: '#e4eaf3', sw: 'linear-gradient(135deg, #eef2f8 30%, #b5cdef 70%, #d5caf0)' },
  { id: 'rose', name: 'Rosé', bg: '#f3e6e4', sw: 'linear-gradient(135deg, #f8ecea 30%, #f0b9c2 70%, #f5d2b9)' },
];
function applyTheme(id) {
  const th = THEMES.find(t => t.id === id) || THEMES[0];
  document.documentElement.dataset.theme = th.id;
  document.querySelector('meta[name="theme-color"]').content = th.bg;
  document.querySelectorAll('.tpick').forEach(b => { const on = b.dataset.theme === th.id; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
}
function renderThemePicks() {
  const box = $('#theme-picks'); box.innerHTML = '';
  for (const th of THEMES) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'tpick'; b.setAttribute('role', 'radio'); b.dataset.theme = th.id;
    b.innerHTML = `<i style="background:${th.sw}"></i><span>${th.name}</span>`;
    b.onclick = () => { haptic(); LS.set('theme', th.id); applyTheme(th.id); };
    box.append(b);
  }
  applyTheme(document.documentElement.dataset.theme);
}
function chipsInto(box, items, isOn, onToggle) {
  box.innerHTML = '';
  for (const [key, label] of items) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'tchip' + (isOn(key) ? ' on' : ''); b.textContent = label;
    b.onclick = () => { haptic(); onToggle(key); b.classList.toggle('on', isOn(key)); };
    box.append(b);
  }
}
function toggleStyle(k) {
  const sel = new Set(myStyles || STYLES.map(s => s.key));
  if (sel.has(k)) { if (sel.size > 1) sel.delete(k); else toast('Mindestens eine Richtung bleibt an'); } else sel.add(k);
  myStyles = [...sel]; LS.set('styles', myStyles);
}
const styleOn = k => (myStyles || STYLES.map(s => s.key)).includes(k);
function renderMix() {
  for (const m of Object.keys(MODES)) { $(`#mix-${m}`).value = mix[m]; $(`#mix-${m}-v`).textContent = mix[m] + ' %'; }
  const bar = document.querySelectorAll('.mixbar i');
  ['dir', 'new', 'chart'].forEach((m, k) => { bar[k].style.flexGrow = mix[m]; bar[k].style.display = mix[m] ? '' : 'none'; });
}
// Ein Regler ändert sich → die anderen beiden passen sich anteilig an, Summe bleibt 100
function setMix(m, v) {
  v = clamp(Math.round(v / 5) * 5, 0, 100);
  const others = Object.keys(MODES).filter(k => k !== m);
  const rest = 100 - v, osum = others.reduce((a, k) => a + mix[k], 0);
  mix[m] = v;
  for (const k of others) mix[k] = osum ? Math.round(mix[k] / osum * rest / 5) * 5 : Math.round(rest / others.length / 5) * 5;
  const diff = 100 - Object.values(mix).reduce((a, b) => a + b, 0);
  const big = others.sort((a, b) => mix[b] - mix[a])[0]; mix[big] = clamp(mix[big] + diff, 0, 100);
  LS.set('mix', mix);
  renderMix();
}
for (const m of Object.keys(MODES)) $(`#mix-${m}`).addEventListener('input', e => setMix(m, +e.target.value));

function renderProfileState() {
  const st = $('#profile-state'), ob = $('#ob-profile'), del = $('#profile-del');
  document.querySelectorAll('.file-btn').forEach(b => { b.textContent = profile ? 'Mediathek neu importieren' : 'Mediathek importieren'; });
  if (profile) {
    const d = new Date(profile.at || Date.now()).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
    const txt = `${profile.known.length} Künstler · ${profile.songs.length} Songs · ${profile.top.length} Lieblinge · importiert am ${d}`;
    st.textContent = txt; del.hidden = false;
    if (ob) { ob.textContent = '✓ ' + `${profile.known.length} Künstler importiert`; ob.classList.add('ok'); }
  } else {
    st.textContent = 'Noch kein Profil importiert. Ohne Profil richtet sich Klangfeed nach deinen Richtungen und nach dem, was du merkst.';
    del.hidden = true;
    if (ob) { ob.textContent = 'iCloud Drive → Klangfeed → geschmack.json'; ob.classList.remove('ok'); }
  }
}
$('#profile-file').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > 3e6) { toast('Die Datei ist zu groß.'); return; }
  importProfileText(await f.text());
});
$('#profile-del').onclick = () => { if (confirm('Importierte Mediathek von diesem Gerät löschen?')) deleteProfile(); };

const autonextBox = $('#autonext');
autonextBox.checked = autonext;
autonextBox.onchange = () => { autonext = autonextBox.checked; LS.set('autonext', autonext); };
const calmBox = $('#calm');
calmBox.checked = document.documentElement.classList.contains('calm');
calmBox.onchange = () => { LS.set('calm', calmBox.checked); document.documentElement.classList.toggle('calm', calmBox.checked); };

function renderWeights() {
  const rows = [];
  const row = (label, w, max = 2) => `<div class="wrow"><span>${esc(label)}</span><span class="wbar"><i style="transform:scaleX(${clamp(w / max, .03, 1)})"></i></span><span>${w.toFixed(1)}×</span></div>`;
  rows.push('<p class="wsub">Arten</p>', ...Object.entries(MODES).map(([m, l]) => row(l, lw('mw', m))));
  const arts = Object.entries(learned.aw).filter(([, w]) => w > 1.05).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const names = {}; for (const s of [...likes, ...songs]) names[norm(mainArtist(s.artist))] = mainArtist(s.artist);
  if (arts.length) rows.push('<p class="wsub">Künstler, die du magst</p>', ...arts.map(([k, w]) => row(names[k] || k, w, 5)));
  const nis = Object.entries(learned.nw).filter(([, w]) => Math.abs(w - 1) > .05).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (nis.length) rows.push('<p class="wsub">Ganz neu</p>', ...nis.map(([k, w]) => row(NICHE_BY[k]?.label || k, w, 4)));
  const bl = Object.values(learned.aw).filter(w => w < .3).length;
  if (bl) rows.push(`<p class="wsub">${bl} Künstler ausgeblendet</p>`);
  $('#weights').innerHTML = rows.join('');
}
$('#learned-box').addEventListener('toggle', e => { if (e.target.open) renderWeights(); });
$('#reset').onclick = () => {
  if (!confirm('Gelerntes zurücksetzen? Gemerkte Songs und dein Profil bleiben.')) return;
  learned = { mw: {}, aw: {}, nw: {}, sw: {} }; LS.set('learned', learned); renderWeights(); toast('Gelerntes zurückgesetzt');
};
$('#wipe').onclick = () => {
  if (!confirm('Wirklich alle Klangfeed-Daten auf diesem Gerät löschen? Das lässt sich nicht rückgängig machen.')) return;
  Object.keys(localStorage).filter(k => k.startsWith('kf.') || k.startsWith('kf_')).forEach(k => localStorage.removeItem(k));
  sessionStorage.clear();
  location.reload();
};
function renderSettings() {
  renderMix();
  chipsInto($('#style-chips'), STYLES.map(s => [s.key, s.label]), styleOn, k => { toggleStyle(k); buckets.dir = buckets.dir.filter(s => !s.style || styleOn(s.style)); });
  chipsInto($('#country-chips'), Object.entries(COUNTRIES).map(([c, [f, n]]) => [c, `${f} ${n}`]), c => countries.includes(c), c => {
    if (countries.includes(c)) { if (countries.length > 1) countries = countries.filter(x => x !== c); else toast('Mindestens ein Land bleibt an'); }
    else countries = [...countries, c];
    LS.set('countries', countries); chartQueue = []; buckets.chart = buckets.chart.filter(s => countries.includes(s.country));
  });
  renderProfileState();
  $('#stats').textContent = `${seenStore.size} Songs entdeckt · ${likes.length} gemerkt${profile ? ' · Mediathek verbunden' : ''}`;
  if ($('#learned-box').open) renderWeights();
}
renderThemePicks();

// ---------------------------------------------------------------- Begrüßung beim ersten Start
function showOnboarding() {
  const sh = $('#onboard');
  sh.hidden = false;
  chipsInto($('#ob-styles'), STYLES.map(s => [s.key, s.label]), styleOn, toggleStyle);
  renderProfileState();
  $('#ob-go').onclick = () => {
    LS.set('onb', true);
    haptic();
    sh.classList.add('out');
    setTimeout(() => { sh.hidden = true; sh.classList.remove('out'); }, 360);
    buckets.dir = buckets.dir.filter(s => !s.style || styleOn(s.style));
    if (songs.length) unlockFromGesture();
    else { unlocked = true; toast('Einen Moment, die ersten Songs kommen …'); }
  };
}

// ---------------------------------------------------------------- Tastatur (Rechner)
document.addEventListener('keydown', e => {
  if (view !== 'feed' || e.target.closest?.('input, select, textarea')) return;
  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); goTo(cur + 1); }
  else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); goTo(cur - 1); }
  else if (e.key === ' ') { e.preventDefault(); if (!gestureUnlocked) togglePlay(); }
  else if (e.key === 'l' && songs[cur]) toggleLike(songs[cur]);
});
let resizeTimer;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { layout(); feedEl.scrollTop = cur * H; renderModes(); }, 120); });

// ---------------------------------------------------------------- Zustand über Neustarts behalten
// Die App merkt sich die Karten um die aktuelle herum. Startet sie kurz hintereinander mehrmals (Absturz?),
// wird der Zustand verworfen, damit keine Absturz-Schleife entsteht (wie in WikiFeed).
const bootCount = Number(sessionStorage.getItem('kf.boot') || 0);
sessionStorage.setItem('kf.boot', bootCount + 1);
setTimeout(() => sessionStorage.removeItem('kf.boot'), 20000);
let snapTimer;
function saveSnap() {
  clearTimeout(snapTimer);
  if (!songs.length) return;
  const from = Math.max(0, cur - 3);
  LS.set('snap', { t: Date.now(), idx: cur - from, filter, songs: songs.slice(from, cur + 8).map(slim) });
}
function saveSnapSoon() { clearTimeout(snapTimer); snapTimer = setTimeout(saveSnap, 800); }
function restoreSnap() {
  const s = LS.get('snap', null);
  if (bootCount >= 2) { LS.del('snap'); return false; }
  if (!s || !Array.isArray(s.songs) || !s.songs.length || Date.now() - s.t > 12 * 3600e3) return false;
  const list = s.songs.filter(x => x && x.id && x.preview && x.title);
  if (!list.length) return false;
  for (const x of list) { seenSession.add(x.id); seenSession.add(songKey(x)); }
  songs = list;
  cur = clamp(s.idx | 0, 0, songs.length - 1);
  return true;
}
addEventListener('pagehide', saveSnap);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveSnap(); });

// ---------------------------------------------------------------- Start
updateSavedCount();
renderModes();
const restored = restoreSnap();
// Alle drei Vorräte sofort parallel anwerfen: Der erste fertige liefert die erste Karte
if (mix.chart > 0 || filter === 'chart') refill('chart');
if (mix.new > 0 || filter === 'new') refill('new');
if (mix.dir > 0 || filter === 'dir') refill('dir');
if (restored) {
  layout();
  feedEl.scrollTop = cur * H;
  activate(cur);
}
fill(restored ? 6 : 8);
if (!LS.get('onb', false) && !likes.length && !profile) showOnboarding();
requestAnimationFrame(renderModes);
document.fonts?.ready.then(renderModes);

// Service Worker: neue Version wird im Hintergrund geladen und gilt ab dem nächsten Start.
// Ist die App gerade offen und spielt nichts, lädt sie sich gleich neu (Zustand bleibt erhalten).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(reg => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    saveSnap();
    if (pa.paused) location.reload(); else pendingReload = true;
  });
}
