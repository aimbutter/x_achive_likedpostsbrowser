let rawLikesArray = [];
let filteredLikes = [];
let currentPage = 1;
const itemsPerPage = 50; 
let currentRenderId = 0;

let isIndexing = false;
let currentIndexPointer = 0;

const cacheKey = "twitter_likes_cache";
const rawDataKey = "private_user_likes_data";

let apiCache = new Map();
try {
    const localData = localStorage.getItem(cacheKey);
    if (localData) {
        apiCache = new Map(JSON.parse(localData));
    }
} catch (e) {
    console.log("Could not load media cache.");
}

// SNOWFLAKE DECODER: Twitter Epoch offset = 1288834974657
function getTweetTimestamp(tweetId) {
    try {
        const idBig = BigInt(tweetId);
        return Number((idBig >> 22n) + 1288834974657n);
    } catch (e) {
        return 0;
    }
}

// Formats date/time according to local device settings
function formatTweetDate(tweetId) {
    const timestampMs = getTweetTimestamp(tweetId);
    if (!timestampMs) return "Unknown Date";
    const date = new Date(timestampMs);
    return date.toLocaleString();
}

// Exact Phrase Checkers
function isSuspendedPost(item) {
    const tweetId = item.like.tweetId;
    const textLower = (item.like.fullText || "").toLowerCase();
    
    if (textLower.includes("this post is from a suspended account") || 
        textLower.includes("suspended account") ||
        textLower.includes("this post is unavailable")) {
        return true;
    }
    
    if (apiCache.has(tweetId) && apiCache.get(tweetId) === "suspended") {
        return true;
    }
    
    return false;
}

function isProtectedPost(item) {
    const tweetId = item.like.tweetId;
    const textLower = (item.like.fullText || "").toLowerCase();
    
    const exactPhrase1 = "you’re unable to view this post because this account owner limits who can view their posts";
    const exactPhrase2 = "you're unable to view this post because this account owner limits who can view their posts";
    
    if (textLower.includes(exactPhrase1) || textLower.includes(exactPhrase2)) {
        return true;
    }
    
    if (apiCache.has(tweetId) && apiCache.get(tweetId) === "protected") {
        return true;
    }
    
    return false;
}

// Device Auto-Loader
window.addEventListener('DOMContentLoaded', () => {
    try {
        const savedRawData = localStorage.getItem(rawDataKey);
        if (savedRawData) {
            rawLikesArray = JSON.parse(savedRawData);
            handleSearchAndFilter();
            showWorkspaceUI();
        }
    } catch(e) {
        console.log("No saved archive found on this device.");
    }

    setupDragAndDrop();
});

function saveCacheToLocalStorage() {
    try {
        const arrayData = Array.from(apiCache.entries());
        localStorage.setItem(cacheKey, JSON.stringify(arrayData));
    } catch (e) {
        console.log("Local storage full. Cache running in temporary memory.");
    }
}

function setupDragAndDrop() {
    const dropZone = document.getElementById('dropZone');
    dropZone.addEventListener('click', () => document.getElementById('fileInput').click());
    window.addEventListener('dragover', (e) => e.preventDefault(), false);
    window.addEventListener('drop', (e) => e.preventDefault(), false);
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files);
    });
}

function handleFile(files) {
    if (!files.length) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        processRawText(e.target.result.trim());
    };
    reader.readAsText(files[0]);
}

function processRawText(rawText) {
    try {
        const jsonString = rawText.replace(/^window\.YTD\.like\.part0\s*=\s*/, '');
        rawLikesArray = JSON.parse(jsonString);
        
        try {
            localStorage.setItem(rawDataKey, JSON.stringify(rawLikesArray));
        } catch(e) {
            console.log("Storage quota limit reached for local file saving.");
        }

        currentPage = 1;
        currentIndexPointer = 0;
        showWorkspaceUI();
        handleSearchAndFilter();
    } catch (error) {
        alert("Error reading file. Make sure it's a valid 'like.js' file.");
        console.error(error);
    }
}

function showWorkspaceUI() {
    document.getElementById('dropZone').style.display = 'none';
    document.getElementById('workspace').style.display = 'block';
    document.getElementById('navLeftContainer').style.display = 'flex';
    document.getElementById('navRightContainer').style.display = 'flex';
    updateIndexerButtonUI();
}

function clearLoadedArchive() {
    if (confirm("Clear your saved archive and all cached tweet data from this browser? You will need to drop your like.js file again next time.")) {
        localStorage.removeItem(rawDataKey);
        localStorage.removeItem(cacheKey);
        location.reload();
    }
}

// MULTI-FILTER & SORT ENGINE
function handleSearchAndFilter() {
    const query = document.getElementById('searchBox').value.toLowerCase().trim();
    const sortOrder = document.getElementById('sortOrder').value;

    const activeFilters = Array.from(document.querySelectorAll('.filter-checkbox:checked')).map(cb => cb.value);

    filteredLikes = rawLikesArray.filter(item => {
        const rawText = item.like.fullText || "";
        const textContent = rawText.trim();
        const textLower = textContent.toLowerCase();
        const tweetId = item.like.tweetId;
        const originalUrl = (item.like.expandedUrl || "").toLowerCase();

        const suspended = isSuspendedPost(item);
        const protectedPost = isProtectedPost(item);

        const hasText = textContent.length > 0;
        const hasMediaLink = textLower.includes("https://t.co/") || originalUrl.includes("t.co");

        // 1. Exclude Suspended
        if (activeFilters.includes('hideSuspended') && suspended) return false;

        // 2. Exclude Protected
        if (activeFilters.includes('hideProtected') && protectedPost) return false;

        // 3. Keep Only Protected
        if (activeFilters.includes('onlyProtected') && !protectedPost) return false;

        // Content type filters
        if (activeFilters.includes('noText') && hasText) return false;
        if (activeFilters.includes('hasMedia') && !hasMediaLink) return false;
        if (activeFilters.includes('noMedia') && hasMediaLink) return false;

        // Search query matching
        if (query) {
            let match = textLower.includes(query) || tweetId.includes(query);

            const urlMatch = originalUrl.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status/i);
            if (urlMatch && urlMatch[1] && urlMatch[1].toLowerCase() !== 'i') {
                if (urlMatch[1].toLowerCase().includes(query)) match = true;
            }

            if (apiCache.has(tweetId)) {
                const cachedData = apiCache.get(tweetId);
                if (cachedData && typeof cachedData === "object" && cachedData.author) {
                    const liveName = (cachedData.author.name || "").toLowerCase();
                    const liveScreenName = (cachedData.author.screen_name || "").toLowerCase();
                    if (liveName.includes(query) || liveScreenName.includes(query)) {
                        match = true;
                    }
                }
            }
            if (!match) return false;
        }

        return true;
    });

    filteredLikes.sort((a, b) => {
        const timeA = getTweetTimestamp(a.like.tweetId);
        const timeB = getTweetTimestamp(b.like.tweetId);
        return sortOrder === 'oldest' ? timeA - timeB : timeB - timeA;
    });

    currentPage = 1;
    renderPage();
}

async function toggleIndexer() {
    const btn = document.getElementById('indexBtn');
    if (isIndexing) {
        isIndexing = false;
        updateIndexerButtonUI();
        return;
    }

    isIndexing = true;
    btn.style.backgroundColor = "#ffad1f";
    btn.style.borderColor = "#ffad1f";

    for (; currentIndexPointer < rawLikesArray.length; currentIndexPointer++) {
        if (!isIndexing) return;

        const tweetId = rawLikesArray[currentIndexPointer].like.tweetId;
        if (!apiCache.has(tweetId)) {
            btn.innerText = `⏳ Indexing (${currentIndexPointer}/${rawLikesArray.length})...`;
            await fetchDataSafely(tweetId);
            await new Promise(resolve => setTimeout(resolve, 450));
        }
    }

    isIndexing = false;
    updateIndexerButtonUI();
}

function updateIndexerButtonUI() {
    const btn = document.getElementById('indexBtn');
    let cachedCount = 0;
    rawLikesArray.forEach(item => {
        if (apiCache.has(item.like.tweetId)) cachedCount++;
    });

    if (cachedCount === rawLikesArray.length && rawLikesArray.length > 0) {
        btn.style.backgroundColor = "var(--success-green)";
        btn.style.borderColor = "var(--success-green)";
        btn.innerText = "✅ Fully Indexed";
        btn.disabled = true;
    } else {
        btn.style.backgroundColor = isIndexing ? "#ffad1f" : "var(--success-green)";
        btn.style.borderColor = isIndexing ? "#ffad1f" : "var(--success-green)";
        btn.innerText = isIndexing ? `⏳ Indexing... Pause` : `⚡ Index Archive (${cachedCount}/${rawLikesArray.length})`;
    }
}

async function renderPage() {
    const listContainer = document.getElementById('likesList');
    listContainer.innerHTML = '';
    
    currentRenderId++;
    const thisRenderId = currentRenderId;
    
    const totalPages = Math.ceil(filteredLikes.length / itemsPerPage) || 1;
    
    document.getElementById('itemCountDisplay').innerText = `${filteredLikes.length} items found`;
    document.querySelectorAll('.page-badge-text').forEach(el => {
        el.innerText = `${currentPage}/${totalPages}`;
    });

    document.getElementById('navLeft').disabled = (currentPage === 1);
    document.getElementById('navRight').disabled = (currentPage === totalPages || totalPages === 0);

    const startIndex = (currentPage - 1) * itemsPerPage;
    const pageItems = filteredLikes.slice(startIndex, startIndex + itemsPerPage);

    pageItems.forEach((item) => {
        const tweetId = item.like.tweetId;
        const textContent = item.like.fullText || "";
        const originalUrl = item.like.expandedUrl || `https://twitter.com/i/web/status/${tweetId}`;
        const localDateStr = formatTweetDate(tweetId);

        let fallbackUsername = "HiddenUser";
        let initial = "🔒"; 
        const match = originalUrl.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status/i);
        if (match && match[1] && match[1].toLowerCase() !== 'i') {
            fallbackUsername = match[1];
            initial = fallbackUsername.charAt(0).toUpperCase();
        }
        
        const card = document.createElement('div');
        card.className = 'tweet-card';
        card.id = `card-${tweetId}`;
        
        card.innerHTML = `
            <div class="tweet-header" id="header-${tweetId}">
                <div class="profile-pic" style="background-color: var(--border-color); display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; font-size:14px;">
                    ${initial}
                </div>
                <div class="user-info">
                    <span class="display-name">@${escapeHtml(fallbackUsername)}</span>
                    <span class="username">ID: ${tweetId}</span>
                </div>
                <button class="card-reload-btn" onclick="reloadSingleTweet('${tweetId}')" title="Re-fetch post from VxTwitter">🔄 Reload</button>
            </div>
            <div class="tweet-text" id="text-${tweetId}">${formatTextWithLinks(textContent)}</div>
            <div id="media-${tweetId}"></div>
            <div id="loading-${tweetId}" class="loading-indicator" style="display:block;">Fetching media from VxTwitter...</div>
            
            <div class="tweet-meta">
                <span id="date-${tweetId}">${localDateStr}</span>
                <a class="launch-link" href="${originalUrl}" target="_blank">Open Live Post ↗</a>
            </div>
        `;
        listContainer.appendChild(card);
    });

    for (let i = 0; i < pageItems.length; i++) {
        if (thisRenderId !== currentRenderId) return;

        const tweetId = pageItems[i].like.tweetId;
        const loader = document.getElementById(`loading-${tweetId}`);
        
        if (apiCache.has(tweetId)) {
            const cachedData = apiCache.get(tweetId);
            if (loader) loader.style.display = 'none';
            
            if (typeof cachedData === "object") {
                renderContent(tweetId, cachedData);
            } else if (cachedData === "failed" || cachedData === "suspended" || cachedData === "protected") {
                showFetchWarning(tweetId, cachedData);
            }
        } else {
            await fetchDataSafely(tweetId);
            if (loader) loader.style.display = 'none';
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
    
    updateIndexerButtonUI();
}

// Single Tweet Reload Handler
async function reloadSingleTweet(tweetId) {
    apiCache.delete(tweetId);
    saveCacheToLocalStorage();

    const loader = document.getElementById(`loading-${tweetId}`);
    if (loader) {
        loader.style.display = 'block';
        loader.innerText = 'Re-fetching post...';
    }

    const mediaBox = document.getElementById(`media-${tweetId}`);
    if (mediaBox) {
        mediaBox.innerHTML = '';
        mediaBox.className = '';
    }

    await fetchDataSafely(tweetId);
    if (loader) loader.style.display = 'none';
}

function showFetchWarning(tweetId, state) {
    const mediaBox = document.getElementById(`media-${tweetId}`);
    if (!mediaBox) return;

    let message = "⚠️ Media not showing? The post may be deleted, protected, or no longer available on Twitter/X. Try pressing 🔄 <strong>Reload</strong> above.";
    if (state === "suspended") {
        message = "🛑 This post or account appears to be suspended or deleted. Try pressing 🔄 <strong>Reload</strong> to re-check.";
    } else if (state === "protected") {
        message = "🔒 Account owner limits who can view their posts. Try pressing 🔄 <strong>Reload</strong> to re-check.";
    }

    mediaBox.className = "fetch-warning";
    mediaBox.innerHTML = message;
}

async function fetchDataSafely(tweetId) {
    const apiUrl = `https://api.vxtwitter.com/i/status/${tweetId}`;
    try {
        let res = await fetch(apiUrl);
        let data = await res.json();
        const textToSearch = (data.text || data.error || "").toLowerCase();
        
        if (textToSearch.includes("suspended account") || textToSearch.includes("this post is from a suspended account")) {
            apiCache.set(tweetId, "suspended");
            saveCacheToLocalStorage();
            showFetchWarning(tweetId, "suspended");
            return;
        }

        if (textToSearch.includes("limits who can view their posts")) {
            apiCache.set(tweetId, "protected");
            saveCacheToLocalStorage();
            showFetchWarning(tweetId, "protected");
            return;
        }

        if (!res.ok) {
            apiCache.set(tweetId, "failed");
            saveCacheToLocalStorage();
            showFetchWarning(tweetId, "failed");
            return; 
        }
        
        if (data && data.text) { 
            const normalizedTweet = {
                author: {
                    name: data.user_name || 'User',
                    screen_name: data.user_screen_name || 'unknown',
                    avatar_url: '' 
                },
                text: data.text,
                date: data.date,
                media: { all: data.media_extended || [] }
            };
            
            apiCache.set(tweetId, normalizedTweet);
            saveCacheToLocalStorage();
            renderContent(tweetId, normalizedTweet);
        } else {
            apiCache.set(tweetId, "failed");
            saveCacheToLocalStorage();
            showFetchWarning(tweetId, "failed");
        }
    } catch (err) {
        apiCache.set(tweetId, "failed");
        saveCacheToLocalStorage();
        showFetchWarning(tweetId, "failed");
    }
}

function renderContent(tweetId, t) {
    const headerEl = document.getElementById(`header-${tweetId}`);
    if(!headerEl) return; 

    headerEl.innerHTML = `
        <div class="profile-pic" style="background-color: var(--accent); display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:14px; color:white;">
            ${t.author.name.charAt(0).toUpperCase()}
        </div>
        <div class="user-info">
            <span class="display-name">${escapeHtml(t.author.name)}</span>
            <span class="username">@${escapeHtml(t.author.screen_name)}</span>
        </div>
        <button class="card-reload-btn" onclick="reloadSingleTweet('${tweetId}')" title="Re-fetch post from VxTwitter">🔄 Reload</button>
    `;
    
    document.getElementById(`text-${tweetId}`).innerHTML = formatTextWithLinks(t.text);

    if (t.media && t.media.all && t.media.all.length > 0) {
        const mediaBox = document.getElementById(`media-${tweetId}`);
        mediaBox.className = "media-container";
        mediaBox.innerHTML = '';

        t.media.all.forEach(m => {
            if (m.type === 'photo' || m.type === 'image') {
                const img = document.createElement('img');
                img.src = m.url;
                img.alt = "Post Image";
                img.referrerPolicy = "no-referrer";
                img.loading = "lazy";
                mediaBox.appendChild(img);
            } else if (m.type === 'video' || m.type === 'gif') {
                const video = document.createElement('video');
                video.controls = true;
                video.preload = "metadata";
                video.playsInline = true;
                
                // Directly set referrerpolicy and video src on the <video> element itself
                video.referrerPolicy = "no-referrer";
                video.setAttribute("referrerpolicy", "no-referrer");
                video.src = m.url;

                video.onerror = () => {
                    const errDiv = document.createElement('div');
                    errDiv.className = "fetch-warning";
                    errDiv.innerHTML = `⚠️ Video stream blocked or deleted. Try pressing 🔄 <strong>Reload</strong> above or <a href="${m.url}" target="_blank" style="color:var(--accent);font-weight:bold;">Open Direct MP4 ↗</a>`;
                    mediaBox.appendChild(errDiv);
                    video.remove();
                };

                mediaBox.appendChild(video);
            }
        });
    }
}

function changePage(direction) {
    currentPage += direction;
    renderPage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function formatTextWithLinks(text) {
    const safeText = escapeHtml(text);
    return safeText.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" class="tco-link">$1</a>');
}

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
