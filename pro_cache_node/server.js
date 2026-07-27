const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

// Load environment variables with safe defaults
const PORT = process.env.PORT || 8080;
const XOR_KEY = process.env.XOR_KEY || "default_nexus_secure_xor_key_64_chars_long_etc_etc_etc_etc_etc_etc_";
const CACHE_DIR = path.join(__dirname, 'cache_segments');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// XOR decryption function matching PHP's xorDecode
function xorDecode(encoded) {
    try {
        let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        const data = Buffer.from(base64, 'base64');
        let out = '';
        for (let i = 0; i < data.length; i++) {
            out += String.fromCharCode(data[i] ^ XOR_KEY.charCodeAt(i % XOR_KEY.length));
        }
        return out;
    } catch (e) {
        return '';
    }
}

// MAG Box stream headers
const STREAM_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
    'Accept': '*/*',
    'Connection': 'keep-alive'
};

// High-performance async request handler
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

    // Route 1: Segment streaming and active caching (/segment?url=ENCRYPTED_XOR_URL)
    if (pathname === '/segment') {
        const encryptedUrl = parsedUrl.query.url;
        if (!encryptedUrl) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing encrypted segment URL');
            return;
        }

        const targetUrl = xorDecode(encryptedUrl);
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

    // Default route: Health Check
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: "active",
        service: "Pro Cache Node",
        timezone: "Asia/Dhaka",
        uptime: process.uptime()
    }));
});

server.listen(PORT, () => {
    console.log(`🚀 Boss Kobir's Pro Cache Node listening on Port ${PORT}`);
});
