#!/usr/bin/env python3
"""Download the map features of a small area from Overture Maps.

Overture publishes OpenStreetMap-derived buildings, roads, water and land use
as GeoParquet on a public S3 bucket. This script reads only the row groups
whose bounding boxes overlap the requested area and writes them as one
GeoJSON file that `generate.ts` turns into a zfront map.

    pip install pyarrow shapely
    python3 scripts/realmap/fetch_overture.py --town bath

Towns are listed in towns.json. Output: scripts/realmap/cache/<town>.geojson
(git-ignored). Row-group bounding boxes are cached per release in
scripts/realmap/cache/index-<release>.json, so only the first run is slow.

Data licences: OSM-derived themes are ODbL ("© OpenStreetMap contributors");
land_cover is ESA WorldCover (CC BY 4.0). See README.md.
"""

import argparse
import json
import math
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import pyarrow.compute as pc
import pyarrow.fs as pafs
import pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import box, mapping

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
BUCKET = "overturemaps-us-west-2"
RELEASE = "2026-10-21.0"

# (theme, type, columns to keep besides geometry) -> feature kind
SOURCES = [
    ("buildings", "building", ["subtype", "class"], "building"),
    ("transportation", "segment", ["subtype", "class"], "segment"),
    ("base", "water", ["subtype", "class"], "water"),
    ("base", "land", ["subtype", "class"], "land"),
    ("base", "land_use", ["subtype", "class"], "land_use"),
    ("base", "land_cover", ["subtype"], "land_cover"),
]


def s3() -> pafs.S3FileSystem:
    kwargs = {"anonymous": True, "region": "us-west-2"}
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if proxy:
        kwargs["proxy_options"] = proxy
    ca = os.environ.get("SSL_CERT_FILE")
    if ca:
        kwargs["tls_ca_file_path"] = ca
    return pafs.S3FileSystem(**kwargs)


def row_group_bboxes(fs: pafs.S3FileSystem, path: str) -> list:
    md = pq.ParquetFile(path, filesystem=fs).metadata
    names = [md.schema.column(i).path for i in range(md.num_columns)]
    cols = {k: names.index(f"bbox.{k}") for k in ("xmin", "xmax", "ymin", "ymax")}
    out = []
    for i in range(md.num_row_groups):
        rg = md.row_group(i)
        st = {k: rg.column(c).statistics for k, c in cols.items()}
        out.append(
            [i, st["xmin"].min, st["xmax"].max, st["ymin"].min, st["ymax"].max]
        )
    return out


def load_index(fs: pafs.S3FileSystem) -> dict:
    path = os.path.join(CACHE, f"index-{RELEASE}.json")
    index = {}
    if os.path.exists(path):
        with open(path) as f:
            index = json.load(f)
    changed = False
    for theme, typ, _, _ in SOURCES:
        key = f"{theme}/{typ}"
        if key in index:
            continue
        prefix = f"{BUCKET}/release/{RELEASE}/theme={theme}/type={typ}/"
        files = [
            f.path
            for f in fs.get_file_info(pafs.FileSelector(prefix))
            if f.path.endswith(".parquet")
        ]
        print(f"indexing {key}: {len(files)} files", file=sys.stderr)
        with ThreadPoolExecutor(32) as ex:
            groups = list(ex.map(lambda p: row_group_bboxes(fs, p), files))
        index[key] = dict(zip(files, groups))
        changed = True
    if changed:
        os.makedirs(CACHE, exist_ok=True)
        with open(path, "w") as f:
            json.dump(index, f)
    return index


def area_bbox(lat: float, lon: float, size_km: float, margin: float = 1.05):
    half = size_km * 1000 / 2 * margin
    dlat = half / 111_320
    dlon = half / (111_320 * math.cos(math.radians(lat)))
    return lon - dlon, lat - dlat, lon + dlon, lat + dlat


def fetch(fs, index, theme, typ, cols, kind, bb):
    xmin, ymin, xmax, ymax = bb
    clip = box(*bb)
    jobs = [
        (path, rg)
        for path, groups in index[f"{theme}/{typ}"].items()
        for rg, gx0, gx1, gy0, gy1 in groups
        if gx0 <= xmax and gx1 >= xmin and gy0 <= ymax and gy1 >= ymin
    ]

    def read(job):
        path, rg = job
        t = pq.ParquetFile(path, filesystem=fs).read_row_group(
            rg, columns=["bbox", "geometry", *cols]
        )
        b = t.column("bbox")
        keep = pc.and_(
            pc.and_(
                pc.less_equal(pc.struct_field(b, "xmin"), xmax),
                pc.greater_equal(pc.struct_field(b, "xmax"), xmin),
            ),
            pc.and_(
                pc.less_equal(pc.struct_field(b, "ymin"), ymax),
                pc.greater_equal(pc.struct_field(b, "ymax"), ymin),
            ),
        )
        return t.filter(keep).drop(["bbox"]).to_pylist()

    with ThreadPoolExecutor(16) as ex:
        rows = [r for part in ex.map(read, jobs) for r in part]
    features = []
    for r in rows:
        g = wkb.loads(r.pop("geometry")).intersection(clip)
        if g.is_empty:
            continue
        props = {"kind": kind}
        props.update({k: v for k, v in r.items() if v is not None})
        features.append(
            {"type": "Feature", "properties": props, "geometry": mapping(g)}
        )
    print(f"{kind}: {len(jobs)} row groups, {len(features)} features", file=sys.stderr)
    return features


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--town", required=True, help="a key of towns.json")
    args = ap.parse_args()
    with open(os.path.join(HERE, "towns.json")) as f:
        town = json.load(f)[args.town]
    bb = area_bbox(town["lat"], town["lon"], town["sizeKm"])
    fs = s3()
    index = load_index(fs)
    features = []
    for theme, typ, cols, kind in SOURCES:
        features += fetch(fs, index, theme, typ, cols, kind, bb)
    os.makedirs(CACHE, exist_ok=True)
    out = os.path.join(CACHE, f"{args.town}.geojson")
    with open(out, "w") as f:
        json.dump(
            {
                "type": "FeatureCollection",
                "release": RELEASE,
                "bbox": bb,
                "features": features,
            },
            f,
        )
    print(f"wrote {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
