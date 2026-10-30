/**
 * BarPass — instanced health/progress bars and warship veterancy pips.
 *
 * Up to five draw calls per frame (all share one program + instance buffer):
 *   1. Health bars (11x3 tiles, above warships)
 *   2. Progress bars (below structure icons — construction + missile
 *      readiness), filled in one progress color so they never read as health
 *   3. zfront: structure health bars above the icons of damaged buildings;
 *      2 and 3 grow and shrink with the icons (the HQ's health is in the HUD)
 *   4. zfront: small health bars over damaged cell-drawn buildings (wall
 *      posts, wall spans, mines, beacons, depots), a fixed size on screen
 *   5. Veterancy pips (solid gold rank bars stacked at a warship's bottom-right)
 *
 * Data flow:
 *   UnitState.health / .missileTimerQueue / .constructionStartTick → CPU progress
 *   → instance VBO (x, y, progress) → GPU colored rectangle
 *   HordeFrame.structureHp → setStructureHealth → the same
 *   UnitState.veterancy → one instance per level (x, y, slot) → solid gold rect
 */

import { UnitType } from "@openfront/engine-api/game/GameTypes";
import type { Config } from "@openfront/engine-lib/configuration/Config";
import { maxHealthWithVeterancy } from "@openfront/engine-lib/game/Veterancy";
import type { RendererConfig, UnitState } from "../../types";
import { UT_MISSILE_SILO, UT_SAM_LAUNCHER } from "../../types";
import type { RenderSettings } from "../RenderSettings";
import { createProgram } from "../utils/GlUtils";

import barFragSrc from "../shaders/bar/bar.frag.glsl?raw";
import barVertSrc from "../shaders/bar/bar.vert.glsl?raw";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLOATS_PER_INSTANCE = 3; // x, y, progress
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

// ---------------------------------------------------------------------------
// BarPass
// ---------------------------------------------------------------------------

export class BarPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private program: WebGLProgram;
  private maxBars = 2048;

  private uCamera: WebGLUniformLocation;
  private uBarSize: WebGLUniformLocation;
  private uBarOffset: WebGLUniformLocation;
  private uBorderWidth: WebGLUniformLocation;
  private uThresholds: WebGLUniformLocation;
  private uColorRed: WebGLUniformLocation;
  private uColorOrange: WebGLUniformLocation;
  private uColorYellow: WebGLUniformLocation;
  private uColorGreen: WebGLUniformLocation;
  private uSolid: WebGLUniformLocation;
  private uSolidColor: WebGLUniformLocation;
  private uPipStride: WebGLUniformLocation;
  private uFillColor: WebGLUniformLocation;

  private vao: WebGLVertexArrayObject;
  private instanceBuf: WebGLBuffer;

  private healthData: Float32Array;
  private healthCount = 0;
  private progressData: Float32Array;
  private progressCount = 0;
  private veterancyData: Float32Array;
  private veterancyCount = 0;
  private structureHealthData = new Float32Array(0);
  private structureHealthCount = 0;
  private cellHealthData = new Float32Array(0);
  private cellHealthCount = 0;

  private mapW: number;
  private warshipMaxHealth: number;
  private veterancyHealthBonus: number;

  constructor(
    gl: WebGL2RenderingContext,
    header: RendererConfig,
    settings: RenderSettings,
    private config: Config,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = header.mapWidth;
    this.warshipMaxHealth = config.unitInfo(UnitType.Warship).maxHealth ?? 0;
    this.veterancyHealthBonus = config.warshipVeterancyHealthBonus();

    // --- Shader program ---
    this.program = createProgram(gl, barVertSrc, barFragSrc, "BarPass");
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uBarSize = gl.getUniformLocation(this.program, "uBarSize")!;
    this.uBarOffset = gl.getUniformLocation(this.program, "uBarOffset")!;
    this.uBorderWidth = gl.getUniformLocation(this.program, "uBorderWidth")!;
    this.uThresholds = gl.getUniformLocation(this.program, "uThresholds")!;
    this.uColorRed = gl.getUniformLocation(this.program, "uColorRed")!;
    this.uColorOrange = gl.getUniformLocation(this.program, "uColorOrange")!;
    this.uColorYellow = gl.getUniformLocation(this.program, "uColorYellow")!;
    this.uColorGreen = gl.getUniformLocation(this.program, "uColorGreen")!;
    this.uSolid = gl.getUniformLocation(this.program, "uSolid")!;
    this.uSolidColor = gl.getUniformLocation(this.program, "uSolidColor")!;
    this.uPipStride = gl.getUniformLocation(this.program, "uPipStride")!;
    this.uFillColor = gl.getUniformLocation(this.program, "uFillColor")!;

    // --- Instance data buffers (CPU-side) ---
    this.healthData = new Float32Array(this.maxBars * FLOATS_PER_INSTANCE);
    this.progressData = new Float32Array(this.maxBars * FLOATS_PER_INSTANCE);
    this.veterancyData = new Float32Array(this.maxBars * FLOATS_PER_INSTANCE);

    // --- VAO: unit quad + instanced data ---
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Quad vertices (2 triangles)
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Instance buffer (dynamic)
    this.instanceBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.maxBars * BYTES_PER_INSTANCE,
      gl.DYNAMIC_DRAW,
    );
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(null);
  }

  /** Rebuild bar instance data from current unit state. */
  updateBars(
    mobileUnits: Map<number, UnitState>,
    structures: Map<number, UnitState>,
    gameTick: number,
  ): void {
    this.healthCount = 0;
    this.progressCount = 0;
    this.veterancyCount = 0;

    // --- Health bars + veterancy pips (warships) ---
    // Only warships carry health among mobile units, so this loop is effectively
    // warship-only.
    for (const unit of mobileUnits.values()) {
      if (unit.health === null || unit.health <= 0) continue;
      // Veteran warships have a higher effective max health, so a full veteran
      // ship reads as full. Shared with the engine's UnitImpl.maxHealth().
      const maxHealth = maxHealthWithVeterancy(
        this.warshipMaxHealth,
        unit.veterancy,
        this.veterancyHealthBonus,
      );
      if (unit.health < maxHealth) {
        this.pushHealth(unit, unit.health / maxHealth);
      }
      if (unit.veterancy > 0) {
        this.pushVeterancy(unit);
      }
    }

    // --- Progress bars (structures) ---
    for (const unit of structures.values()) {
      if (!unit.isActive) continue;
      const progress = this.computeStructureProgress(unit, gameTick);
      if (progress !== null) this.pushProgress(unit, progress);
    }
  }

  /**
   * zfront: the horde's damaged structures (HordeFrame.structureHp, four
   * ints each: tile, health, full health, has an icon).
   */
  setStructureHealth(hp: Int32Array): void {
    const n = hp.length >> 2;
    if (this.structureHealthData.length < n * FLOATS_PER_INSTANCE) {
      this.structureHealthData = new Float32Array(n * FLOATS_PER_INSTANCE);
      this.cellHealthData = new Float32Array(n * FLOATS_PER_INSTANCE);
    }
    this.structureHealthCount = 0;
    this.cellHealthCount = 0;
    for (let k = 0; k + 3 < hp.length; k += 4) {
      const tile = hp[k];
      const fraction = hp[k + 2] > 0 ? hp[k + 1] / hp[k + 2] : 0;
      const icon = hp[k + 3] !== 0;
      const data = icon ? this.structureHealthData : this.cellHealthData;
      const off =
        (icon ? this.structureHealthCount++ : this.cellHealthCount++) *
        FLOATS_PER_INSTANCE;
      const x = tile % this.mapW;
      data[off] = x;
      data[off + 1] = (tile - x) / this.mapW;
      data[off + 2] = Math.max(0, Math.min(1, fraction));
    }
  }

  /**
   * How much bigger than at the default zoom a structure icon is drawn, in
   * world tiles. Mirrors the icon scale in structure.vert.glsl.
   */
  private iconScale(zoom: number): number {
    const s = this.settings.structure;
    let scale: number;
    if (zoom <= s.dotsZoomThreshold) scale = s.dotScale;
    else if (zoom >= s.iconGrowZoom) scale = zoom / s.iconGrowZoom;
    else scale = Math.min(1, zoom / s.iconScaleFactorZoomedOut);
    return (scale * s.iconScaleFactorZoomedOut) / zoom;
  }

  /** Render bars. Call once per frame after FX, before names. */
  draw(cameraMat: Float32Array, zoom: number): void {
    const b = this.settings.bar;
    const showCells = zoom >= b.cellBarMinZoom;
    if (
      this.healthCount === 0 &&
      this.progressCount === 0 &&
      this.veterancyCount === 0 &&
      this.structureHealthCount === 0 &&
      (this.cellHealthCount === 0 || !showCells)
    )
      return;

    const gl = this.gl;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMat);
    gl.uniform1f(this.uSolid, 0); // health/progress bars use the colored path
    gl.uniform4f(this.uFillColor, 0, 0, 0, 0);
    gl.uniform1f(this.uBorderWidth, b.borderWidth);
    gl.uniform3f(this.uThresholds, b.threshold1, b.threshold2, b.threshold3);
    gl.uniform3f(this.uColorRed, b.colorRedR, b.colorRedG, b.colorRedB);
    gl.uniform3f(
      this.uColorOrange,
      b.colorOrangeR,
      b.colorOrangeG,
      b.colorOrangeB,
    );
    gl.uniform3f(
      this.uColorYellow,
      b.colorYellowR,
      b.colorYellowG,
      b.colorYellowB,
    );
    gl.uniform3f(this.uColorGreen, b.colorGreenR, b.colorGreenG, b.colorGreenB);
    gl.bindVertexArray(this.vao);

    // Health bars
    if (this.healthCount > 0) {
      gl.uniform2f(this.uBarSize, b.healthBarW, b.healthBarH);
      gl.uniform2f(this.uBarOffset, -b.healthBarW / 2, b.healthBarOffsetY);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.healthData.subarray(0, this.healthCount * FLOATS_PER_INSTANCE),
      );
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.healthCount);
    }

    // Structure bars follow their icon's size.
    const s = this.iconScale(zoom);
    gl.uniform1f(this.uBorderWidth, b.borderWidth * s);

    // zfront: structure health, above the icon
    if (this.structureHealthCount > 0) {
      this.drawBars(
        this.structureHealthData,
        Math.min(this.structureHealthCount, this.maxBars),
        b.progressBarW * s,
        b.progressBarH * s,
        -b.progressBarW * s * 0.5,
        b.structureHealthOffsetY * s,
      );
    }

    // Progress bars, below the icon, in their own color
    if (this.progressCount > 0) {
      gl.uniform4f(
        this.uFillColor,
        b.progressColorR,
        b.progressColorG,
        b.progressColorB,
        1,
      );
      this.drawBars(
        this.progressData,
        this.progressCount,
        b.progressBarW * s,
        b.progressBarH * s,
        -b.progressBarW * s * 0.5,
        b.progressBarOffsetY * s,
      );
      gl.uniform4f(this.uFillColor, 0, 0, 0, 0);
    }

    // zfront: cell-drawn buildings, a fixed size on screen over their 2x2
    // cell (whose top-left tile the instance holds)
    if (this.cellHealthCount > 0 && showCells) {
      const px = 1 / zoom;
      gl.uniform1f(this.uBorderWidth, b.cellBarBorderPx * px);
      this.drawBars(
        this.cellHealthData,
        Math.min(this.cellHealthCount, this.maxBars),
        b.cellBarWPx * px,
        b.cellBarHPx * px,
        0.5 - b.cellBarWPx * px * 0.5,
        -0.5 - (b.cellBarGapPx + b.cellBarHPx) * px,
      );
    }

    // Veterancy pips (solid gold rank bars, bottom-right of warship sprites)
    if (this.veterancyCount > 0) {
      gl.uniform1f(this.uSolid, 1);
      gl.uniform3f(this.uSolidColor, b.veterancyR, b.veterancyG, b.veterancyB);
      gl.uniform1f(this.uPipStride, b.veterancyPipH + b.veterancyPipGap);
      gl.uniform2f(this.uBarSize, b.veterancyPipW, b.veterancyPipH);
      gl.uniform2f(
        this.uBarOffset,
        b.veterancyPipOffsetX,
        b.veterancyPipOffsetY,
      );
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.veterancyData.subarray(
          0,
          this.veterancyCount * FLOATS_PER_INSTANCE,
        ),
      );
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.veterancyCount);
    }

    gl.bindVertexArray(null);
  }

  private drawBars(
    data: Float32Array,
    count: number,
    w: number,
    h: number,
    offsetX: number,
    offsetY: number,
  ): void {
    const gl = this.gl;
    gl.uniform2f(this.uBarSize, w, h);
    gl.uniform2f(this.uBarOffset, offsetX, offsetY);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      data.subarray(0, count * FLOATS_PER_INSTANCE),
    );
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
    this.gl.deleteBuffer(this.instanceBuf);
    this.gl.deleteVertexArray(this.vao);
  }

  // ---- Private ----

  private pushHealth(unit: UnitState, progress: number): void {
    if (this.healthCount >= this.maxBars) return;
    const off = this.healthCount * FLOATS_PER_INSTANCE;
    this.healthData[off] = unit.pos % this.mapW;
    this.healthData[off + 1] = (unit.pos - this.healthData[off]) / this.mapW;
    this.healthData[off + 2] = progress;
    this.healthCount++;
  }

  /** Emit one gold pip instance per veterancy level, stacked by slot index. */
  private pushVeterancy(unit: UnitState): void {
    const x = unit.pos % this.mapW;
    const y = (unit.pos - x) / this.mapW;
    for (let slot = 0; slot < unit.veterancy; slot++) {
      if (this.veterancyCount >= this.maxBars) return;
      const off = this.veterancyCount * FLOATS_PER_INSTANCE;
      this.veterancyData[off] = x;
      this.veterancyData[off + 1] = y;
      this.veterancyData[off + 2] = slot; // vertical stack slot, read by the shader
      this.veterancyCount++;
    }
  }

  private pushProgress(unit: UnitState, progress: number): void {
    if (this.progressCount >= this.maxBars) return;
    const off = this.progressCount * FLOATS_PER_INSTANCE;
    const x = unit.pos % this.mapW;
    this.progressData[off] = x;
    this.progressData[off + 1] = (unit.pos - x) / this.mapW;
    this.progressData[off + 2] = progress;
    this.progressCount++;
  }

  private computeStructureProgress(
    unit: UnitState,
    gameTick: number,
  ): number | null {
    // Deletion progress (reverse countdown — takes priority over other bars)
    if (unit.markedForDeletion !== false) {
      const remaining = unit.markedForDeletion - gameTick;
      return Math.max(
        0,
        Math.min(1, remaining / this.config.deletionMarkDuration()),
      );
    }

    // Construction progress
    if (unit.underConstruction && unit.constructionStartTick !== null) {
      const duration =
        this.config.unitInfo(unit.unitType as UnitType).constructionDuration ??
        50;
      const elapsed = gameTick - unit.constructionStartTick;
      return Math.min(1, Math.max(0, elapsed / duration));
    }

    // Missile readiness (Silo / SAM)
    if (
      unit.unitType === UT_MISSILE_SILO ||
      unit.unitType === UT_SAM_LAUNCHER
    ) {
      const readiness = this.missileReadiness(unit, gameTick);
      if (readiness < 1) return readiness;
    }

    return null;
  }

  private missileReadiness(unit: UnitState, gameTick: number): number {
    const maxMissiles = unit.level;
    const reloading = unit.missileTimerQueue.length;
    if (reloading === 0) return 1;

    const ready = maxMissiles - reloading;

    const cooldown =
      unit.unitType === UT_SAM_LAUNCHER
        ? this.config.SAMCooldown()
        : this.config.SiloCooldown();

    let readiness = ready / maxMissiles;
    for (const timer of unit.missileTimerQueue) {
      const progress = gameTick - timer;
      readiness += progress / cooldown / maxMissiles;
    }
    return Math.max(0, Math.min(1, readiness));
  }
}
