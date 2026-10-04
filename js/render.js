"use strict";
/* Draws the flight. It never moves the ship. */
(function (root) {
  const F = root.StarbaseFlight;
  const Map = root.StarbaseMap;
  const W = F.WORLD;

  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function scale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }
  function len(a) { return Math.hypot(a.x, a.y, a.z); }
  function norm(a) {
    const n = len(a) || 1;
    return { x: a.x / n, y: a.y / n, z: a.z / n };
  }
  function lerp(a, b, t) { return add(a, scale(sub(b, a), t)); }
  function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

  function hash(i) {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  const stars = [];
  for (let i = 0; i < 160; i++) {
    const u = hash(i + 1);
    const v = hash(i + 99);
    const theta = u * W.TAU;
    const z = v * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    stars.push({ x: r * Math.cos(theta), y: r * Math.sin(theta), z: z, m: 0.35 + hash(i + 7) * 0.9 });
  }

  function create(canvas) {
    const ctx = canvas.getContext("2d");
    const view = { dist: 6400, fov: 50 * W.DEG };
    const trail = [];
    let trailMark = 0;

    function resize() {
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      const pw = Math.max(1, Math.floor(w * dpr));
      const ph = Math.max(1, Math.floor(h * dpr));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      return { w: pw, h: ph, dpr: dpr };
    }

    function targetDistance(flight, a) {
      const alt = Math.max(0, a.alt || 0);
      let d = 5200 + alt * 4.8;
      const focal = Math.tan(view.fov * 0.5);
      if (flight.airborne && a.ecc < 1 && isFinite(a.apo) && a.apoAlt > 130000) {
        d = Math.max(d, (a.apo * 2.2) / focal * 0.52);
      }
      if (a.parent === "earth" && a.apo > W.MOON_ORBIT * 0.42) {
        d = Math.max(d, (W.MOON_ORBIT * 2.35) / focal * 0.48);
      }
      if (a.parent === "moon") {
        const span = Math.max(isFinite(a.apo) ? a.apo : 0, W.R_MOON * 4);
        d = Math.max(d, span * 2.5 / focal * 0.5);
      }
      if (a.parent === "sun" || a.parent === "mars") {
        const earth = F.bodyState("earth", flight.t);
        const mars = F.bodyState("mars", flight.t);
        const ship = Math.hypot(flight.x, flight.y);
        const reach = Math.max(ship, Math.hypot(mars.x, mars.y), Math.hypot(earth.x, earth.y));
        d = Math.max(d, reach * 1.15 / focal * 0.42);
        if (a.parent === "mars") {
          const local = Math.max(isFinite(a.apo) ? a.apo : W.SOI_MARS, W.R_MARS * 6);
          d = Math.max(5200 + alt * 4.8, local * 2.6 / focal * 0.5);
        }
      }
      return Math.max(2600, Math.min(d, W.AU * 4));
    }

    function poseFrame(t) {
      const pose = F.sitePose(t);
      const radial = { x: Math.cos(pose.up), y: Math.sin(pose.up), z: 0 };
      const east = { x: -Math.sin(pose.up), y: Math.cos(pose.up), z: 0 };
      const north = { x: 0, y: 0, z: 1 };
      return { pose, radial, east, north };
    }

    function camera(flight, a, dt) {
      const want = targetDistance(flight, a);
      const rate = want > view.dist ? 2.6 : 0.62;
      view.dist += (want - view.dist) * (1 - Math.exp(-Math.max(0.016, dt) * rate));
      const ship = { x: flight.x, y: flight.y, z: 0 };
      const frame = poseFrame(flight.t);
      const blend = smooth((view.dist - 70000) / (650000 - 70000));
      const cine = norm(add(add(scale(frame.east, -1), scale(frame.north, -0.34)), scale(frame.radial, 0.46)));
      const map = norm(add(add(scale(frame.north, 1), scale(frame.east, -0.08)), scale(frame.radial, 0.04)));
      const dir = norm(lerp(cine, map, blend));
      const ahead = Math.min(700, view.dist * 0.06);
      const close = 1 - smooth((view.dist - 12000) / (90000 - 12000));
      const look = lerp(add(ship, scale(frame.east, ahead)), ship, Math.max(blend, close));
      const eye = add(look, scale(dir, view.dist));
      const fwd = norm(sub(look, eye));
      const hint = blend < 0.45 ? frame.radial : frame.north;
      let right = cross(fwd, hint);
      if (len(right) < 1e-4) right = cross(fwd, { x: 0, y: 0, z: 1 });
      right = norm(right);
      const up = norm(cross(right, fwd));
      return { eye, look, fwd, right, up, blend, frame, ship };
    }

    function projector(cam, size) {
      const f = (size.h * 0.5) / Math.tan(view.fov * 0.5);
      const focusY = size.h * (size.h > size.w * 1.05 ? 0.40 : 0.38);
      return function (p) {
        const d = sub(p, cam.eye);
        const x = dot(d, cam.right);
        const y = dot(d, cam.up);
        const z = dot(d, cam.fwd);
        if (z < 12) return null;
        return { x: size.w * 0.5 + (x / z) * f, y: focusY - (y / z) * f, z: z, f: f };
      };
    }

    function hidden(eye, point, center, radius) {
      const dx = point.x - eye.x;
      const dy = point.y - eye.y;
      const dz = (point.z || 0) - eye.z;
      const ox = eye.x - center.x;
      const oy = eye.y - center.y;
      const oz = eye.z - center.z;
      const a = dx * dx + dy * dy + dz * dz;
      const b = 2 * (ox * dx + oy * dy + oz * dz);
      const c = ox * ox + oy * oy + oz * oz - radius * radius;
      const disc = b * b - 4 * a * c;
      if (disc <= 0 || a < 1e-6) return false;
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      return t > 0.002 && t < 0.992;
    }

    function frontRing(points, earth, eye) {
      const out = [];
      const n = points.length;
      for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        const va = dot(sub(a, earth), sub(eye, earth));
        const vb = dot(sub(b, earth), sub(eye, earth));
        if (va > 0) out.push(a);
        if ((va > 0) !== (vb > 0)) {
          const t = va / (va - vb);
          out.push(lerp(a, b, Math.max(0, Math.min(1, t))));
        }
      }
      return out.length > 2 ? out : null;
    }

    function worldOn(earth, spin, unit, radius) {
      const c = Math.cos(spin);
      const s = Math.sin(spin);
      const rx = unit.x * c - unit.y * s;
      const ry = unit.x * s + unit.y * c;
      return { x: earth.x + rx * radius, y: earth.y + ry * radius, z: unit.z * radius };
    }

    function limb(project, center, radius) {
      const dist = len(sub(center, project.eye));
      const c = project(center);
      if (!c || !(dist > radius * 1.001)) return null;
      const px = (radius / Math.sqrt(dist * dist - radius * radius)) * c.f;
      if (!Number.isFinite(px) || !Number.isFinite(c.x)) return null;
      return { x: c.x, y: c.y, r: px, z: c.z, dist: dist };
    }

    function drawStars(ctx, project, size) {
      ctx.fillStyle = "#070910";
      ctx.fillRect(0, 0, size.w, size.h);
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const p = project(add(project.eye, scale(s, 1e13)));
        if (!p) continue;
        ctx.globalAlpha = 0.35 + s.m * 0.45;
        ctx.fillStyle = s.m > 1 ? "#fff6e4" : "#d5e4f2";
        ctx.fillRect(p.x, p.y, s.m > 1.05 ? 2.2 : 1.4, s.m > 1.05 ? 2.2 : 1.4);
      }
      ctx.globalAlpha = 1;
    }

    function drawEarth(ctx, project, cam, flight) {
      const earth = F.bodyState("earth", flight.t);
      const sunDir = norm({ x: -earth.x, y: -earth.y, z: 0 });
      const disc = limb(Object.assign(project, { eye: cam.eye }), earth, W.R_EARTH);
      if (!disc || disc.r < 1.5) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(disc.x, disc.y, disc.r, 0, W.TAU);
      ctx.clip();
      ctx.fillStyle = "#071422";
      ctx.fillRect(disc.x - disc.r, disc.y - disc.r, disc.r * 2, disc.r * 2);
      const spin = W.SITE_RATE * flight.t;
      for (let i = 0; i < Map.continents.length; i++) {
        const land = Map.continents[i];
        const pts = [];
        for (let k = 0; k < land.ring.length; k++) pts.push(worldOn(earth, spin, land.ring[k], W.R_EARTH * 1.002));
        const vis = frontRing(pts, earth, cam.eye);
        if (!vis) continue;
        const mid = vis[0];
        const lit = dot(norm(sub(mid, earth)), sunDir);
        ctx.beginPath();
        for (let k = 0; k < vis.length; k++) {
          const p = project(vis[k]);
          if (!p) continue;
          if (k === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fillStyle = lit > 0.08 ? land.fill : land.night;
        ctx.fill();
      }
      const sub = project(add(earth, scale(sunDir, W.R_EARTH * 0.98)));
      if (sub && Number.isFinite(sub.x) && Number.isFinite(disc.r) && disc.r < 1e7) {
        const g = ctx.createRadialGradient(sub.x, sub.y, Math.max(0, disc.r * 0.05), sub.x, sub.y, Math.max(1, disc.r * 1.35));
        g.addColorStop(0, "rgba(190, 214, 196, 0.28)");
        g.addColorStop(0.45, "rgba(80, 140, 170, 0.16)");
        g.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = g;
        ctx.fillRect(disc.x - disc.r, disc.y - disc.r, disc.r * 2, disc.r * 2);
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.restore();
      const glowR0 = Math.max(0, disc.r * 0.92);
      const glowR1 = Math.max(glowR0 + 1, disc.r * 1.18);
      if (!Number.isFinite(disc.x) || !Number.isFinite(glowR1) || glowR1 > 1e7) return;
      const glow = ctx.createRadialGradient(disc.x, disc.y, glowR0, disc.x, disc.y, glowR1);
      glow.addColorStop(0, "rgba(120, 186, 214, 0)");
      glow.addColorStop(0.55, "rgba(126, 196, 220, 0.35)");
      glow.addColorStop(1, "rgba(126, 196, 220, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(disc.x, disc.y, disc.r * 1.18, 0, W.TAU);
      ctx.fill();
      if (disc.r < 70) label(ctx, "Earth", disc.x, disc.y - disc.r - 14);
    }

    function drawPlanet(ctx, project, cam, center, radius, fill, name, minAng) {
      const dist = len(sub(center, cam.eye));
      if (dist < radius) return;
      const ang = Math.max(Math.asin(Math.min(0.95, radius / dist)), minAng || 0);
      const c = project(center);
      if (!c) return;
      const px = Math.tan(ang) * c.f;
      ctx.beginPath();
      ctx.arc(c.x, c.y, px, 0, W.TAU);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (px < 48) label(ctx, name, c.x, c.y - px - 12);
    }

    function label(ctx, text, x, y) {
      ctx.font = "600 13px sans-serif";
      ctx.fillStyle = "rgba(244, 236, 220, 0.88)";
      ctx.textAlign = "center";
      ctx.fillText(text, x, y);
    }

    function localPoint(frame, eastM, northM, upM) {
      return add(add(add(
        { x: frame.pose.x, y: frame.pose.y, z: 0 },
        scale(frame.east, eastM)
      ), scale(frame.north, northM)), scale(frame.radial, upM || 0));
    }

    function drawShore(ctx, project, cam) {
      const fade = 1 - smooth((view.dist - 35000) / (150000 - 35000));
      if (fade < 0.02) return;
      ctx.save();
      ctx.globalAlpha = fade;
      const water = [
        localPoint(cam.frame, -2000, -18000, -30),
        localPoint(cam.frame, 28000, -18000, -30),
        localPoint(cam.frame, 28000, 18000, -30),
        localPoint(cam.frame, -2000, 18000, -30)
      ];
      poly(ctx, project, water, "#12344a");
      const land = [localPoint(cam.frame, -22000, -18000, 0), localPoint(cam.frame, -22000, 18000, 0)];
      for (let i = Map.shore.length - 1; i >= 0; i--) land.push(localPoint(cam.frame, Map.shore[i][0], Map.shore[i][1], 0));
      poly(ctx, project, land, "#3d4a32");
      poly(ctx, project, [
        localPoint(cam.frame, -9000, -2000, 40),
        localPoint(cam.frame, -4200, -600, 90),
        localPoint(cam.frame, -7000, 1800, 40)
      ], "#2c3828");
      poly(ctx, project, [
        localPoint(cam.frame, -80, -70, 2),
        localPoint(cam.frame, 90, -70, 2),
        localPoint(cam.frame, 90, 80, 2),
        localPoint(cam.frame, -80, 80, 2)
      ], "#b7b1a4");
      const foot = localPoint(cam.frame, -90, 30, 0);
      const top = localPoint(cam.frame, -90, 30, 540);
      const a = project(foot);
      const b = project(top);
      if (a && b) {
        ctx.strokeStyle = "#d9d3c6";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    function poly(ctx, project, pts, fill) {
      ctx.beginPath();
      let moved = false;
      for (let i = 0; i < pts.length; i++) {
        const p = project(pts[i]);
        if (!p) continue;
        if (!moved) { ctx.moveTo(p.x, p.y); moved = true; }
        else ctx.lineTo(p.x, p.y);
      }
      if (!moved) return;
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }

    function drawOrbit(ctx, project, flight) {
      if (view.dist < 180000) return;
      const orbit = F.sampleOrbit(flight, 80);
      if (!orbit) return;
      ctx.beginPath();
      let on = false;
      for (let i = 0; i < orbit.points.length; i++) {
        const p = project({ x: orbit.points[i].x, y: orbit.points[i].y, z: 0 });
        if (!p) { on = false; continue; }
        if (!on) { ctx.moveTo(p.x, p.y); on = true; }
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = "rgba(232, 220, 190, 0.45)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      mark(ctx, project, orbit.apo, "A");
      mark(ctx, project, orbit.peri, "P");
    }

    function mark(ctx, project, point, letter) {
      if (!point) return;
      const p = project({ x: point.x, y: point.y, z: 0 });
      if (!p) return;
      ctx.fillStyle = "#f0e2c0";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, W.TAU);
      ctx.fill();
      ctx.font = "600 11px sans-serif";
      ctx.fillText(letter, p.x + 6, p.y - 6);
    }

    function drawRocket(ctx, project, cam, flight, burning) {
      const earth = F.bodyState("earth", flight.t);
      const tail = { x: flight.x, y: flight.y, z: 0 };
      const noseW = { x: flight.x + Math.cos(flight.nose) * 820, y: flight.y + Math.sin(flight.nose) * 820, z: 0 };
      if (hidden(cam.eye, tail, earth, W.R_EARTH * 0.98) && hidden(cam.eye, noseW, earth, W.R_EARTH * 0.98)) return;
      let a = project(tail);
      let b = project(noseW);
      if (!a) return;
      if (!b) b = { x: a.x, y: a.y - 70 };
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let L = Math.hypot(dx, dy);
      if (L < 8) { dx = 0; dy = -1; L = 1; }
      const px = Math.max(66, Math.min(L, 168));
      const ux = dx / L;
      const uy = dy / L;
      const sx = -uy;
      const sy = ux;
      const tip = { x: a.x + ux * px, y: a.y + uy * px };
      const wide = px * 0.16;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(Math.atan2(uy, ux));
      if (burning) {
        const flick = 0.75 + Math.sin(flight.t * 40) * 0.15 + Math.sin(flight.t * 90) * 0.1;
        ctx.fillStyle = "rgba(255, 186, 84, 0.9)";
        ctx.beginPath();
        ctx.moveTo(0, wide * 0.45);
        ctx.lineTo(-px * 0.55 * flick, 0);
        ctx.lineTo(0, -wide * 0.45);
        ctx.fill();
        ctx.fillStyle = "rgba(255, 244, 210, 0.95)";
        ctx.beginPath();
        ctx.moveTo(0, wide * 0.22);
        ctx.lineTo(-px * 0.28 * flick, 0);
        ctx.lineTo(0, -wide * 0.22);
        ctx.fill();
      }
      ctx.fillStyle = "#f4efe4";
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px * 0.72, wide);
      ctx.lineTo(px * 0.08, wide * 0.82);
      ctx.lineTo(0, wide * 0.35);
      ctx.lineTo(0, -wide * 0.35);
      ctx.lineTo(px * 0.08, -wide * 0.82);
      ctx.lineTo(px * 0.72, -wide);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#d24a3a";
      ctx.beginPath();
      ctx.moveTo(px * 0.16, wide * 0.7);
      ctx.lineTo(0, wide * 1.25);
      ctx.lineTo(px * 0.28, wide * 0.45);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(px * 0.16, -wide * 0.7);
      ctx.lineTo(0, -wide * 1.25);
      ctx.lineTo(px * 0.28, -wide * 0.45);
      ctx.fill();
      ctx.fillStyle = "#1c2430";
      ctx.beginPath();
      ctx.arc(px * 0.62, 0, wide * 0.28, 0, W.TAU);
      ctx.fill();
      ctx.restore();
      if (px > 72) {
        ctx.fillStyle = "#243044";
        ctx.font = "700 " + Math.max(12, Math.round(px * 0.11)) + "px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("2042", (a.x + tip.x) * 0.5, (a.y + tip.y) * 0.5);
      }
      return tip;
    }

    function draw(flight, intent, dt) {
      const size = resize();
      const a = F.analyze(flight);
      const cam = camera(flight, a, dt || 0.016);
      const project = projector(cam, size);
      project.eye = cam.eye;
      drawStars(ctx, project, size);
      if (a.parent === "sun" || a.parent === "mars" || view.dist > W.MOON_ORBIT * 0.2) {
        const sun = limb(project, { x: 0, y: 0, z: 0 }, W.R_SUN);
        if (sun && sun.r < size.h * 0.45 && sun.r > 2 && Number.isFinite(sun.x)) {
          const g = ctx.createRadialGradient(sun.x, sun.y, sun.r * 0.2, sun.x, sun.y, Math.max(sun.r * 2.4, sun.r + 1));
          g.addColorStop(0, "rgba(255, 214, 140, 0.95)");
          g.addColorStop(0.4, "rgba(255, 170, 80, 0.35)");
          g.addColorStop(1, "rgba(255, 160, 60, 0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(sun.x, sun.y, sun.r * 2.4, 0, W.TAU);
          ctx.fill();
        }
      }
      drawEarth(ctx, project, cam, flight);
      drawOrbit(ctx, project, flight);
      const moon = F.bodyState("moon", flight.t);
      const mars = F.bodyState("mars", flight.t);
      drawPlanet(ctx, project, cam, { x: mars.x, y: mars.y, z: 0 }, W.R_MARS, "#c46a45", "Mars", 0.012);
      drawPlanet(ctx, project, cam, { x: moon.x, y: moon.y, z: 0 }, W.R_MOON, "#d7d0c2", "Moon", 0.045);
      drawShore(ctx, project, cam);
      if (flight.airborne && (intent.burn > 0.05 || flight.t - trailMark < 30)) {
        if (flight.t - trailMark > 0.4) {
          trail.push({ x: flight.x, y: flight.y });
          if (trail.length > 48) trail.shift();
          trailMark = flight.t;
        }
      }
      if (trail.length > 1 && view.dist < 2e6) {
        ctx.beginPath();
        for (let i = 0; i < trail.length; i++) {
          const p = project({ x: trail[i].x, y: trail[i].y, z: 0 });
          if (!p) continue;
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = "rgba(255, 176, 96, 0.45)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      const burning = !!(intent && intent.burn > 0.04 && flight.fuel > 0 && flight.status === "flight");
      drawRocket(ctx, project, cam, flight, burning);
    }

    function clearTrail() { trail.length = 0; }

    return { draw, clearTrail };
  }

  root.StarbaseView = { create };
})(typeof window !== "undefined" ? window : globalThis);
