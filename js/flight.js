"use strict";
/* Flight math only. No document, no canvas, no pixels.
   Callers pass intents { burn, angle } and read back plain numbers. */
(function (root) {
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;
  const DAY = 86400;

  const MU_SUN = 1.32712440018e20;
  const MU_EARTH = 3.986004418e14;
  const MU_MOON = 4.9048695e12;
  const MU_MARS = 4.2828372e13;

  const AU = 1.495978707e11;
  const R_SUN = 6.957e8;
  const R_EARTH = 6.371e6;
  const R_MOON = 1.7374e6;
  const R_MARS = 3.3895e6;

  const MOON_ORBIT = 3.844e8;
  const MARS_ORBIT = 1.5237 * AU;

  const YEAR = 365.256363 * DAY;
  const MOON_PERIOD = 27.321661 * DAY;
  const MARS_PERIOD = 686.98 * DAY;
  const SIDEREAL_DAY = 86164.0905;

  const LAUNCH_LAT = 26.0 * DEG;
  const LAUNCH_LON = -97.16;
  const OMEGA_EARTH = TAU / SIDEREAL_DAY;
  // South Texas is not on the equator, so the pad moves slower than 465 m/s.
  const SITE_RATE = OMEGA_EARTH * Math.cos(LAUNCH_LAT);

  const SOI_EARTH = 9.24e8;
  const SOI_MOON = 6.61e7;
  const SOI_MARS = 5.77e8;

  const ATMOS = 150000;
  const SCALE_HEIGHT = 8500;
  const DRAG_B = 7.2e-5;

  const MAX_ACCEL = 34;
  const MAX_DV = 32000;
  const TURN_RATE = 55 * DEG;

  const MOON_PHASE = 58 * DEG;
  const MARS_PHASE = 44 * DEG;

  const BODIES = {
    sun: { id: "sun", mu: MU_SUN, radius: R_SUN, soi: Infinity, parent: null, orbit: 0, period: 1, phase: 0 },
    earth: { id: "earth", mu: MU_EARTH, radius: R_EARTH, soi: SOI_EARTH, parent: "sun", orbit: AU, period: YEAR, phase: 0 },
    moon: { id: "moon", mu: MU_MOON, radius: R_MOON, soi: SOI_MOON, parent: "earth", orbit: MOON_ORBIT, period: MOON_PERIOD, phase: MOON_PHASE },
    mars: { id: "mars", mu: MU_MARS, radius: R_MARS, soi: SOI_MARS, parent: "sun", orbit: MARS_ORBIT, period: MARS_PERIOD, phase: MARS_PHASE }
  };

  const WORLD = {
    DEG, TAU, DAY,
    MU_SUN, MU_EARTH, MU_MOON, MU_MARS,
    AU, R_SUN, R_EARTH, R_MOON, R_MARS,
    MOON_ORBIT, MARS_ORBIT,
    LAUNCH_LAT, LAUNCH_LON, SITE_RATE,
    SOI_EARTH, SOI_MOON, SOI_MARS,
    ATMOS, MAX_ACCEL, MAX_DV, TURN_RATE,
    MOON_PHASE, MARS_PHASE,
    surfaceSpeed: SITE_RATE * R_EARTH
  };

  function wrap(a) {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
  }
  function wrapPositive(a) {
    a = a % TAU;
    if (a < 0) a += TAU;
    return a;
  }
  function hypot(x, y) { return Math.hypot(x, y); }

  function bodyState(id, t) {
    const b = BODIES[id];
    if (!b || !b.parent) return { x: 0, y: 0, vx: 0, vy: 0 };
    const p = bodyState(b.parent, t);
    const n = TAU / b.period;
    const th = b.phase + n * t;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const r = b.orbit;
    return {
      x: p.x + c * r,
      y: p.y + s * r,
      vx: p.vx - s * r * n,
      vy: p.vy + c * r * n
    };
  }

  function pickParent(x, y, t) {
    const moon = bodyState("moon", t);
    if (hypot(x - moon.x, y - moon.y) <= SOI_MOON) return "moon";
    const mars = bodyState("mars", t);
    if (hypot(x - mars.x, y - mars.y) <= SOI_MARS) return "mars";
    const earth = bodyState("earth", t);
    if (hypot(x - earth.x, y - earth.y) <= SOI_EARTH) return "earth";
    return "sun";
  }

  function sitePose(t) {
    const earth = bodyState("earth", t);
    const a = SITE_RATE * t;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const speed = SITE_RATE * R_EARTH;
    return {
      x: earth.x + c * R_EARTH,
      y: earth.y + s * R_EARTH,
      vx: earth.vx - s * speed,
      vy: earth.vy + c * speed,
      up: a
    };
  }

  function createFlight() {
    const pose = sitePose(0);
    return {
      status: "pad",
      airborne: false,
      t: 0,
      x: pose.x,
      y: pose.y,
      vx: pose.vx,
      vy: pose.vy,
      nose: pose.up,
      fuel: 1,
      parentId: "earth",
      peakAlt: 0,
      visited: { earth: true, moon: false, mars: false, sun: false }
    };
  }

  function relativeTo(state, id) {
    const p = bodyState(id || state.parentId, state.t);
    return {
      rx: state.x - p.x,
      ry: state.y - p.y,
      vx: state.vx - p.vx,
      vy: state.vy - p.vy
    };
  }

  function elementsOf(rel, mu) {
    const rx = rel.rx, ry = rel.ry, vx = rel.vx, vy = rel.vy;
    const r = hypot(rx, ry);
    const v2 = vx * vx + vy * vy;
    const h = rx * vy - ry * vx;
    const energy = v2 / 2 - mu / Math.max(r, 1);
    const aDen = 2 / Math.max(r, 1) - v2 / mu;
    const a = Math.abs(aDen) > 1e-16 ? 1 / aDen : Infinity;
    const rv = rx * vx + ry * vy;
    const ex = ((v2 - mu / r) * rx - rv * vx) / mu;
    const ey = ((v2 - mu / r) * ry - rv * vy) / mu;
    const e = hypot(ex, ey);
    let nu = 0;
    if (e > 1e-8 && r > 0) {
      const cosNu = Math.max(-1, Math.min(1, (ex * rx + ey * ry) / (e * r)));
      const sinNu = (ex * ry - ey * rx) / (e * r);
      nu = Math.atan2(sinNu, cosNu);
    }
    const peri = isFinite(a) ? a * (1 - e) : r;
    const apo = e < 1 && isFinite(a) ? a * (1 + e) : Infinity;
    return { r, v2, h, energy, a, ex, ey, e, nu, peri, apo, mu, rv };
  }

  function frameOf(el) {
    const e = el.e;
    let ehatx = 1, ehaty = 0;
    if (e > 1e-8) {
      ehatx = el.ex / e;
      ehaty = el.ey / e;
    } else if (el.r > 0) {
      ehatx = el.rx !== undefined ? 0 : 1;
    }
    const sign = el.h >= 0 ? 1 : -1;
    const phatx = -ehaty * sign;
    const phaty = ehatx * sign;
    return { ehatx, ehaty, phatx, phaty };
  }

  function solveKeplerE(M, e) {
    M = wrap(M);
    let E = e < 0.8 ? M : Math.atan2(Math.sin(M), Math.cos(M) - e);
    for (let i = 0; i < 14; i++) {
      const f = E - e * Math.sin(E) - M;
      const fp = 1 - e * Math.cos(E);
      const d = f / fp;
      E -= d;
      if (Math.abs(d) < 1e-12) break;
    }
    return E;
  }

  function solveKeplerF(M, e) {
    let F = Math.asinh(M / Math.max(e, 1.000001));
    if (!isFinite(F)) F = Math.sign(M) || 0;
    for (let i = 0; i < 20; i++) {
      const sh = Math.sinh(F);
      const ch = Math.cosh(F);
      const f = e * sh - F - M;
      const fp = e * ch - 1;
      if (Math.abs(fp) < 1e-12) break;
      const d = f / fp;
      F -= d;
      if (Math.abs(d) < 1e-12) break;
    }
    return F;
  }

  function keplerAdvance(rel, mu, dt) {
    const el = elementsOf(rel, mu);
    el.rx = rel.rx;
    el.ry = rel.ry;
    const r = el.r;
    if (!(r > 1) || !isFinite(el.energy) || Math.abs(el.h) < 1) {
      return numericCoast(rel, mu, dt);
    }
    if (el.e < 1e-6 && isFinite(el.a) && el.a > 0) {
      const n = Math.sqrt(mu / (r * r * r)) * Math.sign(el.h || 1);
      const ang = n * dt;
      const c = Math.cos(ang), s = Math.sin(ang);
      const rx = rel.rx * c - rel.ry * s;
      const ry = rel.rx * s + rel.ry * c;
      const vx = rel.vx * c - rel.vy * s;
      const vy = rel.vx * s + rel.vy * c;
      return { rx, ry, vx, vy };
    }
    if (el.e < 1 && el.a > 0 && isFinite(el.a)) {
      const fr = frameOf(el);
      const cosNu = Math.cos(el.nu);
      const sinNu = Math.sin(el.nu);
      const denom = 1 + el.e * cosNu;
      const cosE = (el.e + cosNu) / denom;
      const sinE = sinNu * Math.sqrt(Math.max(0, 1 - el.e * el.e)) / denom;
      let E = Math.atan2(sinE, cosE);
      const M = E - el.e * Math.sin(E);
      const n = Math.sqrt(mu / (el.a * el.a * el.a));
      const E2 = solveKeplerE(M + n * dt, el.e);
      const r2 = el.a * (1 - el.e * Math.cos(E2));
      const cosNu2 = (Math.cos(E2) - el.e) / (1 - el.e * Math.cos(E2));
      const sinNu2 = Math.sin(E2) * Math.sqrt(Math.max(0, 1 - el.e * el.e)) / (1 - el.e * Math.cos(E2));
      const rx = r2 * (cosNu2 * fr.ehatx + sinNu2 * fr.phatx);
      const ry = r2 * (cosNu2 * fr.ehaty + sinNu2 * fr.phaty);
      const scale = Math.sqrt(mu * el.a) / r2;
      const vx = scale * (-Math.sin(E2) * fr.ehatx + Math.sqrt(Math.max(0, 1 - el.e * el.e)) * Math.cos(E2) * fr.phatx);
      const vy = scale * (-Math.sin(E2) * fr.ehaty + Math.sqrt(Math.max(0, 1 - el.e * el.e)) * Math.cos(E2) * fr.phaty);
      return { rx, ry, vx, vy };
    }
    if (el.e > 1 && el.a < 0 && isFinite(el.a)) {
      const ah = -el.a;
      const fr = frameOf(el);
      const cosNu = Math.cos(el.nu);
      const sinNu = Math.sin(el.nu);
      const denom = 1 + el.e * cosNu;
      if (Math.abs(denom) < 1e-8) return numericCoast(rel, mu, dt);
      const ch = (el.e + cosNu) / denom;
      const sh = sinNu * Math.sqrt(el.e * el.e - 1) / denom;
      const F = Math.asinh(Math.max(-1e6, Math.min(1e6, sh)));
      const Fcheck = Math.acosh(Math.max(1, ch)) * Math.sign(sh || sinNu || 1);
      const F0 = isFinite(Fcheck) ? Fcheck : F;
      const M = el.e * Math.sinh(F0) - F0;
      const n = Math.sqrt(mu / (ah * ah * ah));
      const F2 = solveKeplerF(M + n * dt, el.e);
      const ch2 = Math.cosh(F2);
      const sh2 = Math.sinh(F2);
      const rxp = ah * (el.e - ch2);
      const ryp = ah * Math.sqrt(el.e * el.e - 1) * sh2;
      const rx = rxp * fr.ehatx + ryp * fr.phatx;
      const ry = rxp * fr.ehaty + ryp * fr.phaty;
      const denomV = el.e * ch2 - 1;
      const svel = Math.sqrt(mu / ah) / denomV;
      const vx = svel * (-sh2 * fr.ehatx + Math.sqrt(el.e * el.e - 1) * ch2 * fr.phatx);
      const vy = svel * (-sh2 * fr.ehaty + Math.sqrt(el.e * el.e - 1) * ch2 * fr.phaty);
      return { rx, ry, vx, vy };
    }
    return numericCoast(rel, mu, dt);
  }

  function accelRel(rel, mu) {
    const r = hypot(rel.rx, rel.ry) || 1;
    const g = mu / (r * r * r);
    return { ax: -rel.rx * g, ay: -rel.ry * g };
  }

  function numericCoast(rel, mu, dt) {
    let rx = rel.rx, ry = rel.ry, vx = rel.vx, vy = rel.vy;
    const steps = Math.max(1, Math.ceil(Math.abs(dt) / 2));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = accelRel({ rx, ry }, mu);
      vx += a.ax * h;
      vy += a.ay * h;
      rx += vx * h;
      ry += vy * h;
    }
    return { rx, ry, vx, vy };
  }

  function worldFromRel(parentId, t0, dt, rel) {
    const p1 = bodyState(parentId, t0 + dt);
    return {
      x: p1.x + rel.rx,
      y: p1.y + rel.ry,
      vx: p1.vx + rel.vx,
      vy: p1.vy + rel.vy
    };
  }

  function predict(state, dt) {
    const id = state.parentId;
    const rel0 = relativeTo(state, id);
    const rel = keplerAdvance(rel0, BODIES[id].mu, dt);
    return worldFromRel(id, state.t, dt, rel);
  }

  function timesOf(el) {
    const out = { period: null, timeToPeri: null, timeToApo: null };
    if (!(el.e < 1) || !(el.a > 0) || !isFinite(el.a)) {
      if (el.e > 1 && el.a < 0) {
        const ah = -el.a;
        const n = Math.sqrt(el.mu / (ah * ah * ah));
        const cosNu = Math.cos(el.nu);
        const sinNu = Math.sin(el.nu);
        const denom = 1 + el.e * cosNu;
        if (Math.abs(denom) < 1e-8) return out;
        const sh = sinNu * Math.sqrt(el.e * el.e - 1) / denom;
        const F = Math.asinh(Math.max(-1e6, Math.min(1e6, sh)));
        const M = el.e * Math.sinh(F) - F;
        if (M < 0) out.timeToPeri = -M / n;
      }
      return out;
    }
    const n = Math.sqrt(el.mu / (el.a * el.a * el.a));
    out.period = TAU / n;
    const cosNu = Math.cos(el.nu);
    const sinNu = Math.sin(el.nu);
    const denom = 1 + el.e * cosNu;
    const cosE = (el.e + cosNu) / denom;
    const sinE = sinNu * Math.sqrt(Math.max(0, 1 - el.e * el.e)) / denom;
    const E = Math.atan2(sinE, cosE);
    const M = wrapPositive(E - el.e * Math.sin(E));
    out.timeToPeri = wrapPositive(-M) / n;
    out.timeToApo = wrapPositive(Math.PI - M) / n;
    return out;
  }

  function analyze(state) {
    const id = state.parentId;
    const body = BODIES[id];
    const rel = relativeTo(state, id);
    const el = elementsOf(rel, body.mu);
    const times = timesOf(el);
    const alt = el.r - body.radius;
    const apoAlt = isFinite(el.apo) ? el.apo - body.radius : Infinity;
    const periAlt = el.peri - body.radius;
    const speed = hypot(rel.vx, rel.vy);
    const up = Math.atan2(rel.ry, rel.rx);
    const prograde = Math.atan2(rel.vy, rel.vx);
    const nearAngle = 8 * DEG;
    const nearPeri = Math.abs(wrap(el.nu)) < nearAngle || (times.timeToPeri !== null && times.timeToPeri < 12);
    const nearApo = Math.abs(wrap(el.nu - Math.PI)) < nearAngle || (times.timeToApo !== null && times.timeToApo < 12);
    const vRadial = el.r > 0 ? (rel.rx * rel.vx + rel.ry * rel.vy) / el.r : 0;
    return {
      parent: id,
      alt, apo: el.apo, peri: el.peri, apoAlt, periAlt,
      ecc: el.e, energy: el.energy, semiMajor: el.a,
      period: times.period,
      timeToApo: times.timeToApo,
      timeToPeri: times.timeToPeri,
      trueAnomaly: el.nu,
      nearApo, nearPeri,
      speed, vRadial,
      prograde, up,
      east: wrap(up + Math.PI / 2),
      retrograde: wrap(prograde + Math.PI),
      nose: state.nose,
      fuel: state.fuel,
      airborne: state.airborne,
      status: state.status,
      radius: el.r
    };
  }

  function sampleOrbit(state, count) {
    const a = analyze(state);
    if (!(a.ecc < 0.999) || !isFinite(a.apo) || !(a.period > 0)) {
      if (a.ecc >= 1 && a.timeToPeri !== null) {
        const pts = [];
        const span = Math.min(a.timeToPeri * 2 + 3600, 20 * DAY);
        const n = count || 64;
        for (let i = 0; i <= n; i++) {
          const dt = -a.timeToPeri + span * (i / n);
          pts.push(predict(state, dt));
        }
        return { kind: "hyperbolic", points: pts };
      }
      return null;
    }
    const n = count || 96;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      pts.push(predict(state, a.period * (i / n)));
    }
    const apoPt = predict(state, a.timeToApo || 0);
    const periPt = predict(state, a.timeToPeri || 0);
    return { kind: "ellipse", points: pts, apo: apoPt, peri: periPt };
  }

function missAt(state, bodyId, dt) {
  const pos = predict(state, dt);
  const b = bodyState(bodyId, state.t + dt);
  return hypot(pos.x - b.x, pos.y - b.y);
}

function closestApproach(state, bodyId, horizon) {
  if (!(horizon > 0)) return { dist: Infinity, t: 0 };
  const step = Math.min(6 * 3600, Math.max(30, horizon / 64));
  const steps = Math.max(8, Math.ceil(horizon / step));
  let best = Infinity;
  let bestT = 0;
  for (let i = 1; i <= steps; i++) {
    const dt = horizon * (i / steps);
    const d = missAt(state, bodyId, dt);
    if (d < best) {
      best = d;
      bestT = dt;
    }
  }
  const span = horizon / steps;
  const lo = Math.max(0, bestT - span);
  const hi = Math.min(horizon, bestT + span);
  const fine = 10;
  for (let i = 0; i <= fine; i++) {
    const dt = lo + (hi - lo) * (i / fine);
    const d = missAt(state, bodyId, dt);
    if (d < best) {
      best = d;
      bestT = dt;
    }
  }
  return { dist: best, t: bestT };
}

  function density(alt) {
    if (alt > ATMOS || alt < -2000) return alt < 0 ? 1.225 : 0;
    return 1.225 * Math.exp(-Math.max(0, alt) / SCALE_HEIGHT);
  }

  function gravityAccel(x, y, t, parentId) {
    const p = bodyState(parentId, t);
    const rx = x - p.x;
    const ry = y - p.y;
    const r = hypot(rx, ry) || 1;
    const mu = BODIES[parentId].mu;
    const g = mu / (r * r * r);
    return { ax: -rx * g, ay: -ry * g, r, rx, ry, parent: p };
  }

  function slew(state, angle, dt) {
    if (!isFinite(angle)) return;
    let d = wrap(angle - state.nose);
    const max = TURN_RATE * dt;
    if (Math.abs(d) > max) d = Math.sign(d) * max;
    state.nose = wrap(state.nose + d);
  }

  function spendFuel(state, burn, dt) {
    if (burn <= 0 || state.fuel <= 0) return 0;
    const want = burn * (MAX_ACCEL / MAX_DV) * dt;
    const used = Math.min(state.fuel, want);
    state.fuel -= used;
    return used / Math.max(want, 1e-12);
  }

  function thrustAccel(state, burn) {
    if (burn <= 0 || state.fuel <= 0) return { ax: 0, ay: 0 };
    const a = MAX_ACCEL * burn;
    return { ax: Math.cos(state.nose) * a, ay: Math.sin(state.nose) * a };
  }

  function dragAccel(x, y, vx, vy, t) {
    const earth = bodyState("earth", t);
    const rx = x - earth.x;
    const ry = y - earth.y;
    const r = hypot(rx, ry);
    const alt = r - R_EARTH;
    const rho = density(alt);
    if (rho <= 0) return { ax: 0, ay: 0 };
    const vax = vx - earth.vx - (-ry * SITE_RATE);
    const vay = vy - earth.vy - (rx * SITE_RATE);
    const s = hypot(vax, vay);
    if (s < 0.01) return { ax: 0, ay: 0 };
    const accel = 0.5 * rho * s * s * DRAG_B;
    return { ax: -vax / s * accel, ay: -vay / s * accel };
  }

  function stepNumeric(state, intent, dt) {
    const burn = state.fuel > 0 ? Math.max(0, Math.min(1, intent.burn || 0)) : 0;
    slew(state, intent.angle, dt);
    const fuelScale = burn > 0 ? spendFuel(state, burn, dt) : 1;
    const useBurn = burn * (burn > 0 ? Math.min(1, fuelScale) : 0);
    const g = gravityAccel(state.x, state.y, state.t, state.parentId);
    const th = thrustAccel(state, useBurn);
    let ax = g.ax + th.ax;
    let ay = g.ay + th.ay;
    if (state.parentId === "earth") {
      const d = dragAccel(state.x, state.y, state.vx, state.vy, state.t);
      ax += d.ax;
      ay += d.ay;
    }
    state.vx += ax * dt;
    state.vy += ay * dt;
    state.x += state.vx * dt;
    state.y += state.vy * dt;
    state.t += dt;
    const next = pickParent(state.x, state.y, state.t);
    if (next !== state.parentId) {
      state.parentId = next;
      if (state.visited && Object.prototype.hasOwnProperty.call(state.visited, next)) state.visited[next] = true;
    }
    noteAlt(state);
    collide(state);
  }

  function noteAlt(state) {
    if (!state.airborne) return;
    const body = BODIES[state.parentId];
    const p = bodyState(state.parentId, state.t);
    const alt = hypot(state.x - p.x, state.y - p.y) - body.radius;
    if (alt > state.peakAlt) state.peakAlt = alt;
  }

  function collide(state) {
    if (state.status === "lost" || state.status === "landed") return;
    const id = state.parentId;
    if (id === "sun") {
      const r = hypot(state.x, state.y);
      if (r < R_SUN) {
        state.status = "lost";
        state.airborne = false;
      }
      return;
    }
    const body = BODIES[id];
    const p = bodyState(id, state.t);
    const rx = state.x - p.x;
    const ry = state.y - p.y;
    const r = hypot(rx, ry) || 1;
    const alt = r - body.radius;
    if (alt > 0) return;
    const nx = rx / r, ny = ry / r;
    const vrx = state.vx - p.vx;
    const vry = state.vy - p.vy;
    const speed = hypot(vrx, vry);
    state.x = p.x + nx * body.radius;
    state.y = p.y + ny * body.radius;
    state.vx = p.vx;
    state.vy = p.vy;
    state.airborne = false;
    const soft = (id === "moon" && speed < 22) || (id === "mars" && speed < 30) || (id === "earth" && speed < 28 && state.peakAlt < 12000);
    state.status = soft ? "landed" : "lost";
    state.landedOn = id;
  }

  function willLift(state, intent) {
    if (state.airborne) return true;
    const pose = sitePose(state.t);
    const burn = Math.max(0, Math.min(1, intent.burn || 0));
    const align = Math.cos(wrap((intent.angle == null ? state.nose : intent.angle) - pose.up));
    const g = MU_EARTH / (R_EARTH * R_EARTH);
    return burn * MAX_ACCEL * align > g + 0.35;
  }

function clampPad(state, intent, dt) {
  const pose = sitePose(state.t + dt);
  slew(state, intent && intent.angle, dt);
  state.t += dt;
  state.x = pose.x;
  state.y = pose.y;
  state.vx = pose.vx;
  state.vy = pose.vy;
  state.parentId = "earth";
}

  function coastChunk(state) {
    const id = state.parentId;
    if (id === "moon" || id === "mars") return 180;
    if (id === "sun") return 6 * 3600;
    const moon = bodyState("moon", state.t);
    const dMoon = hypot(state.x - moon.x, state.y - moon.y);
    if (dMoon < MOON_ORBIT * 1.25) return 480;
    const rel = relativeTo(state, "earth");
    const r = hypot(rel.rx, rel.ry);
    if (r > 2e8) return 1500;
    return 900;
  }

  function surfaceHitDelay(state, horizon) {
    const id = state.parentId;
    if (id === "sun") return null;
    const body = BODIES[id];
    const rel = relativeTo(state, id);
    const el = elementsOf(rel, body.mu);
    if (!(el.peri < body.radius * 0.998)) return null;
    if (el.r <= body.radius) return 0;
    const times = timesOf(el);
    if (times.timeToPeri == null) return null;
    if (times.timeToPeri <= horizon) return Math.max(0, times.timeToPeri);
    return null;
  }

  function applyCoast(state, dt) {
    const id = state.parentId;
    const rel0 = relativeTo(state, id);
    const rel = keplerAdvance(rel0, BODIES[id].mu, dt);
    const w = worldFromRel(id, state.t, dt, rel);
    state.x = w.x;
    state.y = w.y;
    state.vx = w.vx;
    state.vy = w.vy;
    state.t += dt;
    const next = pickParent(state.x, state.y, state.t);
    if (next !== state.parentId) {
      state.parentId = next;
      if (state.visited && Object.prototype.hasOwnProperty.call(state.visited, next)) state.visited[next] = true;
    }
    noteAlt(state);
    collide(state);
  }

  function boundaryDelay(state, chunk) {
    const start = state.parentId;
    function parentAt(dt) {
      const pos = predict(state, dt);
      return pickParent(pos.x, pos.y, state.t + dt);
    }
    const end = parentAt(chunk);
    const mid = parentAt(chunk * 0.5);
    if (end === start && mid === start) return null;
    let lo = 0;
    let hi = chunk;
    for (let i = 0; i < 20; i++) {
      const m = (lo + hi) / 2;
      if (parentAt(m) !== start) hi = m;
      else lo = m;
    }
    const next = parentAt(hi);
    if (next === start) return null;
    return { dt: Math.max(0.05, hi), next };
  }

  function coast(state, dt, intent) {
    if (intent && isFinite(intent.angle)) slew(state, intent.angle, dt);
    let left = dt;
    let guard = 0;
    const guardMax = Math.max(64, Math.ceil(dt / 20));
    while (left > 0.05 && guard++ < guardMax && state.status === "flight") {
      const chunk = Math.min(left, coastChunk(state));
      const hit = surfaceHitDelay(state, chunk);
      const boundary = boundaryDelay(state, chunk);
      let step = chunk;
      if (hit != null && (boundary == null || hit <= boundary.dt)) step = hit;
      else if (boundary && boundary.dt < chunk) step = boundary.dt;
      if (!(step > 0)) break;
      if (step < 0.05) step = 0.05;
      const applied = Math.min(step, left);
      applyCoast(state, applied);
      left -= applied;
      if (state.status !== "flight") return;
    }
  }

  function needsNumeric(state, intent) {
    const burn = Math.max(0, Math.min(1, (intent && intent.burn) || 0));
    if (burn > 0.015 && state.fuel > 0) return true;
    if (!state.airborne) return false;
    if (state.parentId === "earth") {
      const earth = bodyState("earth", state.t);
      const alt = hypot(state.x - earth.x, state.y - earth.y) - R_EARTH;
      if (alt < ATMOS) return true;
    }
    return false;
  }

  function advance(state, intent, dt) {
    if (!(dt > 0) || !state) return;
    if (state.status === "lost" || state.status === "landed") return;
const command = intent || { burn: 0, angle: state.nose };
  if (!state.airborne) {
    if (!willLift(state, command)) {
      clampPad(state, command, dt);
      return;
    }
    state.airborne = true;
    state.status = "flight";
    state.peakAlt = 0;
  }
    if (!needsNumeric(state, command)) {
      coast(state, dt, command);
      return;
    }
    let left = dt;
    let guard = 0;
    const hMax = 0.25;
    while (left > 1e-4 && guard++ < 20000 && state.status === "flight") {
      const h = Math.min(hMax, left);
      stepNumeric(state, command, h);
      left -= h;
      if (!needsNumeric(state, command)) {
        coast(state, left, command);
        return;
      }
    }
  }

  function snapshot(state) {
    return {
      version: 2,
      status: state.status,
      airborne: !!state.airborne,
      t: state.t,
      x: state.x, y: state.y, vx: state.vx, vy: state.vy,
      nose: state.nose,
      fuel: state.fuel,
      parentId: state.parentId,
      peakAlt: state.peakAlt || 0,
      landedOn: state.landedOn || null,
      visited: {
        earth: !!(state.visited && state.visited.earth),
        moon: !!(state.visited && state.visited.moon),
        mars: !!(state.visited && state.visited.mars),
        sun: !!(state.visited && state.visited.sun)
      }
    };
  }

  function restore(data) {
    const next = createFlight();
    if (!data || data.version !== 2) return next;
    const nums = ["t", "x", "y", "vx", "vy", "nose", "fuel", "peakAlt"];
    for (const k of nums) {
      if (!isFinite(data[k])) return createFlight();
    }
    if (!BODIES[data.parentId]) return createFlight();
    if (data.status !== "pad" && data.status !== "flight" && data.status !== "landed" && data.status !== "lost") return createFlight();
    next.status = data.status;
    next.airborne = !!data.airborne && data.status === "flight";
    next.t = data.t;
    next.x = data.x; next.y = data.y; next.vx = data.vx; next.vy = data.vy;
    next.nose = data.nose;
    next.fuel = Math.max(0, Math.min(1, data.fuel));
    next.parentId = data.parentId;
    next.peakAlt = data.peakAlt || 0;
    next.landedOn = data.landedOn || null;
    next.visited = {
      earth: true,
      moon: !!(data.visited && data.visited.moon),
      mars: !!(data.visited && data.visited.mars),
      sun: !!(data.visited && data.visited.sun)
    };
    return next;
  }

  function airSpeed(state) {
    const earth = bodyState("earth", state.t);
    const rx = state.x - earth.x;
    const ry = state.y - earth.y;
    const vax = state.vx - earth.vx - (-ry * SITE_RATE);
    const vay = state.vy - earth.vy - (rx * SITE_RATE);
    return hypot(vax, vay);
  }

  function shipAngle(state) {
    const e = bodyState("earth", state.t);
    return Math.atan2(state.y - e.y, state.x - e.x);
  }
  function moonAngle(t) {
    const e = bodyState("earth", t);
    const m = bodyState("moon", t);
    return Math.atan2(m.y - e.y, m.x - e.x);
  }

  root.StarbaseFlight = {
    WORLD, BODIES,
    createFlight, advance, analyze, predict, sampleOrbit, closestApproach,
    bodyState, pickParent, willLift, snapshot, restore,
    shipAngle, moonAngle, wrap, sitePose, airSpeed
  };
})(typeof window !== "undefined" ? window : globalThis);
