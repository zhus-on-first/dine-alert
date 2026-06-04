// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: light-brown; icon-glyph: utensils;
// ================================================================
// restaurant_detector.js — Scriptable
//
// Triggered by Pushcut or Shortcuts on a schedule.
// Handles: category detection via Nominatim, exclusion zones,
//          dwell detection, notification, logging.
//
// Network: one Nominatim call per trigger (OpenStreetMap, nonprofit)
// All other logic stays on-device.
// ================================================================


// ================================================================
// CONFIG — the only section you need to edit
// ================================================================
const CONFIG = {

  // Your exclusion zones — won't alert when near these.
  // To get your coordinates: run the helper at the bottom once.
  exclusionZones: [
    { name: "Home", lat: 64.75, lon: 147.35 },
    // { name: "Work", lat: 0.00, lon: -0.00 },
  ],

  // Must be at least this far (meters) from any exclusion zone
  exclusionRadiusM: 150,

  // OSM venue types that count as "at a restaurant"
  // Full list: https://wiki.openstreetmap.org/wiki/Key:amenity
  foodTypes: [
    "restaurant", "cafe", "fast_food", "bar", "pub",
    "food_court", "ice_cream", "bakery", "biergarten"
  ],

  // Must stay within this distance of first-check location to confirm dwell
  dwellConfirmRadiusM: 200,

  // Minutes you must be at a location before notifying.
  // With 30-min trigger intervals, 20 min means second trigger confirms.
  minDwellMinutes: 10,

  // Forget a stored first-check after this long (stale data protection)
  maxStateAgeMinutes: 90,

  // Don't re-notify near the same location within this many hours
  notificationCooldownHours: 8,

  // Tap notification → opens DoorDash
  doordashURL: "doordash://",

  // Nominatim requires a User-Agent identifying your client.
  // Just a label — doesn't need to be a real URL.
  nominatimUserAgent: "personal-ios-restaurant-detector/1.0",
};


// ================================================================
// FILE PATHS
// ================================================================
const fm         = FileManager.iCloud();
const docsDir    = fm.documentsDirectory();
const STATE_FILE = fm.joinPath(docsDir, "restaurant_state.json");
const LOG_FILE   = fm.joinPath(docsDir, "restaurant_log.txt");


// ================================================================
// LOGGING
// View live: Scriptable app → run script → console at bottom
// View history: Scriptable → ≡ → Files → restaurant_log.txt
// ================================================================
function log(message) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}\n`;
  console.log(entry.trim());

  const existing = fm.fileExists(LOG_FILE) ? fm.readString(LOG_FILE) : "";
  const lines = (existing + entry).split("\n");

  // Cap at 200 lines — oldest lines drop off automatically
  fm.writeString(LOG_FILE, lines.slice(-200).join("\n"));
}


// ================================================================
// STATE — persists between script runs for dwell detection.
// The script never stores "you've been here X minutes" directly —
// it stores the start time and does the math fresh each run.
// ================================================================
function readState() {
  if (!fm.fileExists(STATE_FILE)) return null;
  try {
    return JSON.parse(fm.readString(STATE_FILE));
  } catch {
    log("State file unreadable — clearing.");
    clearState();
    return null;
  }
}

function writeState(state) {
  fm.writeString(STATE_FILE, JSON.stringify(state, null, 2));
}

function clearState() {
  if (fm.fileExists(STATE_FILE)) fm.remove(STATE_FILE);
}


// ================================================================
// HAVERSINE DISTANCE
// Returns surface distance in meters between two lat/lon points.
//
// Why not just subtract coordinates?
//   Lat/lon are angles on a sphere, not x/y on a flat grid.
//   1° of latitude ≈ 111km always, but 1° of longitude shrinks
//   as you approach the poles (lines converge and meet there).
//   Simple subtraction treats them as equal units — wrong.
//   Haversine accounts for the sphere's curvature correctly.
// ================================================================
function distanceBetween(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(lat1 * Math.PI/180) *
            Math.cos(lat2 * Math.PI/180) *
            Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}


// ================================================================
// NOMINATIM CATEGORY CHECK
// One HTTP call to OpenStreetMap's reverse geocoder.
// Returns the OSM venue type at your coordinates, or null on failure.
//
// Nominatim usage policy:
//   - Max 1 request/second (fine here — one call per trigger interval)
//   - Requires User-Agent header (set in CONFIG above)
//   - No API key needed
//   - https://operations.osmfoundation.org/policies/nominatim/
// ================================================================
async function getVenueType(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;

  const req = new Request(url);
  req.headers = {
    "User-Agent": CONFIG.nominatimUserAgent,
    "Accept-Language": "en",
  };

  try {
    const result = await req.loadJSON();
    const type = result?.type || null;
    log(`Nominatim response — type: "${type}", name: "${result?.name || "unknown"}"`);
    return type;
  } catch (e) {
    log(`Nominatim request failed: ${e.message}`);
    return null;
  }
}


// ================================================================
// NOTIFICATION
// reverseGeocode used only for a human-readable name in the alert —
// not for category detection. Category is handled by Nominatim above.
// ================================================================
async function sendNotification(lat, lon) {
  const geo       = await Location.reverseGeocode(lat, lon);
  const placeName = geo?.[0]?.name || "a restaurant nearby";

  const notif      = new Notification();
  notif.identifier = `doordash-${Date.now()}`;
  notif.title      = "🍽️ DoorDash Dine-In Credits";
  notif.body       = `You're at ${placeName} — claim your DashPass dine-in credit!`;
  notif.openURL    = CONFIG.doordashURL;
  notif.sound      = "default";
  await notif.schedule();

  log(`Notification sent for: ${placeName}`);
}


// ================================================================
// MAIN
// ================================================================
async function run() {
  log("─── Triggered ───");

  // Get current location — Core Location, on-device
  Location.setAccuracyToHundredMeters();
  const loc = await Location.current();
  const { latitude: lat, longitude: lon } = loc;
  log(`Location: ${lat.toFixed(5)}, ${lon.toFixed(5)}`);


  // ── Step 1: Exclusion Zones ──────────────────────────────────
  // Check before any network call — bail immediately if near home/work.
  for (const zone of CONFIG.exclusionZones) {
    const dist = distanceBetween(lat, lon, zone.lat, zone.lon);
    if (dist < CONFIG.exclusionRadiusM) {
      log(`Within "${zone.name}" zone — ${Math.round(dist)}m (limit: ${CONFIG.exclusionRadiusM}m). Clearing state and exiting.`);
      clearState();
      return;
    }
    log(`Outside "${zone.name}" zone — ${Math.round(dist)}m. OK.`);
  }


  // ── Step 2: Category Check ───────────────────────────────────
  // One Nominatim call. If the venue type isn't a food place, exit.
  // This replaces Shortcuts' "Find Places" — no Yelp prompts.
  const venueType = await getVenueType(lat, lon);

  if (!venueType || !CONFIG.foodTypes.includes(venueType)) {
    log(`Not a food venue (type: "${venueType}"). Clearing state and exiting.`);
    clearState();
    return;
  }

  log(`Food venue confirmed: "${venueType}".`);


  // ── Step 3: Dwell Detection via State File ───────────────────
  const now   = new Date();
  const state = readState();

  if (state) {
    const ageMinutes      = (now - new Date(state.timestamp)) / 1000 / 60;
    const distFromPending = distanceBetween(lat, lon, state.pendingLat, state.pendingLon);

    log(`Pending state: ${Math.round(ageMinutes)} min old, ${Math.round(distFromPending)}m from stored location.`);

    // State is too old — probably left hours ago undetected
    if (ageMinutes > CONFIG.maxStateAgeMinutes) {
      log(`State expired (${Math.round(ageMinutes)} min > ${CONFIG.maxStateAgeMinutes} min limit). Storing fresh first check.`);
      clearState();
      // fall through to Step 4

    // Moved too far — left the restaurant
    } else if (distFromPending > CONFIG.dwellConfirmRadiusM) {
      log(`Moved ${Math.round(distFromPending)}m from stored location (limit: ${CONFIG.dwellConfirmRadiusM}m). Left restaurant. Clearing.`);
      clearState();
      return;

    // Already notified — check cooldown
    } else if (state.notifiedAt) {
      const hoursSince = (now - new Date(state.notifiedAt)) / 1000 / 60 / 60;
      if (hoursSince < CONFIG.notificationCooldownHours) {
        log(`Already notified ${hoursSince.toFixed(1)}h ago. Cooldown: ${CONFIG.notificationCooldownHours}h. Skipping.`);
        return;
      } else {
        log(`Cooldown expired (${hoursSince.toFixed(1)}h). Clearing for fresh session.`);
        clearState();
        // fall through to Step 4
      }

    // Dwell confirmed — been here long enough
    } else if (ageMinutes >= CONFIG.minDwellMinutes) {
      log(`Dwell confirmed: ${Math.round(ageMinutes)} min ≥ ${CONFIG.minDwellMinutes} min minimum. Notifying.`);
      await sendNotification(lat, lon);
      writeState({ ...state, notifiedAt: now.toISOString() });
      return;

    // Still waiting — not long enough yet
    } else {
      log(`Waiting: ${Math.round(ageMinutes)} min elapsed, need ${CONFIG.minDwellMinutes} min. Will re-check next trigger.`);
      return;
    }
  }


  // ── Step 4: Store First Check ────────────────────────────────
  // Category confirmed, not in exclusion zone, no prior state.
  // Record location + time. Next trigger will evaluate dwell.
  log(`No pending state. Storing first check at "${venueType}".`);
  writeState({
    pendingLat: lat,
    pendingLon: lon,
    timestamp:  now.toISOString(),
    venueType:  venueType,
  });
}

await run();
Script.complete();

// ================================================================
// ONE-TIME COORDINATE HELPER
// Uncomment, run once manually, copy the output into CONFIG above,
// then re-comment this block.
// ================================================================
// const l = await Location.current();
// console.log(`lat: ${l.latitude}, lon: ${l.longitude}`);
