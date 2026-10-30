const viewer = document.querySelector("[data-fbx-viewer]");
async function initializeViewer() {
  if (!viewer) return;
  const stage = viewer.querySelector("[data-model-stage]");
  const source = viewer.querySelector("[data-model-src]").dataset.modelSrc;
  const status = stage.querySelector(".model-status");
  const resetButton = viewer.querySelector("[data-model-reset]");
  const cutControls = viewer.querySelector("[data-model-cut-controls]");
  const orientationControl = viewer.querySelector("[data-model-orientation]");
  const english = document.documentElement.lang === "en";
  let THREE;
  let FBXLoader;
  let OrbitControls;
  try {
    [THREE, { FBXLoader }, { OrbitControls }] = await Promise.all([
      import("three"),
      import("three/addons/loaders/FBXLoader.js"),
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
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100000);
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

  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
  keyLight.position.set(1, 2, 3);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
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
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();

  let updateOrientationCube = () => {};
  const loader = new FBXLoader();
  loader.load(
    source,
    (model) => {
      model.traverse((part) => {
        if (!part.isMesh) return;
        part.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72 });
        part.castShadow = true;
        part.receiveShadow = true;
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

      const centeredModel = new THREE.Group();
      centeredModel.position.copy(center).negate();
      scene.add(centeredModel);

      const planeRadius = size.length() / 2;
      const rotation = new THREE.Euler();
      const planeDefinitions = [
        { normal: new THREE.Vector3(1, 0, 0), enabled: true },
        { normal: new THREE.Vector3(0, 1, 0), enabled: false },
        { normal: new THREE.Vector3(0, 0, 1), enabled: false },
      ];
      const clippingPlanes = planeDefinitions.map(({ normal }) => new THREE.Plane(normal.clone(), 0));
      const material = new THREE.MeshStandardMaterial({
        color: 0xeee2ca,
        roughness: 0.78,
        clippingPlanes,
      });
      model.traverse((part) => {
        if (!part.isMesh) return;
        part.material = material;
        part.castShadow = true;
        part.receiveShadow = true;
      });
      centeredModel.add(model);

      const axisLabels = ["X", "Y", "Z"];
      const planeGeometry = new THREE.PlaneGeometry(planeRadius * 2.15, planeRadius * 2.15);
      const planeHelpers = planeDefinitions.map(() => {
        const group = new THREE.Group();
        const surface = new THREE.Mesh(
          planeGeometry,
          new THREE.MeshBasicMaterial({
            color: 0x10a9df,
            transparent: true,
            opacity: 0.16,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false,
          }),
        );
        surface.renderOrder = 5;
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(planeGeometry),
          new THREE.LineBasicMaterial({ color: 0x075779, transparent: true, opacity: 0.72, depthTest: false }),
        );
        outline.renderOrder = 6;
        group.add(surface, outline);
        group.visible = false;
        scene.add(group);
        return { group, hideTimer: 0 };
      });
      const orientationSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      orientationSvg.setAttribute("viewBox", "0 0 100 100");
      orientationSvg.setAttribute("role", "group");
      orientationSvg.setAttribute("aria-label", english ? "View orientation" : "Orientation de la vue");
      const orientationFaces = [
        { axis: "x", sign: 1, vertices: [1, 3, 7, 5], name: english ? "Right" : "Droite" },
        { axis: "x", sign: -1, vertices: [0, 4, 6, 2], name: english ? "Left" : "Gauche" },
        { axis: "y", sign: 1, vertices: [2, 6, 7, 3], name: english ? "Top" : "Dessus" },
        { axis: "y", sign: -1, vertices: [0, 1, 5, 4], name: english ? "Bottom" : "Dessous" },
        { axis: "z", sign: 1, vertices: [4, 5, 7, 6], name: english ? "Front" : "Avant" },
        { axis: "z", sign: -1, vertices: [0, 2, 3, 1], name: english ? "Back" : "Arrière" },
      ];
      const cubeVertices = [
        new THREE.Vector3(-1, -1, -1),
        new THREE.Vector3(1, -1, -1),
        new THREE.Vector3(-1, 1, -1),
        new THREE.Vector3(1, 1, -1),
        new THREE.Vector3(-1, -1, 1),
        new THREE.Vector3(1, -1, 1),
        new THREE.Vector3(-1, 1, 1),
        new THREE.Vector3(1, 1, 1),
      ];
      const setCameraDirection = (direction, up = new THREE.Vector3(0, 1, 0)) => {
        const distance = camera.position.distanceTo(controls.target);
        camera.position.copy(controls.target).addScaledVector(direction.clone().normalize(), distance);
        camera.up.copy(up);
        camera.lookAt(controls.target);
        controls.update();
      };
      const makeViewTarget = (element, label, setView) => {
        element.setAttribute("role", "button");
        element.setAttribute("tabindex", "0");
        element.setAttribute("aria-label", label);
        element.style.display = "none";
        element.addEventListener("click", setView);
        element.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          setView();
        });
      };
      const faceElements = orientationFaces.map((face) => {
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const faceKey = `${face.sign > 0 ? "+" : "-"}${face.axis}`;
        group.setAttribute("data-view", faceKey);
        makeViewTarget(
          group,
          english ? `View from ${face.name}` : `Vue ${face.name.toLowerCase()}`,
          () => {
            const direction = new THREE.Vector3();
            direction[face.axis] = face.sign;
            const up = face.axis === "y"
              ? new THREE.Vector3(0, 0, face.sign > 0 ? -1 : 1)
              : new THREE.Vector3(0, 1, 0);
            setCameraDirection(direction, up);
          },
        );
        const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.textContent = face.name.toUpperCase();
        group.append(polygon, label);
        orientationSvg.append(group);
        return { face, polygon, label };
      });
      const edgePairs = [];
      for (let first = 0; first < cubeVertices.length; first += 1) {
        for (let second = first + 1; second < cubeVertices.length; second += 1) {
          const differences = ["x", "y", "z"].filter((axis) => cubeVertices[first][axis] !== cubeVertices[second][axis]);
          if (differences.length === 1) edgePairs.push([first, second]);
        }
      }
      const edgeElements = edgePairs.map(([first, second], index) => {
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("data-edge", String(index + 1));
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        group.append(line);
        const direction = cubeVertices[first].clone().add(cubeVertices[second]);
        makeViewTarget(
          group,
          english ? "Diagonal view" : "Vue diagonale",
          () => setCameraDirection(direction),
        );
        orientationSvg.append(group);
        return { first, second, group, line };
      });
      const cornerElements = cubeVertices.map((vertex, index) => {
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const key = `${vertex.x > 0 ? "+" : "-"}${vertex.y > 0 ? "+" : "-"}${vertex.z > 0 ? "+" : "-"}`;
        group.setAttribute("data-corner", key);
        const point = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        point.setAttribute("r", "6");
        group.append(point);
        makeViewTarget(
          group,
          english ? "Axonometric view" : "Vue axonométrique",
          () => setCameraDirection(vertex),
        );
        orientationSvg.append(group);
        return { vertex, group, point, index };
      });
      const projected = new THREE.Vector3();
      const inverseCameraRotation = new THREE.Quaternion();
      const projectCubePoint = (vertex) => {
        projected.copy(vertex).applyQuaternion(inverseCameraRotation);
        return { x: 50 + projected.x * 23, y: 50 - projected.y * 23, z: projected.z };
      };
      updateOrientationCube = () => {
        camera.updateMatrixWorld();
        inverseCameraRotation.copy(camera.quaternion).invert();
        faceElements.forEach(({ polygon, label }) => {
          polygon.parentElement.style.display = "none";
          polygon.parentElement.removeAttribute("aria-hidden");
          polygon.removeAttribute("points");
          label.removeAttribute("x");
          label.removeAttribute("y");
        });
        edgeElements.forEach(({ group }) => {
          group.style.display = "none";
          group.removeAttribute("aria-hidden");
        });
        cornerElements.forEach(({ group }) => {
          group.style.display = "none";
          group.removeAttribute("aria-hidden");
        });
        const visibleFaces = faceElements
          .map(({ face, polygon, label }) => {
            const normal = new THREE.Vector3();
            normal[face.axis] = face.sign;
            normal.applyQuaternion(inverseCameraRotation);
            const points = face.vertices.map((vertexIndex) => projectCubePoint(cubeVertices[vertexIndex]));
            const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
            const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
            const depth = points.reduce((sum, point) => sum + point.z, 0) / points.length;
            return { face, polygon, label, normal, points, centerX, centerY, depth };
          })
          .filter((face) => face.normal.z > 0.001)
          .sort((a, b) => a.depth - b.depth);

        visibleFaces.forEach(({ face, polygon, label, points, centerX, centerY }) => {
          polygon.parentElement.style.display = "";
          polygon.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
          label.setAttribute("x", String(centerX));
          label.setAttribute("y", String(centerY));
          orientationSvg.append(polygon.parentElement);
        });

        edgeElements.forEach(({ first, second, group, line }) => {
          const visibleOnFace = visibleFaces.some(({ face }) =>
            face.vertices.includes(first) && face.vertices.includes(second));
          if (!visibleOnFace) return;
          const start = projectCubePoint(cubeVertices[first]);
          const end = projectCubePoint(cubeVertices[second]);
          group.style.display = "";
          line.setAttribute("x1", String(start.x));
          line.setAttribute("y1", String(start.y));
          line.setAttribute("x2", String(end.x));
          line.setAttribute("y2", String(end.y));
          orientationSvg.append(group);
        });
        const visibleCorners = cornerElements
          .map((corner) => ({ ...corner, position: projectCubePoint(corner.vertex) }))
          .filter((corner) => corner.position.z > 0.001)
          .sort((a, b) => a.position.z - b.position.z);
        visibleCorners.forEach(({ group, point, position }) => {
          group.style.display = "";
          point.setAttribute("cx", String(position.x));
          point.setAttribute("cy", String(position.y));
          orientationSvg.append(group);
        });
      };
      orientationControl.replaceChildren(orientationSvg);
      orientationControl.hidden = false;

      const planeStates = [];
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

        const settings = { position: 0, rotation: [0, 0, 0] };
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
          clippingPlanes[index].normal.copy(definition.normal).applyEuler(rotation).normalize();
          clippingPlanes[index].constant = enabledInput.checked
            ? -settings.position
            : planeRadius * 2;
          planeHelper.group.position.copy(clippingPlanes[index].normal).multiplyScalar(settings.position + 0.025);
          planeHelper.group.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            clippingPlanes[index].normal,
          );
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

        addSlider(english ? "Position" : "Position", -planeRadius, planeRadius, planeRadius / 100, 0, (value) => {
          settings.position = value;
          updatePlane();
        }, " m", panel, true);
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
        rotation.set(...settings.rotation.map((degrees) => THREE.MathUtils.degToRad(degrees)));
        clippingPlanes[index].normal.copy(definition.normal).applyEuler(rotation).normalize();
        clippingPlanes[index].constant = enabledInput.checked ? -settings.position : planeRadius * 2;
        planeHelper.group.position.copy(clippingPlanes[index].normal).multiplyScalar(settings.position + 0.025);
        planeHelper.group.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          clippingPlanes[index].normal,
        );
        planeStates.push({ enabledInput, settings, sliderControls, updatePlane, planeHelper });
      });
      cutControls.hidden = false;
      resetButton.addEventListener("click", () => {
        planeStates.forEach(({ enabledInput, settings, sliderControls, updatePlane, planeHelper }) => {
          enabledInput.checked = false;
          settings.position = 0;
          settings.rotation.fill(0);
          sliderControls.forEach(({ input, output, suffix }) => {
            input.value = "0";
            output.value = `0${suffix}`;
          });
          updatePlane(false);
        });
      });

      const distance = (maxDimension / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.3;
      const initialPosition = new THREE.Vector3(distance, distance * 0.72, distance);
      camera.position.copy(initialPosition);
      camera.near = maxDimension / 1000;
      camera.far = maxDimension * 100;
      camera.updateProjectionMatrix();
      controls.minDistance = maxDimension * 0.08;
      controls.maxDistance = maxDimension * 12;
      controls.target.set(0, 0, 0);
      controls.update();
      controls.saveState();
      status.remove();
    },
    undefined,
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
