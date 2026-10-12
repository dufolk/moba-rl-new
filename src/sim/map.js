// Howling-Abyss-like single lane. Simulation coordinates are LoL units:
// x runs along the lane from the blue (team 0) base to the red (team 1) base,
// y is lateral (0 = lane center). The lane is mirror-symmetric around x = MID.

export const MAP_LENGTH = 12800;
export const MID = MAP_LENGTH / 2;

function baseHalfWidth(s) {
  const u = (s - 1300) / 1350;
  const v = 1 - u * u;
  return v > 0 ? 1200 * Math.sqrt(v) : 0;
}

function laneHalfWidth(s) {
  return 730 + 70 * Math.sin(s / 520) + 45 * Math.sin(s / 230 + 0.7);
}

export function halfWidth(x) {
  if (x < 0 || x > MAP_LENGTH) return 0;
  const s = Math.min(x, MAP_LENGTH - x);
  return Math.max(baseHalfWidth(s), s > 1700 ? laneHalfWidth(s) : 0);
}

export function isInside(x, y, r = 0) {
  return Math.abs(y) <= halfWidth(x) - r;
}

/** Clamp a position so a circle of radius r stays inside the walkable area. */
export function clampToMap(p, r = 0) {
  let x = Math.min(Math.max(p.x, 40 + r), MAP_LENGTH - 40 - r);
  let hw = Math.max(0, halfWidth(x) - r);
  let y = Math.min(Math.max(p.y, -hw), hw);
  p.x = x;
  p.y = y;
  return p;
}

export function teamX(team, x) {
  return team === 0 ? x : MAP_LENGTH - x;
}

export const LAYOUT = {
  fountainX: 330,
  fountainHealRadius: 700,
  fountainLaserRange: 1250,
  spawnX: 430,
  nexusX: 1250,
  nexusRadius: 230,
  minionSpawnX: 1650,
  towers: [
    { tier: 'nexus', x: 2050, y: 0 },
    { tier: 'inner', x: 3500, y: 0 },
    { tier: 'outer', x: 4900, y: 0 },
  ],
  relics: [
    { x: MID - 1650, y: 430 },
    { x: MID + 1650, y: -430 },
    { x: MID - 3150, y: -470 },
    { x: MID + 3150, y: 470 },
  ],
};

/**
 * March along a ray and return the first point where it hits terrain or a
 * blocking circle. Returns null when nothing is hit within maxDist.
 */
export function raycastTerrain(x0, y0, dx, dy, maxDist, circles = []) {
  const step = 20;
  for (let d = step; d <= maxDist; d += step) {
    const x = x0 + dx * d, y = y0 + dy * d;
    if (x <= 40 || x >= MAP_LENGTH - 40 || !isInside(x, y, 0)) {
      return { x: x0 + dx * (d - step), y: y0 + dy * (d - step), d: d - step };
    }
    for (const c of circles) {
      const ex = x - c.x, ey = y - c.y;
      if (ex * ex + ey * ey <= c.r * c.r) {
        return { x: x0 + dx * (d - step), y: y0 + dy * (d - step), d: d - step, structure: c };
      }
    }
  }
  return null;
}
