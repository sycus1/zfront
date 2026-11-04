import { DistrictMap } from "@openfront/engine-lib/game/Districts";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";

/**
 * zfront: what the districts hold (stage 4 of the district plan in
 * docs/zfront/spike-plan.md). When the horde starts, every district out
 * from the first HQ's own gets a cash cache (some of them), survivors, and
 * a few get a dormant building: a City, a Factory or a Missile Silo. The
 * further a district is from the HQ, in steps from district to district,
 * the more it holds, and the buildings sit a ring or more out.
 *
 * Holding a district (Held or Threatened, after its Outpost secures it)
 * collects its cash and survivors, once per game, and wakes its building:
 * HordeExecution builds it, finished and free, for the holder. When the
 * district is lost the building goes dormant again (the unit goes), to
 * wake for whoever takes the district next. A building the horde wrecks
 * stays dormant until the district is lost and taken again.
 *
 * A town's railway station and harbour (Relief.ts) are dormant buildings
 * too, at their own spots rather than drawn by lot, and in whatever ring
 * they fall, even the HQ's own districts. One the horde wrecks is rebuilt
 * once the wave is cleared (repairRelief), as its district may never be
 * lost.
 *
 * Deterministic: its own PRNG, districts visited in id order, rings by a
 * breadth-first walk in neighbour order.
 */

export interface DistrictContentOptions {
  /** 1: districts hold cash, survivors and dormant buildings. */
  districtContents: number;
  /**
   * Gold in a cash cache for each ring out from the HQ's districts (ring
   * 1 is next to them), up to `contentMaxRing` rings, give or take a
   * quarter.
   */
  cacheGoldPerRing: number;
  /** Percent of districts with a cash cache. */
  cachePercent: number;
  /** Survivors in a district for each ring out, give or take a quarter. */
  survivorsPerRing: number;
  /** Rings beyond this hold no more than it. */
  contentMaxRing: number;
  /** Dormant buildings on the map. */
  dormantCities: number;
  dormantFactories: number;
  dormantSilos: number;
  /** The nearest ring a dormant City or Factory goes in; a Silo one further. */
  dormantMinRing: number;
  /** Districts with fewer open coarse cells than this hold nothing. */
  contentMinCells: number;
  /**
   * A woken Silo is a mortar at its top level that fires this many levels
   * harder again (HordeExecution.fireMortars).
   */
  siloBonusLevels: number;
}

/**
 * What a district holds, by kind: 0 none, then City, Factory, Silo, and a
 * railway station (it wakes as a Factory) or harbour (a Port) that brings
 * relief (Relief.ts).
 */
export const DORMANT_NONE = 0;
export const DORMANT_CITY = 1;
export const DORMANT_FACTORY = 2;
export const DORMANT_SILO = 3;
export const DORMANT_STATION = 4;
export const DORMANT_HARBOUR = 5;

/** Whether a dormant building of `kind` brings relief. */
export function bringsRelief(kind: number): boolean {
  return kind === DORMANT_STATION || kind === DORMANT_HARBOUR;
}

/** A dormant building at a spot of the map's own: a station or harbour. */
export interface FixedSite {
  district: number;
  kind: number;
  tile: number;
}

export interface DistrictContentsState {
  placed: boolean;
  cash: number[];
  survivors: number[];
  kind: number[];
  site: number[];
  unit: number[];
  owner: number[];
  taken: number[];
  spent: number[];
}

/** What DistrictContents.update reads from the game and asks it to do. */
export interface ContentsView {
  /** smallID holding district `d` as Held or Threatened, else 0. */
  heldBy(d: number): number;
  /**
   * smallID holding district `d` as one of their starting districts, else
   * 0. Only a station or harbour wakes there; nothing else is put there.
   */
  startOf(d: number): number;
  /** Whether unit `id` still stands. */
  standing(id: number): boolean;
  /** Pays `holder` a district's cash and survivors. */
  collect(d: number, holder: number, cash: number, survivors: number): void;
  /**
   * Builds the district's dormant building of `kind` on tile `site` for
   * `holder`. Returns its unit id, or 0 if it couldn't.
   */
  wake(d: number, holder: number, kind: number, site: number): number;
  /** Takes away unit `id`, a woken building whose district was lost. */
  sleep(id: number): void;
}

export class DistrictContents {
  private placed = false;
  private cash: Int32Array;
  private survivors: Int32Array;
  private kind: Uint8Array;
  /** Tile the building stands on and the labels sit at; -1 for none. */
  private site: Int32Array;
  /** The woken building's unit id, 0 while dormant. */
  private unit: Int32Array;
  /** smallID the building was woken for. */
  private owner: Int32Array;
  /** 1 once the cash and survivors have been collected. */
  private taken: Uint8Array;
  /** 1 once the building has woken for the current holder. */
  private spent: Uint8Array;

  constructor(
    private opts: DistrictContentOptions,
    private map: DistrictMap,
  ) {
    const n = map.count;
    this.cash = new Int32Array(n);
    this.survivors = new Int32Array(n);
    this.kind = new Uint8Array(n);
    this.site = new Int32Array(n).fill(-1);
    this.unit = new Int32Array(n);
    this.owner = new Int32Array(n);
    this.taken = new Uint8Array(n);
    this.spent = new Uint8Array(n);
  }

  enabled(): boolean {
    return this.opts.districtContents !== 0 && this.map.size > 0;
  }

  isPlaced(): boolean {
    return this.placed;
  }

  /**
   * Rings out from `home` (the first HQ's districts, ring 0): ring k is k
   * steps from them, district to district. -1 where none reaches.
   */
  rings(home: readonly number[]): Int32Array {
    const ring = new Int32Array(this.map.count).fill(-1);
    const queue: number[] = [];
    for (const d of home) {
      if (ring[d] !== -1) continue;
      ring[d] = 0;
      queue.push(d);
    }
    for (let k = 0; k < queue.length; k++) {
      const d = queue[k];
      for (const n of this.map.neighbours[d]) {
        if (ring[n] !== -1) continue;
        ring[n] = ring[d] + 1;
        queue.push(n);
      }
    }
    return ring;
  }

  /**
   * Fills the districts, once. `home` is the first HQ's districts, `cells`
   * gives a district's coarse cells, `open` whether a cell is walkable and
   * `siteTile` the tile a building on a cell would stand on (-1: none).
   * `fixed` are the map's own station and harbour.
   */
  place(
    random: PseudoRandom,
    home: readonly number[],
    cells: (d: number) => ArrayLike<number>,
    open: (cell: number) => boolean,
    siteTile: (cell: number) => number,
    width: number,
    fixed: readonly FixedSite[] = [],
  ): void {
    if (this.placed || !this.enabled()) return;
    this.placed = true;
    const o = this.opts;
    const ring = this.rings(home);
    const ids = this.map.ids;
    const eligible: number[] = [];
    for (let d = 0; d < this.map.count; d++) {
      if (ring[d] < 1) continue;
      const site = this.siteOf(d, cells(d), open, ids, width);
      if (site.count < o.contentMinCells || site.cell < 0) continue;
      const tile = siteTile(site.cell);
      if (tile < 0) continue;
      this.site[d] = tile;
      const r = Math.min(ring[d], Math.max(1, o.contentMaxRing));
      if (random.nextInt(0, 100) < o.cachePercent) {
        this.cash[d] = roundTo(
          (o.cacheGoldPerRing * r * random.nextInt(75, 126)) / 100,
          100,
        );
      }
      this.survivors[d] = roundTo(
        (o.survivorsPerRing * r * random.nextInt(75, 126)) / 100,
        100,
      );
      eligible.push(d);
    }
    // The station and harbour stand where the map puts them, and the
    // labels sit there too; the lot goes round them.
    for (const f of fixed) {
      if (f.district < 0 || f.district >= this.map.count) continue;
      if (this.kind[f.district] !== DORMANT_NONE) continue;
      this.kind[f.district] = f.kind;
      this.site[f.district] = f.tile;
    }
    // The Silos go furthest out, then Factories, then Cities.
    const order = shuffled(eligible, random);
    const put = (kind: number, count: number, minRing: number) => {
      for (const d of order) {
        if (count <= 0) return;
        if (this.kind[d] !== DORMANT_NONE || ring[d] < minRing) continue;
        this.kind[d] = kind;
        count--;
      }
    };
    put(DORMANT_SILO, o.dormantSilos, o.dormantMinRing + 1);
    put(DORMANT_FACTORY, o.dormantFactories, o.dormantMinRing);
    put(DORMANT_CITY, o.dormantCities, o.dormantMinRing);
  }

  /**
   * District `d`'s open cells and its site: the open cell nearest the
   * middle of them whose four neighbours are open cells of `d` too, so a
   * building there is clear of the border and its walls; else the open
   * cell nearest the middle.
   */
  private siteOf(
    d: number,
    list: ArrayLike<number>,
    open: (cell: number) => boolean,
    ids: Uint16Array,
    width: number,
  ): { count: number; cell: number } {
    let count = 0;
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (!open(c)) continue;
      count++;
      sx += c % width;
      sy += Math.floor(c / width);
    }
    if (count === 0) return { count, cell: -1 };
    // Twice the middle, so distances compare against whole cells.
    const mx = (2 * sx) / count;
    const my = (2 * sy) / count;
    let best = -1;
    let bestD = Infinity;
    let inner = false;
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (!open(c)) continue;
      const x = c % width;
      const y = (c - x) / width;
      const interior =
        x > 0 &&
        x + 1 < width &&
        c - width >= 0 &&
        c + width < ids.length &&
        [c - 1, c + 1, c - width, c + width].every(
          (n) => ids[n] === d && open(n),
        );
      if (inner && !interior) continue;
      const dist = (2 * x - mx) * (2 * x - mx) + (2 * y - my) * (2 * y - my);
      if ((interior && !inner) || dist < bestD) {
        best = c;
        bestD = dist;
        inner = inner || interior;
      }
    }
    return { count, cell: best };
  }

  /**
   * Collects and wakes what newly held districts hold, and puts to sleep
   * the buildings of districts that have been lost.
   */
  update(view: ContentsView): void {
    if (!this.placed) return;
    for (let d = 0; d < this.map.count; d++) {
      if (this.site[d] < 0) continue;
      let h = view.heldBy(d);
      if (h === 0 && bringsRelief(this.kind[d])) h = view.startOf(d);
      if (this.unit[d] !== 0) {
        const id = this.unit[d];
        if (!view.standing(id)) {
          // Wrecked: dormant until the district is lost and taken again.
          this.unit[d] = 0;
        } else if (h !== this.owner[d]) {
          view.sleep(id);
          this.unit[d] = 0;
        }
      }
      if (h !== this.owner[d]) {
        this.owner[d] = h;
        this.spent[d] = 0;
      }
      if (h === 0) continue;
      if (this.taken[d] === 0) {
        this.taken[d] = 1;
        if (this.cash[d] > 0 || this.survivors[d] > 0) {
          view.collect(d, h, this.cash[d], this.survivors[d]);
        }
      }
      if (this.kind[d] !== DORMANT_NONE && this.spent[d] === 0) {
        this.spent[d] = 1;
        this.unit[d] = view.wake(d, h, this.kind[d], this.site[d]);
      }
    }
  }

  /** Whether unit `id` is a woken dormant building of `kind`. */
  isWoken(id: number, kind: number): boolean {
    if (id === 0) return false;
    for (let d = 0; d < this.map.count; d++) {
      if (this.unit[d] === id) return this.kind[d] === kind;
    }
    return false;
  }

  /**
   * The station and harbour that are awake: their kind and unit id, in
   * district order.
   */
  awakeRelief(): { kind: number; unit: number }[] {
    const out: { kind: number; unit: number }[] = [];
    if (!this.placed) return out;
    for (let d = 0; d < this.map.count; d++) {
      if (bringsRelief(this.kind[d]) && this.unit[d] !== 0) {
        out.push({ kind: this.kind[d], unit: this.unit[d] });
      }
    }
    return out;
  }

  /**
   * A wave has been cleared: a station or harbour the horde wrecked is
   * rebuilt, on the next update, for whoever still holds its district.
   */
  repairRelief(): void {
    if (!this.placed) return;
    for (let d = 0; d < this.map.count; d++) {
      if (bringsRelief(this.kind[d]) && this.unit[d] === 0) this.spent[d] = 0;
    }
  }

  /** Whether the map has a station or harbour. */
  hasRelief(): boolean {
    if (!this.placed) return false;
    for (let d = 0; d < this.map.count; d++) {
      if (bringsRelief(this.kind[d])) return true;
    }
    return false;
  }

  /** District `d`'s cash and survivors still to collect, and its building. */
  contentsOf(d: number): {
    cash: number;
    survivors: number;
    kind: number;
    site: number;
    awake: boolean;
  } {
    const left = this.taken[d] === 0;
    return {
      cash: left ? this.cash[d] : 0,
      survivors: left ? this.survivors[d] : 0,
      kind: this.kind[d],
      site: this.site[d],
      awake: this.unit[d] !== 0,
    };
  }

  /**
   * Six ints for each district that still holds something: its site tile,
   * cash and survivors left, building kind, 1 if the building is awake,
   * and 1 if `near(d)` (see HordeFrame.districtContents).
   */
  encode(near: (d: number) => boolean): Int32Array {
    if (!this.placed) return new Int32Array();
    const out: number[] = [];
    for (let d = 0; d < this.map.count; d++) {
      if (this.site[d] < 0) continue;
      const c = this.contentsOf(d);
      if (c.cash === 0 && c.survivors === 0 && c.kind === DORMANT_NONE) {
        continue;
      }
      out.push(
        c.site,
        c.cash,
        c.survivors,
        c.kind,
        c.awake ? 1 : 0,
        near(d) ? 1 : 0,
      );
    }
    return Int32Array.from(out);
  }

  state(): DistrictContentsState {
    return {
      placed: this.placed,
      cash: Array.from(this.cash),
      survivors: Array.from(this.survivors),
      kind: Array.from(this.kind),
      site: Array.from(this.site),
      unit: Array.from(this.unit),
      owner: Array.from(this.owner),
      taken: Array.from(this.taken),
      spent: Array.from(this.spent),
    };
  }

  restore(s: DistrictContentsState): void {
    if (s.kind.length !== this.map.count) return;
    this.placed = s.placed;
    this.cash = Int32Array.from(s.cash);
    this.survivors = Int32Array.from(s.survivors);
    this.kind = Uint8Array.from(s.kind);
    this.site = Int32Array.from(s.site);
    this.unit = Int32Array.from(s.unit);
    this.owner = Int32Array.from(s.owner);
    this.taken = Uint8Array.from(s.taken);
    this.spent = Uint8Array.from(s.spent);
  }

  hash(mix: (v: number) => void): void {
    if (!this.placed) return;
    for (let d = 0; d < this.map.count; d++) {
      mix(this.cash[d]);
      mix(this.survivors[d]);
      mix(this.kind[d]);
      mix(this.site[d]);
      mix(this.unit[d]);
      mix(this.owner[d]);
      mix(this.taken[d] * 2 + this.spent[d]);
    }
  }
}

function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/** A copy of `list` in an order drawn from `random` (Fisher-Yates). */
function shuffled(list: readonly number[], random: PseudoRandom): number[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = random.nextInt(0, i + 1);
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}
