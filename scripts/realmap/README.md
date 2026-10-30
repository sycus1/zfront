# Real-town maps

Makes a close-up zfront map of a real place: a 1.2 km square at 3 m per
tile (400 × 400 tiles), where streets are corridors and buildings are walls.
The size is the horde's neighbourhood scale (see "Neighbourhood scale" in
docs/zfront/spike-plan.md); `metresPerTile` is written to `info.json` so the
game knows to use the town horde numbers.
This is the offline spike for postcode or place search; the plan is to move
the drawing into the client later.

## Make a map

1. Add the place to `towns.json` (centre `lat`/`lon`, `sizeKm`, `metresPerTile`).
2. Download its features from [Overture Maps](https://overturemaps.org/)
   (needs `pip install pyarrow shapely`; the first run indexes the release,
   about a minute):

   ```bash
   python3 scripts/realmap/fetch_overture.py --town bath
   ```

3. Draw the generator inputs into `map-generator/assets/maps/<town>/`
   (`image.png`, the `roads` layer, `info.json`). Height
   tiles are downloaded on the way. Behind a proxy, add `NODE_USE_ENV_PROXY=1`.

   ```bash
   npx tsx scripts/realmap/generate.ts bath
   ```

4. Run the map generator: `npm run gen-maps`.
5. Try it headlessly: `npm run balance:horde -- --map Bath --zone 0`.

Downloads are cached in `scripts/realmap/cache/` (git-ignored).

## What each tile becomes

Later rows are drawn over earlier ones.

| Feature                                   | Terrain            | Horde    |
| ----------------------------------------- | ------------------ | -------- |
| Fields, gardens, parks, other open ground | land, mag 4 + h    | cost 2-3 |
| Scrub                                     | land, mag 8 + h    | cost 3-4 |
| Woods                                     | land, mag 12 + h/2 | cost 4   |
| Rivers, canals, lakes                     | water              | blocked  |
| Sea (outside Overture's land polygons)    | water              | blocked  |
| Cliffs                                    | land, mag 22       | blocked  |
| Footpaths (1 tile), rail (2 tiles)        | land, mag h        | cost 1-2 |
| Buildings                                 | land, mag 30       | blocked  |
| Roads (2-5 tiles wide by class)           | land, mag h        | cost 1-2 |
| Slopes steeper than 45° on open ground    | land, mag 22       | blocked  |

`h` is 0-6: the tile's height between the area's 2nd and 98th percentile.
Roads are drawn over water, so bridges cross rivers. Streams are left out.
Last, any open ground the horde can't reach (courtyards walled in by
buildings, checked on the horde's half-size grid) is filled in as
building, so an HQ can't hide there.

Roads would otherwise look like any open ground, so they are also drawn
into a `roads` layer, which the client paints over the terrain. Road tiles
in a horde cell that is blocked are left out of it. Buildings have no layer:
the client colours every blocked horde cell itself (see
`src/client/render/gl/utils/HordeTerrainColors.ts`).

## Data and licences

- Overture Maps buildings, transportation, water, land and land use are
  from OpenStreetMap: © OpenStreetMap contributors, ODbL. The generated map
  files are a derived database, so they are ODbL too.
- Overture land cover is ESA WorldCover, CC BY 4.0.
- Height comes from [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
  on AWS (Terrarium encoding, zoom 15). In England these come from
  Environment Agency 2 m LIDAR (Open Government Licence v3.0).

Credit lines are in `CREDITS.md`.
