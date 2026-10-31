import { Elites } from "@openfront/engine/horde/Elites";
import { UNREACHABLE } from "@openfront/engine/horde/FlowField";
import { HordeField } from "@openfront/engine/horde/HordeField";
import { MortarOptions, Mortars } from "@openfront/engine/horde/Mortars";
import {
  discOffsets,
  nearestCell,
  priorityElite,
  turretVolley,
} from "@openfront/engine/horde/Weapons";

const W = 30;
const at = (x: number, y: number) => y * W + x;
const TURRET = at(15, 15);
// The HQ is due west of the turret.
const HQ = at(5, 15);
const { offsets, d2 } = discOffsets(8, W);

const MORTAR: MortarOptions = {
  mortarRange: 8,
  mortarMinRange: 3,
  mortarReload: 10,
  mortarFlight: 4,
  mortarBlastRadius: 1,
  mortarKills: 100,
  mortarEliteDamage: 150,
  mortarMinTarget: 20,
  mortarLevelPercent: 50,
};
const GUN = { id: 1, cell: TURRET, owner: 7, level: 1 };
// No flow: the horde stays put, so shells land where they were aimed.
const STILL = new Uint32Array(W * W).fill(UNREACHABLE);

function field() {
  return new HordeField(W, W, new Uint8Array(W * W).fill(1));
}

function volley(f: HordeField, hq: number, budget: number) {
  return turretVolley(f, TURRET, W, W, offsets, d2, 64, hq, budget);
}

describe("weapons target the zombies nearest the HQ", () => {
  test("a turret shoots the zombies nearest the HQ before nearer ones", () => {
    const f = field();
    f.add(at(17, 15), 10); // next to the turret, far side from the HQ
    f.add(at(9, 15), 10); // 6 cells away, between it and the HQ
    f.add(at(12, 16), 10);
    const v = volley(f, HQ, 15);
    expect(v).toEqual({ shamblers: 15, target: at(9, 15) });
    expect(f.density[at(9, 15)]).toBe(0);
    expect(f.density[at(12, 16)]).toBe(5);
    expect(f.density[at(17, 15)]).toBe(10);
  });

  test("it never shoots out of range, however near the HQ", () => {
    const f = field();
    f.add(at(6, 15), 10); // 9 cells from the turret, range 8
    f.add(at(20, 15), 10);
    expect(volley(f, HQ, 15)).toEqual({ shamblers: 10, target: at(20, 15) });
    expect(f.density[at(6, 15)]).toBe(10);
  });

  test("with no HQ it shoots the zombies nearest itself", () => {
    const f = field();
    f.add(at(17, 15), 10);
    f.add(at(9, 15), 10);
    expect(volley(f, -1, 15)).toEqual({ shamblers: 15, target: at(17, 15) });
    expect(f.density[at(9, 15)]).toBe(5);
  });

  test("a turret hits the elite in range nearest the HQ", () => {
    const e = new Elites(10, 1, 1);
    e.spawn(at(16, 15), 100); // first listed, but far side
    e.spawn(at(10, 15), 100);
    e.spawn(at(11, 14), 0); // dead
    e.spawn(at(6, 15), 100); // out of range
    expect(priorityElite(e, TURRET, W, 64, HQ)).toBe(1);
    expect(priorityElite(e, TURRET, W, 64, -1)).toBe(0);
  });

  test("each weapon defends the HQ nearest it", () => {
    expect(nearestCell(TURRET, [at(29, 29), HQ, at(24, 15)], W)).toBe(
      at(24, 15),
    );
    expect(nearestCell(TURRET, [], W)).toBe(-1);
  });

  test("a mortar shells the crowd nearest the HQ, not the thickest", () => {
    const f = field();
    f.add(at(22, 15), 40); // the thickest, far side
    f.add(at(10, 15), 25); // enough, nearest the HQ
    f.add(at(8, 15), 10); // nearer still, but too thin to be worth a shell
    const m = new Mortars(MORTAR, W, W);
    m.fire([{ ...GUN, hq: HQ }], 0, f, STILL, 0);
    expect(m.inFlight()[0].target).toBe(at(10, 15));
    // With no HQ it still goes for the thickest.
    const n = new Mortars(MORTAR, W, W);
    n.fire([GUN], 0, f, STILL, 0);
    expect(n.inFlight()[0].target).toBe(at(22, 15));
  });

  test("a mortar skips crowds under half the thickest in reach", () => {
    const f = field();
    f.add(at(22, 15), 500);
    f.add(at(10, 15), 249); // just short of half
    const m = new Mortars(MORTAR, W, W);
    m.fire([{ ...GUN, hq: HQ }], 0, f, STILL, 0);
    expect(m.inFlight()[0].target).toBe(at(22, 15));
    f.add(at(10, 15), 1);
    const again = new Mortars(MORTAR, W, W);
    again.fire([{ ...GUN, hq: HQ }], 0, f, STILL, 0);
    expect(again.inFlight()[0].target).toBe(at(10, 15));
  });
});
