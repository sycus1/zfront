#version 300 es
precision highp float;

// One square per zombie (HordeSwarm). Positions are in tiles; each square
// walks from aMove.xy to aMove.zw over the current move.
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aMove;
// x a random seed, y when it appeared (or died), z when it died, -1 alive.
layout(location = 2) in vec3 aLife;

uniform mat3 uCamera;
uniform float uNow;
uniform float uMoveStart;
uniform float uMoveSec;
// Square size in tiles.
uniform float uSize;

out vec2 vLocal;
out vec3 vColor;
out float vAlpha;

void main() {
  float seed = aLife.x;
  float t = clamp((uNow - uMoveStart) / uMoveSec, 0.0, 1.0);
  vec2 pos = mix(aMove.xy, aMove.zw, t);
  // Shambling: a small sway of its own.
  pos += 0.07 * vec2(sin(uNow * 3.1 + seed * 40.0), cos(uNow * 2.6 + seed * 57.0));

  float size = uSize;
  if (aLife.z >= 0.0) {
    // A killed zombie: a dark mark that spreads and fades.
    float k = clamp((uNow - aLife.z) / float(DEATH_SEC), 0.0, 1.0);
    vColor = vec3(0.35, 0.04, 0.03);
    vAlpha = 0.9 * (1.0 - k);
    size *= 1.0 + 0.6 * k;
  } else {
    vColor = mix(vec3(0.78, 0.1, 0.07), vec3(1.0, 0.36, 0.2), fract(seed * 7.13));
    vAlpha = clamp((uNow - aLife.y) / 0.25, 0.0, 1.0);
  }

  vLocal = aCorner;
  vec2 p = pos + (aCorner - 0.5) * size;
  vec3 clip = uCamera * vec3(p, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
