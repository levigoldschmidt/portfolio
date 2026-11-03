#!/usr/bin/env python3
"""Merge the primitives of each glTF mesh by material and write a compact binary GLB.

    python tools/optimize_gltf.py input.gltf output.glb [--only 1,2 | --exclude 1,2]

Onshape exports one primitive per face (thousands of draw calls, base64 buffers).
--only / --exclude keep or drop glTF nodes (by index) to split a model into layers.
"""
import base64
import json
import struct
import sys
from collections import OrderedDict

import numpy as np

DTYPES = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_accessor(gltf, buffer, index):
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    dtype = np.dtype(DTYPES[acc["componentType"]])
    n = NCOMP[acc["type"]]
    offset = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or dtype.itemsize * n
    if stride == dtype.itemsize * n:
        return np.frombuffer(buffer, dtype, acc["count"] * n, offset).reshape(acc["count"], n)
    raw = np.frombuffer(buffer, np.uint8, stride * acc["count"], offset).reshape(acc["count"], stride)
    return raw[:, : dtype.itemsize * n].copy().view(dtype).reshape(acc["count"], n)


def main(src, dst, only=None, exclude=None):
    with open(src, encoding="utf-8-sig") as f:
        gltf = json.load(f)
    uri = gltf["buffers"][0]["uri"]
    buffer = base64.b64decode(uri.split(",", 1)[1])

    if only is not None or exclude is not None:
        # Keep only the selected mesh nodes, then drop the meshes nobody uses.
        for index, node in enumerate(gltf["nodes"]):
            keep = index in only if only is not None else index not in exclude
            if "mesh" in node and not keep:
                del node["mesh"]
        used = sorted({n["mesh"] for n in gltf["nodes"] if "mesh" in n})
        remap = {old: new for new, old in enumerate(used)}
        for node in gltf["nodes"]:
            if "mesh" in node:
                node["mesh"] = remap[node["mesh"]]
        gltf["meshes"] = [gltf["meshes"][old] for old in used]

    chunks, views, accessors = [], [], []
    size = 0

    def add(array, target, with_bounds=False):
        nonlocal size
        data = np.ascontiguousarray(array).tobytes()
        pad = (-len(data)) % 4
        views.append({"buffer": 0, "byteOffset": size, "byteLength": len(data), "target": target})
        chunks.append(data + b"\0" * pad)
        size += len(data) + pad
        comp = {np.dtype(np.float32): 5126, np.dtype(np.uint32): 5125}[array.dtype]
        acc = {"bufferView": len(views) - 1, "componentType": comp, "count": len(array),
               "type": {1: "SCALAR", 2: "VEC2", 3: "VEC3"}[array.shape[1]]}
        if with_bounds:
            acc["min"] = array.min(axis=0).tolist()
            acc["max"] = array.max(axis=0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    for mesh in gltf["meshes"]:
        groups = OrderedDict()
        for prim in mesh["primitives"]:
            attrs = prim["attributes"]
            key = (prim.get("material"), prim.get("mode", 4), tuple(sorted(a for a in attrs if a in ("POSITION", "NORMAL", "TEXCOORD_0"))))
            groups.setdefault(key, []).append(prim)
        new_prims = []
        for (material, mode, names), prims in groups.items():
            parts = {name: [] for name in names}
            indices, base = [], 0
            for prim in prims:
                count = gltf["accessors"][prim["attributes"]["POSITION"]]["count"]
                for name in names:
                    parts[name].append(read_accessor(gltf, buffer, prim["attributes"][name]).astype(np.float32))
                if "indices" in prim:
                    indices.append(read_accessor(gltf, buffer, prim["indices"]).astype(np.uint32).reshape(-1, 1) + base)
                else:
                    indices.append(np.arange(count, dtype=np.uint32).reshape(-1, 1) + base)
                base += count
            merged = {name: np.concatenate(parts[name]) for name in names}
            index = np.concatenate(indices).reshape(-1)
            # Deduplicate identical vertices (all attributes equal).
            table = np.concatenate([merged[name] for name in names], axis=1)
            _, first, inverse = np.unique(table, axis=0, return_index=True, return_inverse=True)
            inverse = inverse.reshape(-1)
            merged = {name: merged[name][first] for name in names}
            index = inverse[index].astype(np.uint32).reshape(-1, 1)
            out = {name: add(merged[name], 34962, name == "POSITION") for name in names}
            new = {"attributes": out, "indices": add(index, 34963), "mode": mode}
            if material is not None:
                new["material"] = material
            new_prims.append(new)
        mesh["primitives"] = new_prims
        mesh.pop("extras", None)
        mesh.pop("extensions", None)

    for node in gltf["nodes"]:
        node.pop("extras", None)
        node.pop("extensions", None)
    gltf.pop("extensionsUsed", None)
    gltf.pop("extensions", None)
    gltf["bufferViews"], gltf["accessors"] = views, accessors
    blob = b"".join(chunks)
    gltf["buffers"] = [{"byteLength": len(blob)}]

    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(dst, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(blob), 0x004E4942) + blob)
    print(f"{src} -> {dst}: {total / 1e6:.1f} MB, {sum(len(m['primitives']) for m in gltf['meshes'])} primitives")


if __name__ == "__main__":
    # usage: optimize_gltf.py in.gltf out.glb [--only 1,2,3 | --exclude 1,2,3]  (node indices)
    args = sys.argv[3:]
    node_list = lambda text: {int(v) for v in text.split(",")}
    main(
        sys.argv[1],
        sys.argv[2],
        only=node_list(args[args.index("--only") + 1]) if "--only" in args else None,
        exclude=node_list(args[args.index("--exclude") + 1]) if "--exclude" in args else None,
    )
