#version 300 es
precision highp float;

// Buffer districts (zfront), one texel per coarse cell (R8, normalized):
// bits 0-2 the district's state (0 wild, 1 securing, 2 held, 3 threatened,
// 4 core, see engine-lib game/Districts), bits 3-6 set where the cell's
// north, east, south or west neighbour is in another district.
uniform sampler2D uDistricts;
uniform ivec2 uGridSize;
uniform float uTime;

in vec2 vUV;
out vec4 fragColor;

const int WILD = 0;
const int SECURING = 1;
const int HELD = 2;
const int THREATENED = 3;
const int CORE = 4;

// Half the width of a border line, in coarse cells.
const float EDGE = 0.16;

void main() {
  vec2 p = vUV * vec2(uGridSize);
  ivec2 cell = clamp(ivec2(p), ivec2(0), uGridSize - 1);
  int b = int(texelFetch(uDistricts, cell, 0).r * 255.0 + 0.5);
  int state = b & 7;
  vec2 f = fract(p);
  // Keep lines about a pixel wide at least when zoomed out.
  vec2 w = max(vec2(EDGE), fwidth(p) * 0.75);
  bool edge =
    ((b & 8) != 0 && f.y < w.y) ||
    ((b & 16) != 0 && f.x > 1.0 - w.x) ||
    ((b & 32) != 0 && f.y > 1.0 - w.y) ||
    ((b & 64) != 0 && f.x < w.x);

  vec4 c = vec4(0.0);
  if (state == HELD) {
    c = edge ? vec4(0.30, 0.85, 0.45, 0.85) : vec4(0.30, 0.85, 0.45, 0.10);
  } else if (state == THREATENED) {
    float pulse = 0.5 + 0.5 * sin(uTime * 6.0);
    c = edge
      ? vec4(0.95, 0.30, 0.25, 0.9)
      : vec4(0.95, 0.30, 0.25, 0.08 + 0.10 * pulse);
  } else if (state == SECURING) {
    // Diagonal stripes: an Outpost is working on it.
    float stripe = step(0.5, fract((p.x + p.y) * 0.25 - uTime * 0.3));
    c = edge
      ? vec4(0.95, 0.75, 0.25, 0.8)
      : vec4(0.95, 0.75, 0.25, 0.05 + 0.06 * stripe);
  } else if (state == CORE) {
    c = edge ? vec4(1.0, 1.0, 1.0, 0.35) : vec4(0.0);
  } else if (edge) {
    // Wild: a faint line, so the districts read before anyone holds them.
    c = vec4(0.0, 0.0, 0.0, 0.18);
  }
  if (c.a <= 0.0) discard;
  fragColor = c;
}
