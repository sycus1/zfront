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
// Mortar shells in the air: xy the shell on its arc, zw its shadow on the
// ground, in coarse cells.
uniform vec4 uShells[MAX_SHELLS];
uniform int uShellCount;
// Mortar blasts: xy the centre in coarse cells, z its age from 0 to 1, w the
// radius in coarse cells.
uniform vec4 uBlasts[MAX_BLASTS];
uniform int uBlastCount;
// 0 draws only the packed horde, under the zombie squares (HordeSwarm); 1
// draws everything else, over them.
uniform int uLayer;
// Zombies in a cell from which it is drawn as packed (HordeSwarm's cap).
uniform float uPackedFrom;
// Build mode (zfront): the ghost's coarse cell centre (x < 0 when off), and
// the wall links it would make, as cell centres x0, y0, x1, y1.
uniform vec2 uCursor;
uniform vec4 uLinks[MAX_LINKS];
uniform int uLinkCount;
// Supply crates: xy the centre in coarse cells, z the share of looting done
// (-1 when nobody is looting), w the share of its life left.
uniform vec4 uCrates[MAX_CRATES];
uniform int uCrateCount;
// Pixel-art one-cell buildings (cell-sprites.png, premultiplied), CELL_PX
// square frames in this order: barricade, stone, reinforced, mine, beacon,
// sounding beacon, depot.
uniform sampler2D uCells;
uniform vec2 uCellTexSize;
const float CELL_PX = 8.0;

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

// A mortar shell at p: a dark round with a hot rim, or the soft shadow on
// the ground below it, which it meets as it lands. 0 alpha where there is
// neither; alpha 1 only on the shell itself.
vec4 shellAt(vec2 p) {
  vec4 hit = vec4(0.0);
  for (int k = 0; k < MAX_SHELLS; k++) {
    if (k >= uShellCount) break;
    float d = length(p - uShells[k].xy);
    if (d < 0.5) return d < 0.32 ? vec4(0.12, 0.12, 0.1, 1.0) : vec4(1.0, 0.75, 0.3, 1.0);
    if (length(p - uShells[k].zw) < 0.35) hit = vec4(0.0, 0.0, 0.0, 0.45);
  }
  return hit;
}

// A mortar blast at p: a fireball that shrinks from white-hot to dark red
// inside a shock ring that runs out and thins. 0 alpha outside it.
vec4 blastAt(vec2 p) {
  for (int k = 0; k < MAX_BLASTS; k++) {
    if (k >= uBlastCount) break;
    float age = uBlasts[k].z;
    float r = uBlasts[k].w;
    float d = length(p - uBlasts[k].xy);
    if (d > r * 1.4) continue;
    float core = r * (1.0 - age) * 0.9;
    if (d < core) {
      vec3 hot = mix(vec3(1.0, 0.95, 0.75), vec3(1.0, 0.5, 0.12), clamp(d / core + age, 0.0, 1.0));
      return vec4(mix(hot, vec3(0.45, 0.08, 0.05), age), 0.95);
    }
    float ring = r * (0.5 + 0.8 * age);
    if (abs(d - ring) < 0.35 * (1.0 - age)) return vec4(1.0, 0.7, 0.3, 0.9 * (1.0 - age * 0.5));
  }
  return vec4(0.0);
}

// A supply crate at p: rgb the colour, a the alpha, 0 where there is none.
// A gold box with dark straps, inside a ring: green and filling clockwise
// while it is looted, otherwise white and running down as its life does,
// blinking near the end.
vec4 crateAt(vec2 p) {
  for (int k = 0; k < MAX_CRATES; k++) {
    if (k >= uCrateCount) break;
    vec2 r = p - uCrates[k].xy;
    if (abs(r.x) > 2.2 || abs(r.y) > 2.2) continue;
    float looted = uCrates[k].z;
    float life = uCrates[k].w;
    float box = max(abs(r.x), abs(r.y));
    if (box < 0.9) {
      bool strap = abs(r.x) < 0.14 || abs(r.y) < 0.14 || box > 0.76;
      return vec4(strap ? vec3(0.42, 0.27, 0.08) : vec3(1.0, 0.76, 0.22), 1.0);
    }
    float d = length(r);
    if (d > 1.45 && d < 1.9) {
      // 0 at the top, going clockwise (y grows downwards).
      float a = fract(atan(r.x, -r.y) / 6.2831853 + 1.0);
      if (looted >= 0.0) {
        return a <= looted
          ? vec4(0.35, 0.95, 0.4, 1.0)
          : vec4(0.1, 0.25, 0.1, 0.7);
      }
      float blink = life < 0.25 ? step(0.5, fract(uTime * 3.0)) : 1.0;
      return a <= life
        ? vec4(1.0, 0.95, 0.8, 0.9 * blink)
        : vec4(0.0, 0.0, 0.0, 0.35);
    }
  }
  return vec4(0.0);
}

// Cells round the cursor that show the build grid.
const float GRID_RADIUS = 9.0;

// Dashed gold lines along the previewed wall links: 1 on a dash, else 0.
float linkAt(vec2 p) {
  for (int k = 0; k < MAX_LINKS; k++) {
    if (k >= uLinkCount) break;
    vec2 a = uLinks[k].xy;
    vec2 ab = uLinks[k].zw - a;
    float len = max(length(ab), 1e-3);
    float t = clamp(dot(p - a, ab) / (len * len), 0.0, 1.0);
    if (length(p - (a + ab * t)) > 0.28) continue;
    if (fract(t * len * 0.8 - uTime * 1.5) < 0.6) return 1.0;
  }
  return 0.0;
}

// Opacity of the build grid's cell edges at p, fading out from the cursor.
// `px` is fwidth(p), taken in uniform control flow by the caller.
float gridAt(vec2 p, vec2 px) {
  if (uCursor.x < 0.0) return 0.0;
  float r = length(p - uCursor);
  if (r > GRID_RADIUS) return 0.0;
  vec2 f = abs(fract(p + 0.5) - 0.5);
  float line = max(step(f.x, px.x), step(f.y, px.y));
  // The cursor's own cell gets a brighter outline.
  bool here = all(equal(floor(p), floor(uCursor)));
  return line * (here ? 0.9 : 0.35 * (1.0 - r / GRID_RADIUS));
}

bool isWall(ivec2 cell) {
  int b = byteAt(cell);
  return b >= int(WALL) && b != int(ELITE);
}

// A one-cell building's art at f (0-1 across the cell), sampled sharply so
// each art pixel stays a flat square at any zoom. Premultiplied.
// pw is fwidth(p), taken in uniform control flow.
vec4 cellSprite(int frame, vec2 f, vec2 pw) {
  vec2 texel = vec2((float(frame) + f.x) * CELL_PX, f.y * CELL_PX);
  vec2 seam = floor(texel + 0.5);
  vec2 dudv = max(pw * CELL_PX, vec2(1e-4));
  texel = seam + clamp((texel - seam) / dudv, -0.5, 0.5);
  // Stay inside this frame so its neighbours don't bleed in.
  float lo = float(frame) * CELL_PX + 0.5;
  texel.x = clamp(texel.x, lo, lo + CELL_PX - 1.0);
  texel.y = clamp(texel.y, 0.5, CELL_PX - 0.5);
  return texture(uCells, texel / uCellTexSize);
}

void main() {
  vec2 p = vUV * vec2(uGridSize);
  vec2 pw = fwidth(p);
  float grid = gridAt(p, pw);
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

  if (uCursor.x >= 0.0 && linkAt(p) > 0.0) {
    fragColor = vec4(1.0, 0.82, 0.3, 0.95);
    return;
  }

  // A shell in the air is over everything; its shadow is under the blasts.
  vec4 shell = shellAt(p);
  if (shell.a >= 1.0) {
    fragColor = shell;
    return;
  }

  vec4 blast = blastAt(p);
  if (blast.a > 0.0) {
    fragColor = blast;
    return;
  }

  if (shell.a > 0.0) {
    fragColor = shell;
    return;
  }

  vec4 crate = crateAt(p);
  if (crate.a > 0.0) {
    fragColor = crate;
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
  if (raw >= int(MINE) && raw != int(ELITE)) {
    vec2 f = fract(p);
    int frame;
    if (raw >= int(WALL)) {
      frame = raw - int(WALL);
      // Wall art runs east-west; turn it where the wall runs north-south.
      bool ew = isWall(cell + ivec2(1, 0)) || isWall(cell - ivec2(1, 0));
      bool ns = isWall(cell + ivec2(0, 1)) || isWall(cell - ivec2(0, 1));
      if (ns && !ew) f = f.yx;
    } else if (raw == int(MINE)) frame = 3;
    else if (raw == int(BEACON)) frame = 4;
    else if (raw == int(BEACON_SOUNDING)) frame = 5;
    else frame = 6; // depot
    vec4 c = cellSprite(frame, f, pw);
    if (raw == int(BEACON_SOUNDING)) {
      // A sound ring pulses out from the siren.
      float r = length(f - 0.5);
      float wave = fract(uTime * 1.5);
      float ring = (1.0 - smoothstep(0.0, 0.06, abs(r - wave * 0.5))) * (1.0 - wave);
      c = mix(c, vec4(0.95, 0.35, 0.2, 1.0), ring * 0.8);
    }
    if (c.a < 0.02) discard;
    fragColor = vec4(c.rgb / c.a, c.a);
    return;
  }

  float arrow = arrowAt(p);
  if (arrow > 0.0) {
    float pulse = 0.7 + 0.3 * sin(uTime * 4.0);
    vec3 tint = uArrowFinal ? vec3(1.0, 0.2, 0.15) : vec3(1.0, 0.75, 0.15);
    fragColor = vec4(arrow < 1.0 ? tint * 0.35 : tint, 0.9 * pulse);
    return;
  }

  // Build mode: the grid's cell edges, over the squares.
  if (grid <= 0.0) discard;
  fragColor = vec4(vec3(1.0), grid);
}
