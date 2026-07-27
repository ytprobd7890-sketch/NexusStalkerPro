const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const os = require('os');

// ==============================================================================
// Boss Kobir - High-Performance 24/7 Active Node.js Stream Harvester & Cache Node
// ==============================================================================
// This server actively and continuously pulls, copies, and caches live video
// segments (.ts files) of all 4,000 channels 24/7 to local storage!
// It dynamically generates an M3U playlist of ONLY the active cached channels!
// ==============================================================================

const PORT = process.env.PORT || 8080;
const CACHE_DIR = path.join(__dirname, 'cache_segments');

// Configuration
const RAILWAY_PLAYLIST_URL = process.env.RAILWAY_PLAYLIST_URL || "https://tatatv.kobir26.qzz.io/playlist.php?token=kobir26tata27";
const MAX_CONCURRENT_HARVESTERS = parseInt(process.env.MAX_CONCURRENT_HARVESTERS || "40"); // Safe for 1GB RAM / 2 vCPUs
const SEGMENT_TIMEOUT = 5000; // 5s timeout

// Telemetry Analytics
let totalRequestsServed = 0;
let totalSegmentsCached24_7 = 0;
const cachedChannelsMap = new Map(); // ch_name -> { id, name, genre, last_cached_at, timestamp }
const cachedGenresMap = {};          // genre -> count

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Clean Base64URL Decoding (XOR Key is fully disabled)
function base64UrlDecode(encoded) {
    try {
        let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        return Buffer.from(b64, 'base64').toString('utf8');
    } catch (e) {
        return '';
    }
}

// Helper to format uptime into human-readable format
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d}d, ${h}h, ${m}m, ${s}s`;
}

// MAG Box stream headers
const STREAM_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
    'Accept': '*/*',
    'Connection': 'keep-alive'
};

// Generic HTTP/HTTPS Fetch Helper
function fetchUrl(targetUrl, headers = {}) {
    return new Promise((resolve, reject) => {
        const parsed = url.parse(targetUrl);
        const client = parsed.protocol === 'https:' ? https : http;
        const options = {
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.path,
            method: 'GET',
            headers: { ...STREAM_HEADERS, ...headers }
        };
        client.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ data, statusCode: res.statusCode, headers: res.headers }));
        }).on('error', reject).end();
    });
}

// Active 24/7 Channel Segment Harvester Worker
async function harvestChannelSegment(channelM3u8Url) {
    try {
        // Extract channel ID from the URL (e.g. ?id=11070)
        const parsedUrl = url.parse(channelM3u8Url, true);
        const chId = parsedUrl.query.id || '0';

        // Step 1: Fetch the .m3u8 manifest from Railway (Container 1)
        const m3u8Res = await fetchUrl(channelM3u8Url);
        if (m3u8Res.statusCode !== 200) return;

        // Step 2: Parse to find the target .ts segment URL
        const lines = m3u8Res.data.split('\n');
        let segmentUrl = '';
        for (let line of lines) {
            line = line.trim();
            if (line && line.startsWith('http')) {
                segmentUrl = line;
                break;
            }
        }

        if (!segmentUrl) return;

        // Extract metadata if available in query params
        const parsedSeg = url.parse(segmentUrl, true);
        const chName = parsedSeg.query.ch_name || 'Unknown';
        const genre = parsedSeg.query.genre || 'General';
        const rawTargetUrl = base64UrlDecode(parsedSeg.query.url);

        if (!rawTargetUrl) return;

        const urlHash = crypto.createHash('md5').update(rawTargetUrl).digest('hex');
        const cacheFilePath = path.join(CACHE_DIR, `${urlHash}.ts`);

        // Check if segment is already cached
        if (fs.existsSync(cacheFilePath)) {
            // Keep channel warm in telemetry
            cachedChannelsMap.set(chName, {
                id: chId,
                name: chName,
                genre: genre,
                last_cached_at: new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" }),
                timestamp: Date.now()
            });
            return; 
        }

        // Step 3: Fetch raw .ts segment and write directly to 1TB local SSD
        const parsedTarget = url.parse(rawTargetUrl);
        const client = parsedTarget.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: parsedTarget.hostname,
            port: parsedTarget.port,
            path: parsedTarget.path,
            method: 'GET',
            headers: STREAM_HEADERS
        };

        await new Promise((resolve, reject) => {
            const req = client.request(options, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`CDN status: ${res.statusCode}`));
                    return;
                }
                const writer = fs.createWriteStream(cacheFilePath);
                res.pipe(writer);
                res.on('end', () => {
                    writer.close();
                    totalSegmentsCached24_7++;
                    cachedChannelsMap.set(chName, {
                        id: chId,
                        name: chName,
                        genre: genre,
                        last_cached_at: new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" }),
                        timestamp: Date.now()
                    });
                    if (!cachedGenresMap[genre]) cachedGenresMap[genre] = 0;
                    cachedGenresMap[genre]++;
                    resolve();
                });
                res.on('error', reject);
            });
            req.on('error', reject);
            req.end();
        });

    } catch (e) {
        // Fail silently
    }
}

// Main 24/7 Active Harvester Loop
async function runActiveHarvesterLoop() {
    console.log("[Harvester] Querying master M3U playlist from Railway to index channels...");
    let m3uRes;
    try {
        m3uRes = await fetchUrl(RAILWAY_PLAYLIST_URL);
    } catch (err) {
        console.error("[Harvester Error] Failed to contact Railway manager:", err.message);
        setTimeout(runActiveHarvesterLoop, 15000); 
        return;
    }

    if (m3uRes.statusCode !== 200) {
        console.error(`[Harvester Error] Railway manager returned status: ${m3uRes.statusCode}`);
        setTimeout(runActiveHarvesterLoop, 15000);
        return;
    }

    const lines = m3uRes.data.split('\n');
    const channelUrls = [];
    for (let line of lines) {
        line = line.trim();
        if (line && line.startsWith('http')) {
            channelUrls.push(line);
        }
    }

    console.log(`[Harvester] Successfully indexed ${channelUrls.length} channels. Starting parallel 24/7 harvesting cycle...`);

    let index = 0;
    async function worker() {
        while (index < channelUrls.length) {
            const url = channelUrls[index++];
            await harvestChannelSegment(url);
        }
    }

    // Launch parallel workers
    const workers = [];
    for (let i = 0; i < Math.min(MAX_CONCURRENT_HARVESTERS, channelUrls.length); i++) {
        workers.push(worker());
    }
    await Promise.all(workers);

    console.log(`[Harvester] Completed 1 full active 24/7 harvesting cycle. Starting next cycle in 2 seconds...`);
    
    // Auto-clean segments older than 5 minutes to prevent clogging up disk
    try {
        const files = fs.readdirSync(CACHE_DIR);
        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(CACHE_DIR, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > 300000) { // 5 minutes
                fs.unlinkSync(filePath);
            }
        });
    } catch (e) {}

    // Auto-clean channels from memory list if not active for 10 minutes (600,000 ms)
    const now = Date.now();
    cachedChannelsMap.forEach((val, key) => {
        if (now - val.timestamp > 600000) {
            cachedChannelsMap.delete(key);
        }
    });

    setTimeout(runActiveHarvesterLoop, 2000);
}

// Start Background Harvester Loop immediately on server boot!
setTimeout(runActiveHarvesterLoop, 5000);


// ==============================================================================
// HTTP API & Caching Proxy Server
// ==============================================================================
const server = http.createServer((req, res) => {
    totalRequestsServed++;

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Route 1: Serve segments directly from the 24/7 Active cache (Ultra fast!)
    if (pathname === '/segment') {
        const encryptedUrl = parsedUrl.query.url;
        if (!encryptedUrl) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing encrypted segment URL');
            return;
        }

        const targetUrl = base64UrlDecode(encryptedUrl);
        if (!targetUrl || !targetUrl.startsWith('http')) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid segment URL');
            return;
        }

        const urlHash = crypto.createHash('md5').update(targetUrl).digest('hex');
        const cacheFilePath = path.join(CACHE_DIR, `${urlHash}.ts`);

        // Cache HIT: Stream segment directly from 1TB+ SSD
        if (fs.existsSync(cacheFilePath)) {
            const stat = fs.statSync(cacheFilePath);
            res.writeHead(200, {
                'Content-Type': 'video/mp2t',
                'Content-Length': stat.size,
                'X-Cache-Status': 'HIT',
                'Cache-Control': 'no-cache'
            });
            fs.createReadStream(cacheFilePath).pipe(res);
            return;
        }

        // Cache MISS (Fallback): Fetch from Portal CDN, pipe, and cache simultaneously
        const parsedTarget = url.parse(targetUrl);
        const client = parsedTarget.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: parsedTarget.hostname,
            port: parsedTarget.port,
            path: parsedTarget.path,
            method: 'GET',
            headers: STREAM_HEADERS
        };

        const cReq = client.request(options, (cRes) => {
            if (cRes.statusCode !== 200) {
                res.writeHead(cRes.statusCode, { 'Content-Type': 'text/plain' });
                res.end(`Portal CDN responded with status: ${cRes.statusCode}`);
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'video/mp2t',
                'X-Cache-Status': 'MISS_FALLBACK',
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no'
            });

            const cacheWriter = fs.createWriteStream(cacheFilePath);
            cRes.pipe(res);
            cRes.pipe(cacheWriter);

            cRes.on('end', () => cacheWriter.close());
            cRes.on('error', () => {
                cacheWriter.close();
                fs.unlink(cacheFilePath, () => {});
            });
        });

        cReq.on('error', (err) => {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end(`Failed to fetch segment: ${err.message}`);
        });

        cReq.end();
        return;
    }

    // Route 2: [NEW & PRO] Dynamic M3U Playlist of ONLY currently active cached channels!
    if (pathname === '/playlist.m3u' || pathname === '/playlist') {
        const proto = ((!empty(req.headers['x-forwarded-proto']) && req.headers['x-forwarded-proto'] === 'https') || req.connection.encrypted) ? 'https' : 'http';
        const hostHeader = req.headers.host || 'localhost';
        const selfBase = `${proto}://${hostHeader}`;

        let m3uLines = [];
        m3uLines.push('#EXTM3U x-tvg-url="https://avkb.short.gy/epg.xml.gz" url-tvg="https://avkb.short.gy/epg.xml.gz"');
        m3uLines.push('#');
        m3uLines.push('#  Nexus Premium — 24/7 Cached Channels Playlist');
        m3uLines.push('#  Owner    : Boss Kobir');
        m3uLines.push(`#  Uptime   : ${formatUptime(process.uptime())}`);
        m3uLines.push(`#  Channels : ${cachedChannelsMap.size}`);
        m3uLines.push('#');
        m3uLines.push('');

        cachedChannelsMap.forEach((val) => {
            // Build direct local stream URL to point to this cache node's local files
            const streamUrl = `${selfBase}/stream/ch_${val.id}.m3u8`;
            m3uLines.push(`#EXTINF:-1 tvg-id="${val.id}" tvg-name="${val.name}" group-title="${val.genre}",${val.name}`);
            m3uLines.push(streamUrl);
        });

        res.writeHead(200, {
            'Content-Type': 'application/x-mpegurl; charset=utf-8',
            'Content-Disposition': 'inline; filename="Cached_KobirTV.m3u"',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(m3uLines.join('\n'));
        return;
    }

    // Helper for empty check
    function empty(val) {
        return !val;
    }

    // Route 3: Serve the active segment/manifest files (/stream/ch_720.m3u8)
    if (pathname.startsWith('/stream/')) {
        const fileName = pathname.replace('/stream/', '');
        if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Access Forbidden');
            return;
        }

        const filePath = path.join(CACHE_DIR, fileName);

        // If requested file is a manifest and it's not present (cold start), return 404
        if (!fs.existsSync(filePath)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File Not Found');
            return;
        }

        const ext = path.extname(fileName);
        const contentType = ext === '.m3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp2t';

        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*'
        });

        fs.createReadStream(filePath).pipe(res);
        return;
    }

    // Route 4: Real-time 24/7 Telemetry Dashboard
    if (pathname === '/' || pathname === '/info') {
        let cachedFilesCount = 0;
        try {
            cachedFilesCount = fs.readdirSync(CACHE_DIR).length;
        } catch (e) {
            cachedFilesCount = 0;
        }

        const mem = process.memoryUsage();
        const uptimeSecs = process.uptime();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: "active",
            service_name: "Boss Kobir's Pro 24/7 Active Cache Node",
            version: "3.5.0-ActiveEdition",
            owner: "Boss Kobir",
            caching_mode: "AUTOMATED_24_7_ACTIVE_PULL (No-VPS Required)",
            
            // Telemetry Analytics
            total_unique_channels_monitored: cachedChannelsMap.size,
            total_active_segments_on_disk: cachedFilesCount,
            total_segments_actively_cached_24_7: totalSegmentsCached24_7,
            
            // Memory & System specs
            node_version: process.version,
            platform: process.platform,
            architecture: process.arch,
            cpu_cores: os.cpus().length,
            process_memory_rss: Math.round(mem.rss / 1024 / 1024) + ' MB',
            system_total_memory: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
            system_free_memory: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
            
            // Location and time settings
            timezone: "Asia/Dhaka",
            system_time_now: new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" }),
            uptime_formatted: formatUptime(uptimeSecs),
            
            // Channels and Genres Details
            cached_channels_last_active_list: Object.fromEntries(cachedChannelsMap),
            cached_segments_served_by_genre: cachedGenresMap
        }, null, 2));
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`🚀 Boss Kobir's Pro 24/7 Active Cache Node listening on Port ${PORT}`);
});
