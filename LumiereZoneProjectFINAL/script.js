const API = "https://graphql.anilist.co";
const WL_KEY = "lumierezone_watchlist";
let activeGenre = null;
const GENRES = ["Action","Comedy","Drama","Fantasy","Romance","Sci-Fi","Slice of Life","Horror"];

/* ---------- current season ---------- */
function currentSeason(){
  const d = new Date();
  const m = d.getMonth()+1;
  const season = m<=3 ? "WINTER" : m<=6 ? "SPRING" : m<=9 ? "SUMMER" : "FALL";
  return { season, seasonYear: d.getFullYear() };
}

/* ---------- helpers ---------- */
function scrollToId(id){ document.getElementById(id).scrollIntoView({behavior:"smooth"}); }
function getWatchlist(){ try{ return JSON.parse(localStorage.getItem(WL_KEY)) || {}; }catch(e){ return {}; } }
function saveWatchlist(wl){ localStorage.setItem(WL_KEY, JSON.stringify(wl)); renderWatchlist(); updateWlCount(); }
function updateWlCount(){ const n = Object.keys(getWatchlist()).length; document.getElementById("wl-count").textContent = n+" tracked"; }
function truncate(str,n){ if(!str) return ""; return str.length>n? str.slice(0,n)+"…" : str; }
function stripHtml(str){ return str ? str.replace(/<[^>]*>/g,"") : ""; }

/* normalize an AniList media object into the shape the UI uses */
function normalize(m){
  return {
    id: m.id,
    title: m.title.english || m.title.romaji || "Untitled",
    titleNative: m.title.native || "",
    image: (m.coverImage && (m.coverImage.large || m.coverImage.medium)) || "",
    imageLarge: (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || "",
    score: (m.averageScore != null) ? (m.averageScore/10).toFixed(1) : null,
    episodes: m.episodes || null,
    genres: m.genres || [],
    synopsis: stripHtml(m.description),
    trailerId: (m.trailer && m.trailer.site === "youtube") ? m.trailer.id : null,
    externalLinks: m.externalLinks || [],
    streamingEpisodes: m.streamingEpisodes || [],
    status: m.status ? m.status.replace(/_/g," ").toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()) : null
  };
}

/* ---------- GraphQL fetch with retry ---------- */
async function alFetch(query, variables, attempt=1){
  try{
    const res = await fetch(API, {
      method:"POST",
      headers:{"Content-Type":"application/json", "Accept":"application/json"},
      body: JSON.stringify({ query, variables })
    });
    if(!res.ok){
      if((res.status===429 || res.status===502 || res.status===504) && attempt<3){
        await new Promise(r=>setTimeout(r, attempt*1000));
        return alFetch(query, variables, attempt+1);
      }
      throw new Error("API error "+res.status);
    }
    const json = await res.json();
    if(json.errors) throw new Error(json.errors[0]?.message || "GraphQL error");
    return json.data;
  }catch(e){
    if(attempt<3){
      await new Promise(r=>setTimeout(r, attempt*1000));
      return alFetch(query, variables, attempt+1);
    }
    throw e;
  }
}

const MEDIA_FIELDS = `
  id
  title{ romaji english native }
  coverImage{ large extraLarge medium }
  averageScore
  episodes
  genres
  description(asHtml:false)
  status
  trailer{ id site }
  externalLinks{ url site }
  streamingEpisodes{ title url site }
`;

/* ---------- hero ---------- */
async function loadHero(){
  const { season, seasonYear } = currentSeason();
  const query = `query($season:MediaSeason,$seasonYear:Int){
    Page(perPage:1){ media(season:$season, seasonYear:$seasonYear, type:ANIME, sort:POPULARITY_DESC, isAdult:false){ ${MEDIA_FIELDS} } }
  }`;
  try{
    const data = await alFetch(query, { season, seasonYear });
    const raw = data.Page.media[0];
    if(!raw) throw new Error("empty");
    const a = normalize(raw);
    const hero = document.getElementById("hero");
    hero.style.backgroundImage = `url(${a.imageLarge})`;
    hero.innerHTML = `<div class="hero-inner">
      <div class="hero-eyebrow">Popular This Season · ★ ${a.score ?? "—"}</div>
      <h1>${a.title}</h1>
      <div class="hero-tags">${a.genres.slice(0,3).map(g=>`<span class="tag">${g}</span>`).join("")}</div>
      <div class="hero-synopsis">${a.synopsis ? truncate(a.synopsis,220) : "No synopsis available."}</div>
      <div class="hero-actions">
        <button class="btn btn-gold" onclick="openModal(${a.id})">View Details</button>
        ${a.trailerId ? `<button class="btn btn-outline" onclick="openTrailer('${a.trailerId}')">▶ Watch Trailer</button>` : ""}
      </div></div>`;
  }catch(e){
    document.getElementById("hero").innerHTML = `<div class="hero-inner"><div class="error-box">Couldn't load the featured title. <button class="btn btn-outline" onclick="loadHero()">Retry</button></div></div>`;
  }
}

/* ---------- genre chips ---------- */
function loadGenres(){
  const box = document.getElementById("genre-chips");
  box.innerHTML = `<span class="chip active" data-g="" onclick="filterGenre(null,this)">All</span>` +
    GENRES.map(g=>`<span class="chip" data-g="${g}" onclick="filterGenre('${g}',this)">${g}</span>`).join("");
}
function filterGenre(genre, el){
  activeGenre = genre;
  [...document.getElementById("genre-chips").children].forEach(c=>c.classList.remove("active"));
  el.classList.add("active");
  loadSeasonal();
}

/* ---------- seasonal grid ---------- */
async function loadSeasonal(){
  const grid = document.getElementById("seasonal-grid");
  grid.innerHTML = `<div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div>`;
  const { season, seasonYear } = currentSeason();
  const query = `query($season:MediaSeason,$seasonYear:Int,$genre:String){
    Page(perPage:8){ media(season:$season, seasonYear:$seasonYear, genre:$genre, type:ANIME, sort:POPULARITY_DESC, isAdult:false){ ${MEDIA_FIELDS} } }
  }`;
  try{
    const data = await alFetch(query, { season, seasonYear, genre: activeGenre });
    const list = data.Page.media.map(normalize);
    renderCards(grid, list, activeGenre ? "No airing titles for this genre right now." : "Nothing to show right now.");
  }catch(e){
    grid.innerHTML = `<div class="error-box">Couldn't reach the anime database. Check your connection and try again.<br><button class="btn btn-outline" onclick="loadSeasonal()">Retry</button></div>`;
  }
}

function renderCards(container, list, emptyMsg){
  if(!list.length){ container.innerHTML = `<div class="empty">${emptyMsg}</div>`; return; }
  container.innerHTML = list.map(a=>`
    <div class="card" onclick="openModal(${a.id})">
      <img loading="lazy" src="${a.image}" alt="${a.title}">
      <div class="card-body">
        <div class="card-title">${a.title}</div>
        <div class="card-meta">★ ${a.score ?? "—"} · ${a.episodes ?? "?"} ep</div>
      </div>
    </div>`).join("");
}

/* ---------- search ---------- */
let searchTimer;
document.getElementById("search-form").addEventListener("submit", e=>{ e.preventDefault(); runSearch(); });
document.getElementById("search-input").addEventListener("input", ()=>{
  clearTimeout(searchTimer);
  const q = document.getElementById("search-input").value.trim();
  if(!q){ clearSearch(); return; }
  searchTimer = setTimeout(runSearch, 500);
});
function clearSearch(){
  document.getElementById("search-input").value = "";
  document.getElementById("results-section").style.display = "none";
}
async function runSearch(){
  const q = document.getElementById("search-input").value.trim();
  if(!q) return;
  const section = document.getElementById("results-section");
  const grid = document.getElementById("results-grid");
  section.style.display = "block";
  document.getElementById("results-title").textContent = `Results for “${q}”`;
  grid.innerHTML = `<div class="skel"></div><div class="skel"></div>`;
  const query = `query($search:String){
    Page(perPage:12){ media(search:$search, type:ANIME, isAdult:false){ ${MEDIA_FIELDS} } }
  }`;
  try{
    const data = await alFetch(query, { search: q });
    const list = data.Page.media.map(normalize);
    renderCards(grid, list, `No anime found for “${q}”. Try a different title.`);
  }catch(e){
    grid.innerHTML = `<div class="error-box">Search failed — the API may be busy. <button class="btn btn-outline" onclick="runSearch()">Retry</button></div>`;
  }
  section.scrollIntoView({behavior:"smooth"});
}

/* ---------- genre dropdown (top-left nav) ---------- */
const NAV_GENRES = ["Action","Adventure","Comedy","Drama","Fantasy","Horror","Mahou Shoujo","Mecha","Music","Mystery","Psychological","Romance","Sci-Fi","Slice of Life","Sports","Supernatural","Thriller"];

function buildGenreMenu(){
  document.getElementById("genre-menu").innerHTML =
    NAV_GENRES.map(g=>`<button onclick="browseGenre('${g}')">${g}</button>`).join("");
}
function toggleGenreMenu(e){
  e.stopPropagation();
  document.getElementById("genre-menu").classList.toggle("open");
}
document.addEventListener("click", e=>{
  if(!e.target.closest("#genre-dropdown")) document.getElementById("genre-menu").classList.remove("open");
});

async function browseGenre(genre){
  document.getElementById("genre-menu").classList.remove("open");
  document.getElementById("search-input").value = "";
  const section = document.getElementById("results-section");
  const grid = document.getElementById("results-grid");
  section.style.display = "block";
  document.getElementById("results-title").textContent = `Top ${genre} Anime`;
  grid.innerHTML = `<div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div>`;
  section.scrollIntoView({behavior:"smooth"});
  const query = `query($genre:String){
    Page(perPage:12){ media(genre:$genre, type:ANIME, sort:POPULARITY_DESC, isAdult:false){ ${MEDIA_FIELDS} } }
  }`;
  try{
    const data = await alFetch(query, { genre });
    renderCards(grid, data.Page.media.map(normalize), `No ${genre} anime found.`);
  }catch(e){
    grid.innerHTML = `<div class="error-box">Couldn't load ${genre} anime. <button class="btn btn-outline" onclick="browseGenre('${genre}')">Retry</button></div>`;
  }
}

/* ---------- modal / detail ---------- */
async function openModal(id){
  const backdrop = document.getElementById("modal-backdrop");
  backdrop.classList.add("open");
  document.getElementById("modal-title").textContent = "Loading…";
  document.getElementById("modal-synopsis").textContent = "";
  document.getElementById("modal-tags").innerHTML = "";
  document.getElementById("modal-actions").innerHTML = "";
  const museBox = document.getElementById("modal-muse"); if(museBox) museBox.innerHTML = "";
  const query = `query($id:Int){ Media(id:$id, type:ANIME){ ${MEDIA_FIELDS} } }`;
  try{
    const data = await alFetch(query, { id });
    const a = normalize(data.Media);
    document.getElementById("modal-img").src = a.imageLarge;
    document.getElementById("modal-title").textContent = a.title;
    document.getElementById("modal-jp").textContent = a.titleNative || "";
    document.getElementById("modal-tags").innerHTML = a.genres.map(g=>`<span class="tag">${g}</span>`).join("");
    document.getElementById("modal-meta").textContent = `★ ${a.score ?? "—"}  ·  ${a.episodes ?? "?"} episodes  ·  ${a.status ?? "—"}`;
    document.getElementById("modal-synopsis").textContent = a.synopsis || "No synopsis available.";
    renderModalActions(a);
    renderMuseSection(a);
  }catch(e){
    document.getElementById("modal-title").textContent = "Couldn't load this title";
    document.getElementById("modal-synopsis").innerHTML = `Something went wrong reaching the API.<br><button class="btn btn-outline" onclick="openModal(${id})">Retry</button>`;
  }
}
function closeModal(){ document.getElementById("modal-backdrop").classList.remove("open"); }

function extractYouTubeId(url){
  if(!url) return null;
  let m = url.match(/[?&]v=([^&]+)/); if(m) return m[1];
  m = url.match(/youtu\.be\/([^?&]+)/); if(m) return m[1];
  m = url.match(/youtube\.com\/embed\/([^?&]+)/); if(m) return m[1];
  return null;
}

function renderMuseSection(a){
  const box = document.getElementById("modal-muse");
  if(!box) return;
  const episodes = (a.streamingEpisodes||[]).filter(e=> e.site && e.site.toLowerCase().includes("muse"));
  if(episodes.length){
    box.innerHTML = `<div class="muse-label">Watch on Muse Asia</div><div class="muse-eps">` +
      episodes.slice(0,12).map((e,i)=>{
        const vid = extractYouTubeId(e.url);
        const label = e.title ? e.title.replace(/^Episode\s*/i,"Ep ") : `Ep ${i+1}`;
        return vid
          ? `<button class="btn btn-outline muse-ep" onclick="openTrailer('${vid}')">▶ ${label}</button>`
          : `<a class="btn btn-outline muse-ep" href="${e.url}" target="_blank" rel="noopener">${label}</a>`;
      }).join("") + `</div>`;
    return;
  }
  const channel = (a.externalLinks||[]).find(l=> l.site && l.site.toLowerCase().includes("muse"));
  box.innerHTML = channel
    ? `<a class="btn btn-outline" href="${channel.url}" target="_blank" rel="noopener">Watch on Muse Asia ↗</a>`
    : "";
}

/* ---------- trailer lightbox ---------- */
function openTrailer(videoId){
  const backdrop = document.getElementById("trailer-backdrop");
  document.getElementById("trailer-iframe").src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
  backdrop.classList.add("open");
}
function closeTrailer(){
  document.getElementById("trailer-iframe").src = "";
  document.getElementById("trailer-backdrop").classList.remove("open");
}

function renderModalActions(a){
  const wl = getWatchlist();
  const inList = wl[a.id];
  const box = document.getElementById("modal-actions");
  let html = "";
  if(a.trailerId) html += `<button class="btn btn-outline" onclick="openTrailer('${a.trailerId}')">▶ Watch Trailer</button>`;
  if(inList){
    html += `<div class="wl-progress">Progress:
      <button class="step-btn" onclick="stepProgress(${a.id},-1)">−</button>
      <span id="prog-${a.id}">${inList.progress}</span> / ${inList.episodes ?? "?"}
      <button class="step-btn" onclick="stepProgress(${a.id},1)">+</button></div>
      <button class="btn btn-outline" onclick="removeFromList(${a.id})">Remove from My List</button>`;
  } else {
    html += `<button class="btn btn-gold" onclick='addToList(${JSON.stringify({id:a.id,title:a.title,image:a.image,episodes:a.episodes}).replace(/'/g,"&apos;")})'>+ Add to My List</button>`;
  }
  box.innerHTML = html;
}

function addToList(info){
  const wl = getWatchlist();
  wl[info.id] = {title:info.title, image:info.image, episodes:info.episodes, progress:0};
  saveWatchlist(wl);
  renderModalActions({id:info.id, title:info.title, episodes:info.episodes, genres:[], trailerId:null, score:null, status:null, synopsis:null, titleNative:"", image:info.image, imageLarge:info.image});
}
function removeFromList(id){
  const wl = getWatchlist(); delete wl[id]; saveWatchlist(wl);
  const backdrop = document.getElementById("modal-backdrop");
  if(backdrop.classList.contains("open")) closeModal();
}
function stepProgress(id, delta){
  const wl = getWatchlist();
  if(!wl[id]) return;
  let p = wl[id].progress + delta;
  if(p < 0) p = 0;
  if(wl[id].episodes) p = Math.min(p, wl[id].episodes);
  wl[id].progress = p;
  saveWatchlist(wl);
  const el = document.getElementById("prog-"+id);
  if(el) el.textContent = p;
}

function renderWatchlist(){
  const wl = getWatchlist();
  const ids = Object.keys(wl);
  const grid = document.getElementById("watchlist-grid");
  document.getElementById("wl-sub").textContent = ids.length ? `${ids.length} title${ids.length>1?"s":""} tracked` : "";
  if(!ids.length){ grid.innerHTML = `<div class="empty">Nothing here yet — search or browse above and add a title to start tracking it.</div>`; return; }
  grid.innerHTML = ids.map(id=>{
    const w = wl[id];
    return `<div class="wl-card">
      <img src="${w.image}" alt="${w.title}" onclick="openModal(${id})" style="cursor:pointer">
      <div class="wl-info">
        <div class="card-title">${w.title}</div>
        <div class="wl-progress">
          <button class="step-btn" onclick="stepProgress(${id},-1)">−</button>
          <span id="prog-${id}">${w.progress}</span> / ${w.episodes ?? "?"}
          <button class="step-btn" onclick="stepProgress(${id},1)">+</button>
        </div>
      </div>
      <button class="wl-remove" onclick="removeFromList(${id})">Remove</button>
    </div>`;
  }).join("");
}

/* ---------- init ---------- */
loadHero();
buildGenreMenu();
loadGenres();
loadSeasonal();
renderWatchlist();
updateWlCount();
