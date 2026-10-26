#version 300 es
precision highp float;

// Horde cells (R8, normalized): 0 empty, 1-253 density, 254 a wall,
// 255 an elite. One texel per coarse cell (2x2 tiles).
uniform sampler2D uHorde;
uniform ivec2 uGridSize;
uniform float uTime;

in vec2 vUV;
out vec4 fragColor;

const float WALL = 254.0;
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
  if (raw == int(WALL)) {
    // Stone block with a darker rim, so a line of walls reads as segments.
    vec2 f = fract(p);
    float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    float shade = edge < 0.12 ? 0.42 : 0.62;
    fragColor = vec4(vec3(shade, shade * 0.97, shade * 0.9), 1.0);
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
