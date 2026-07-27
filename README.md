# 🚀 Nexus Premium — Enterprise Stalker Portal Manager

<p align="center">
  <img src="data/logo.png" alt="Nexus Premium Logo" width="128" height="128">
</p>

Nexus Premium is a high-performance, enterprise-grade Stalker Portal management and metadata gateway designed for absolute speed, security, and smart EPG integration. Specially tuned for resource-constrained PaaS platforms (like **Railway.app** with 512MB RAM / 2 vCPUs) and optimized with dedicated Nginx-powered local caching layers for lag-free global streaming.

---

## 👑 Ownership & Credits
This premium enterprise repository has been specially upgraded, customized, and is owned by **Boss Kobir**. 

---

## ✨ Pro & Enterprise Features

- **📂 Multi-Portal Manager**: Add, configure, and manage unlimited Stalker Portals simultaneously from a single responsive dashboard. Switch active portals with a single click.
- **🛡️ Access Token Security**: Protect your playlist and EPG links from being stolen or abused. All requests are protected by a secure, auto-generated 10-character alphanumeric token.
- **📡 Smart EPG XMLTV Generator (`epg.php`)**: Generates industry-standard XMLTV guide. Includes a high-efficiency 6-hour local cache to prevent cURL timeouts and stay safe on free hosts.
- **⚙️ Dynamic Category & Group Filters**: Show/hide specific genres/groups directly from the dashboard. Unchecked categories are skipped in both the M3U playlist and EPG, saving huge bandwidth and RAM.
- **🌐 Dual EPG Headers (`x-tvg-url` & `url-tvg`)**: Automatically appends EPG links to both headers inside the M3U file, ensuring 100% compatibility with TiviMate, OTT Navigator, and other IPTV apps.
- **🔌 External EPG Sources Merger**: Add and manage custom XMLTV URLs (like IPTV-Org) from your dashboard and combine them with your local EPG into a single unified playlist header.
- **⚡ Pro-Tuned for Railway (512MB RAM)**: Production Docker container setup equipped with tailored OPcache and optimized Apache MPM worker limits to run seamlessly on restricted resources.

---

## 📂 Pro Repository Structure

```text
Nexus-Stalker2M3u8/
├── Dockerfile             # Production multi-stage Docker build for Railway
├── optimized.ini          # Optimized PHP & OPcache settings for 512MB RAM
├── index.php              # Premium responsive Multi-Portal & Security Dashboard
├── playlist.php           # Secure M3U Generator & Stream Proxy
├── epg.php                # Smart cached XMLTV EPG Generator
├── sync.php               # Standalone channel synchronization script
├── login.php              # Secure login & auto-token generation setup
├── StalkerLite.php        # Core Stalker Portal API wrapper
├── error.php              # Custom-styled 403/404/500 Error template
├── .htaccess              # Master routing and apache directory security
└── data/                  # Flat-file JSON database & local caches (Protected)
    ├── .htaccess          # Direct HTTP access block for database security
    ├── forbidden.php      # Custom-styled forbidden access landing page
    ├── portals_list.json  # Database containing all configured portals
    ├── portal.json        # Currently active/selected portal
    ├── channels.json      # Cached synced channel repository
    ├── epg_cache.xml      # Cached XMLTV EPG file (Refreshes every 6 hours)
    └── users_account.json # Secure admin account credentials & unique XOR keys
```

---

## 🚀 Getting Started

### 1. Automated Railway Deployment (Singapore Node)
Nexus Premium is fully containerized and compatible with Railway's serverless PaaS:
1. Push this repository to a private GitHub repo.
2. Go to **Railway.app**, click **New Project**, and select **Deploy from GitHub**.
3. Choose your repository. Railway will detect the `Dockerfile` and deploy the service automatically in Singapore.
4. Copy your secure public domain URL from Railway.

### 2. Personal Nginx Cache Node VPS Configuration
For ultra-fast, zero-buffering playback, deploy this Nginx configuration on your personal VPS to cache the live `.ts` video chunks of Stalker portals:
1. Copy the optimized Nginx configuration from your dashboard.
2. Paste it inside `/etc/nginx/sites-available/default` on your VPS.
3. Restart Nginx: `sudo systemctl restart nginx`.

---

## 🔒 Security Notes
- Direct access to `.json` flat-file databases in the `data/` directory is strictly forbidden via HTTP/HTTPS.
- To prevent brute-forcing, the dashboard is protected by an idle session timeout of 5 minutes.

---

Crafted with ❤️ by **LazyyXD** & Specially Upgraded & Owned by **Boss Kobir**. 
*(This project is for educational and personal backup purposes only.)*
