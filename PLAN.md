# Starbase 2042, version 2

The page is the game. A later App Store build wraps this same page. It does not become a Swift rewrite. Accounts, a server, payments, and the store listing stay out of this repo.

## Split

Flight math does not know about the screen. `js/flight.js` steps a ship from intents `{ burn, angle }` and returns numbers.

Rendering does not own the physics. `js/render.js` only reads a snapshot and draws it.

Save and load live in `js/save.js`. The key is `starbase2042.save`. The document version is 2. A file from another version is ignored. The shape is `{ version, muted, progress, resume }`. `resume` is a flight snapshot, also version 2. Storage is `localStorage` on the device.

Controls are intents. `js/controls.js` turns the burn and the aim into `{ burn, angle }`. Time warp and “to periapsis / to apoapsis” are outside the integrator. Button handlers stay in `js/main.js`.

`js/guidance.js` returns short cue names, not sentences. `js/hud.js` turns those names into the few lines on screen. `js/map.js` is coastline data.

## Play

Set how hard to burn and which way, then fire from South Texas. The drive is strong enough that Earth orbit, the Moon, and a Mars orbit are all in reach. Burning near apoapsis or periapsis changes the orbit. The words on screen are the cue, not a lecture.
