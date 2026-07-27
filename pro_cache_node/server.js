const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const os = require('os');

// Load environment variables with safe defaults
const PORT = process.env.PORT || 8080;
const CACHE_DIR = path.join(__dirname, 'cache_segments');

// Dynamic Telemetry Counters
let totalRequestsServed = 0;
let activeStreamsCount = 0;

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Clean Base64URL Decoding (XOR Key is fully disabled for maximum simplicity!)
function base64UrlDecode(encoded) {
    try {
        let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        return Buffer.from(b64, 'base64').toString('utf8');
    } catch (e) {
        return '';
    }
}

// Helper to format uptime into human-readable format (HH:MM:SS)
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

// High-performance async request handler
const server = http.createServer((req, res) => {
    totalRequestsServed++;
    activeStreamsCount++;

    // Track active connection closure
    req.on('close', () => {
        activeStreamsCount = Math.max(0, activeStreamsCount - 1);
    });

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

    // Route 1: Segment streaming and active caching (/segment?url=ENCRYPTED_XOR_URL)
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
            res.end('Invalid or corrupted segment URL');
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

        // Cache MISS: Fetch from Portal CDN, pipe to client, and write to 1TB disk simultaneously
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
                'X-Cache-Status': 'MISS',
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no'
            });

            // Open write stream for caching
            const cacheWriter = fs.createWriteStream(cacheFilePath);
            
            // Pipe stream to both client and cache file
            cRes.pipe(res);
            cRes.pipe(cacheWriter);

            cRes.on('end', () => {
                cacheWriter.close();
            });

            cRes.on('error', (err) => {
                cacheWriter.close();
                fs.unlink(cacheFilePath, () => {});
            });
        });

        cReq.on('error', (err) => {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end(`Failed to fetch segment: ${err.message}`);
            fs.unlink(cacheFilePath, () => {});
        });

        cReq.end();

        // High-Performance Sliding Window Garbage Collection:
        // Automatically clean up segments older than 5 minutes (300 seconds) to keep the cache clean
        if (Math.random() < 0.05) { // 5% chance per request
            fs.readdir(CACHE_DIR, (err, files) => {
                if (err) return;
                const now = Date.now();
                files.forEach(file => {
                    const filePath = path.join(CACHE_DIR, file);
                    fs.stat(filePath, (err, stats) => {
                        if (err) return;
                        if (now - stats.mtimeMs > 300000) { // 300,000 ms = 5 mins
                            fs.unlink(filePath, () => {});
                        }
                    });
                });
            });
        }
        return;
    }

    // Default route: High-Tech Enterprise Health Monitoring JSON (10+ Infos!)
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
            // 1. General Service Info
            status: "active",
            service_name: "Boss Kobir's Pro Cache Node",
            version: "2.5.0-Stable",
            owner: "Boss Kobir",
            
            // 2. Active Telemetry & Analytics
            active_connections: Math.max(0, activeStreamsCount - 1), // Exclude the current check connection
            total_requests_served: totalRequestsServed,
            cached_segments_on_disk: cachedFilesCount,
            
            // 3. System Environment
            node_version: process.version,
            platform: process.platform,
            architecture: process.arch,
            cpu_cores: os.cpus().length,
            
            // 4. Memory Resource Management (RSS, Heap, System)
            process_memory_rss: Math.round(mem.rss / 1024 / 1024) + ' MB',
            process_memory_heap_total: Math.round(mem.heapTotal / 1024 / 1024) + ' MB',
            process_memory_heap_used: Math.round(mem.heapUsed / 1024 / 1024) + ' MB',
            system_total_memory: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
            system_free_memory: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
            
            // 5. Time & Location Settings
            timezone: "Asia/Dhaka",
            system_time_now: new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" }),
            uptime_seconds: Math.floor(uptimeSecs),
            uptime_formatted: formatUptime(uptimeSecs)
        }, null, 2));
        return;
    }

    // Fallback 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`🚀 Boss Kobir's Pro Cache Node (XOR-OFF) listening on Port ${PORT}`);
});
