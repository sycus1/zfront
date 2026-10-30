#version 300 es
precision highp float;

in vec2 vLocal;
in vec3 vColor;
in float vAlpha;

// Rim width in square-local units; 0 when squares are too small for one.
uniform float uRim;

out vec4 fragColor;

void main() {
  if (vAlpha <= 0.0) discard;
  float edge = min(min(vLocal.x, 1.0 - vLocal.x), min(vLocal.y, 1.0 - vLocal.y));
  vec3 c = edge < uRim ? vColor * 0.55 : vColor;
  fragColor = vec4(c, vAlpha);
}
