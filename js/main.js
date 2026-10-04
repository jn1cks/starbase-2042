"use strict";
(function () {
  const F = window.StarbaseFlight;
  const G = window.StarbaseGuidance;
  const Save = window.StarbaseSave;
  const Hud = window.StarbaseHud;
  const controls = window.StarbaseControls.create();
  const canvas = document.getElementById("view");
  const view = window.StarbaseView.create(canvas);

  const goalEl = document.getElementById("goal");
  const headedEl = document.getElementById("headed");
  const placeEl = document.getElementById("place");
  const cueEl = document.getElementById("cue");
  const burnEl = document.getElementById("burn");
  const aimEl = document.getElementById("aim");
  const burnWordEl = document.getElementById("burnWord");
  const aimWordEl = document.getElementById("aimWord");
  const fuelBar = document.getElementById("fuelBar");
  const fireBtn = document.getElementById("fire");
  const flightBox = document.getElementById("flight");
  const againBtn = document.getElementById("again");
  const muteBtn = document.getElementById("mute");
  const warpLabel = document.getElementById("warpNow");
  const pips = document.querySelectorAll("#pips span");

  let record = Save.load();
  let flight = record.resume ? F.restore(record.resume) : F.createFlight();
  if (flight.status === "flight") {
    controls.fired = true;
    controls.mode = "orbital";
    controls.burn = 0;
    burnEl.value = "0";
    const resumed = F.analyze(flight);
    controls.aim = F.wrap(flight.nose - resumed.prograde);
  } else {
    controls.burn = Number(burnEl.value) / 100;
  }
  let lastSave = 0;
  let notedLaunch = flight.airborne;
  let audio = null;
  let rumble = null;
  let lastFrame = 0;
  let aimHeld = false;

  function muted() { return !!record.muted; }

  function paintWords() {
    burnWordEl.textContent = Hud.burnWord(controls.burn);
    aimWordEl.textContent = Hud.aimWord(controls.mode, controls.aim);
    if (!aimHeld) aimEl.value = String(Math.round(controls.aim * 180 / Math.PI));
  }

  function paintHud(advice) {
    const text = Hud.lines(advice, record.progress, controls.seek);
    goalEl.textContent = text.goal;
    headedEl.textContent = text.headed;
    placeEl.textContent = text.place;
    cueEl.textContent = text.cue;
    fuelBar.style.transform = "scaleX(" + Math.max(0, Math.min(1, flight.fuel)) + ")";
    const flying = flight.status === "flight";
    const done = flight.status === "landed" || flight.status === "lost";
    fireBtn.hidden = flying || done;
    flightBox.hidden = !flying;
    againBtn.hidden = !done;
    againBtn.textContent = flight.status === "landed" ? "Fly again" : "Fly again";
    pips.forEach((pip) => {
      const key = pip.getAttribute("data-k");
      const on = key === "moon"
        ? (record.progress.moon || record.progress.moonOrbit || record.progress.moonSurface)
        : !!record.progress[key];
      pip.classList.toggle("on", on);
    });
    muteBtn.textContent = muted() ? "Sound off" : "Sound";
    muteBtn.setAttribute("aria-pressed", muted() ? "true" : "false");
  }

  function noteProgress(advice) {
    const a = advice.analysis;
    const before = JSON.stringify(record.progress);
    if (flight.airborne && !notedLaunch) {
      notedLaunch = true;
      record.progress.flights += 1;
    }
    if (a.parent === "earth" && a.ecc < 1 && a.periAlt > 150000 && a.apoAlt > 160000) record.progress.earthOrbit = true;
    if (a.parent === "moon" || flight.landedOn === "moon") record.progress.moon = true;
    if (advice.headed === "moon-orbit") record.progress.moonOrbit = true;
    if (flight.status === "landed" && flight.landedOn === "moon") record.progress.moonSurface = true;
    if (advice.headed === "mars-orbit") record.progress.marsOrbit = true;
    if (JSON.stringify(record.progress) !== before) store(true);
  }

  function store(force) {
    record.muted = muted();
    record.resume = F.snapshot(flight);
    record.version = Save.VERSION;
    const now = performance.now();
    if (!force && now - lastSave < 4000) return;
    lastSave = now;
    Save.save(record);
  }

  function inAir(state) {
    if (!state.airborne || state.parentId !== "earth") return false;
    const earth = F.bodyState("earth", state.t);
    return Math.hypot(state.x - earth.x, state.y - earth.y) - Wsafe() < F.WORLD.ATMOS;
  }
  function Wsafe() { return F.WORLD.R_EARTH; }

  function warpOf(intent) {
    if (!flight.airborne) return 1;
    let cap = 12000;
    if (intent.burn > 0.02) cap = Math.min(cap, 40);
    if (inAir(flight)) cap = Math.min(cap, 25);
    return Math.min(controls.warp, cap);
  }

  function step(dt) {
    if (flight.status === "lost" || flight.status === "landed") return;
    const preview = controls.intent(flight);
    const warp = warpOf(preview);
    warpLabel.textContent = warp >= 100 ? Math.round(warp) + "×" : warp + "×";
    document.querySelectorAll("#flight button[data-warp]").forEach((btn) => {
      btn.classList.toggle("on", Number(btn.getAttribute("data-warp")) === controls.warp);
    });
    let left = dt * warp;
    let guard = 0;
    while (left > 1e-4 && guard++ < 6 && (flight.status === "pad" || flight.status === "flight")) {
      const intent = controls.intent(flight);
      let h = left;
      if (intent.burn > 0.02 || inAir(flight)) h = Math.min(left, 0.2);
      if (controls.seek) {
        const a = F.analyze(flight);
        const t = controls.seek === "apoapsis" ? a.timeToApo : a.timeToPeri;
        if (t != null) h = Math.min(h, Math.max(0.35, t * 0.34));
      }
      F.advance(flight, intent, h);
      left -= h;
    }
  }

  function ensureAudio() {
    if (audio || muted()) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audio = new Ctx();
    const buffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    rumble = audio.createBufferSource();
    rumble.buffer = buffer;
    rumble.loop = true;
    const filter = audio.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 180;
    const gain = audio.createGain();
    gain.gain.value = 0;
    rumble.connect(filter);
    filter.connect(gain);
    gain.connect(audio.destination);
    rumble.start();
    rumble._gain = gain;
  }

  function hear(intent) {
    if (muted()) {
      if (rumble && rumble._gain) rumble._gain.gain.value = 0;
      return;
    }
    ensureAudio();
    if (!rumble || !rumble._gain) return;
    const on = intent.burn > 0.05 && flight.fuel > 0 && (flight.status === "flight" || controls.fired);
    rumble._gain.gain.value = on ? 0.04 + intent.burn * 0.05 : 0;
  }

  function frame(now) {
    const dt = Math.min(0.05, lastFrame ? (now - lastFrame) / 1000 : 0.016);
    lastFrame = now;
    step(dt);
    const advice = G.advise(flight, controls.intent(flight));
    noteProgress(advice);
    paintWords();
    paintHud(advice);
    const intent = controls.intent(flight);
    view.draw(flight, intent, dt);
    hear(intent);
    if (flight.status === "flight") store(false);
    if (flight.status === "landed" || flight.status === "lost") store(true);
    requestAnimationFrame(frame);
  }

  burnEl.addEventListener("input", () => {
    controls.setBurn(Number(burnEl.value) / 100);
    paintWords();
  });
  aimEl.addEventListener("pointerdown", () => { aimHeld = true; });
  aimEl.addEventListener("pointerup", () => { aimHeld = false; });
  aimEl.addEventListener("pointercancel", () => { aimHeld = false; });
  aimEl.addEventListener("input", () => {
    controls.setAim(Number(aimEl.value) * Math.PI / 180);
    paintWords();
  });
  fireBtn.addEventListener("click", () => {
    controls.fire();
    ensureAudio();
    if (navigator.vibrate) navigator.vibrate(24);
  });
  againBtn.addEventListener("click", () => {
    flight = F.createFlight();
    controls.resetFlight();
    controls.setBurn(Number(burnEl.value) / 100);
    notedLaunch = false;
    view.clearTrail();
    burnEl.value = "80";
    controls.setBurn(0.8);
    aimEl.value = "0";
    store(true);
  });
  document.getElementById("peri").addEventListener("click", () => { controls.seek = "periapsis"; });
  document.getElementById("apo").addEventListener("click", () => { controls.seek = "apoapsis"; });
  flightBox.addEventListener("click", (event) => {
    const warp = event.target.getAttribute && event.target.getAttribute("data-warp");
    if (!warp) return;
    controls.warp = Number(warp);
  });
  muteBtn.addEventListener("click", () => {
    record.muted = !record.muted;
    if (record.muted && rumble && rumble._gain) rumble._gain.gain.value = 0;
    store(true);
    paintHud(G.advise(flight, controls.intent(flight)));
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const dir = event.key === "ArrowRight" ? 1 : -1;
      controls.setAim(controls.aim + dir * 4 * Math.PI / 180);
      event.preventDefault();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      controls.setBurn(controls.burn + (event.key === "ArrowUp" ? 0.05 : -0.05));
      burnEl.value = String(Math.round(controls.burn * 100));
      event.preventDefault();
    } else if (event.key === " " || event.key === "Enter") {
      if (!controls.fired && flight.status === "pad") controls.fire();
      event.preventDefault();
    } else if (event.key >= "1" && event.key <= "5") {
      controls.warp = [1, 25, 100, 1000, 8000][Number(event.key) - 1];
    }
  });

  window.addEventListener("pagehide", () => store(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") store(true);
  });

  function pilotIntent(advice) {
    const a = advice.analysis;
    const deg = F.WORLD.DEG;
    let burn = 0;
    let angle = a.prograde;
    if (!flight.airborne || advice.cue === "ready" || advice.cue === "tilt-gulf" || advice.cue === "point-up") {
      burn = 1;
      let pitch = 8 * deg;
      if (flight.airborne) {
        if (a.alt < 400) pitch = 2 * deg;
        else if (a.alt < 2000) pitch = 12 * deg;
        else if (a.alt < 6000) pitch = 25 * deg;
        else if (a.alt < 12000) pitch = 45 * deg;
        else if (a.alt < 25000) pitch = 65 * deg;
        else pitch = null;
      }
      angle = pitch == null ? a.prograde : a.up + pitch;
      if (advice.cue === "point-up") angle = a.up;
    } else if (advice.cue === "burn-prograde") {
      angle = a.prograde;
      burn = advice.now ? 1 : 0;
    } else if (advice.cue === "burn-retrograde") {
      angle = a.retrograde;
      burn = advice.now ? 1 : 0;
    } else if (advice.cue === "burn-out") {
      angle = a.up;
      burn = advice.now ? 1 : 0;
    } else if (advice.cue === "burn-in") {
      angle = F.wrap(a.up + Math.PI);
      burn = advice.now ? 1 : 0;
    }
    return { burn, angle };
  }

  window.STARBASE = {
    fire: () => controls.fire(),
    setBurn: (v) => { controls.setBurn(v); burnEl.value = String(Math.round(v * 100)); },
    setAim: (deg) => { controls.setAim(deg * Math.PI / 180); aimEl.value = String(deg); },
    pilot: (seconds) => {
      let left = seconds;
      let advice = null;
      while (left > 0 && flight.status !== "lost" && flight.status !== "landed") {
        advice = G.advise(flight, { burn: 1, angle: flight.nose });
        const intent = pilotIntent(advice);
        const step = intent.burn > 0 ? 0.35 : (advice.cue === "wait-moon" ? 20 : Math.min(left, advice.seconds ? Math.min(30, Math.max(0.5, advice.seconds * 0.4)) : 8));
        const h = Math.min(left, step);
        F.advance(flight, intent, h);
        controls.fired = true;
        left -= h;
      }
      return advice && { headed: advice.headed, cue: advice.cue, alt: advice.analysis.alt, apo: advice.analysis.apoAlt, peri: advice.analysis.periAlt, parent: advice.analysis.parent };
    },
    advance: (seconds) => {
      let left = seconds;
      while (left > 0 && flight.status !== "lost" && flight.status !== "landed") {
        const intent = controls.intent(flight);
        const h = Math.min(left, intent.burn > 0 ? 0.25 : Math.min(left, 30));
        F.advance(flight, intent, h);
        left -= h;
      }
    },
    analyze: () => F.analyze(flight),
    save: () => Save.load()
  };

  paintWords();
  paintHud(G.advise(flight, controls.intent(flight)));
  requestAnimationFrame(frame);
})();
