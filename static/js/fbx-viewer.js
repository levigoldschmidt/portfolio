const viewer = document.querySelector("[data-fbx-viewer]");
async function initializeViewer() {
  if (!viewer) return;
  const stage = viewer.querySelector("[data-model-stage]");
  const source = viewer.querySelector("[data-model-src]").dataset.modelSrc;
  const modelScale = Number(viewer.querySelector("[data-model-scale]")?.dataset.modelScale || 1);
  const orientationSource = viewer.querySelector("[data-model-orientation]").dataset.modelOrientationSrc;
  const status = stage.querySelector(".model-status");
  const resetButton = viewer.querySelector("[data-model-reset]");
  const fullscreenButton = viewer.querySelector("[data-model-fullscreen]");
  const fullscreenStatus = viewer.querySelector("[data-model-fullscreen-status]");
  const cutControls = viewer.querySelector("[data-model-cut-controls]");
  const orientationControl = viewer.querySelector("[data-model-orientation]");
  const english = document.documentElement.lang === "en";
  const updateFullscreenButton = () => {
    const isFullscreen = document.fullscreenElement === viewer;
    fullscreenButton.textContent = isFullscreen
      ? (english ? "Exit fullscreen" : "Quitter le plein écran")
      : (english ? "Fullscreen" : "Plein écran");
    fullscreenButton.setAttribute("aria-label", fullscreenButton.textContent);
  };
  fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement === viewer) {
        await document.exitFullscreen();
      } else {
        await viewer.requestFullscreen();
      }
      updateFullscreenButton();
    } catch (error) {
      console.error("Could not change fullscreen mode.", error);
      fullscreenStatus.textContent = english
        ? "Fullscreen mode could not be changed."
        : "Le mode plein écran n’a pas pu être modifié.";
    }
  });
  document.addEventListener("fullscreenchange", updateFullscreenButton);
  updateFullscreenButton();
  let THREE;
  let FBXLoader;
  let OBJLoader;
  let GLTFLoader;
  let OrbitControls;
  try {
    [THREE, { FBXLoader }, { OBJLoader }, { GLTFLoader }, { OrbitControls }] = await Promise.all([
      import("three"),
      import("three/addons/loaders/FBXLoader.js"),
      import("three/addons/loaders/OBJLoader.js"),
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/controls/OrbitControls.js"),
    ]);
  } catch (error) {
    console.error("Could not load the 3D viewer libraries.", error);
    status.textContent = english
      ? "3D viewing is not available in this browser."
      : "La visualisation 3D n’est pas disponible dans ce navigateur.";
    return;
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#bec9d1");
  let cameraFrustumHeight = 1;
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.01, 100000);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  } catch (error) {
    console.error("Could not initialize the 3D viewer.", error);
    status.textContent = english
      ? "3D viewing is not available in this browser."
      : "La visualisation 3D n’est pas disponible dans ce navigateur.";
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.localClippingEnabled = true;
  stage.append(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.1));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(1, 2, 3);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
  fillLight.position.set(-2, 1, -2);
  scene.add(fillLight);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.target.set(0, 0, 0);

  const resize = () => {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.left = -cameraFrustumHeight * camera.aspect / 2;
    camera.right = cameraFrustumHeight * camera.aspect / 2;
    camera.top = cameraFrustumHeight / 2;
    camera.bottom = -cameraFrustumHeight / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();

  let updateOrientationCube = () => {};
  const sourceExtension = source.toLowerCase().split("?")[0].split(".").pop();
  const ModelLoader = sourceExtension === "obj"
    ? OBJLoader
    : sourceExtension === "gltf" || sourceExtension === "glb"
      ? GLTFLoader
      : FBXLoader;
  const loader = new ModelLoader();
  const loadModel = (onLoad, onError) => {
    if (loader instanceof OBJLoader) {
      new THREE.FileLoader().setResponseType("text").load(
        source,
        (text) => {
          try {
            onLoad(loader.parse(text.replace(/^\s*(?:trace_obj|shadow_obj)\b.*$/gm, "")));
          } catch (error) {
            onError(error);
          }
        },
        undefined,
        onError,
      );
      return;
    }
    if (loader instanceof GLTFLoader) {
      loader.load(source, (gltf) => onLoad(gltf.scene), undefined, onError);
      return;
    }
    loader.load(source, onLoad, undefined, onError);
  };
  loadModel(
    (model) => {
      if (!Number.isFinite(modelScale) || modelScale <= 0) {
        console.error("The 3D model scale must be a positive finite number.");
        status.textContent = english
          ? "The 3D model could not be loaded."
          : "Le modèle 3D n’a pas pu être chargé.";
        return;
      }
      model.scale.setScalar(modelScale);
      model.traverse((part) => {
        if (!part.isMesh) return;
        part.material = new THREE.MeshStandardMaterial({
          color: 0xfafafa,
          roughness: 0.88,
          side: THREE.FrontSide,
        });
      });

      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z);
      if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
        console.error("The FBX model has no measurable geometry.");
        status.textContent = english
          ? "The 3D model could not be loaded."
          : "Le modèle 3D n’a pas pu être chargé.";
        return;
      }

      cameraFrustumHeight = maxDimension * 1.7;
      resize();

      const centeredModel = new THREE.Group();
      centeredModel.position.copy(center).negate();
      scene.add(centeredModel);

      const planeRadius = size.length() / 2;
      const rotation = new THREE.Euler();
      const planeDefinitions = [
        { normal: new THREE.Vector3(1, 0, 0), enabled: true },
        { normal: new THREE.Vector3(0, 1, 0), clipSign: -1, enabled: false },
        { normal: new THREE.Vector3(0, 0, 1), enabled: false },
      ];
      const clippingPlanes = planeDefinitions.map(({ normal }) => new THREE.Plane(normal.clone(), 0));
      const material = new THREE.MeshStandardMaterial({
        color: 0xfafafa,
        roughness: 0.88,
        side: THREE.FrontSide,
        clippingPlanes,
      });
      model.traverse((part) => {
        if (!part.isMesh) return;
        part.material = material;
      });
      centeredModel.add(model);

      const axisLabels = ["X", "Y", "Z"];
      const planeGeometry = new THREE.PlaneGeometry(planeRadius * 2, planeRadius * 2);
      const planeHelpers = planeDefinitions.map(() => {
        const group = new THREE.Group();
        const surface = new THREE.Mesh(
          planeGeometry,
          new THREE.MeshBasicMaterial({
            color: 0x10a9df,
            transparent: true,
            opacity: 0.035,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: true,
          }),
        );
        surface.renderOrder = 5;
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(planeGeometry),
          new THREE.LineBasicMaterial({ color: 0x075779, transparent: true, opacity: 0.25, depthTest: false }),
        );
        outline.renderOrder = 6;
        group.add(surface, outline);
        group.visible = false;
        scene.add(group);
        return { group, hideTimer: 0 };
      });
      const sectionSurfaces = planeDefinitions.map((_, index) => {
        const cap = new THREE.Mesh(
          new THREE.BufferGeometry(),
          new THREE.MeshBasicMaterial({
            color: 0x000000,
            side: THREE.DoubleSide,
            clippingPlanes: clippingPlanes.filter((__, planeIndex) => planeIndex !== index),
            depthTest: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
          }),
        );
        cap.renderOrder = 1;
        cap.frustumCulled = false;
        cap.visible = false;
        scene.add(cap);
        return cap;
      });
      const sectionEdges = planeDefinitions.map((_, index) => {
        const edges = new THREE.LineSegments(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({
            color: 0x000000,
            clippingPlanes: clippingPlanes.filter((__, planeIndex) => planeIndex !== index),
          }),
        );
        edges.renderOrder = 2;
        edges.frustumCulled = false;
        edges.visible = false;
        scene.add(edges);
        return edges;
      });
      const surfaceTimers = planeDefinitions.map(() => 0);
      let planeStates = [];
      const pointInPolygon = (point, polygon) => {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
          const a = polygon[i];
          const b = polygon[j];
          if ((a.y > point.y) !== (b.y > point.y)
            && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
          }
        }
        return inside;
      };
      const isSimplePolygon = (polygon, coordinateTolerance) => {
        const areaTolerance = coordinateTolerance * coordinateTolerance;
        const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const onSegment = (a, b, point) => point.x >= Math.min(a.x, b.x) - coordinateTolerance
          && point.x <= Math.max(a.x, b.x) + coordinateTolerance
          && point.y >= Math.min(a.y, b.y) - coordinateTolerance
          && point.y <= Math.max(a.y, b.y) + coordinateTolerance;
        const intersects = (a, b, c, d) => {
          const abC = cross(a, b, c);
          const abD = cross(a, b, d);
          const cdA = cross(c, d, a);
          const cdB = cross(c, d, b);
          if (((abC > areaTolerance && abD < -areaTolerance)
            || (abC < -areaTolerance && abD > areaTolerance))
            && ((cdA > areaTolerance && cdB < -areaTolerance)
              || (cdA < -areaTolerance && cdB > areaTolerance))) {
            return true;
          }
          return (Math.abs(abC) <= areaTolerance && onSegment(a, b, c))
            || (Math.abs(abD) <= areaTolerance && onSegment(a, b, d))
            || (Math.abs(cdA) <= areaTolerance && onSegment(c, d, a))
            || (Math.abs(cdB) <= areaTolerance && onSegment(c, d, b));
        };
        for (let first = 0; first < polygon.length; first += 1) {
          const firstNext = (first + 1) % polygon.length;
          for (let second = first + 1; second < polygon.length; second += 1) {
            const secondNext = (second + 1) % polygon.length;
            if (first === second || firstNext === second || secondNext === first) continue;
            if (intersects(polygon[first], polygon[firstNext], polygon[second], polygon[secondNext])) {
              return false;
            }
          }
        }
        return true;
      };
      const createSectionGeometries = (plane) => {
        const tolerance = Math.max(maxDimension * 1e-5, 1e-5);
        const pointKey = (point) => [
          Math.round(point.x / tolerance),
          Math.round(point.y / tolerance),
          Math.round(point.z / tolerance),
        ].join(",");
        const normal = plane.normal.clone().normalize();
        const reference = Math.abs(normal.z) < 0.9
          ? new THREE.Vector3(0, 0, 1)
          : new THREE.Vector3(0, 1, 0);
        const u = new THREE.Vector3().crossVectors(normal, reference).normalize();
        const v = new THREE.Vector3().crossVectors(normal, u).normalize();
        const origin = normal.clone().multiplyScalar(-plane.constant)
          .addScaledVector(normal, maxDimension * 1e-4);
        const surfacePositions = [];
        const surfaceIndices = [];
        const edgePositions = [];
        model.updateWorldMatrix(true, true);
        const isVisible = (part, root) => {
          while (part && part !== root) {
            if (!part.visible) return false;
            part = part.parent;
          }
          return Boolean(part?.visible);
        };
        const pointsByKey = new Map();
        const graph = new Map();
        const edgeKeys = new Set();
        const addSegment = (start, end) => {
          const startKey = pointKey(start);
          const endKey = pointKey(end);
          if (startKey === endKey) return;
          const edgeKey = [startKey, endKey].sort().join("|");
          if (edgeKeys.has(edgeKey)) return;
          edgeKeys.add(edgeKey);
          pointsByKey.set(startKey, start);
          pointsByKey.set(endKey, end);
          edgePositions.push(start.x, start.y, start.z, end.x, end.y, end.z);
          if (!graph.has(startKey)) graph.set(startKey, new Set());
          if (!graph.has(endKey)) graph.set(endKey, new Set());
          graph.get(startKey).add(endKey);
          graph.get(endKey).add(startKey);
        };
        model.traverse((part) => {
          if (!part.isMesh || !isVisible(part, model)) return;
          const position = part.geometry.getAttribute("position");
          const indices = part.geometry.index;
          const vertexCount = indices ? indices.count : position.count;
          const vertex = (index) => new THREE.Vector3()
            .fromBufferAttribute(position, indices ? indices.getX(index) : index)
            .applyMatrix4(part.matrixWorld);
          for (let i = 0; i < vertexCount; i += 3) {
            const vertices = [vertex(i), vertex(i + 1), vertex(i + 2)];
            const distances = vertices.map((point) => plane.distanceToPoint(point));
            if (distances.every((distance) => Math.abs(distance) <= tolerance)) continue;
            const onPlaneEdges = [];
            for (let edge = 0; edge < 3; edge += 1) {
              const next = (edge + 1) % 3;
              if (Math.abs(distances[edge]) <= tolerance
                && Math.abs(distances[next]) <= tolerance) {
                onPlaneEdges.push([vertices[edge], vertices[next]]);
              }
            }
            onPlaneEdges.forEach(([start, end]) => addSegment(start, end));
            const intersections = [];
            for (let edge = 0; edge < 3; edge += 1) {
              const next = (edge + 1) % 3;
              const startDistance = distances[edge];
              const endDistance = distances[next];
              if ((startDistance < -tolerance && endDistance > tolerance)
                || (startDistance > tolerance && endDistance < -tolerance)) {
                intersections.push(vertices[edge].clone().lerp(
                  vertices[next],
                  startDistance / (startDistance - endDistance),
                ));
              } else if (Math.abs(startDistance) <= tolerance && Math.abs(endDistance) > tolerance) {
                intersections.push(vertices[edge].clone());
              }
            }
            const unique = intersections.filter((point, index) => intersections
              .findIndex((candidate) => candidate.distanceToSquared(point) <= tolerance * tolerance) === index);
            if (unique.length === 2) addSegment(unique[0], unique[1]);
          }
        });

        const graphComponents = [];
        const visitedComponents = new Set();
        for (const key of graph.keys()) {
          if (visitedComponents.has(key)) continue;
          const component = [];
          const pending = [key];
          visitedComponents.add(key);
          while (pending.length) {
            const current = pending.pop();
            component.push(current);
            graph.get(current).forEach((neighbor) => {
              if (visitedComponents.has(neighbor)) return;
              visitedComponents.add(neighbor);
              pending.push(neighbor);
            });
          }
          graphComponents.push(component);
        }
        const fillGraph = new Map([...graph].map(([key, neighbors]) => [key, new Set(neighbors)]));
        const openChains = [];
        for (const component of graphComponents) {
          const endpoints = component.filter((key) => graph.get(key).size === 1);
          const edgeCount = component.reduce((total, key) => total + graph.get(key).size, 0) / 2;
          if (endpoints.length === 2 && edgeCount >= 3
            && component.every((key) => graph.get(key).size <= 2)) {
            openChains.push(endpoints);
          }
        }
        const unmatchedEndpoints = openChains.flat();
        const maxClosureGap = maxDimension * 0.02;
        while (unmatchedEndpoints.length >= 2) {
          let closest = null;
          for (let first = 0; first < unmatchedEndpoints.length; first += 1) {
            for (let second = first + 1; second < unmatchedEndpoints.length; second += 1) {
              const distance = pointsByKey.get(unmatchedEndpoints[first])
                .distanceTo(pointsByKey.get(unmatchedEndpoints[second]));
              if (distance > maxClosureGap || (closest && distance >= closest.distance)) continue;
              closest = { first, second, distance };
            }
          }
          if (!closest) break;
          const [secondKey] = unmatchedEndpoints.splice(closest.second, 1);
          const [firstKey] = unmatchedEndpoints.splice(closest.first, 1);
          fillGraph.get(firstKey).add(secondKey);
          fillGraph.get(secondKey).add(firstKey);
        }

        const projectedPoints = new Map([...pointsByKey].map(([key, point]) => {
          const relative = point.clone().sub(origin);
          return [key, new THREE.Vector2(relative.dot(u), relative.dot(v))];
        }));
        const orderedNeighbors = new Map([...fillGraph].map(([key, neighbors]) => [
          key,
          [...neighbors].sort((first, second) => {
            const center = projectedPoints.get(key);
            const firstPoint = projectedPoints.get(first);
            const secondPoint = projectedPoints.get(second);
            return Math.atan2(firstPoint.y - center.y, firstPoint.x - center.x)
              - Math.atan2(secondPoint.y - center.y, secondPoint.x - center.x);
          }),
        ]));
        const loops = [];
        const visitedDirections = new Set();
        const loopKeys = new Set();
        for (const [startKey, neighbors] of orderedNeighbors) {
          for (const firstNeighbor of neighbors) {
            if (visitedDirections.has(`${startKey}>${firstNeighbor}`)) continue;
            const loop = [];
            let previous = startKey;
            let current = firstNeighbor;
            let closed = false;
            for (let step = 0; step <= edgeKeys.size * 2; step += 1) {
              const direction = `${previous}>${current}`;
              if (visitedDirections.has(direction)) {
                closed = previous === startKey && current === firstNeighbor;
                break;
              }
              visitedDirections.add(direction);
              loop.push(previous);
              const nextNeighbors = orderedNeighbors.get(current) || [];
              const reverseIndex = nextNeighbors.indexOf(previous);
              if (reverseIndex === -1 || nextNeighbors.length < 2) break;
              const next = nextNeighbors[(reverseIndex + nextNeighbors.length - 1) % nextNeighbors.length];
              previous = current;
              current = next;
              if (previous === startKey && current === firstNeighbor) {
                closed = true;
                break;
              }
            }
            if (!closed || loop.length < 3 || new Set(loop).size !== loop.length) continue;
            const projected = loop.map((key) => projectedPoints.get(key));
            const area = THREE.ShapeUtils.area(projected);
            if (area <= tolerance * tolerance || !isSimplePolygon(projected, tolerance)) continue;
            const canonicalLoop = [...loop].sort().join("|");
            if (loopKeys.has(canonicalLoop)) continue;
            loopKeys.add(canonicalLoop);
            loops.push(loop.map((key) => pointsByKey.get(key)));
          }
        }
        const contours = loops.map((points) => {
          const projected = points.map((point) => {
            const relative = point.clone().sub(origin);
            return new THREE.Vector2(relative.dot(u), relative.dot(v));
          });
          return {
            points: projected,
            area: Math.abs(THREE.ShapeUtils.area(projected)),
            parent: -1,
            depth: 0,
          };
        }).filter(({ area }) => area > tolerance * tolerance);
        contours.forEach((contour, contourIndex) => {
          let parentArea = Infinity;
          contours.forEach((candidate, candidateIndex) => {
            if (contourIndex === candidateIndex || candidate.area <= contour.area
              || candidate.area >= parentArea) return;
            if (pointInPolygon(contour.points[0], candidate.points)) {
              contour.parent = candidateIndex;
              parentArea = candidate.area;
            }
          });
        });
        contours.forEach((contour) => {
          let parent = contour.parent;
          while (parent !== -1) {
            contour.depth += 1;
            parent = contours[parent].parent;
          }
        });
        contours.forEach((contour, contourIndex) => {
          if (contour.depth % 2 !== 0) return;
          const holes = contours.filter((candidate) => candidate.parent === contourIndex
            && candidate.depth === contour.depth + 1).map((candidate) => candidate.points);
          const flattened = [contour.points, ...holes].flat();
          const triangles = THREE.ShapeUtils.triangulateShape(contour.points, holes);
          const offset = surfacePositions.length / 3;
          flattened.forEach((point) => {
            const worldPoint = origin.clone().addScaledVector(u, point.x).addScaledVector(v, point.y);
            surfacePositions.push(worldPoint.x, worldPoint.y, worldPoint.z);
          });
          triangles.forEach((triangle) => surfaceIndices.push(
            offset + triangle[0],
            offset + triangle[1],
            offset + triangle[2],
          ));
        });
        const surfaceGeometry = new THREE.BufferGeometry();
        surfaceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(surfacePositions, 3));
        surfaceGeometry.setIndex(surfaceIndices);
        if (surfacePositions.length) {
          surfaceGeometry.computeBoundingBox();
          surfaceGeometry.computeBoundingSphere();
        }
        const edgeGeometry = new THREE.BufferGeometry();
        edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
        if (edgePositions.length) {
          edgeGeometry.computeBoundingBox();
          edgeGeometry.computeBoundingSphere();
        }
        return {
          surfaceGeometry,
          edgeGeometry,
          hasSurface: surfaceIndices.length > 0,
          hasEdges: edgePositions.length > 0,
        };
      };
      const scheduleSectionSurface = (index, enabled) => {
        window.clearTimeout(surfaceTimers[index]);
        const updateSurface = () => {
          const cap = sectionSurfaces[index];
          const edges = sectionEdges[index];
          if (!enabled) {
            cap.visible = false;
            cap.geometry.dispose();
            cap.geometry = new THREE.BufferGeometry();
            edges.visible = false;
            edges.geometry.dispose();
            edges.geometry = new THREE.BufferGeometry();
            return;
          }
          const geometries = createSectionGeometries(clippingPlanes[index]);
          cap.geometry.dispose();
          cap.geometry = geometries.surfaceGeometry;
          cap.visible = geometries.hasSurface;
          edges.geometry.dispose();
          edges.geometry = geometries.edgeGeometry;
          edges.visible = geometries.hasEdges;
        };
        if (!enabled) {
          updateSurface();
          return;
        }
        surfaceTimers[index] = window.setTimeout(updateSurface, 100);
      };
      const setCameraDirection = (direction, up = new THREE.Vector3(0, 1, 0)) => {
        const distance = camera.position.distanceTo(controls.target);
        controls.target.set(0, 0, 0);
        camera.position.copy(controls.target).addScaledVector(direction.clone().normalize(), distance);
        camera.up.copy(up);
        camera.lookAt(controls.target);
        controls.update();
      };
      let selectedFaceKey = null;
      let setSelectedFace = (face) => {
        selectedFaceKey = `${face.sign > 0 ? "+" : "-"}${face.axis}`;
      };
      const orientationCubeScene = new THREE.Scene();
      orientationCubeScene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2));
      const orientationKeyLight = new THREE.DirectionalLight(0xffffff, 2);
      orientationKeyLight.position.set(2, 3, 4);
      orientationCubeScene.add(orientationKeyLight);
      const orientationCamera = new THREE.OrthographicCamera(-1.2, 1.2, 1.2, -1.2, 0.01, 100);
      const orientationRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      orientationRenderer.setClearColor(0x000000, 0);
      orientationRenderer.setPixelRatio(Math.min(window.devicePixelRatio * 2, 4));
      orientationRenderer.domElement.setAttribute("aria-hidden", "true");
      orientationRenderer.domElement.className = "model-orientation-canvas";
      const orientationLabels = document.createElement("div");
      orientationLabels.className = "model-orientation-labels";
      const orientationFacesByWorldAxis = [
        { axis: "x", sign: 1, localNormal: new THREE.Vector3(1, 0, 0), localU: new THREE.Vector3(0, 1, 0), name: english ? "Right" : "Droite" },
        { axis: "x", sign: -1, localNormal: new THREE.Vector3(-1, 0, 0), localU: new THREE.Vector3(0, 1, 0), name: english ? "Left" : "Gauche" },
        { axis: "y", sign: 1, localNormal: new THREE.Vector3(0, 0, 1), localU: new THREE.Vector3(1, 0, 0), name: english ? "Top" : "Dessus" },
        { axis: "y", sign: -1, localNormal: new THREE.Vector3(0, 0, -1), localU: new THREE.Vector3(1, 0, 0), name: english ? "Bottom" : "Dessous" },
        { axis: "z", sign: 1, localNormal: new THREE.Vector3(0, -1, 0), localU: new THREE.Vector3(1, 0, 0), name: english ? "Front" : "Avant" },
        { axis: "z", sign: -1, localNormal: new THREE.Vector3(0, 1, 0), localU: new THREE.Vector3(1, 0, 0), name: english ? "Back" : "Arrière" },
      ];
      const orientationLabelsByKey = new Map();
      orientationFacesByWorldAxis.forEach((face) => {
        const key = `${face.sign > 0 ? "+" : "-"}${face.axis}`;
        const label = document.createElement("button");
        label.type = "button";
        label.className = "model-orientation-label";
        label.textContent = face.name.toUpperCase();
        label.setAttribute("aria-label", english ? `View from ${face.name}` : `Vue ${face.name.toLowerCase()}`);
        label.addEventListener("click", () => {
          const direction = new THREE.Vector3();
          direction[face.axis] = face.sign;
          const up = face.axis === "y"
            ? new THREE.Vector3(0, 0, face.sign > 0 ? -1 : 1)
            : new THREE.Vector3(0, 1, 0);
          setSelectedFace(face);
          setCameraDirection(direction, up);
          updateOrientationCube();
        });
        orientationLabels.append(label);
        orientationLabelsByKey.set(key, label);
      });

      const orientationLoader = new GLTFLoader();
      orientationLoader.load(
        orientationSource,
        (gltf) => {
          const orientationModel = gltf.scene;
          const orientationBounds = new THREE.Box3().setFromObject(orientationModel);
          const orientationCenter = orientationBounds.getCenter(new THREE.Vector3());
          const orientationSize = orientationBounds.getSize(new THREE.Vector3());
          const orientationMaxDimension = Math.max(orientationSize.x, orientationSize.y, orientationSize.z);
          if (!Number.isFinite(orientationMaxDimension) || orientationMaxDimension <= 0) {
            console.error("The orientation GLTF has no measurable geometry.");
            orientationControl.setAttribute("aria-label", english
              ? "The orientation cube could not be loaded."
              : "Le cube d’orientation n’a pas pu être chargé.");
            return;
          }

          const orientationRoot = new THREE.Group();
          orientationRoot.rotation.x = -Math.PI / 2;
          orientationRoot.scale.setScalar(1.2 / orientationMaxDimension);
          orientationModel.position.sub(orientationCenter);
          orientationRoot.add(orientationModel);
          orientationCubeScene.add(orientationRoot);
          orientationModel.traverse((part) => {
            if (!part.isMesh) return;
            part.material = part.material.clone();
            part.material.side = THREE.DoubleSide;
          });

          const orientationHalfExtents = orientationSize.clone().multiplyScalar(0.5);
          const faceSize = orientationMaxDimension * 0.7467;
          orientationFacesByWorldAxis.forEach((face) => {
            const textCanvas = document.createElement("canvas");
            textCanvas.width = 512;
            textCanvas.height = 192;
            const context = textCanvas.getContext("2d");
            if (!context) {
              throw new Error("Could not create the orientation label canvas.");
            }
            context.fillStyle = "#202a31";
            context.font = "700 96px Arial, sans-serif";
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText(face.name.toUpperCase(), 256, 96, 490);
            const texture = new THREE.CanvasTexture(textCanvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            const labelMaterial = new THREE.MeshBasicMaterial({
              map: texture,
              transparent: true,
              depthWrite: false,
              side: THREE.DoubleSide,
            });
            const labelMesh = new THREE.Mesh(
              new THREE.PlaneGeometry(faceSize * 0.9, faceSize * 0.32),
              labelMaterial,
            );
            const localV = face.localNormal.clone().cross(face.localU).normalize();
            const basis = new THREE.Matrix4().makeBasis(face.localU, localV, face.localNormal);
            labelMesh.position.copy(face.localNormal).multiplyScalar(
              orientationHalfExtents[face.localNormal.x ? "x" : face.localNormal.y ? "y" : "z"] + 0.00008,
            );
            labelMesh.quaternion.setFromRotationMatrix(basis);
            labelMesh.renderOrder = 3;
            orientationRoot.add(labelMesh);
          });

          const makeSurfaceHighlight = (color, opacity, renderOrder) => {
            const mesh = new THREE.Mesh(
              new THREE.BufferGeometry(),
              new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity,
                depthWrite: false,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -1,
              }),
            );
            mesh.visible = false;
            mesh.renderOrder = renderOrder;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            orientationCubeScene.add(mesh);
            return mesh;
          };
          const selectedSurface = makeSurfaceHighlight(0x168bc0, 0.88, 4);
          const hoverSurface = makeSurfaceHighlight(0xf0b429, 0.88, 5);
          const applySurfaceHighlight = (target, hit) => {
            target.geometry = hit.object.geometry;
            hit.object.updateWorldMatrix(true, false);
            target.matrix.copy(hit.object.matrixWorld);
            target.matrixWorldNeedsUpdate = true;
            target.visible = true;
          };
          const highlightMaterial = new THREE.MeshBasicMaterial({
            color: 0x168bc0,
            transparent: true,
            opacity: 0.88,
            depthWrite: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          });
          const highlight = new THREE.Mesh(
            new THREE.PlaneGeometry(faceSize, faceSize),
            highlightMaterial,
          );
          highlight.visible = false;
          highlight.renderOrder = 4;
          orientationRoot.add(highlight);

          const orientationCanvasSize = orientationControl.clientWidth || 112;
          orientationRenderer.setSize(orientationCanvasSize, orientationCanvasSize, false);
          orientationControl.replaceChildren(orientationRenderer.domElement, orientationLabels);
          orientationControl.hidden = false;

          const orientationRaycaster = new THREE.Raycaster();
          const orientationPointer = new THREE.Vector2();
          const orientationInverse = new THREE.Quaternion();
          const selectedFacePosition = new THREE.Vector3();
          const selectedFaceRotation = new THREE.Quaternion();
          setSelectedFace = (face, hit) => {
            selectedFaceKey = `${face.sign > 0 ? "+" : "-"}${face.axis}`;
            if (hit) {
              applySurfaceHighlight(selectedSurface, hit);
              highlight.visible = false;
              return;
            }
            selectedSurface.visible = false;
            selectedFacePosition.set(0, 0, 0).addScaledVector(
              face.localNormal,
              orientationHalfExtents[face.localNormal.x ? "x" : face.localNormal.y ? "y" : "z"] + 0.0001,
            );
            highlight.position.copy(selectedFacePosition);
            selectedFaceRotation.setFromUnitVectors(new THREE.Vector3(0, 0, 1), face.localNormal);
            highlight.quaternion.copy(selectedFaceRotation);
            highlight.visible = true;
          };
          const getSurface = (event) => {
            const rect = orientationRenderer.domElement.getBoundingClientRect();
            orientationPointer.set(
              ((event.clientX - rect.left) / rect.width) * 2 - 1,
              -((event.clientY - rect.top) / rect.height) * 2 + 1,
            );
            orientationRaycaster.setFromCamera(orientationPointer, orientationCamera);
            const hit = orientationRaycaster.intersectObject(orientationModel, true)[0];
            if (!hit) return null;
            const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
            orientationInverse.copy(orientationRoot.quaternion).invert();
            normal.applyQuaternion(orientationInverse).normalize();
            return { hit, normal };
          };
          const orientToSurface = (event) => {
            if (event.button !== 0) return;
            const surface = getSurface(event);
            if (!surface) return;
            const { hit, normal: localNormal } = surface;
            const worldNormal = localNormal.clone().applyQuaternion(orientationRoot.quaternion);
            const dominantAxis = ["x", "y", "z"].reduce((best, axis) =>
              Math.abs(localNormal[axis]) > Math.abs(localNormal[best]) ? axis : best, "x");
            if (Math.abs(localNormal[dominantAxis]) > 0.96) {
              const worldDirection = worldNormal;
              const axis = ["x", "y", "z"].reduce((best, candidate) =>
                Math.abs(worldDirection[candidate]) > Math.abs(worldDirection[best]) ? candidate : best, "x");
              const face = orientationFacesByWorldAxis.find((candidate) =>
                candidate.axis === axis && candidate.sign === Math.sign(worldDirection[axis]));
              if (!face) return;
              setSelectedFace(face, hit);
              const direction = new THREE.Vector3();
              direction[face.axis] = face.sign;
              const up = face.axis === "y"
                ? new THREE.Vector3(0, 0, face.sign > 0 ? -1 : 1)
                : new THREE.Vector3(0, 1, 0);
              setCameraDirection(direction, up);
            } else {
              selectedFaceKey = null;
              applySurfaceHighlight(selectedSurface, hit);
              highlight.visible = false;
              setCameraDirection(worldNormal);
            }
            updateOrientationCube();
          };
          orientationRenderer.domElement.addEventListener("pointermove", (event) => {
            const surface = getSurface(event);
            if (!surface) {
              hoverSurface.visible = false;
              orientationRenderer.domElement.style.cursor = "default";
              return;
            }
            applySurfaceHighlight(hoverSurface, surface.hit);
            orientationRenderer.domElement.style.cursor = "pointer";
            orientationRenderer.render(orientationCubeScene, orientationCamera);
          });
          orientationRenderer.domElement.addEventListener("pointerleave", () => {
            hoverSurface.visible = false;
            orientationRenderer.domElement.style.cursor = "default";
            orientationRenderer.render(orientationCubeScene, orientationCamera);
          });
          let lastPointerActivation = 0;
          orientationRenderer.domElement.addEventListener("pointerup", (event) => {
            lastPointerActivation = performance.now();
            orientToSurface(event);
          });
          orientationRenderer.domElement.addEventListener("click", (event) => {
            if (performance.now() - lastPointerActivation < 500) return;
            orientToSurface(event);
          });

          updateOrientationCube = () => {
            const viewDirection = camera.position.clone().sub(controls.target).normalize();
            orientationCamera.position.copy(viewDirection).multiplyScalar(4);
            orientationCamera.up.copy(camera.up);
            orientationCamera.lookAt(0, 0, 0);
            orientationCamera.updateMatrixWorld();
            orientationRoot.updateMatrixWorld(true);
            orientationFacesByWorldAxis.forEach((face) => {
              const label = orientationLabelsByKey.get(`${face.sign > 0 ? "+" : "-"}${face.axis}`);
              const worldNormal = face.localNormal.clone().transformDirection(orientationRoot.matrixWorld);
              label.dataset.selected = String(selectedFaceKey === `${face.sign > 0 ? "+" : "-"}${face.axis}`);
              label.style.display = worldNormal.dot(viewDirection) > 0.001 ? "" : "none";
            });
            orientationRenderer.render(orientationCubeScene, orientationCamera);
          };
          updateOrientationCube();
        },
        (error) => {
          console.error("Could not load the orientation GLTF.", error);
          orientationControl.setAttribute("aria-label", english
            ? "The orientation cube could not be loaded."
            : "Le cube d’orientation n’a pas pu être chargé.");
        },
      );

      planeStates = [];
      planeDefinitions.forEach((definition, index) => {
        const panel = document.createElement("section");
        panel.className = "model-cut-plane";
        const title = document.createElement("h3");
        title.className = "model-cut-plane-title";
        title.textContent = english ? `Section plane ${index + 1}` : `Plan de coupe ${index + 1}`;
        panel.append(title);

        const toggleLabel = document.createElement("label");
        toggleLabel.className = "cut-plane-toggle";
        const enabledInput = document.createElement("input");
        enabledInput.type = "checkbox";
        enabledInput.checked = definition.enabled;
        const toggleText = document.createElement("span");
        toggleText.textContent = english ? "Enable" : "Activer";
        toggleLabel.append(enabledInput, toggleText);
        panel.append(toggleLabel);

        const initialPlanePosition = index === 1 ? size.y / 2 : 0;
        const settings = { position: initialPlanePosition, rotation: [0, 0, 0] };
        const planeHelper = planeHelpers[index];
        const sliderControls = [];
        const showPlane = () => {
          planeHelper.group.visible = true;
          window.clearTimeout(planeHelper.hideTimer);
          planeHelper.hideTimer = window.setTimeout(() => {
            planeHelper.group.visible = false;
          }, 4000);
        };
        const updatePlane = (showPreview = true) => {
          rotation.set(...settings.rotation.map((degrees) => THREE.MathUtils.degToRad(degrees)));
          const planeNormal = definition.normal.clone().applyEuler(rotation).normalize();
          clippingPlanes[index].normal.copy(planeNormal).multiplyScalar(definition.clipSign || 1);
          clippingPlanes[index].constant = enabledInput.checked
            ? -settings.position * (definition.clipSign || 1) - maxDimension * 1e-5
            : planeRadius * 2;
          planeHelper.group.position.copy(planeNormal).multiplyScalar(settings.position + 0.025);
          planeHelper.group.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            clippingPlanes[index].normal,
          );
          scheduleSectionSurface(index, enabledInput.checked);
          if (showPreview) {
            showPlane();
          } else {
            window.clearTimeout(planeHelper.hideTimer);
            planeHelper.group.visible = false;
          }
        };
        enabledInput.addEventListener("change", updatePlane);

        const addSlider = (label, min, max, step, value, onChange, suffix, target, compact = false) => {
          const row = document.createElement("label");
          row.className = `cut-plane-slider${compact ? " cut-plane-slider-position" : ""}`;
          const title = document.createElement("span");
          title.textContent = label;
          const input = document.createElement("input");
          input.type = "range";
          input.min = String(min);
          input.max = String(max);
          input.step = String(step);
          input.value = String(value);
          input.setAttribute("aria-label", label);
          const output = document.createElement("output");
          output.value = `${Number(value.toFixed(2))}${suffix}`;
          input.addEventListener("input", () => {
            const nextValue = Number(input.value);
            output.value = `${Number(nextValue.toFixed(2))}${suffix}`;
            onChange(nextValue);
          });
          row.append(title, input, output);
          target.append(row);
          sliderControls.push({ input, output, suffix });
        };

        const positionMin = index === 1 ? -size.y / 2 : -planeRadius;
        const positionMax = index === 1 ? size.y / 2 : planeRadius;
        const positionStep = (positionMax - positionMin) / 100;
        addSlider(
          english ? "Position" : "Position",
          positionMin,
          positionMax,
          positionStep,
          initialPlanePosition,
          (value) => {
            settings.position = value;
            updatePlane();
          },
          " m",
          panel,
          true,
        );
        const advanced = document.createElement("details");
        advanced.className = "cut-plane-advanced";
        const advancedSummary = document.createElement("summary");
        advancedSummary.textContent = english ? "Advanced" : "Avancé";
        const rotationControls = document.createElement("div");
        rotationControls.className = "cut-plane-rotation";
        settings.rotation.forEach((value, axis) => {
          addSlider(
            `${english ? "Rotation" : "Rotation"} ${axisLabels[axis]}`,
            -180,
            180,
            1,
            value,
            (nextValue) => {
              settings.rotation[axis] = nextValue;
              updatePlane();
            },
            "°",
            rotationControls,
          );
        });
        advanced.append(advancedSummary, rotationControls);
        panel.append(advanced);

        cutControls.append(panel);
        updatePlane(false);
        planeStates.push({ enabledInput, settings, sliderControls, updatePlane, planeHelper });
      });
      cutControls.hidden = false;
      resetButton.addEventListener("click", () => {
        planeStates.forEach(({ enabledInput, settings, sliderControls, updatePlane }, index) => {
          enabledInput.checked = false;
          settings.position = index === 1 ? size.y / 2 : 0;
          settings.rotation.fill(0);
          sliderControls.forEach(({ input, output, suffix }, sliderIndex) => {
            const value = sliderIndex === 0 ? settings.position : 0;
            input.value = String(value);
            output.value = `${Number(value.toFixed(2))}${suffix}`;
          });
          updatePlane(false);
        });
      });

      const distance = maxDimension * 3.5;
      const initialPosition = new THREE.Vector3(distance, distance * 0.72, distance);
      camera.position.copy(initialPosition);
      camera.near = maxDimension / 1000;
      camera.far = maxDimension * 20;
      camera.updateProjectionMatrix();
      controls.minDistance = maxDimension * 0.08;
      controls.maxDistance = maxDimension * 12;
      controls.target.set(0, 0, 0);
      controls.update();
      controls.saveState();
      updateOrientationCube();
      status.remove();
    },
    (error) => {
      console.error("Could not load the 3D model.", error);
      status.textContent = english
        ? "The 3D model could not be loaded."
        : "Le modèle 3D n’a pas pu être chargé.";
    },
  );

  const render = () => {
    controls.update();
    updateOrientationCube();
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  };
  render();
}

initializeViewer();
