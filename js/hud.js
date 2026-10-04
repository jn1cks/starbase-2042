"use strict";
/* Turns cues into a few short lines. No canvas and no flight steps. */
(function (root) {
  const F = root.StarbaseFlight;
  const W = F.WORLD;

  function clock(seconds) {
    if (seconds == null || !isFinite(seconds)) return "";
    const s = Math.max(0, Math.round(seconds));
    if (s < 90) return s + " sec";
    const m = Math.round(s / 60);
    if (m < 90) return m + " min";
    const h = Math.round(s / 3600);
    if (h < 48) return h + " hr";
    return Math.round(s / W.DAY) + " days";
  }

  function placeAmount(meters, parent) {
    if (!isFinite(meters)) return "escape";
    if (meters < 0) return "below the ground";
    if (parent === "sun") {
      const au = meters / W.AU;
      return (au < 10 ? au.toFixed(2) : au.toFixed(1)) + " AU";
    }
    const km = meters / 1000;
    if (km < 10) return km.toFixed(1) + " km";
    if (km < 10000) return Math.round(km).toLocaleString("en-US") + " km";
    return Math.round(km / 1000).toLocaleString("en-US") + " thousand km";
  }

  function placeLine(a) {
    if (!a) return "";
    const apo = a.apoAlt < 0 ? "below the ground" : placeAmount(a.apoAlt, a.parent);
    const peri = a.periAlt < 0 ? "below the ground" : placeAmount(a.periAlt, a.parent);
    return "Apoapsis " + apo + "  ·  Periapsis " + peri;
  }

  const HEADED = {
    pad: "South Texas",
    ascent: "Climbing",
    suborbital: "Climbing",
    falling: "Falling back",
    "earth-orbit": "Earth orbit",
    moon: "The Moon",
    "moon-orbit": "Moon orbit",
    mars: "Mars",
    "mars-orbit": "Mars orbit"
  };

  function cueLine(advice, seek) {
    if (seek === "apoapsis") return "Coasting to apoapsis";
    if (seek === "periapsis") return "Coasting to periapsis";
    if (!advice) return "";
    if (advice.mars && advice.mars.now && advice.cue !== "burn-prograde") return "For Mars, burn prograde";
    const cue = advice.cue;
    const where = advice.where;
    const when = clock(advice.seconds);
    if (cue === "ready") return "Set the burn, then fire";
    if (cue === "point-up") return "Point up to lift";
    if (cue === "tilt-gulf") return "Tilt toward the Gulf";
    if (cue === "wait-moon") return when ? "Moon lines up in " + when : "Moon lines up soon";
    if (cue === "coast") return "Coast";
    if (cue === "none") return "";
    const verb = cue === "burn-retrograde" ? "burn retrograde"
      : cue === "burn-out" ? "burn outward"
      : cue === "burn-in" ? "burn inward"
      : "burn prograde";
    if (where === "apoapsis" && advice.now) return "Apoapsis — " + verb;
    if (where === "periapsis" && advice.now) return "Periapsis — " + verb;
    if (where && when && !advice.now) {
      const name = where === "apoapsis" ? "Apoapsis" : "Periapsis";
      return name + " in " + when + " — " + verb;
    }
    if (advice.headed === "mars" && advice.analysis && advice.analysis.parent === "earth") return "Mars lines up — " + verb;
    const nice = verb.charAt(0).toUpperCase() + verb.slice(1);
    return nice;
  }

  function goalLine(progress) {
    if (progress && (progress.moonOrbit || progress.moonSurface || progress.moon)) {
      if (!progress.marsOrbit) return "Mars";
      return "Mars orbit";
    }
    return "The Moon";
  }

  function burnWord(burn) {
    if (burn < 0.08) return "Off";
    if (burn < 0.4) return "Soft";
    if (burn < 0.7) return "Steady";
    return "Hard";
  }

  function aimWord(mode, aim) {
    const deg = Math.round(aim * 180 / Math.PI);
    const a = Math.abs(deg);
    if (mode === "orbital") {
      if (a < 12) return "Prograde";
      if (deg > 12 && deg < 70) return "Inward";
      if (deg >= 70 && deg <= 110) return "Inward";
      if (deg < -12 && deg > -70) return "Outward";
      if (deg <= -70 && deg >= -110) return "Outward";
      return "Retrograde";
    }
    if (a < 12) return "Up";
    if (deg > 12 && deg < 80) return "Toward the Gulf";
    if (deg >= 80 && deg <= 110) return "The Gulf";
    if (deg < -12 && deg > -80) return "Toward the hills";
    if (deg <= -80 && deg >= -110) return "The hills";
    return "Down";
  }

  function lines(advice, progress, seek) {
    return {
      goal: goalLine(progress),
      headed: (advice && HEADED[advice.headed]) || "South Texas",
      place: advice && advice.analysis && advice.analysis.airborne ? placeLine(advice.analysis) : "",
      cue: cueLine(advice, seek)
    };
  }

  root.StarbaseHud = { lines, burnWord, aimWord, clock };
})(typeof window !== "undefined" ? window : globalThis);
