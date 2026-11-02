import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { Unit } from "./Game";
import { StationManager } from "./RailNetworkImpl";
import { Railroad } from "./Railroad";
import { TrainStation } from "./TrainStation";

export interface RailNetwork {
  connectStation(station: TrainStation): void;
  removeStation(unit: Unit): void;
  findStationsPath(from: TrainStation, to: TrainStation): TrainStation[];
  stationManager(): StationManager;
  overlappingRailroads(unitType: UnitType, tile: TileRef): TileRef[];
  computeGhostRailPaths(unitType: UnitType, tile: TileRef): TileRef[][];
  recomputeClusters(): void;
  /** zfront: tears up one railroad (the horde wrecked it); its stations stay. */
  wreckRailroad(rail: Railroad): void;
  /**
   * zfront: lays track between two stations again, as `connect` does when
   * a station is built. Returns false when there's no route for it.
   */
  relink(a: TrainStation, b: TrainStation): boolean;
}
