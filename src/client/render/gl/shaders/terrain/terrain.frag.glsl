#version 300 es
precision highp float;

uniform sampler2D uTerrain;
// zfront: the coarse cell centre of a wall post being placed (x < 0 when
// none) and how many cells its spans reach. Tiles baked with a low alpha are
// solid faces a wall can snap to; those in reach light up.
uniform vec2 uSnapCursor;
uniform float uSnapRadius;

in vec2 vUV;
out vec4 fragColor;

void main() {
  vec4 t = texture(uTerrain, vUV);
  vec3 rgb = t.rgb;
  if (uSnapCursor.x >= 0.0 && t.a < 0.75) {
    vec2 cell = floor(vUV * vec2(float(MAP_W), float(MAP_H)) / 2.0) + 0.5;
    if (length(cell - uSnapCursor) <= uSnapRadius) {
      rgb = mix(rgb, vec3(1.0, 0.835, 0.31), 0.75);
    }
  }
  fragColor = vec4(rgb, 1.0);
}
