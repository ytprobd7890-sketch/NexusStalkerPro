import time
import requests
import threading
from concurrent.futures import ThreadPoolExecutor

# ==============================================================================
# Boss Kobir - IPTV VPS Active 24/7 Stream Cacher & Warmer Script
# ==============================================================================
# This script runs 24/7 on your personal VPS.
#
# HOW IT AUTOMATICALLY CACHES ALL VIDEO CHUNKS 24/7 PERFECTLY:
# 1. It fetches the master M3U playlist from your Railway server.
# 2. It loops through all channels and requests their sub-playlist (.m3u8).
# 3. It parses the sub-playlist to extract the actual .ts video segment URLs.
# 4. It requests the first .ts segment from your Pro Cache Node (Container 2).
# 5. This forces your Pro Cache Node to download and cache the actual live video
#    chunks on its 1TB+ SSD disk 24/7, even when no real user is watching!
# ==============================================================================

# Configuration
RAILWAY_PLAYLIST_URL = "https://tatatv.kobir26.qzz.io/playlist.php?token=kobir26tata27"
MAX_CONCURRENT_THREADS = 60  # High concurrent threads to warm multiple channels simultaneously
CHANNEL_WARM_TIMEOUT = 3     # Timeout to trigger the caching process

def get_channels_list():
    """Fetches the master M3U playlist from Railway and indexes all channel URLs."""
    print("[VPS] Fetching master M3U playlist to index channels...")
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
        
        print(f"[VPS] Successfully indexed {len(stream_urls)} channels for proactive 24/7 caching!")
        return stream_urls
    except Exception as e:
        print(f"[Error] Failed to read playlist: {e}")
        return []

def warm_and_cache_channel(stream_url):
    """
    Requests the sub-playlist, parses the .ts segment URL, and requests it 
    from the Pro Cache Node to force direct disk caching of video chunks.
    """
    try:
        headers = {'User-Agent': 'NSPlayer'}
        
        # Step 1: Request the sub-playlist (.m3u8) from Railway (Container 1)
        r = requests.get(stream_url, headers=headers, timeout=5)
        if r.status_code != 200:
            return
        
        # Step 2: Parse the returned manifest to find the PRO Cache Node segment URL
        lines = r.text.split("\n")
        segment_url = ""
        for line in lines:
            line = line.strip()
            if line and "segment?url=" in line:
                segment_url = line
                break
        
        # Step 3: Hit the Pro Cache Node segment URL (Container 2)
        # This triggers the Cache Node to download the raw .ts file and save it to 1TB SSD!
        if segment_url:
            requests.get(segment_url, headers=headers, timeout=CHANNEL_WARM_TIMEOUT, stream=True)
    except Exception:
        pass

def start_active_caching_loop():
    """Infinite loop that runs the active 24/7 video chunk caching process."""
    while True:
        urls = get_channels_list()
        if not urls:
            print("[VPS] No channels found. Retrying in 15 seconds...")
            time.sleep(15)
            continue
        
        print(f"[VPS] Launching active caching cycle for {len(urls)} channels using {MAX_CONCURRENT_THREADS} threads...")
        start_time = time.time()
        
        # Run multithreaded warming across all channels
        with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_THREADS) as executor:
            executor.map(warm_and_cache_channel, urls)
            
        elapsed = time.time() - start_time
        print(f"[VPS] Completed 1 active caching cycle in {elapsed:.2f} seconds. Starting next cycle immediately...")
        time.sleep(1)

if __name__ == "__main__":
    print("==================================================================")
    print("🚀 BOSS KOBIR - ACTIVE 24/7 PRO CACHE NODE VIDEO WARMER RUNNING")
    print("==================================================================")
    start_active_caching_loop()
