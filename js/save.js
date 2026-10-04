"use strict";
/* Versioned save. The only module that touches localStorage. */
(function (root) {
  const KEY = "starbase2042.save";
  const VERSION = 2;

  function blank() {
    return {
      version: VERSION,
      muted: false,
      progress: {
        flights: 0,
        earthOrbit: false,
        moon: false,
        moonOrbit: false,
        moonSurface: false,
        marsOrbit: false
      },
      resume: null
    };
  }

  function normalize(data) {
    const next = blank();
    if (!data || data.version !== VERSION) return next;
    next.muted = !!data.muted;
    const p = data.progress || {};
    next.progress.flights = Math.max(0, Math.floor(Number(p.flights) || 0));
    next.progress.earthOrbit = !!p.earthOrbit;
    next.progress.moon = !!p.moon;
    next.progress.moonOrbit = !!p.moonOrbit;
    next.progress.moonSurface = !!p.moonSurface;
    next.progress.marsOrbit = !!p.marsOrbit;
    if (data.resume && data.resume.version === VERSION) next.resume = data.resume;
    return next;
  }

  function storage() {
    try {
      if (typeof localStorage !== "undefined") return localStorage;
    } catch (err) { /* private mode */ }
    return null;
  }

  function load() {
    const box = storage();
    if (!box) return blank();
    try {
      const raw = box.getItem(KEY);
      if (!raw) return blank();
      return normalize(JSON.parse(raw));
    } catch (err) {
      return blank();
    }
  }

  function save(data) {
    const box = storage();
    if (!box) return false;
    try {
      box.setItem(KEY, JSON.stringify(normalize(data)));
      return true;
    } catch (err) {
      return false;
    }
  }

  root.StarbaseSave = { KEY, VERSION, blank, normalize, load, save };
})(typeof window !== "undefined" ? window : globalThis);
