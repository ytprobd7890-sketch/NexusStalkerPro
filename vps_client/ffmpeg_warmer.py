import os
import time
import requests
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor

# ==============================================================================
# Boss Kobir - High Performance 24/7 FFmpeg Active Warmer Client
# ==============================================================================
# This script runs 24/7 as an alternative to the standard Python Requests warmer.
#
# HOW IT WORKS:
# 1. It fetches your master M3U playlist from Railway (Container 1).
# 2. It loops through all 4,000 channels and spawns lightweight FFmpeg processes.
# 3. FFmpeg connects to the stream URL, pretending to be a real player.
# 4. FFmpeg pulls the stream packets for exactly 10 seconds and discards them
#    (-c copy -f null -). This uses 0% CPU transcoding and 0% disk on this client.
# 5. This forces your upstream Pro Cache Node (Container 2) to download and
#    cache the live video chunks (.ts files) 100% natively and stably!
# ==============================================================================

# Configuration via Env Variables (with safe defaults)
RAILWAY_PLAYLIST_URL = os.environ.get(
    "RAILWAY_PLAYLIST_URL", 
    "https://tatatv.kobir26.qzz.io/playlist.php?token=kobir26tata27"
)
MAX_CONCURRENT_THREADS = int(os.environ.get("MAX_CONCURRENT_THREADS", "15")) # 15-20 is ideal for 1GB RAM / 2 vCPUs
WARM_DURATION_SECONDS = os.environ.get("WARM_DURATION_SECONDS", "10")

def get_channels_list():
    """Fetches the master M3U playlist from Railway and indexes all channel URLs."""
    print(f"[FFmpeg Client] Fetching master M3U playlist from: {RAILWAY_PLAYLIST_URL}")
    try:
        r = requests.get(RAILWAY_PLAYLIST_URL, timeout=15)
        if r.status_code != 200:
            print(f"[Error] Failed to fetch master playlist. Status: {r.status_code}")
            return []
        
        lines = r.text.split("\n")
        stream_urls = []
        for line in lines:
            line = line.strip()
            if line and line.startswith("http"):
                stream_urls.append(line)
        
        print(f"[FFmpeg Client] Successfully indexed {len(stream_urls)} channels for FFmpeg warming!")
        return stream_urls
    except Exception as e:
        print(f"[Error] Failed to read playlist: {e}")
        return []

def warm_channel_with_ffmpeg(stream_url):
    """Spawns an FFmpeg subprocess to pull the stream for 10 seconds and discard it."""
    # FFmpeg command optimized for active warming without disk or CPU overhead:
    # -t 10: Pull stream for exactly 10 seconds
    # -c copy: Do not transcode, only copy packets (Uses ~0% CPU)
    # -f null -: Discard downloaded video data (Uses 0% disk)
    cmd = [
        'ffmpeg',
        '-user_agent', 'NSPlayer',
        '-i', stream_url,
        '-t', WARM_DURATION_SECONDS,
        '-c', 'copy',
        '-f', 'null',
        '-'
    ]
    try:
        # Execute FFmpeg silently in the background
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
    except Exception:
        pass

def start_active_ffmpeg_loop():
    """Infinite loop that runs the active 24/7 FFmpeg caching process."""
    while True:
        urls = get_channels_list()
        if not urls:
            print("[FFmpeg Client] No channels found. Retrying in 15 seconds...")
            time.sleep(15)
            continue
        
        print(f"[FFmpeg Client] Launching active FFmpeg warming cycle for {len(urls)} channels using {MAX_CONCURRENT_THREADS} threads...")
        start_time = time.time()
        
        # Run multithreaded FFmpeg stream pulling
        with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_THREADS) as executor:
            executor.map(warm_channel_with_ffmpeg, urls)
            
        elapsed = time.time() - start_time
        print(f"[FFmpeg Client] Completed 1 active FFmpeg cycle in {elapsed:.2f} seconds. Starting next cycle immediately...")
        time.sleep(1)

if __name__ == "__main__":
    print("==================================================================")
    print("🚀 BOSS KOBIR - ACTIVE 24/7 FFMPEG STREAM WARMER CLIENT RUNNING")
    print("==================================================================")
    print(f"Target Playlist: {RAILWAY_PLAYLIST_URL}")
    print(f"Max Threads:     {MAX_CONCURRENT_THREADS}")
    print(f"Warm Duration:   {WARM_DURATION_SECONDS}s")
    print("==================================================================")
    start_active_ffmpeg_loop()
