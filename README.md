# Dine Alert

An automated iOS system that detects when you're dining at a restaurant and sends a notification to claim DoorDash dine-in credits. Built with Scriptable and iOS Shortcuts. No full app required.

---

## How It Works

```
iOS Shortcuts (time-based trigger)
  → Scriptable script runs
    → Gets current location (Core Location, on-device)
    → Checks exclusion zones (home, work) via Haversine distance
    → Calls Nominatim to confirm venue category (OpenStreetMap)
    → Dwell detection via state file (confirms you're staying, not passing by)
    → Fires local notification → tap opens DoorDash
```

---

## Privacy

- Location never leaves your device except for one call to [Nominatim](https://nominatim.openstreetmap.org/) (OpenStreetMap's reverse geocoder — nonprofit, no account, no tracking, no API key)
- No third-party location services (no Foursquare, no Yelp, no Google)
- State and log files stored locally in Scriptable's iCloud documents folder
- Notification is local — nothing sent to a server

---

## Requirements

- iPhone running iOS 15+
- [Scriptable](https://apps.apple.com/us/app/scriptable/id1405459188) (free)
- iOS Shortcuts app (built into iOS)

---

## Setup

### 1. Get Your Exclusion Zone Coordinates

Open Scriptable, create a new script, paste and run this one-liner:

```javascript
const l = await Location.current();
console.log(`lat: ${l.latitude}, lon: ${l.longitude}`);
```

Run it once at home, note the output. Run it again at work. You'll paste these into the config below.

### 2. Install the Script

- Open Scriptable → tap **+** to create a new script
- Name it exactly: `restaurant_detector`
- Paste the contents of `restaurant_detector.js`
- Edit the `CONFIG` block at the top with your coordinates

### 3. Set Up Shortcuts Automations

Create one automation per time slot you want checked. Each automation is identical — only the time changes.

**Possible times:**
| Window | Times |
|---|---|
| Lunch | 11:30 AM, 12:00 PM, 12:30 PM |
| Dinner | 5:30 PM, 6:00 PM, 6:30 PM, 7:00 PM, 7:30 PM |

**For each time slot:**

1. Shortcuts → **Automation** tab → **+** → **Time of Day**
2. Set your time → Repeat: **Daily**
3. Tap **Next** → **Add Action** → search **Scriptable** → **Run Script**
4. Select `restaurant_detector`
5. Toggle **Ask Before Running** → **Off**
6. Toggle **Show When Run** → **Off**
7. Tap **Done**

---

## Configuration

All tunable values are at the top of `restaurant_detector.js`.

---

## Files

| File | Purpose |
|---|---|
| `restaurant_detector.js` | The Scriptable script — all logic lives here |
| `restaurant_state.json` | Auto-created at runtime. Tracks dwell state. |
| `restaurant_log.txt` | Auto-created at runtime. Rolling 200-line log. |

State and log files are written to Scriptable's iCloud documents folder. View them in:

```
Files app → iCloud Drive → Scriptable
```

---

## Dwell Detection

The script never notifies on first detection — it confirms you're actually staying.

```
Trigger 1 → food venue found → store location + timestamp → exit silently
Trigger 2 → food venue found → elapsed time ≥ minDwellMinutes → notify
```

If you move more than `dwellConfirmRadiusM` meters between checks, state is cleared — you walked past a restaurant, not dined in one.

---

## Sample Log Output

```
[2026-05-31T12:00:01Z] ─── Triggered ───
[2026-05-31T12:00:02Z] Location: 00, 00
[2026-05-31T12:00:02Z] Outside "Home" zone — 843m. OK.
[2026-05-31T12:00:02Z] Outside "Work" zone — 1204m. OK.
[2026-05-31T12:00:02Z] Nominatim response — type: "restaurant", name: "Tartine Manufactory"
[2026-05-31T12:00:02Z] Food venue confirmed: "restaurant".
[2026-05-31T12:00:02Z] No pending state. Storing first check at "restaurant".

[2026-05-31T12:15:01Z] ─── Triggered ───
[2026-05-31T12:15:02Z] Location: 00, 00
[2026-05-31T12:15:02Z] Outside "Home" zone — 847m. OK.
[2026-05-31T12:15:02Z] Outside "Work" zone — 1201m. OK.
[2026-05-31T12:15:02Z] Nominatim response — type: "restaurant", name: "Tartine Manufactory"
[2026-05-31T12:15:02Z] Food venue confirmed: "restaurant".
[2026-05-31T12:15:02Z] Pending state: 15 min old, 5m from stored location.
[2026-05-31T12:15:02Z] Dwell confirmed: 15 min ≥ 10 min minimum. Notifying.
[2026-05-31T12:15:02Z] Notification sent for: Tartine Manufactory
```

---

## Troubleshooting

**No notification firing**
- Run the script manually in Scriptable and check the console output at the bottom
- Confirm location permissions: Settings → Scriptable → Location → **Always**
- Confirm `minDwellMinutes` is less than your trigger interval

**Notification fires at home or work**
- Check your exclusion zone coordinates — run the one-liner helper to get fresh coordinates
- Consider increasing `exclusionRadiusM` if you live close to a restaurant

**Nominatim returns null or wrong type**
- You may be at a venue OSM doesn't have categorized yet
- Check [openstreetmap.org](https://www.openstreetmap.org) and search your location to see how it's tagged

**Script not running from Shortcuts**
- Confirm `Script.complete()` is at the bottom of the script
- Confirm **Run In App** and **Show When Run** are both toggled off in the Shortcut action

---

## Nominatim Usage Policy

This project makes one HTTP request per trigger interval to Nominatim, OpenStreetMap's reverse geocoding service.

- Max 1 request/second — this project is well within that limit
- User-Agent header is required and included
- No API key needed
- Full policy: [operations.osmfoundation.org/policies/nominatim](https://operations.osmfoundation.org/policies/nominatim/)
