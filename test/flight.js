"use strict";
const assert = require("assert");
global.window = global;
require("../js/flight.js");
require("../js/guidance.js");
const F = global.StarbaseFlight;
const G = global.StarbaseGuidance;
const W = F.WORLD;

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log("ok  " + name);
  } catch (err) {
    failed++;
    console.error("FAIL " + name);
    console.error(err && err.stack || err);
  }
}

check("circular orbit closes", () => {
  const r = W.R_EARTH + 200e3;
  const v = Math.sqrt(W.MU_EARTH / r);
  const period = 2 * Math.PI * Math.sqrt(r * r * r / W.MU_EARTH);
  const earth = F.bodyState("earth", 0);
  const state = F.createFlight();
  state.airborne = true;
  state.status = "flight";
  state.parentId = "earth";
  state.x = earth.x + r;
  state.y = earth.y;
  state.vx = earth.vx;
  state.vy = earth.vy + v;
  F.advance(state, { burn: 0, angle: 0 }, period);
  const e2 = F.bodyState("earth", state.t);
  assert.ok(Math.abs(state.x - e2.x - r) < 2500, "x");
  assert.ok(Math.abs(state.y - e2.y) < 2500, "y");
});

check("ellipse apo and peri sit where they should", () => {
  const rp = W.R_EARTH + 200e3;
  const ra = W.R_EARTH + 2000e3;
  const a = (rp + ra) / 2;
  const e = (ra - rp) / (ra + rp);
  const vp = Math.sqrt(W.MU_EARTH * (1 + e) / rp);
  const earth = F.bodyState("earth", 0);
  const state = F.createFlight();
  state.airborne = true;
  state.status = "flight";
  state.parentId = "earth";
  state.x = earth.x + rp;
  state.y = earth.y;
  state.vx = earth.vx;
  state.vy = earth.vy + vp;
  const info = F.analyze(state);
  assert.ok(Math.abs(info.periAlt - 200e3) < 800, "peri " + info.periAlt);
  assert.ok(Math.abs(info.apoAlt - 2000e3) < 2500, "apo " + info.apoAlt);
  F.advance(state, { burn: 0, angle: 0 }, info.timeToApo);
  const atApo = F.analyze(state);
  assert.ok(atApo.nearApo, "near apo");
  assert.ok(Math.abs(atApo.alt - 2000e3) < 4000, "alt " + atApo.alt);
});

check("the pad holds until the burn can lift", () => {
  const held = F.createFlight();
  F.advance(held, { burn: 0.2, angle: held.nose + Math.PI / 2 }, 3);
  assert.strictEqual(held.airborne, false);
  const go = F.createFlight();
  assert.strictEqual(F.willLift(go, { burn: 0.8, angle: go.nose }), true);
  F.advance(go, { burn: 0.8, angle: go.nose }, 2);
  assert.strictEqual(go.airborne, true);
  assert.ok(F.analyze(go).alt > 15, "alt " + F.analyze(go).alt);
});

function pitchOf(alt) {
  if (alt < 400) return 2 * W.DEG;
  if (alt < 2000) return 12 * W.DEG;
  if (alt < 6000) return 25 * W.DEG;
  if (alt < 12000) return 45 * W.DEG;
  if (alt < 25000) return 65 * W.DEG;
  return null;
}

function stepFor(advice, a, state) {
  const burning = advice.now && (advice.cue === "burn-prograde" || advice.cue === "burn-retrograde" || advice.cue === "burn-out" || advice.cue === "burn-in" || advice.cue === "tilt-gulf");
  if (burning) return 0.35;
  if (advice.cue === "wait-moon") return 25;
  if (advice.where && advice.seconds != null) {
    const s = advice.seconds;
    if ((a.parent === "mars" || a.parent === "sun") && s > 180) return Math.min(s * 0.2, 3 * 3600);
    return Math.min(30, Math.max(0.5, s * 0.4));
  }
  if (a.parent === "sun") {
    const mars = F.bodyState("mars", state.t);
    const d = Math.hypot(state.x - mars.x, state.y - mars.y);
    return d < 4e10 ? 1800 : 6 * 3600;
  }
  if (a.parent === "moon" || a.parent === "mars") {
    return Math.min(90, Math.max(1, (advice.seconds || a.timeToPeri || 30) * 0.35));
  }
  if (a.apo > 8e7) return 240;
  return 8;
}

function intentFor(state, advice, style) {
  const a = advice.analysis;
  let burn = 0;
  let angle = a.prograde;
  if (!state.airborne || advice.cue === "ready" || advice.cue === "tilt-gulf" || advice.cue === "point-up") {
    burn = advice.cue === "point-up" ? 1 : 1;
    const pitch = !state.airborne
      ? (style === "fixed" ? 28 * W.DEG : 8 * W.DEG)
      : (style === "fixed" ? 28 * W.DEG : pitchOf(a.alt));
    angle = pitch == null ? a.prograde : a.up + pitch;
    if (advice.cue === "point-up") angle = a.up;
  } else if (advice.cue === "burn-prograde") {
    angle = a.prograde;
    burn = advice.now ? 1 : 0;
  } else if (advice.cue === "burn-retrograde" || advice.cue === "burn-in") {
    angle = advice.cue === "burn-in" ? F.wrap(a.up + Math.PI) : a.retrograde;
    burn = advice.now ? 1 : 0;
  } else if (advice.cue === "burn-out") {
    angle = a.up;
    burn = advice.now ? 1 : 0;
  }
  return { burn, angle };
}

function flyByCues(style, done, limitDays) {
  const state = F.createFlight();
  const limit = (limitDays || 8) * W.DAY;
  let guard = 0;
  let lastCue = "";
  while (guard++ < 250000 && state.t < limit && state.status !== "lost" && state.status !== "landed") {
    const preview = { burn: 1, angle: state.nose };
    const advice = G.advise(state, preview);
    if (done(state, advice)) return { state, advice };
    const intent = intentFor(state, advice, style);
    const step = stepFor(advice, advice.analysis, state);
    if (advice.cue !== lastCue && guard < 4000) {
      lastCue = advice.cue;
    }
    F.advance(state, intent, step);
  }
  return { state, advice: G.advise(state, { burn: 0, angle: state.nose }) };
}

check("cues carry a launch from South Texas into Earth orbit and on to the Moon", () => {
  const { state, advice } = flyByCues("schedule", (s, adv) => {
    return adv.headed === "moon-orbit" || (s.parentId === "moon" && adv.cue === "coast" && adv.analysis.ecc < 1);
  }, 12);
  const a = F.analyze(state);
  console.log("  moon", a.parent, "headed", advice.headed, "apo", isFinite(a.apoAlt) ? (a.apoAlt / 1000).toFixed(0) : "inf", "peri", (a.periAlt / 1000).toFixed(0), "ecc", a.ecc.toFixed(3), "fuel", state.fuel.toFixed(3), "days", (state.t / W.DAY).toFixed(2), "status", state.status);
  assert.strictEqual(a.parent, "moon");
  assert.ok(a.ecc < 1, "ecc " + a.ecc);
  assert.ok(a.periAlt > 15000, "peri " + a.periAlt);
  assert.ok(state.fuel > 0.2, "fuel " + state.fuel);
});

check("a fixed tilt toward the Gulf still makes orbit", () => {
  const { state, advice } = flyByCues("fixed", (s, adv) => adv.headed === "earth-orbit" || adv.headed === "moon" || adv.headed === "moon-orbit", 2);
  const a = advice.analysis;
  console.log("  fixed", advice.headed, "apo", (a.apoAlt / 1000).toFixed(0), "peri", (a.periAlt / 1000).toFixed(0), "fuel", state.fuel.toFixed(3), "status", state.status);
  assert.ok(a.periAlt > 140e3, "peri " + a.periAlt);
  assert.ok(a.apoAlt > 160e3, "apo " + a.apoAlt);
  assert.strictEqual(state.status, "flight");
});

check("Mars orbit is reachable with the same cues", () => {
  const flown = flyByCues("schedule", (s, adv) => adv.headed === "earth-orbit" && adv.cue === "wait-moon", 1);
  const state = flown.state;
  assert.ok(state.fuel > 0.45, "fuel before departure " + state.fuel);
  let guard = 0;
  let sawMars = false;
  while (guard++ < 400000 && state.parentId === "earth" && state.status === "flight" && state.t < 4 * W.DAY) {
    const advice = G.advise(state, { burn: 0, angle: state.nose });
    if (advice.mars && advice.mars.now) {
      sawMars = true;
      F.advance(state, { burn: 1, angle: advice.analysis.prograde }, 0.3);
    } else if (sawMars) break;
    else F.advance(state, { burn: 0, angle: advice.analysis.prograde }, 8);
  }
  assert.ok(sawMars, "mars lineup");
  guard = 0;
  while (guard++ < 20000 && state.parentId === "earth" && state.status === "flight") {
    F.advance(state, { burn: 0, angle: state.nose }, 400);
  }
  guard = 0;
  while (guard++ < 30000 && state.t < 420 * W.DAY && state.status === "flight") {
    const advice = G.advise(state, { burn: 0, angle: state.nose });
    if (advice.headed === "mars-orbit") break;
    const intent = intentFor(state, advice, "schedule");
    let step = stepFor(advice, advice.analysis, state);
    if (advice.analysis.parent === "sun" && intent.burn === 0) {
      const mars = F.bodyState("mars", state.t);
      const d = Math.hypot(state.x - mars.x, state.y - mars.y);
      step = d < 3e10 ? 1200 : 6 * 3600;
    }
    F.advance(state, intent, step);
  }
  const a = F.analyze(state);
  console.log("  mars", a.parent, adviceHead(state), "ecc", a.ecc.toFixed(3), "peri", (a.periAlt / 1000).toFixed(0), "apo", isFinite(a.apoAlt) ? (a.apoAlt / 1000).toFixed(0) : "inf", "fuel", state.fuel.toFixed(3), "days", (state.t / W.DAY).toFixed(1), "status", state.status);
  assert.strictEqual(a.parent, "mars");
  assert.strictEqual(adviceHead(state), "mars-orbit");
  assert.ok(a.ecc < 1, "ecc " + a.ecc);
  assert.ok(a.periAlt > 80000, "peri " + a.periAlt);
  assert.ok(isFinite(a.apo) && a.apo < W.SOI_MARS, "apo " + a.apo);
});

function adviceHead(state) {
  return G.advise(state, { burn: 0, angle: state.nose }).headed;
}

console.log(failed ? failed + " failed" : "all passed");
process.exit(failed ? 1 : 0);
