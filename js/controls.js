"use strict";
/* Slider and button state become intents. No drawing and no integration. */
(function (root) {
  const F = root.StarbaseFlight;

  function refFor(mode, analysis) {
    return mode === "orbital" ? analysis.prograde : analysis.up;
  }

  function wantsOrbital(state, analysis) {
    if (!state.airborne) return false;
    if (analysis.parent !== "earth") return true;
    if (analysis.alt > 80000) return true;
    return F.airSpeed(state) > 900;
  }

  function create() {
    const c = {
      burn: 0.8,
      aim: 0,
      mode: "surface",
      fired: false,
      seek: null,
      warp: 1
    };

    c.intent = function (state) {
      const analysis = F.analyze(state);
      const next = wantsOrbital(state, analysis) ? "orbital" : "surface";
      if (next !== c.mode) {
        const world = refFor(c.mode, analysis) + c.aim;
        c.aim = F.wrap(world - refFor(next, analysis));
        c.mode = next;
      }
      if (c.seek) {
        const t = c.seek === "apoapsis" ? analysis.timeToApo : analysis.timeToPeri;
        if (!(t > 18)) c.seek = null;
      }
      return {
        burn: c.fired && !c.seek ? c.burn : 0,
        angle: F.wrap(refFor(c.mode, analysis) + c.aim)
      };
    };

    c.setBurn = function (value) {
      c.burn = Math.max(0, Math.min(1, value));
    };
    c.setAim = function (radians) {
      c.aim = F.wrap(radians);
    };
    c.fire = function () {
      c.fired = true;
    };
    c.resetFlight = function () {
      c.fired = false;
      c.seek = null;
      c.warp = 1;
      c.mode = "surface";
      c.aim = 0;
    };
    return c;
  }

  root.StarbaseControls = { create };
})(typeof window !== "undefined" ? window : globalThis);
