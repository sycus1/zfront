#version 300 es
precision highp float;

// Horde cells (R8, normalized): 0 empty, 1-251 density, 252-254 a wall
// (barricade, stone, reinforced), 255 an elite. One texel per coarse cell (2x2 tiles).
uniform sampler2D uHorde;
uniform ivec2 uGridSize;
uniform float uTime;
// The announced wave's landings: xy the landing cell's centre, zw the unit
// direction to the HQ, in coarse cells.
uniform vec4 uArrows[MAX_ARROWS];
uniform int uArrowCount;
uniform bool uArrowFinal;

in vec2 vUV;
out vec4 fragColor;

const float WALL = 252.0;
const float ELITE = 255.0;

int byteAt(ivec2 cell) {
  cell = clamp(cell, ivec2(0), uGridSize - 1);
  return int(texelFetch(uHorde, cell, 0).r * 255.0 + 0.5);
}

// Density only: walls and elites count as empty, so they don't smear into
// the horde around them.
float densityAt(ivec2 cell) {
  int b = byteAt(cell);
  return b >= int(WALL) ? 0.0 : float(b) / 255.0;
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

void main() {
  vec2 p = vUV * vec2(uGridSize);
  ivec2 cell = clamp(ivec2(p), ivec2(0), uGridSize - 1);
  int raw = byteAt(cell);

  // Elites and walls: exact texel lookup, so they keep their cell's shape.
  if (raw == int(ELITE)) {
    float pulse = 0.75 + 0.25 * sin(uTime * 6.0);
    fragColor = vec4(vec3(0.95, 0.85, 0.2) * pulse, 1.0);
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

  // Mass horde: bilinear filtering by hand softens the coarse grid into
  // blobs while leaving out walls and elites.
  vec2 q = p - 0.5;
  ivec2 i0 = ivec2(floor(q));
  vec2 t = fract(q);
  float d = mix(
    mix(densityAt(i0), densityAt(i0 + ivec2(1, 0)), t.x),
    mix(densityAt(i0 + ivec2(0, 1)), densityAt(i0 + ivec2(1, 1)), t.x),
    t.y
  );
  if (d < 0.002) discard;
  // sqrt so a thin trickle of zombies still reads clearly at map zoom.
  float s = clamp(sqrt(d * 4.0), 0.0, 1.0);
  vec3 color = mix(vec3(0.8, 0.1, 0.08), vec3(1.0, 0.3, 0.15), s);
  float alpha = mix(0.7, 0.95, s);
  fragColor = vec4(color, alpha);
}
