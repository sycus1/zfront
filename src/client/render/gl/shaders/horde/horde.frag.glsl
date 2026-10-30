#version 300 es
precision highp float;

// Horde cells (R8, normalized): 0 empty, 1-247 density, 248 a mine, 249 a
// resting noise beacon, 250 a sounding one, 251 a scavenger depot, 252-254 a
// wall (barricade, stone, reinforced), 255 an elite. One texel per coarse
// cell (2x2 tiles).
uniform sampler2D uHorde;
uniform ivec2 uGridSize;
uniform float uTime;
// The announced wave's landings: xy the landing cell's centre, zw the unit
// direction to the HQ, in coarse cells.
uniform vec4 uArrows[MAX_ARROWS];
uniform int uArrowCount;
uniform bool uArrowFinal;
// Turrets that fired on the last tick: xy the turret cell's centre, zw the
// centre of the cell it hit, in coarse cells.
uniform vec4 uShots[MAX_SHOTS];
uniform int uShotCount;
// 0 draws only the packed horde, under the zombie squares (HordeSwarm); 1
// draws everything else, over them.
uniform int uLayer;
// Zombies in a cell from which it is drawn as packed (HordeSwarm's cap).
uniform float uPackedFrom;

in vec2 vUV;
out vec4 fragColor;

const float MINE = 248.0;
const float BEACON = 249.0;
const float BEACON_SOUNDING = 250.0;
const float DEPOT = 251.0;
const float WALL = 252.0;
const float ELITE = 255.0;

int byteAt(ivec2 cell) {
  cell = clamp(cell, ivec2(0), uGridSize - 1);
  return int(texelFetch(uHorde, cell, 0).r * 255.0 + 0.5);
}

// Zombies in a cell (see engine-lib game/HordeCells): buildings and elites
// count as empty, so they don't smear into the horde around them.
float densityAt(ivec2 cell) {
  int b = byteAt(cell);
  if (b >= int(MINE)) return 0.0;
  return b <= EXACT_MAX ? float(b) : float(EXACT_MAX + (b - EXACT_MAX) * DENSITY_STEP);
}

// 1 inside an arrow (shaft then head, 12 cells long, pointing along the
// direction), 0.5 on its dark rim, 0 outside.
float arrowAt(vec2 p) {
  float hit = 0.0;
  for (int k = 0; k < MAX_ARROWS; k++) {
    if (k >= uArrowCount) break;
    vec2 d = uArrows[k].zw;
    vec2 r = p - uArrows[k].xy;
    float a = dot(r, d);
    float c = abs(r.x * d.y - r.y * d.x);
    // The head's half-width shrinks from 3.5 to 0 over its last 5 cells.
    float half_ = a < 7.0 ? 1.2 : (12.0 - a) * 0.7;
    if (a < 0.0 || a > 12.0 || c > half_ + 0.6) continue;
    hit = max(hit, c > half_ ? 0.5 : 1.0);
  }
  return hit;
}

// Turret fire at p: rgb the colour, a the alpha, 0 where there is none. Each
// shot is a faint beam with bright rounds running down it, a flickering
// muzzle flash and a burst where it lands. Each shot has its own phase so a
// ring of turrets doesn't fire in step.
vec4 shotAt(vec2 p) {
  vec4 hit = vec4(0.0);
  for (int k = 0; k < MAX_SHOTS; k++) {
    if (k >= uShotCount) break;
    vec2 a = uShots[k].xy;
    vec2 b = uShots[k].zw;
    vec2 lo = min(a, b) - 1.0;
    vec2 hi = max(a, b) + 1.0;
    if (p.x < lo.x || p.y < lo.y || p.x > hi.x || p.y > hi.y) continue;
    float phase = fract(uTime * 4.0 + float(k) * 0.618);
    vec2 d = b - a;
    float len = length(d);
    vec2 r = p - a;
    if (len > 0.5) {
      vec2 dir = d / len;
      float along = dot(r, dir);
      float across = abs(r.x * dir.y - r.y * dir.x);
      if (along > 0.0 && along < len) {
        // Two rounds in flight, half a cycle apart.
        float run = min(abs(along - phase * len), abs(along - fract(phase + 0.5) * len));
        if (across < 0.2 && run < 0.7) {
          hit = max(hit, vec4(1.0, 0.95, 0.7, 1.0));
        } else if (across < 0.07) {
          hit = max(hit, vec4(1.0, 0.85, 0.45, 0.45));
        }
      }
      float flash = step(0.5, fract(uTime * 9.0 + float(k) * 0.37));
      if (length(r) < 0.45 + 0.25 * flash) {
        hit = max(hit, vec4(1.0, 0.9, 0.5, 0.55 + 0.4 * flash));
      }
    }
    // The burst shrinks rather than fades: a faint one would punch a hole
    // in the horde drawn under it.
    if (length(p - b) < 0.15 + 0.55 * (1.0 - phase)) {
      hit = max(hit, vec4(1.0, 0.65, 0.25, 0.9));
    }
  }
  return hit;
}

void main() {
  vec2 p = vUV * vec2(uGridSize);
  ivec2 cell = clamp(ivec2(p), ivec2(0), uGridSize - 1);
  int raw = byteAt(cell);

  if (uLayer == 0) {
    // Packed horde: a dark mass, filtered by hand into blobs, where cells
    // hold more zombies than get a square each. Thinner cells are left to
    // the squares.
    vec2 q = p - 0.5;
    ivec2 i0 = ivec2(floor(q));
    vec2 t = fract(q);
    float d = mix(
      mix(densityAt(i0), densityAt(i0 + ivec2(1, 0)), t.x),
      mix(densityAt(i0 + ivec2(0, 1)), densityAt(i0 + ivec2(1, 1)), t.x),
      t.y
    );
    float s = smoothstep(uPackedFrom, uPackedFrom * 6.0, d);
    if (s <= 0.0) discard;
    fragColor = vec4(mix(vec3(0.62, 0.07, 0.05), vec3(0.45, 0.03, 0.03), s), 0.75 + 0.2 * s);
    return;
  }

  vec4 shot = shotAt(p);
  if (shot.a > 0.0) {
    fragColor = shot;
    return;
  }

  // Elites and walls: exact texel lookup, so they keep their cell's shape.
  if (raw == int(ELITE)) {
    float pulse = 0.75 + 0.25 * sin(uTime * 6.0);
    fragColor = vec4(vec3(0.95, 0.85, 0.2) * pulse, 1.0);
    return;
  }
  if (raw >= int(MINE) && raw <= int(DEPOT)) {
    vec2 f = fract(p) - 0.5;
    float r = length(f);
    if (raw == int(MINE)) {
      // A dark disc with a red light.
      if (r > 0.42) discard;
      fragColor = r < 0.14 ? vec4(0.95, 0.15, 0.1, 1.0) : vec4(0.15, 0.15, 0.12, 1.0);
    } else if (raw == int(DEPOT)) {
      // A crate: tan with a darker rim.
      float edge = 0.5 - max(abs(f.x), abs(f.y));
      fragColor = vec4(vec3(0.72, 0.56, 0.3) * (edge < 0.1 ? 0.6 : 1.0), 1.0);
    } else {
      // A blue post; a sounding beacon pulses brighter.
      float pulse = raw == int(BEACON_SOUNDING) ? 0.7 + 0.3 * sin(uTime * 10.0) : 0.45;
      if (r > 0.45) discard;
      fragColor = vec4(vec3(0.3, 0.6, 1.0) * (r < 0.2 ? 1.0 : pulse), 1.0);
    }
    return;
  }
  if (raw >= int(WALL)) {
    // A block with a darker rim, so a line of walls reads as segments:
    // brown timber, grey stone, then dark steel.
    vec3 tint = raw == int(WALL)
      ? vec3(0.55, 0.4, 0.25)
      : raw == int(WALL) + 1 ? vec3(0.62, 0.6, 0.56) : vec3(0.36, 0.4, 0.46);
    vec2 f = fract(p);
    float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    fragColor = vec4(tint * (edge < 0.12 ? 0.68 : 1.0), 1.0);
    return;
  }

  float arrow = arrowAt(p);
  if (arrow > 0.0) {
    float pulse = 0.7 + 0.3 * sin(uTime * 4.0);
    vec3 tint = uArrowFinal ? vec3(1.0, 0.2, 0.15) : vec3(1.0, 0.75, 0.15);
    fragColor = vec4(arrow < 1.0 ? tint * 0.35 : tint, 0.9 * pulse);
    return;
  }

  discard;
}
