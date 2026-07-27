<?php
/**
 * Nexus — Smart XMLTV EPG Generator with Intelligent Caching & Category Filtering
 *
 * GET  /epg.php?token=YOUR_TOKEN   → Returns complete XMLTV EPG filtered by category
 */

require_once __DIR__ . '/StalkerLite.php';

date_default_timezone_set('Asia/Dhaka');

define('PORTAL_FILE',        __DIR__ . '/data/portal.json');
define('CHANNELS_FILE',      __DIR__ . '/data/channels.json');
define('USERS_FILE',         __DIR__ . '/data/users_account.json');
define('HIDDEN_GENRES_FILE', __DIR__ . '/data/hidden_genres.json');
define('EPG_CACHE_FILE',     __DIR__ . '/data/epg_cache.xml');

// ─── 1. Security Guard ───────────────────────────────────────────────────────
$userAccount = null;
if (file_exists(USERS_FILE)) {
    $userAccount = json_decode(file_get_contents(USERS_FILE), true);
}
$requiredToken = $userAccount['access_token'] ?? '';
if (!empty($requiredToken)) {
    $providedToken = $_GET['token'] ?? '';
    if ($providedToken !== $requiredToken) {
        http_response_code(403);
        header('Content-Type: text/plain; charset=utf-8');
        die("ACCESS DENIED: Invalid or missing secure EPG token (?token=your_token).");
    }
}

// Load Category Filter Preferences
$hiddenGenres = [];
if (file_exists(HIDDEN_GENRES_FILE)) {
    $hiddenGenres = json_decode(file_get_contents(HIDDEN_GENRES_FILE), true);
    if (!is_array($hiddenGenres)) $hiddenGenres = [];
}

// ─── 2. Micro-Cache Check (6 Hours) ──────────────────────────────────────────
if (file_exists(EPG_CACHE_FILE) && (time() - filemtime(EPG_CACHE_FILE)) < 21600) {
    header('Content-Type: application/xml; charset=utf-8');
    header('Cache-Control: public, max-age=21600');
    readfile(EPG_CACHE_FILE);
    exit;
}

// ─── 3. EPG Generation (Ezyro Free Host Optimized) ───────────────────────────
$portal = null;
if (file_exists(PORTAL_FILE)) {
    $portal = json_decode(file_get_contents(PORTAL_FILE), true);
}
$channelsData = null;
if (file_exists(CHANNELS_FILE)) {
    $channelsData = json_decode(file_get_contents(CHANNELS_FILE), true);
}

if (!$portal || !$channelsData || empty($channelsData['channels'])) {
    http_response_code(503);
    header('Content-Type: application/xml; charset=utf-8');
    echo '<?xml version="1.0" encoding="utf-8"?><tv generator-info-name="Nexus"><channel id="error"><display-name>No Channels Cached. Sync Portal First.</display-name></channel></tv>';
    exit;
}

// Prevent script timeout on free hosts
set_time_limit(120);

$stk = new StalkerLite(
    $portal['url'],
    $portal['mac'],
    $portal['model']  ?? 'MAG250',
    $portal['device'] ?? [],
    $portal['token']  ?? ''
);

$channels = $channelsData['channels'];
$scrapedLimit = 40; // Number of channels to scrape live EPG for
$scrapedCount = 0;

$xmlLines = [];
$xmlLines[] = '<?xml version="1.0" encoding="utf-8"?>';
$xmlLines[] = '<!DOCTYPE tv SYSTEM "xmltv.dtd">';
$xmlLines[] = '<tv generator-info-name="Nexus EPG Generator">';

// Filter out channels based on hidden genres list
$filteredChannels = [];
foreach ($channels as $ch) {
    $gId   = $ch['genre_id'] ?? '';
    $gName = $ch['genre_name'] ?? 'General';
    
    if (in_array($gId, $hiddenGenres) || in_array($gName, $hiddenGenres)) {
        continue;
    }
    $filteredChannels[] = $ch;
}

// Pre-write filtered channels
foreach ($filteredChannels as $ch) {
    $chId   = htmlspecialchars($ch['id'], ENT_QUOTES);
    $chName = htmlspecialchars($ch['name'], ENT_QUOTES);
    $chLogo = htmlspecialchars($ch['logo'] ?? '', ENT_QUOTES);
    
    $xmlLines[] = "  <channel id=\"{$chId}\">";
    $xmlLines[] = "    <display-name>{$chName}</display-name>";
    if (!empty($chLogo)) {
        $xmlLines[] = "    <icon src=\"{$chLogo}\" />";
    }
    $xmlLines[] = "  </channel>";
}

// Define generic schedules for fillers
$genresFiller = [
    'movies' => ['Blockbuster Movie Night', 'Action Movie Collection', 'Classic Cinema Gold', 'Hollywood Premium'],
    'sports' => ['Live Sports Arena', 'Championship Match replay', 'Sports Highlights Daily', 'Ultimate Sports Coverage'],
    'news'   => ['Global News Live', 'World Headlines Now', 'Business & Tech Report', 'Late Night Talk & Analysis'],
    'music'  => ['Non-Stop Hit Tracks', 'Acoustic Sessions Live', 'Throwback Melodies', 'Top Chart Countdown'],
    'kids'   => ['Cartoon Fun Palace', 'Animated Adventures', 'Morning Kids Show', 'Bedtime Fairytales'],
];

// Write programmes for filtered channels
foreach ($filteredChannels as $ch) {
    $chId      = $ch['id'];
    $chName    = htmlspecialchars($ch['name'], ENT_QUOTES);
    $genreName = strtolower($ch['genre_name'] ?? 'general');
    
    $hasRealEpg = false;
    
    // Attempt real scrape for first few channels
    if ($scrapedCount < $scrapedLimit) {
        $epgUrl = $stk->getServerUrl() . '?' . http_build_query([
            'type'          => 'itv',
            'action'        => 'get_short_epg',
            'ch_id'         => $chId,
            'JsHttpRequest' => '1-xml'
        ]);
        
        $res = $stk->curlGet($epgUrl, [], 3); // Short 3s timeout
        $data = @json_decode($res['data'], true);
        $epgList = $data['js']['data'] ?? $data['js'] ?? [];
        
        if (is_array($epgList) && !empty($epgList)) {
            $hasRealEpg = true;
            $scrapedCount++;
            foreach ($epgList as $prog) {
                if (!is_array($prog)) continue;
                
                $startRaw = $prog['start'] ?? '';
                $endRaw   = $prog['end']   ?? '';
                $title    = htmlspecialchars($prog['name']  ?? 'Live Broadcast', ENT_QUOTES);
                $descr    = htmlspecialchars($prog['descr'] ?? 'Enjoy live television streaming with crystal clear quality.', ENT_QUOTES);
                
                if (!empty($startRaw) && !empty($endRaw)) {
                    $startTimestamp = strtotime($startRaw);
                    $endTimestamp   = strtotime($endRaw);
                    
                    if ($startTimestamp !== false && $endTimestamp !== false) {
                        $startXml = date('YmdHis O', $startTimestamp);
                        $endXml   = date('YmdHis O', $endTimestamp);
                        
                        $xmlLines[] = "  <programme start=\"{$startXml}\" stop=\"{$endXml}\" channel=\"{$chId}\">";
                        $xmlLines[] = "    <title lang=\"en\">{$title}</title>";
                        $xmlLines[] = "    <desc lang=\"en\">{$descr}</desc>";
                        $xmlLines[] = "  </programme>";
                    }
                }
            }
        }
    }
    
    // Fallback Smart Filler Schedule (Realistic 24-hour schedules in 2-hour blocks)
    if (!$hasRealEpg) {
        $today = strtotime('today');
        for ($hour = 0; $hour < 24; $hour += 2) {
            $startTime = $today + ($hour * 3600);
            $endTime   = $startTime + (2 * 3600);
            
            $startXml = date('YmdHis O', $startTime);
            $endXml   = date('YmdHis O', $endTime);
            
            // Choose realistic title based on genre
            $titleList = ['Live Broadcast Schedule', 'General Entertainment', 'Nexus Special Selection', 'Prime Time Show'];
            foreach ($genresFiller as $key => $titles) {
                if (strpos($genreName, $key) !== false) {
                    $titleList = $titles;
                    break;
                }
            }
            $titleIndex = ($hour / 2) % count($titleList);
            $title = htmlspecialchars($titleList[$titleIndex], ENT_QUOTES);
            $descr = "Watching live broadcast of {$chName} in full HD quality. Live programming updated daily.";
            
            $xmlLines[] = "  <programme start=\"{$startXml}\" stop=\"{$endXml}\" channel=\"{$chId}\">";
            $xmlLines[] = "    <title lang=\"en\">{$title}</title>";
            $xmlLines[] = "    <desc lang=\"en\">{$descr}</desc>";
            $xmlLines[] = "  </programme>";
        }
    }
}

$xmlLines[] = '</tv>';
$fullXml = implode("\n", $xmlLines);

@mkdir(dirname(EPG_CACHE_FILE), 0755, true);
@file_put_contents(EPG_CACHE_FILE, $fullXml);

header('Content-Type: application/xml; charset=utf-8');
header('Cache-Control: public, max-age=21600');
echo $fullXml;
exit;
