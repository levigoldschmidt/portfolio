const viewer = document.querySelector("[data-fbx-viewer]");
async function initializeViewer() {
  if (!viewer) return;
  const stage = viewer.querySelector("[data-model-stage]");
  const source = viewer.querySelector("[data-model-src]").dataset.modelSrc;
  const orientationSource = viewer.querySelector("[data-model-orientation]").dataset.modelOrientationSrc;
  const status = stage.querySelector(".model-status");
  const resetButton = viewer.querySelector("[data-model-reset]");
  const cutControls = viewer.querySelector("[data-model-cut-controls]");
  const orientationControl = viewer.querySelector("[data-model-orientation]");
  const english = document.documentElement.lang === "en";
  let THREE;
  let FBXLoader;
  let GLTFLoader;
  let OrbitControls;
  try {
    [THREE, { FBXLoader }, { GLTFLoader }, { OrbitControls }] = await Promise.all([
      import("three"),
      import("three/addons/loaders/FBXLoader.js"),
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

      cameraFrustumHeight = maxDimension * 1.7;
      resize();

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
      const setCameraDirection = (direction, up = new THREE.Vector3(0, 1, 0)) => {
        const distance = camera.position.distanceTo(controls.target);
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

          const highlightMaterial = new THREE.MeshBasicMaterial({
            color: 0x42a9d2,
            transparent: true,
            opacity: 0.68,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const highlight = new THREE.Mesh(
            new THREE.PlaneGeometry(faceSize, faceSize),
            highlightMaterial,
          );
          highlight.visible = false;
          highlight.renderOrder = 2;
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
          setSelectedFace = (face) => {
            selectedFaceKey = `${face.sign > 0 ? "+" : "-"}${face.axis}`;
            selectedFacePosition.set(0, 0, 0).addScaledVector(
              face.localNormal,
              orientationHalfExtents[face.localNormal.x ? "x" : face.localNormal.y ? "y" : "z"] + 0.00004,
            );
            highlight.position.copy(selectedFacePosition);
            selectedFaceRotation.setFromUnitVectors(new THREE.Vector3(0, 0, 1), face.localNormal);
            highlight.quaternion.copy(selectedFaceRotation);
            highlight.visible = true;
          };
          const orientToSurface = (event) => {
            if (event.button !== 0) return;
            const rect = orientationRenderer.domElement.getBoundingClientRect();
            orientationPointer.set(
              ((event.clientX - rect.left) / rect.width) * 2 - 1,
              -((event.clientY - rect.top) / rect.height) * 2 + 1,
            );
            orientationRaycaster.setFromCamera(orientationPointer, orientationCamera);
            const hits = orientationRaycaster.intersectObject(orientationModel, true);
            if (!hits.length) return;
            const localNormal = hits[0].face.normal.clone();
            const worldNormal = localNormal.clone().transformDirection(hits[0].object.matrixWorld);
            orientationInverse.copy(orientationRoot.quaternion).invert();
            localNormal.copy(worldNormal).applyQuaternion(orientationInverse).normalize();
            const dominantAxis = ["x", "y", "z"].reduce((best, axis) =>
              Math.abs(localNormal[axis]) > Math.abs(localNormal[best]) ? axis : best, "x");
            if (Math.abs(localNormal[dominantAxis]) > 0.96) {
              const worldDirection = localNormal.clone().applyQuaternion(orientationRoot.quaternion);
              const axis = ["x", "y", "z"].reduce((best, candidate) =>
                Math.abs(worldDirection[candidate]) > Math.abs(worldDirection[best]) ? candidate : best, "x");
              const face = orientationFacesByWorldAxis.find((candidate) =>
                candidate.axis === axis && candidate.sign === Math.sign(worldDirection[axis]));
              if (!face) return;
              setSelectedFace(face);
              const direction = new THREE.Vector3();
              direction[face.axis] = face.sign;
              const up = face.axis === "y"
                ? new THREE.Vector3(0, 0, face.sign > 0 ? -1 : 1)
                : new THREE.Vector3(0, 1, 0);
              setCameraDirection(direction, up);
            } else {
              selectedFaceKey = null;
              highlight.visible = false;
              setCameraDirection(worldNormal);
            }
            updateOrientationCube();
          };
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
        undefined,
        (error) => {
          console.error("Could not load the orientation GLTF.", error);
          orientationControl.setAttribute("aria-label", english
            ? "The orientation cube could not be loaded."
            : "Le cube d’orientation n’a pas pu être chargé.");
        },
      );

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

      const distance = maxDimension * 3.5;
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
      updateOrientationCube();
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
