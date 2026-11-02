# archi-viewer.js

Interactive 3D model viewer (Three.js, orthographic camera, white clay look,
SSAO, shadows) with any number of models and any number of cut planes.
It initialises every `[data-archi-viewer]` element on the page.

## Supported formats

The loader is chosen from the file extension:

| Extension       | Loader     |
|-----------------|------------|
| `.fbx`          | FBXLoader  |
| `.obj`          | OBJLoader  |
| `.gltf`, `.glb` | GLTFLoader |

The orientation cube (`orientation_model`) must be a glTF file.

## Usage in this site

In `content/projects.json`, add a `3d_model` section. `build_site.py` generates
the viewer markup and includes `assets/js/archi-viewer.js`.

```json
{
  "id": "model-3d",
  "label": "Maquette 3D interactive",
  "type": "3d_model",
  "layers": [
    {
      "label": "Bâtiment",
      "type": "building",
      "file": "projets/my-project/building.obj",
      "viewer_config": "viewers/my-building.json"
    },
    {
      "label": "Annexe",
      "type": "building",
      "file": "projets/my-project/annex.obj",
      "viewer_config": "viewers/my-annex.json"
    },
    { "label": "Environnement", "type": "environment", "file": "projets/my-project/context.fbx" }
  ],
  "unit_scale": 0.001,
  "orientation_model": "projets/my-project/cube.gltf"
}
```

- `layers`: any number of models displayed together. Each has a `label`
  (toggle in the model tree), a `file`, and an optional `type`:
  - `"building"` (default): a model that can be cut. It has **its own
    Paramètres section with its own list of cut planes**, shown in the model
    tree as a child of the layer. Planes only cut their own layer. The section
    is hidden while the layer itself is hidden.
  - `"environment"`: surrounding context (hidden at load, never cut, no
    Paramètres section). While at least one environment layer is visible, every
    Paramètres section is hidden and all cuts are suspended; they come back once
    every environment layer is hidden.
  (`"context": true` is still accepted as an alias of `"type": "environment"`.)
- Layer `viewer_config`: path, relative to `content/`, of the JSON file holding
  the cut planes of that building layer (one file per model). Inlined in the
  page as `data-model-config`. A file can be shared by several layers.
- `file`: optional. For a single model you can use `"file": "…"` instead of
  `layers`. Do not set it when `layers` is present (it is ignored). One of
  `layers` or `file` is required.
- `unit_scale`: factor from file units to metres (`0.001` for millimetres).
- Section `viewer_config` (optional): fallback config for building layers that
  have none, and home of the viewer-wide `urban` option. If neither the layer
  nor the section defines `cut_planes`, three default planes (X, Y, Z) without
  presets are used. `"cut_planes": []` means the layer has no Paramètres
  section.

## Viewer config file

```json
{
  "urban": false,
  "cut_planes": [
    {
      "label": "Plan A",
      "matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
      "normal": [0, 0, 1],
      "flip": false,
      "enabled": false,
      "range": "diagonal",
      "position": 0,
      "presets": [{ "value": 1.5, "label": "1.5 m" }, 3]
    }
  ]
}
```

`cut_planes` can contain any number of planes; each gets its own panel in
**Paramètres** (enable checkbox, position slider, advanced rotation sliders).
Every field is optional:

| Field      | Meaning |
|------------|---------|
| `label`    | Panel title (default "Plan de coupe N"). |
| `normal`   | Base normal `[x, y, z]` before the matrix (default `[0, 0, 1]`). |
| `matrix`   | Initial transformation as 16 numbers of a Three.js `Matrix4`, **column-major** (translation in the last 3 numbers before the final 1: indices 12–14). Its rotation orients the plane normal, its translation sets the plane origin. Default: identity. Coordinates are in the viewer scene: the model is centred on its bounding box and scaled by `unit_scale` (metres). |
| `flip`     | `true` keeps the opposite side of the plane. |
| `enabled`  | Cut active at load (default `false`). |
| `range`    | Slider range in metres, relative to the plane origin: `[min, max]`, `"bounds"` (the layer's bounding box projected on the normal) or `"diagonal"` (± half the layer's bounding-box diagonal, default). |
| `position` | Initial offset along the normal from the origin: a number, `"min"` or `"max"` (default `0`). |
| `presets`  | Any number of predefined positions, as numbers or `{ "value", "label" }`. They appear as numbered markers on the slider; clicking one enables the plane and moves it there, and releasing the slider near one snaps to it. |
| `urban`    | Top-level option. Forces the urban lighting / Ctrl+wheel zoom mode. Default: `true` when there are several layers. |

The plane's final normal is `matrix` applied to `normal`, then the user's
rotation sliders (degrees, about X, Y, Z). The plane passes through
`origin + normal × position`.

Defaults equivalent to the former hard-coded behaviour are in
[content/viewers/default-cut-planes.json](../../content/viewers/default-cut-planes.json).

## Markup contract

To use the script outside `build_site.py`, reproduce the markup generated in
`build_site.py` (`kind == "3d_model"`): a `data-archi-viewer` root containing
`data-model-stage`, `data-model-src` / `data-model-label` / `data-model-type` /
`data-model-config`
elements (one per model), `data-model-scale`, `data-model-orientation`
(`data-model-orientation-src`), the settings panel, reset and fullscreen buttons,
and `data-model-cut-controls`. Three.js and its addons must be resolvable through
an import map (`three`, `three/addons/`).
