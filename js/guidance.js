"use strict";
/* Reads the flight and returns a short cue. No document and no drawing. */
(function (root) {
  const F = root.StarbaseFlight;
  const W = F.WORLD;

  function untilAligned(state, a) {
    const r1 = Math.max(W.R_EARTH + 180000, Math.min(a.radius, W.MOON_ORBIT * 0.45));
    const axis = (r1 + W.MOON_ORBIT) / 2;
    const tTrans = Math.PI * Math.sqrt(axis * axis * axis / W.MU_EARTH);
    const nMoon = W.TAU / (27.321661 * W.DAY);
    const nShip = a.period > 0
      ? W.TAU / a.period
      : Math.sqrt(W.MU_EARTH / Math.pow(Math.max(a.radius, W.R_EARTH + 1), 3));
    const err = F.wrap(F.shipAngle(state) + Math.PI - nMoon * tTrans - F.moonAngle(state.t));
    const rate = nShip - nMoon;
    let seconds = null;
    if (rate > 1e-8) {
      let raw = -err;
      if (raw < 0) raw += W.TAU;
      seconds = raw / rate;
    }
    return { seconds, aligned: Math.abs(err) < 14 * W.DEG };
  }

  const MARS_AIM = -46 * W.DEG;
  let hintCache = null;

  function marsOpportunity(state, a) {
    if (!a || a.parent !== "earth") return null;
    if (!(a.periAlt > 120000)) return null;
    const over = a.speed - Math.sqrt(2 * W.MU_EARTH / Math.max(a.radius, 1));
    if (over >= 560) return null;
    const err = Math.abs(F.wrap(F.shipAngle(state) - MARS_AIM));
    const started = over > -3000;
    if (!started && !(a.apoAlt < 2500e3 && a.ecc < 0.25 && a.periAlt > 150000)) return null;
    if (!started && err > 14 * W.DEG) return null;
    if (started && err > 70 * W.DEG) return null;
    return { cue: "burn-prograde", now: true, seconds: null };
  }

  function marsHint(state, a) {
    const approach = F.closestApproach(state, "mars", 220 * W.DAY);
    if (approach.dist < W.SOI_MARS * 0.9) {
      return { cue: "coast", where: null, seconds: null, now: false };
    }
    if (!(approach.t < 22 * W.DAY) || approach.t < 1.5 * W.DAY) {
      return { cue: "coast", where: null, seconds: null, now: false };
    }
    if (hintCache && Math.abs(hintCache.fuel - state.fuel) < 1e-5 && Math.abs(hintCache.t - state.t) < 900) {
      return hintCache.hint;
    }
    const options = [
      ["burn-prograde", a.prograde],
      ["burn-retrograde", a.retrograde],
      ["burn-out", a.up],
      ["burn-in", F.wrap(a.up + Math.PI)]
    ];
    let bestCue = "coast";
    let bestScore = approach.dist;
    for (let i = 0; i < options.length; i++) {
      const copy = F.restore(F.snapshot(state));
      F.advance(copy, { burn: 1, angle: options[i][1] }, 10);
      if (copy.status !== "flight" || copy.parentId === "earth") continue;
      const score = copy.parentId === "mars" ? 0 : F.closestApproach(copy, "mars", 40 * W.DAY).dist;
      if (score < bestScore) {
        bestScore = score;
        bestCue = options[i][0];
      }
    }
    const hint = bestCue === "coast" || bestScore > approach.dist * 0.98
      ? { cue: "coast", where: null, seconds: null, now: false }
      : { cue: bestCue, where: null, seconds: null, now: true };
    hintCache = { t: state.t, fuel: state.fuel, hint };
    return hint;
  }

  function advise(state, intent) {
    const out = adviseInner(state, intent);
    if (state && state.status === "flight") {
      const mars = marsOpportunity(state, out.analysis);
      if (mars) out.mars = mars;
    }
    return out;
  }

  function adviseInner(state, intent) {
    const a = F.analyze(state);
    const out = { headed: "pad", cue: "ready", where: null, seconds: null, now: false, analysis: a };
    if (!state || state.status === "lost") {
      out.cue = "none";
      out.headed = "falling";
      return out;
    }
    if (state.status === "landed") {
      out.cue = "none";
      out.headed = state.landedOn === "moon" ? "moon" : state.landedOn === "mars" ? "mars" : "pad";
      return out;
    }
    if (!state.airborne) {
      const armed = intent || { burn: 0, angle: state.nose };
      out.headed = "pad";
      out.cue = (armed.burn || 0) > 0.12 && !F.willLift(state, armed) ? "point-up" : "ready";
      return out;
    }

    if (a.parent === "moon") {
      const captured = a.ecc < 1 && a.periAlt > 20000 && isFinite(a.apoAlt) && a.apoAlt < W.SOI_MOON;
      out.headed = captured ? "moon-orbit" : "moon";
      if (captured) {
        out.cue = "coast";
        return out;
      }
      out.cue = "burn-retrograde";
      out.where = "periapsis";
      out.seconds = a.timeToPeri;
      out.now = !!(a.nearPeri || (a.timeToPeri != null && a.timeToPeri < 20));
      return out;
    }

    if (a.parent === "mars") {
      const captured = a.ecc < 1 && a.periAlt > 80000 && isFinite(a.apo) && a.apo < W.SOI_MARS * 0.98;
      out.headed = captured ? "mars-orbit" : "mars";
      if (captured) {
        out.cue = "coast";
        return out;
      }
      out.cue = "burn-retrograde";
      out.where = "periapsis";
      out.seconds = a.timeToPeri;
      const soon = a.timeToPeri != null && a.timeToPeri < 45;
      const near = Math.abs(F.wrap(a.trueAnomaly)) < 32 * W.DEG;
      out.now = soon || near;
      return out;
    }

    if (a.parent === "sun") {
      const hint = marsHint(state, a);
      out.headed = "mars";
      out.cue = hint.cue;
      out.where = hint.where;
      out.seconds = hint.seconds;
      out.now = hint.now;
      return out;
    }

    const highEnough = a.ecc < 1 && a.periAlt > 150000 && a.apoAlt > 165000;
    const falling = a.vRadial < -40 && a.periAlt < 30000 && a.alt < 300000;

    if (a.alt < 30000 && a.speed < 2400 && !(a.apoAlt > 200000)) {
      out.headed = "ascent";
      out.cue = "tilt-gulf";
      out.now = true;
      return out;
    }

    if (!highEnough && a.ecc < 1 && a.apoAlt < 240000 && a.alt < 170000) {
      out.headed = "ascent";
      out.cue = "burn-prograde";
      out.now = true;
      return out;
    }

    if (a.ecc < 1 && a.apoAlt > 170000 && a.periAlt < 155000 && a.apoAlt < W.MOON_ORBIT * 0.45) {
      out.headed = a.alt > 130000 ? "suborbital" : "ascent";
      out.cue = "burn-prograde";
      out.where = "apoapsis";
      out.seconds = a.timeToApo;
      const justPassed = a.period && a.timeToApo != null && a.period - a.timeToApo < 30;
      out.now = !!(a.nearApo || (a.timeToApo != null && a.timeToApo < 35) || justPassed);
      return out;
    }

    if (falling) {
      out.headed = "falling";
      out.cue = "burn-prograde";
      out.now = true;
      return out;
    }

    if (highEnough) {
      const timing = untilAligned(state, a);
      const raising = a.apo < W.MOON_ORBIT * 0.97 && a.ecc < 0.98;
      const atPoint = a.ecc < 0.09 || a.nearPeri;
      if (raising && timing.aligned && atPoint) {
        if (a.apo > W.MOON_ORBIT * 0.72) {
          const close = F.closestApproach(state, "moon", 8 * W.DAY);
          if (close.dist < W.SOI_MOON * 1.2) {
            out.headed = "moon";
            out.cue = "coast";
            return out;
          }
        }
        out.headed = "earth-orbit";
        out.cue = "burn-prograde";
        out.where = a.ecc < 0.09 ? null : "periapsis";
        out.now = true;
        out.seconds = a.timeToPeri;
        return out;
      }
      if (raising) {
        out.headed = "earth-orbit";
        out.cue = "wait-moon";
        out.seconds = timing.seconds;
        return out;
      }
      out.headed = "moon";
      out.cue = "coast";
      return out;
    }

    out.headed = a.vRadial < 0 ? "falling" : "suborbital";
    out.cue = "burn-prograde";
    out.now = true;
    return out;
  }

  root.StarbaseGuidance = { advise };
})(typeof window !== "undefined" ? window : globalThis);
