const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const { spawn, exec } = require('child_process');

const PORT = process.env.PORT || 8080;
const CACHE_DIR = path.join(__dirname, 'cache_segments');
const XOR_KEY = process.env.XOR_KEY || "default_nexus_secure_xor_key_64_chars_long_etc_etc_etc_etc_etc_etc_";

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Map to track active FFmpeg processes: channelId -> { ffmpegProcess, lastRequestedTime }
const activeFFmpegProcesses = new Map();

// Helper to decode Base64URL
function base64UrlDecode(encoded) {
    try {
        let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        return Buffer.from(b64, 'base64').toString('utf8');
    } catch (e) {
        return '';
    }
}

// Start active FFmpeg background process for a channel
function startFFmpegStream(channelId, stalkerStreamUrl) {
    if (activeFFmpegProcesses.has(channelId)) {
        // Update last requested time to keep it alive
        activeFFmpegProcesses.get(channelId).lastRequestedTime = Date.now();
        return;
    }

    console.log(`[FFmpeg] Starting active 24/7 transmuxing for Channel ${channelId}...`);
    
    const outputPlaylist = path.join(CACHE_DIR, `ch_${channelId}.m3u8`);
    const segmentPattern = path.join(CACHE_DIR, `ch_${channelId}_%03d.ts`);

    // FFmpeg parameters tuned for 1GB RAM & 2 vCPUs:
    // -c copy is highly optimized, using near 0% CPU as it bypasses transcoding!
    const ffmpegArgs = [
        '-re',                         // Read input at native frame rate (ideal for live streams)
        '-user_agent', 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
        '-i', stalkerStreamUrl,        // Input live stream
        '-c', 'copy',                  // Copy codecs without re-encoding (extremely lightweight)
        '-hls_time', '6',              // 6-second segment chunks
        '-hls_list_size', '5',         // Maintain only the last 5 segments in the manifest
        '-hls_flags', 'delete_segments', // Automatically delete older .ts segments from disk (Garbage collection!)
        '-hls_segment_filename', segmentPattern, // Output file naming pattern
        '-y',                          // Overwrite output files
        outputPlaylist                 // Output .m3u8 manifest
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    ffmpeg.stdout.on('data', (data) => {
        // Optional debug logs
    });

    ffmpeg.stderr.on('data', (data) => {
        // FFmpeg writes diagnostic logs to stderr
    });

    ffmpeg.on('close', (code) => {
        console.log(`[FFmpeg] Channel ${channelId} process exited with code ${code}`);
        activeFFmpegProcesses.delete(channelId);
    });

    activeFFmpegProcesses.set(channelId, {
        process: ffmpeg,
        lastRequestedTime: Date.now()
    });
}

// Server requests handler
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

    // Route 1: Trigger FFmpeg Stream and retrieve rewritten local m3u8 (/play?id=720&url=BASE64_URL)
    if (pathname === '/play') {
        const channelId = parsedUrl.query.id;
        const encodedUrl = parsedUrl.query.url;

        if (!channelId || !encodedUrl) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing channel ID or encrypted Stalker stream URL');
            return;
        }

        const stalkerUrl = base64UrlDecode(encodedUrl);
        if (!stalkerUrl || !stalkerUrl.startsWith('http')) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid Stalker stream URL');
            return;
        }

        // Start background FFmpeg stream on-demand
        startFFmpegStream(channelId, stalkerUrl);

        // Redirect the player to the newly generated local .m3u8 manifest file
        // We will wait 1.5 seconds for FFmpeg to write the first segment if it's a cold start
        const manifestPath = path.join(CACHE_DIR, `ch_${channelId}.m3u8`);
        
        const checkAndServe = () => {
            if (fs.existsSync(manifestPath)) {
                res.writeHead(302, { 'Location': `/stream/ch_${channelId}.m3u8` });
                res.end();
            } else {
                // If not ready yet, wait another 500ms (Max wait 3.5s)
                setTimeout(() => {
                    if (fs.existsSync(manifestPath)) {
                        res.writeHead(302, { 'Location': `/stream/ch_${channelId}.m3u8` });
                        res.end();
                    } else {
                        res.writeHead(503, { 'Content-Type': 'text/plain' });
                        res.end('Stream warming. Please retry in a few seconds.');
                    }
                }, 1500);
            }
        };

        // If process just started, give it a tiny buffer time
        if (fs.existsSync(manifestPath)) {
            res.writeHead(302, { 'Location': `/stream/ch_${channelId}.m3u8` });
            res.end();
        } else {
            setTimeout(checkAndServe, 1000);
        }
        return;
    }

    // Route 2: Serve the active segment/manifest files (/stream/ch_720.m3u8 or /stream/ch_720_001.ts)
    if (pathname.startsWith('/stream/')) {
        const fileName = pathname.replace('/stream/', '');
        // Path Traversal Protection
        if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Access Forbidden');
            return;
        }

        const filePath = path.join(CACHE_DIR, fileName);

        if (!fs.existsSync(filePath)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File Not Found');
            return;
        }

        // Update activity timer of the corresponding channel process
        const chIdMatch = fileName.match(/ch_([a-zA-Z0-9]+)/);
        if (chIdMatch) {
            const channelId = chIdMatch[1];
            if (activeFFmpegProcesses.has(channelId)) {
                activeFFmpegProcesses.get(channelId).lastRequestedTime = Date.now();
            }
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

    // Route 3: Enterprise Telemetry Dashboard (Monitoring active FFmpeg processes)
    if (pathname === '/' || pathname === '/info') {
        const stats = [];
        activeFFmpegProcesses.forEach((val, id) => {
            stats.push({
                channel_id: id,
                last_active_at: new Date(val.lastRequestedTime).toLocaleString("en-US", { timeZone: "Asia/Dhaka" }),
                idle_seconds: Math.floor((Date.now() - val.lastRequestedTime) / 1000)
            });
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: "active",
            service: "Boss Kobir's Pro FFmpeg Transmuxer Node",
            version: "3.0.0-Stable",
            active_ffmpeg_streams_count: activeFFmpegProcesses.size,
            active_streams_list: stats,
            system_time: new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" }),
            uptime: process.uptime()
        }, null, 2));
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

// Periodic Garbage Collector (Runs every 30 seconds):
// Automatically kills any FFmpeg process that hasn't been requested/viewed for over 120 seconds (2 mins)
setInterval(() => {
    const now = Date.now();
    activeFFmpegProcesses.forEach((val, id) => {
        const idleTime = now - val.lastRequestedTime;
        if (idleTime > 120000) { // 120,000 ms = 2 mins
            console.log(`[GC] Killing idle FFmpeg stream for Channel ${id} (Idle for ${Math.floor(idleTime/1000)}s)`);
            val.process.kill('SIGKILL');
            activeFFmpegProcesses.delete(id);

            // Clean up corresponding .m3u8 and cached .ts files for this channel from disk
            const files = fs.readdirSync(CACHE_DIR);
            files.forEach(file => {
                if (file.startsWith(`ch_${id}`)) {
                    fs.unlink(path.join(CACHE_DIR, file), () => {});
                }
            });
        }
    });
}, 30000);

server.listen(PORT, () => {
    console.log(`🚀 Boss Kobir's Pro FFmpeg Node listening on Port ${PORT}`);
});
