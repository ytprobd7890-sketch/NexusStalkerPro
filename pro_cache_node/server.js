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
// It runs independently without needing any external VPS or warming clients.
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
const cachedChannelsMap = new Map(); // ch_name -> last_active_at
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
            return; // Already cached!
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
                    cachedChannelsMap.set(chName, new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" }));
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
        // Fail silently and continue the loop
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
        setTimeout(runActiveHarvesterLoop, 15000); // Retry in 15 seconds
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
            channelUrls.append ? channelUrls.append(line) : channelUrls.push(line);
        }
    }

    console.log(`[Harvester] Successfully indexed ${channelUrls.length} channels. Starting parallel 24/7 harvesting cycle...`);

    // Helper to run workers with limited concurrency (MAX_CONCURRENT_HARVESTERS)
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

    setTimeout(runActiveHarvesterLoop, 2000);
}

// Start Background Harvester Loop immediately on server boot!
setTimeout(runActiveHarvesterLoop, 5000);


// ==============================================================================
// HTTP API & Caching Proxy Server
// ==============================================================================
const server = http.createServer((req, res) => {
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

    // Route 2: Real-time 24/7 Telemetry Dashboard
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
