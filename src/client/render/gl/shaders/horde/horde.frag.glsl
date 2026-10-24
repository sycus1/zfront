#version 300 es
precision highp float;

// Horde cells (R8, normalized): 0 empty, 1-254 density, 255 an elite.
// One texel per coarse cell (2x2 tiles).
uniform sampler2D uHorde;
uniform ivec2 uGridSize;
uniform float uTime;

in vec2 vUV;
out vec4 fragColor;

void main() {
  ivec2 cell = clamp(ivec2(vUV * vec2(uGridSize)), ivec2(0), uGridSize - 1);
  float raw = texelFetch(uHorde, cell, 0).r;

  // Elites: exact texel lookup so linear filtering can't smear the marker.
  if (raw > 0.999) {
    float pulse = 0.75 + 0.25 * sin(uTime * 6.0);
    fragColor = vec4(vec3(0.95, 0.85, 0.2) * pulse, 1.0);
    return;
  }

  // Mass horde: linear filtering softens the coarse grid into blobs.
  float d = texture(uHorde, vUV).r;
  if (d < 0.002) discard;
  // sqrt so a thin trickle of zombies still reads clearly at map zoom.
  float t = clamp(sqrt(d * 4.0), 0.0, 1.0);
  vec3 color = mix(vec3(0.8, 0.1, 0.08), vec3(1.0, 0.3, 0.15), t);
  float alpha = mix(0.7, 0.95, t);
  fragColor = vec4(color, alpha);
}
