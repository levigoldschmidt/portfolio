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
    { "label": "Bâtiment", "type": "building", "file": "projets/my-project/building.obj" },
    { "label": "Environnement", "type": "environment", "file": "projets/my-project/context.fbx" }
  ],
  "unit_scale": 0.001,
  "orientation_model": "projets/my-project/cube.gltf",
  "viewer_config": "viewers/my-project.json"
}
```

- `layers`: any number of models displayed together. Each has a `label`
  (toggle in the panel), a `file`, and an optional `type`:
  - `"building"` (default): a regular model that can be cut.
  - `"environment"`: surrounding context (hidden at load). While at least one
    environment layer is visible, the **Paramètres** section is hidden
    completely and all cuts are suspended; it comes back once every
    environment layer is hidden.
  (`"context": true` is still accepted as an alias of `"type": "environment"`.)
- `file`: optional. For a single model you can use `"file": "…"` instead of
  `layers`. Do not set it when `layers` is present (it is ignored). One of
  `layers` or `file` is required.
- `unit_scale`: factor from file units to metres (`0.001` for millimetres).
- `viewer_config`: path, relative to `content/`, of a JSON file with the
  settings of this model (one file per model). Its content is inlined in the
  page as `data-viewer-config`. If omitted, three default planes (X, Y, Z)
  without presets are used.

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
| `range`    | Slider range in metres, relative to the plane origin: `[min, max]`, `"bounds"` (model bounding box projected on the normal) or `"diagonal"` (± half the bounding-box diagonal, default). |
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
`data-model-stage`, `data-model-src` / `data-model-label` / `data-model-type`
elements (one per model), `data-model-scale`, `data-model-orientation`
(`data-model-orientation-src`), the settings panel, reset and fullscreen buttons,
and `data-model-cut-controls`. Three.js and its addons must be resolvable through
an import map (`three`, `three/addons/`).
