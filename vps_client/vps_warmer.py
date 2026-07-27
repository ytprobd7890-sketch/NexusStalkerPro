import time
import requests
import threading
from concurrent.futures import ThreadPoolExecutor

# ==============================================================================
# Boss Kobir - IPTV VPS Stream Warmer & Cache Trigger Script
# ==============================================================================
# This script runs 24/7 on your personal VPS.
# It continuously requests stream chunks from your Railway proxy server.
# This forces Railway to download, cache, and keep all 4,000 channels active 24/7!
# ==============================================================================

# Configuration
RAILWAY_PLAYLIST_URL = "https://your-railway.up.railway.app/playlist.php?token=kobir26tata27"
MAX_CONCURRENT_THREADS = 50  # Adjust based on your VPS CPU (handles parallel stream warming)
CHANNEL_WARM_TIMEOUT = 3     # How long to download each stream segment (3 seconds is enough to trigger Railway caching)

def get_channels_list():
    """Fetches the M3U playlist from Railway and extracts all channel stream URLs."""
    print("[VPS] Fetching M3U playlist from Railway to index channels...")
    try:
        r = requests.get(RAILWAY_PLAYLIST_URL, timeout=15)
        if r.status_code != 200:
            print(f"[Error] Failed to fetch playlist. Status: {r.status_code}")
            return []
        
        lines = r.text.split("\n")
        stream_urls = []
        for line in lines:
            line = line.strip()
            if line && line.startswith("http"):
                stream_urls.append(line)
        
        print(f"[VPS] Successfully indexed {len(stream_urls)} channels for warming!")
        return stream_urls
    except Exception as e:
        print(f"[Error] Failed to read playlist: {e}")
        return []

def warm_channel(stream_url):
    """Requests the stream from Railway, forcing the Railway container to fetch and cache it."""
    try:
        headers = {'User-Agent': 'NSPlayer'}
        # Request with a short timeout to just trigger the cache on Railway
        requests.get(stream_url, headers=headers, timeout=CHANNEL_WARM_TIMEOUT, stream=True)
    except requests.exceptions.Timeout:
        # Timeout is expected since we only want to trigger the cache download on Railway, not watch forever!
        pass
    except Exception:
        pass

def start_warming_loop():
    """Infinite loop that warms all channels 24/7."""
    while True:
        urls = get_channels_list()
        if not urls:
            print("[VPS] No channels found. Retrying in 30 seconds...")
            time.sleep(30)
            continue
        
        print(f"[VPS] Starting 24/7 warming cycle for {len(urls)} channels using {MAX_CONCURRENT_THREADS} threads...")
        start_time = time.time()
        
        with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_THREADS) as executor:
            executor.map(warm_channel, urls)
            
        elapsed = time.time() - start_time
        print(f"[VPS] Completed 1 full warming cycle in {elapsed:.2f} seconds. Starting next cycle immediately...")
        time.sleep(1)

if __name__ == "__main__":
    print("==================================================================")
    print("🚀 BOSS KOBIR - 24/7 RAILWAY STREAM WARMER RUNNING ON VPS")
    print("==================================================================")
    start_warming_loop()
