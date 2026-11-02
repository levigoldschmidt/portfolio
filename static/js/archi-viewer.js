// Default cut planes (used when the viewer config defines none): X, Y (flipped, bounded by the model height) and Z.
const DEFAULT_CUT_PLANES = [
  { normal: [1, 0, 0] },
  { normal: [0, 1, 0], flip: true, range: "bounds", position: "max" },
  { normal: [0, 0, 1] },
];

function readViewerConfig(viewer) {
  const raw = viewer.dataset.viewerConfig;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error("Invalid archi-viewer configuration.", error);
    return {};
  }
}

async function initializeViewer(viewer) {
  const viewerConfig = readViewerConfig(viewer);
  const stage = viewer.querySelector("[data-model-stage]");
  const sources = [...viewer.querySelectorAll("[data-model-src]")].map((element) => ({
    src: element.dataset.modelSrc,
    label: element.dataset.modelLabel || "",
    context: element.dataset.modelType === "environment" || element.dataset.modelContext === "true",
  }));
  const urban = typeof viewerConfig.urban === "boolean" ? viewerConfig.urban : sources.length > 1;
  const modelScale = Number(viewer.querySelector("[data-model-scale]")?.dataset.modelScale || 1);
  const orientationSource = viewer.querySelector("[data-model-orientation]").dataset.modelOrientationSrc;
  const status = stage.querySelector(".model-status");
  const resetButton = viewer.querySelector("[data-model-reset]");
  const fullscreenButton = viewer.querySelector("[data-model-fullscreen]");
  const fullscreenStatus = viewer.querySelector("[data-model-fullscreen-status]");
  const cutControls = viewer.querySelector("[data-model-cut-controls]");
  const settingsPanel = viewer.querySelector("[data-model-settings-panel]");
  const settingsToggle = viewer.querySelector("[data-model-settings-toggle]");
  const orientationControl = viewer.querySelector("[data-model-orientation]");
  const english = document.documentElement.lang === "en";
  settingsToggle.addEventListener("click", () => {
    const isExpanded = settingsToggle.getAttribute("aria-expanded") === "true";
    settingsToggle.setAttribute("aria-expanded", String(!isExpanded));
    settingsPanel.hidden = isExpanded;
  });
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
  let EffectComposer;
  let RenderPass;
  let SSAOPass;
  let OutputPass;
  try {
    [
      THREE,
      { FBXLoader },
      { OBJLoader },
      { GLTFLoader },
      { OrbitControls },
      { EffectComposer },
      { RenderPass },
      { SSAOPass },
      { OutputPass },
    ] = await Promise.all([
      import("three"),
      import("three/addons/loaders/FBXLoader.js"),
      import("three/addons/loaders/OBJLoader.js"),
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/controls/OrbitControls.js"),
      import("three/addons/postprocessing/EffectComposer.js"),
      import("three/addons/postprocessing/RenderPass.js"),
      import("three/addons/postprocessing/SSAOPass.js"),
      import("three/addons/postprocessing/OutputPass.js"),
    ]);
  } catch (error) {
    console.error("Could not load the 3D viewer libraries.", error);
    status.textContent = english
      ? "3D viewing is not available in this browser."
      : "La visualisation 3D n’est pas disponible dans ce navigateur.";
    return;
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#ffffff");
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
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = urban ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  stage.append(renderer.domElement);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const ssaoPass = new SSAOPass(scene, camera, stage.clientWidth || 1, stage.clientHeight || 1);
  ssaoPass.kernelRadius = 1.2;
  ssaoPass.ssaoMaterial.defines.PERSPECTIVE_CAMERA = 0;
  ssaoPass.depthRenderMaterial.defines.PERSPECTIVE_CAMERA = 0;
  const ssaoIntensity = 1.5;
  const aoOutputExpression = "vec3( 1.0 - occlusion )";
  if (!ssaoPass.ssaoMaterial.fragmentShader.includes(aoOutputExpression)) {
    throw new Error("The Three.js SSAO shader output could not be configured.");
  }
  ssaoPass.ssaoMaterial.fragmentShader = ssaoPass.ssaoMaterial.fragmentShader.replace(
    aoOutputExpression,
    `vec3( pow( 1.0 - occlusion, ${ssaoIntensity} ) )`,
  );
  ssaoPass.ssaoMaterial.needsUpdate = true;
  composer.addPass(ssaoPass);
  composer.addPass(new OutputPass());

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const keyLight = new THREE.DirectionalLight(0xffffff, urban ? 1.1 : 1.15);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(urban ? 4096 : 2048, urban ? 4096 : 2048);
  keyLight.shadow.bias = -0.0001;
  keyLight.shadow.normalBias = 0.02;
  keyLight.shadow.radius = urban ? 1 : 4;
  scene.add(keyLight);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.target.set(0, 0, 0);
  if (urban) {
    // Le défilement de la page reste prioritaire : zoom à la molette avec Ctrl/⌘ (ou en plein écran), glissement vertical à un doigt = défilement.
    const wheelHint = document.createElement("p");
    wheelHint.className = "model-wheel-hint";
    wheelHint.textContent = english ? "Use Ctrl + scroll to zoom" : "Ctrl + molette pour zoomer";
    wheelHint.hidden = true;
    stage.append(wheelHint);
    let hintTimer = 0;
    renderer.domElement.addEventListener("wheel", (event) => {
      const allowed = event.ctrlKey || event.metaKey || document.fullscreenElement === viewer;
      controls.enableZoom = allowed;
      window.setTimeout(() => { controls.enableZoom = true; }, 0);
      if (!allowed) {
        wheelHint.hidden = false;
        window.clearTimeout(hintTimer);
        hintTimer = window.setTimeout(() => { wheelHint.hidden = true; }, 1200);
      }
    }, { capture: true, passive: true });
    stage.classList.add("model-stage-scrollable");
  }

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
    composer.setSize(width, height);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();

  let updateOrientationCube = () => {};
  const loadSingleModel = (source, onLoad, onError) => {
    const extension = source.toLowerCase().split("?")[0].split(".").pop();
    if (extension === "obj") {
      const objLoader = new OBJLoader();
      new THREE.FileLoader().setResponseType("text").load(
        source,
        (text) => {
          try {
            onLoad(objLoader.parse(text.replace(/^\s*(?:trace_obj|shadow_obj)\b.*$/gm, "")));
          } catch (error) {
            onError(error);
          }
        },
        undefined,
        onError,
      );
    } else if (extension === "gltf" || extension === "glb") {
      new GLTFLoader().load(source, (gltf) => onLoad(gltf.scene), undefined, onError);
    } else {
      new FBXLoader().load(source, onLoad, undefined, onError);
    }
  };
  const modelLayers = [];
  // Téléphone en portrait ou en paysage : le panneau n'est pas posé sur la scène avec une hauteur imposée.
  const sidePanelDocked = window.matchMedia(
    "(max-width: 700px) and (orientation: portrait), (orientation: landscape) and (max-height: 500px)",
  );
  const loadModel = (onLoad, onError) => {
    const root = new THREE.Group();
    const loaded = new Array(sources.length);
    let remaining = sources.length;
    let failed = false;
    sources.forEach((entry, index) => {
      loadSingleModel(
        entry.src,
        (object) => {
          loaded[index] = object;
          remaining -= 1;
          if (remaining === 0 && !failed) {
            loaded.forEach((layer, layerIndex) => {
              layer.name = sources[layerIndex].label || layer.name;
              root.add(layer);
              modelLayers.push({ object: layer, label: sources[layerIndex].label || `Modèle ${layerIndex + 1}`, context: sources[layerIndex].context });
            });
            onLoad(root);
          }
        },
        (error) => {
          if (failed) return;
          failed = true;
          onError(error);
        },
      );
    });
  };  loadModel(
    (model) => {
      if (!Number.isFinite(modelScale) || modelScale <= 0) {
        console.error("The 3D model scale must be a positive finite number.");
        status.textContent = english
          ? "The 3D model could not be loaded."
          : "Le modèle 3D n’a pas pu être chargé.";
        return;
      }
      model.scale.setScalar(modelScale);

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

      cameraFrustumHeight = maxDimension * 0.84;
      resize();
      const lightDistance = maxDimension * 2;
      if (urban) {
        // Soleil à 45° d'azimut et 45° d'altitude
        keyLight.position.set(lightDistance * 0.5, lightDistance * Math.SQRT1_2, lightDistance * 0.5);
      } else {
        keyLight.position.set(lightDistance, lightDistance * 1.5, lightDistance);
      }
      const shadowExtent = maxDimension * (urban ? 0.75 : 2);
      keyLight.shadow.camera.left = -shadowExtent;
      keyLight.shadow.camera.right = shadowExtent;
      keyLight.shadow.camera.top = shadowExtent;
      keyLight.shadow.camera.bottom = -shadowExtent;
      keyLight.shadow.camera.near = 0.1;
      keyLight.shadow.camera.far = maxDimension * 8;
      keyLight.shadow.camera.updateProjectionMatrix();

      const centeredModel = new THREE.Group();
      centeredModel.position.copy(center).negate();
      scene.add(centeredModel);
      const shadowGround = new THREE.Mesh(
        new THREE.PlaneGeometry(
          Math.max(size.x * 4, maxDimension * 4),
          Math.max(size.z * 4, maxDimension * 4),
        ),
        new THREE.ShadowMaterial({ color: 0x808590, opacity: 0.2 }),
      );
      shadowGround.rotation.x = -Math.PI / 2;
      shadowGround.position.y = -size.y / 2 - maxDimension * 1e-4;
      shadowGround.receiveShadow = true;
      shadowGround.renderOrder = 1;
      scene.add(shadowGround);
      const planeRadius = size.length() / 2;
      const rotation = new THREE.Euler();
      const cutPlaneConfigs = Array.isArray(viewerConfig.cut_planes) ? viewerConfig.cut_planes : DEFAULT_CUT_PLANES;
      const planeDefinitions = cutPlaneConfigs.map((config) => {
        const matrix = new THREE.Matrix4();
        if (Array.isArray(config.matrix) && config.matrix.length === 16) matrix.fromArray(config.matrix);
        const origin = new THREE.Vector3().setFromMatrixPosition(matrix);
        const normal = new THREE.Vector3(...(config.normal || [0, 0, 1]))
          .transformDirection(matrix);
        const flip = config.flip ? -1 : 1;
        // Half extent of the model's bounding box projected on the plane normal.
        const boundsHalf = (Math.abs(normal.x) * size.x + Math.abs(normal.y) * size.y + Math.abs(normal.z) * size.z) / 2;
        const offset = origin.dot(normal);
        let range = [-planeRadius, planeRadius];
        if (Array.isArray(config.range) && config.range.length === 2) {
          range = config.range.map(Number);
        } else if (config.range === "bounds") {
          range = [-boundsHalf - offset, boundsHalf - offset];
        }
        let position = 0;
        if (config.position === "max") position = range[1];
        else if (config.position === "min") position = range[0];
        else if (Number.isFinite(Number(config.position))) position = Number(config.position);
        return {
          label: config.label || "",
          normal,
          origin,
          clipSign: flip,
          enabled: Boolean(config.enabled),
          range,
          position,
          presets: (config.presets || []).map((preset) => {
            const value = typeof preset === "number" ? preset : Number(preset.value);
            const label = typeof preset === "object" && preset.label ? preset.label : `${value} m`;
            return { value, label };
          }).filter(({ value }) => Number.isFinite(value)),
        };
      });
      const clippingPlanes = planeDefinitions.map(({ normal }) => new THREE.Plane(normal.clone(), 0));
      const clayMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.2,
        roughness: 0.95,
        side: THREE.FrontSide,
        clippingPlanes,
      });
      clayMaterial.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
          vec3 worldNormal = normalize(transpose(mat3(viewMatrix)) * normal);
          float horizontalFace = smoothstep(0.55, 0.75, abs(worldNormal.y));
          diffuseColor.rgb *= mix(vec3(0.823), vec3(1.0), horizontalFace);`,
        );
      };
      clayMaterial.customProgramCacheKey = () => "architectural-clay";
      const interiorMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.2,
        roughness: 0.85,
        side: THREE.FrontSide,
        clippingPlanes,
      });
      const whiteMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.15,
        roughness: 0.9,
        side: THREE.FrontSide,
        clippingPlanes,
      });
      const glazingMaterial = new THREE.MeshStandardMaterial({
        color: 0xe0e8f0,
        transparent: true,
        opacity: 0.25,
        roughness: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
        clippingPlanes,
      });
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0x555555,
        transparent: true,
        opacity: 0.28,
        clippingPlanes,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const interiorName = /(MOBILIER|MEUBLE|EQUIPEMENT|CUISINE|SANITAIRE|INTERIEUR|INTERIOR|FURNITURE|CABINET)/i;
      const glassName = /(VERRE|VITRAGE|BAIE|FENETRE|FENÊTRE|WINDOW|GLASS)/i;
      const whiteStructureName = /(STRUCTURE|POTEAU|POUTRE|ESCALIER|01_PORTEUR.*BOIS)/i;
      const whiteFloorName = /(DALLE|PLANCHER|TOITURE|TOIT|ROOF|SLAB|FLOOR)/i;
      const contextMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.35,
        roughness: 0.95,
        side: THREE.FrontSide,
        flatShading: true,
        clippingPlanes,
      });
      contextMaterial.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
          vec3 worldNormal = normalize(transpose(mat3(viewMatrix)) * normal);
          float horizontalFace = smoothstep(0.55, 0.75, abs(worldNormal.y));
          diffuseColor.rgb *= mix(vec3(0.918), vec3(1.0), horizontalFace);`,
        );
      };
      contextMaterial.customProgramCacheKey = () => "urban-context-clay";
      const contextEdgeMaterial = new THREE.LineBasicMaterial({
        color: 0x666666,
        transparent: true,
        opacity: 0.18,
        clippingPlanes,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const contextObjects = modelLayers.filter((layer) => layer.context).map((layer) => layer.object);
      const isContextPart = (part) => contextObjects.some((object) => {
        for (let node = part; node; node = node.parent) if (node === object) return true;
        return false;
      });
      if (urban) {
        [clayMaterial, interiorMaterial, whiteMaterial].forEach((material) => {
          material.flatShading = true;
        });
      }
      model.traverse((part) => {
        if (!part.isMesh) return;
        const isContext = urban && isContextPart(part);
        const isDimensionGeometry = /00_COTATION|COTATION|DIMENSION/i.test(part.name);
        if (isContext) {
          part.material = contextMaterial;
        } else if (!isDimensionGeometry && glassName.test(part.name)) {
          part.material = glazingMaterial;
        } else if (interiorName.test(part.name)) {
          part.material = interiorMaterial;
        } else if (whiteStructureName.test(part.name) || whiteFloorName.test(part.name)) {
          part.material = whiteMaterial;
        } else {
          part.material = clayMaterial;
        }
        part.castShadow = !isDimensionGeometry;
        part.receiveShadow = !isDimensionGeometry;
        if (!isDimensionGeometry) {
          const edgeGeometry = new THREE.EdgesGeometry(part.geometry, 25);
          const edges = new THREE.LineSegments(edgeGeometry, isContext ? contextEdgeMaterial : edgeMaterial);
          edges.name = "Architectural edges";
          edges.renderOrder = 2;
          part.add(edges);
        }
      });
      centeredModel.add(model);

      const lockMessage = english
        ? "Section planes are available once the environment is hidden."
        : "Les plans de coupe sont disponibles lorsque l’environnement est masqué.";
      let cutAllowed = true;
      // The Paramètres section (toggle, or tree when relocated in the side panel) to hide while an environment is shown.
      let settingsContainer = null;
      function updateCutAvailability() {
        cutAllowed = !modelLayers.some((layer) => layer.context && layer.object.visible);
        cutControls.toggleAttribute("data-cut-locked", !cutAllowed);
        cutControls.title = cutAllowed ? "" : lockMessage;
        const settingsHost = settingsContainer || settingsToggle;
        settingsHost.hidden = !cutAllowed;
        if (!settingsContainer) settingsPanel.hidden = !cutAllowed || settingsToggle.getAttribute("aria-expanded") !== "true";
        planeStates.forEach((state) => state.updatePlane(false));
      }
      const layerTree = document.createElement("details");
      layerTree.className = "model-layer-tree";
      layerTree.open = true;
      const layerTreeSummary = document.createElement("summary");
      layerTreeSummary.textContent = english ? "Model tree" : "Arborescence";
      const layerList = document.createElement("ul");
      modelLayers.forEach(({ object, label, context: isEnvironment }, index) => {
        const item = document.createElement("li");
        const row = document.createElement("div");
        row.className = "model-layer-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        // L'environnement est masqué au chargement : la vue initiale cadre le bâtiment seul.
        checkbox.checked = !isEnvironment;
        object.visible = checkbox.checked;
        checkbox.id = `model-layer-${index}`;
        checkbox.setAttribute("aria-label", label);
        checkbox.addEventListener("change", () => {
          object.visible = checkbox.checked;
          updateCutAvailability();
          if (isEnvironment) frameView(true, false);
        });
        const focusButton = document.createElement("button");
        focusButton.type = "button";
        focusButton.className = "model-layer-focus";
        focusButton.textContent = label;
        focusButton.title = english ? "Zoom on this element" : "Zoomer sur cet élément";
        focusButton.addEventListener("click", () => {
          const layerBounds = new THREE.Box3().setFromObject(object);
          if (layerBounds.isEmpty()) return;
          const layerCenter = layerBounds.getCenter(new THREE.Vector3());
          const layerExtent = layerBounds.getSize(new THREE.Vector3()).length() * 0.85;
          const offset = camera.position.clone().sub(controls.target);
          controls.target.copy(layerCenter);
          camera.position.copy(layerCenter).add(offset);
          camera.zoom = Math.max(0.1, cameraFrustumHeight / layerExtent);
          camera.updateProjectionMatrix();
          controls.update();
          updateOrientationCube();
        });
        row.append(checkbox, focusButton);
        item.append(row);
        layerList.append(item);
      });
      layerTree.append(layerTreeSummary, layerList);
      if (modelLayers.length > 1) {
        const sidePanel = document.createElement("div");
        sidePanel.className = "model-side-panel";
        const actions = viewer.querySelector(".model-control-actions");
        const settings = viewer.querySelector("[data-model-settings-panel]");
        settingsToggle.remove();
        settings.hidden = false;
        const settingsTree = document.createElement("details");
        settingsTree.className = "model-layer-tree model-settings-tree";
        const settingsSummary = document.createElement("summary");
        settingsSummary.textContent = english ? "Settings" : "Paramètres";
        settingsTree.append(settingsSummary, settings);
        settingsContainer = settingsTree;
        sidePanel.append(layerTree, settingsTree, actions);
        viewer.querySelector(".model-controls")?.classList.add("model-controls-relocated");
        viewer.querySelector(".model-slicing-note")?.remove();
        viewer.append(sidePanel);
        // La page s'agrandit plutôt que d'ajouter une barre de défilement.
        const fitStage = () => {
          if (document.fullscreenElement === viewer || sidePanelDocked.matches) {
            stage.style.minHeight = "";
            return;
          }
          stage.style.minHeight = `${Math.max(360, sidePanel.offsetTop + sidePanel.offsetHeight + 16)}px`;
        };
        new ResizeObserver(fitStage).observe(sidePanel);
        document.addEventListener("fullscreenchange", fitStage);
        sidePanelDocked.addEventListener("change", fitStage);
      }

      const axisLabels = ["X", "Y", "Z"];
      const planeGeometry = new THREE.PlaneGeometry(planeRadius * 2, planeRadius * 2);
      const planeHelpers = planeDefinitions.map(() => {
        const group = new THREE.Group();
        const surface = new THREE.Mesh(
          planeGeometry,
          new THREE.MeshBasicMaterial({
            color: 0x808590,
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
          new THREE.LineBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.25, depthTest: false }),
        );
        outline.renderOrder = 6;
        group.add(surface, outline);
        group.visible = false;
        scene.add(group);
        return { group, hideTimer: 0 };
      });
      let planeStates = [];
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
        const origin = normal.clone().multiplyScalar(-plane.constant);
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

        const projectedPoints = new Map([...pointsByKey].map(([key, point]) => {
          const relative = point.clone().sub(origin);
          return [key, new THREE.Vector2(relative.dot(u), relative.dot(v))];
        }));
        const graphSegments = [];
        graph.forEach((neighbors, key) => {
          neighbors.forEach((neighbor) => {
            if (key < neighbor) graphSegments.push({ start: key, end: neighbor, splits: [] });
          });
        });
        const graphVertices = [...projectedPoints.entries()];
        graphSegments.forEach((segment) => {
          const start = projectedPoints.get(segment.start);
          const direction = projectedPoints.get(segment.end).clone().sub(start);
          const lengthSquared = direction.lengthSq();
          if (lengthSquared <= tolerance * tolerance) return;
          const margin = tolerance / Math.sqrt(lengthSquared);
          graphVertices.forEach(([key, point]) => {
            if (key === segment.start || key === segment.end) return;
            const relative = point.clone().sub(start);
            const t = relative.dot(direction) / lengthSquared;
            if (t <= margin || t >= 1 - margin) return;
            const closest = start.clone().addScaledVector(direction, t);
            if (closest.distanceToSquared(point) <= tolerance * tolerance) {
              segment.splits.push({ key, t });
            }
          });
        });
        const cross2d = (first, second) => first.x * second.y - first.y * second.x;
        graphSegments.forEach((first, firstIndex) => {
          const firstStart = projectedPoints.get(first.start);
          const firstDirection = projectedPoints.get(first.end).clone().sub(firstStart);
          for (let secondIndex = firstIndex + 1; secondIndex < graphSegments.length; secondIndex += 1) {
            const second = graphSegments[secondIndex];
            if (first.start === second.start || first.start === second.end
              || first.end === second.start || first.end === second.end) continue;
            const secondStart = projectedPoints.get(second.start);
            const secondDirection = projectedPoints.get(second.end).clone().sub(secondStart);
            const denominator = cross2d(firstDirection, secondDirection);
            if (Math.abs(denominator) <= tolerance * tolerance) continue;
            const difference = secondStart.clone().sub(firstStart);
            const firstT = cross2d(difference, secondDirection) / denominator;
            const secondT = cross2d(difference, firstDirection) / denominator;
            const firstMargin = tolerance / firstDirection.length();
            const secondMargin = tolerance / secondDirection.length();
            if (firstT <= firstMargin || firstT >= 1 - firstMargin
              || secondT <= secondMargin || secondT >= 1 - secondMargin) continue;
            const projected = firstStart.clone().addScaledVector(firstDirection, firstT);
            const world = origin.clone().addScaledVector(u, projected.x).addScaledVector(v, projected.y);
            const key = pointKey(world);
            if (!pointsByKey.has(key)) pointsByKey.set(key, world);
            projectedPoints.set(key, projected);
            first.splits.push({ key, t: firstT });
            second.splits.push({ key, t: secondT });
          }
        });
        graph.clear();
        pointsByKey.forEach((__, key) => graph.set(key, new Set()));
        edgeKeys.clear();
        const addGraphEdge = (start, end) => {
          if (start === end) return;
          graph.get(start).add(end);
          graph.get(end).add(start);
          edgeKeys.add([start, end].sort().join("|"));
        };
        graphSegments.forEach(({ start, end, splits }) => {
          const orderedNodes = [start, ...splits.sort((first, second) => first.t - second.t)
            .map(({ key }) => key), end];
          for (let index = 0; index < orderedNodes.length - 1; index += 1) {
            addGraphEdge(orderedNodes[index], orderedNodes[index + 1]);
          }
        });
        const fillGraph = new Map([...graph].map(([key, neighbors]) => [key, new Set(neighbors)]));
        const findSegmentIntersections = (startKey, endKey, startPoint, endPoint) => {
          const cross = (first, second) => first.x * second.y - first.y * second.x;
          const direction = endPoint.clone().sub(startPoint);
          const intersections = [];
          for (const [key, neighbors] of graph) {
            for (const neighbor of neighbors) {
              if (key >= neighbor || key === startKey || key === endKey
                || neighbor === startKey || neighbor === endKey) continue;
              const edgeStart = projectedPoints.get(key);
              const edgeEnd = projectedPoints.get(neighbor);
              const edgeDirection = edgeEnd.clone().sub(edgeStart);
              const denominator = cross(direction, edgeDirection);
              if (Math.abs(denominator) <= tolerance * tolerance) continue;
              const difference = edgeStart.clone().sub(startPoint);
              const connectionT = cross(difference, edgeDirection) / denominator;
              const edgeT = cross(difference, direction) / denominator;
              const connectionMargin = tolerance / direction.length();
              const edgeMargin = tolerance / edgeDirection.length();
              if (connectionT <= connectionMargin || connectionT >= 1 - connectionMargin
                || edgeT <= edgeMargin || edgeT >= 1 - edgeMargin) continue;
              intersections.push({
                key,
                neighbor,
                connectionT,
                edgeT,
                point: startPoint.clone().addScaledVector(direction, connectionT),
              });
            }
          }
          return intersections;
        };
        const openingDirection = (key) => {
          const point = projectedPoints.get(key);
          const neighbors = [...graph.get(key)]
            .map((neighbor) => projectedPoints.get(neighbor))
            .map((neighbor) => Math.atan2(neighbor.y - point.y, neighbor.x - point.x))
            .sort((first, second) => first - second);
          if (neighbors.length === 1) {
            return new THREE.Vector2(
              Math.cos(neighbors[0] + Math.PI),
              Math.sin(neighbors[0] + Math.PI),
            );
          }
          let largestGap = -Infinity;
          let direction = 0;
          neighbors.forEach((angle, index) => {
            const nextAngle = index === neighbors.length - 1
              ? neighbors[0] + Math.PI * 2
              : neighbors[index + 1];
            const gap = nextAngle - angle;
            if (gap <= largestGap) return;
            largestGap = gap;
            direction = angle + gap / 2;
          });
          return new THREE.Vector2(Math.cos(direction), Math.sin(direction));
        };
        let unmatchedNodes = [...graph]
          .filter(([, neighbors]) => neighbors.size % 2 === 1)
          .map(([key]) => key);
        const maxClosureGap = maxDimension * 0.15;
        while (unmatchedNodes.length >= 2) {
          let bestConnection = null;
          let bestCrossingConnection = null;
          for (let first = 0; first < unmatchedNodes.length; first += 1) {
            const firstKey = unmatchedNodes[first];
            const firstPoint = projectedPoints.get(firstKey);
            const firstDirection = openingDirection(firstKey);
            for (let second = first + 1; second < unmatchedNodes.length; second += 1) {
              const secondKey = unmatchedNodes[second];
              const isDirectEdge = graph.get(firstKey).has(secondKey);
              const secondPoint = projectedPoints.get(secondKey);
              const connection = secondPoint.clone().sub(firstPoint);
              const distance = connection.length();
              if (distance <= tolerance * 0.01 || distance > maxClosureGap) continue;
              connection.normalize();
              const intersections = isDirectEdge
                ? []
                : findSegmentIntersections(firstKey, secondKey, firstPoint, secondPoint);
              const secondDirection = openingDirection(secondKey);
              const alignment = firstDirection.dot(connection) + secondDirection.dot(connection.clone().negate());
              if (alignment < 1) continue;
              const score = distance + maxDimension * 0.05 * (2 - alignment);
              const candidate = { first, second, firstKey, secondKey, score, intersections, isDirectEdge };
              if (intersections.length) {
                if (!bestCrossingConnection || score < bestCrossingConnection.score) {
                  bestCrossingConnection = candidate;
                }
              } else if (!bestConnection || score < bestConnection.score) {
                bestConnection = candidate;
              }
            }
          }
          bestConnection ||= bestCrossingConnection;
          if (!bestConnection) break;
          const [secondKey] = unmatchedNodes.splice(bestConnection.second, 1);
          const [firstKey] = unmatchedNodes.splice(bestConnection.first, 1);
          if (bestConnection.isDirectEdge) {
            const firstPoint = projectedPoints.get(firstKey);
            const secondPoint = projectedPoints.get(secondKey);
            const midpoint = firstPoint.clone().add(secondPoint).multiplyScalar(0.5);
            const direction = secondPoint.clone().sub(firstPoint).normalize();
            const offset = new THREE.Vector2(-direction.y, direction.x).multiplyScalar(maxDimension * 1e-4);
            const worldPoint = origin.clone().addScaledVector(u, midpoint.x + offset.x)
              .addScaledVector(v, midpoint.y + offset.y);
            const middleKey = pointKey(worldPoint);
            pointsByKey.set(middleKey, worldPoint);
            projectedPoints.set(middleKey, midpoint.add(offset));
            graph.set(middleKey, new Set());
            fillGraph.set(middleKey, new Set());
            const addOffsetEdge = (start, end) => {
              graph.get(start).add(end);
              graph.get(end).add(start);
              fillGraph.get(start).add(end);
              fillGraph.get(end).add(start);
              edgeKeys.add([start, end].sort().join("|"));
            };
            addOffsetEdge(firstKey, middleKey);
            addOffsetEdge(middleKey, secondKey);
            continue;
          }
          const intersectionsByEdge = new Map();
          const connectionNodes = new Map();
          bestConnection.intersections.forEach((intersection) => {
            const worldPoint = origin.clone()
              .addScaledVector(u, intersection.point.x)
              .addScaledVector(v, intersection.point.y);
            const key = pointKey(worldPoint);
            if (!pointsByKey.has(key)) {
              pointsByKey.set(key, worldPoint);
              projectedPoints.set(key, intersection.point);
              graph.set(key, new Set());
              fillGraph.set(key, new Set());
            }
            if (!connectionNodes.has(key)) {
              connectionNodes.set(key, { key, t: intersection.connectionT });
            }
            const edgeId = [intersection.key, intersection.neighbor].sort().join("|");
            if (!intersectionsByEdge.has(edgeId)) {
              intersectionsByEdge.set(edgeId, {
                start: intersection.key,
                end: intersection.neighbor,
                points: [],
              });
            }
            intersectionsByEdge.get(edgeId).points.push({ key, t: intersection.edgeT });
          });
          const addFillEdge = (start, end) => {
            graph.get(start).add(end);
            graph.get(end).add(start);
            fillGraph.get(start).add(end);
            fillGraph.get(end).add(start);
            edgeKeys.add([start, end].sort().join("|"));
          };
          intersectionsByEdge.forEach(({ start, end, points }) => {
            graph.get(start).delete(end);
            graph.get(end).delete(start);
            fillGraph.get(start).delete(end);
            fillGraph.get(end).delete(start);
            edgeKeys.delete([start, end].sort().join("|"));
            const edgeNodes = [start, ...points.sort((first, second) => first.t - second.t)
              .map(({ key }) => key), end];
            for (let index = 0; index < edgeNodes.length - 1; index += 1) {
              addFillEdge(edgeNodes[index], edgeNodes[index + 1]);
            }
          });
          const connectionPath = [firstKey, ...[...connectionNodes.values()]
            .sort((first, second) => first.t - second.t).map(({ key }) => key), secondKey];
          for (let index = 0; index < connectionPath.length - 1; index += 1) {
            addFillEdge(connectionPath[index], connectionPath[index + 1]);
          }
        }
        const splitRepeatedLoop = (loop) => {
          for (let first = 0; first < loop.length; first += 1) {
            const repeatedIndex = loop.indexOf(loop[first], first + 1);
            if (repeatedIndex === -1) continue;
            const inner = loop.slice(first, repeatedIndex);
            const outer = loop.slice(0, first + 1).concat(loop.slice(repeatedIndex + 1));
            return [
              ...(inner.length >= 3 ? splitRepeatedLoop(inner) : []),
              ...(outer.length >= 3 ? splitRepeatedLoop(outer) : []),
            ];
          }
          return [loop];
        };

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
            if (!closed || loop.length < 3) continue;
            splitRepeatedLoop(loop).forEach((simpleLoop) => {
              if (simpleLoop.length < 3) return;
              const projected = simpleLoop.map((key) => projectedPoints.get(key));
              const area = THREE.ShapeUtils.area(projected);
              if (area <= tolerance * tolerance) return;
              const canonicalLoop = [...simpleLoop].sort().join("|");
              if (loopKeys.has(canonicalLoop)) return;
              loopKeys.add(canonicalLoop);
              loops.push(simpleLoop.map((key) => pointsByKey.get(key)));
            });
          }
        }
        loops.forEach((points) => {
          const projected = points.map((point) => {
            const relative = point.clone().sub(origin);
            return new THREE.Vector2(relative.dot(u), relative.dot(v));
          });
          if (Math.abs(THREE.ShapeUtils.area(projected)) <= tolerance * tolerance) return;
          const triangles = THREE.ShapeUtils.triangulateShape(projected, []);
          const offset = surfacePositions.length / 3;
          projected.forEach((point) => {
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
        graph.forEach((neighbors, key) => {
          neighbors.forEach((neighbor) => {
            if (key >= neighbor) return;
            const start = pointsByKey.get(key);
            const end = pointsByKey.get(neighbor);
            edgePositions.push(start.x, start.y, start.z, end.x, end.y, end.z);
          });
        });
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
      orientationCubeScene.add(new THREE.HemisphereLight(0xffffff, 0x9a9a9a, 1.15));
      const orientationKeyLight = new THREE.DirectionalLight(0xffffff, 2.2);
      orientationKeyLight.position.set(2, 3, 4);
      orientationCubeScene.add(orientationKeyLight);
      const orientationCamera = new THREE.OrthographicCamera(-1.2, 1.2, 1.2, -1.2, 0.01, 100);
      const orientationRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      orientationRenderer.setClearColor(0x000000, 0);
      orientationRenderer.setPixelRatio(Math.min(window.devicePixelRatio * 2, 4));
      orientationRenderer.outputColorSpace = THREE.SRGBColorSpace;
      orientationRenderer.toneMapping = THREE.NeutralToneMapping;
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
            const recolorMaterial = (sourceMaterial) => {
              const cubeMaterial = sourceMaterial.clone();
              cubeMaterial.color?.setHex(0xffffff);
              cubeMaterial.map = null;
              cubeMaterial.vertexColors = false;
              cubeMaterial.emissiveMap = null;
              if (cubeMaterial.emissive) {
                cubeMaterial.emissive.setHex(0x333333);
                cubeMaterial.emissiveIntensity = 0.05;
              }
              cubeMaterial.roughness = 0.88;
              cubeMaterial.metalness = 0;
              cubeMaterial.side = THREE.DoubleSide;
              return cubeMaterial;
            };
            part.material = Array.isArray(part.material)
              ? part.material.map(recolorMaterial)
              : recolorMaterial(part.material);
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
          const selectedSurface = makeSurfaceHighlight(0x000000, 0.2, 4);
          const hoverSurface = makeSurfaceHighlight(0x000000, 0.1, 5);
          const applySurfaceHighlight = (target, hit) => {
            target.geometry = hit.object.geometry;
            hit.object.updateWorldMatrix(true, false);
            target.matrix.copy(hit.object.matrixWorld);
            target.matrixWorldNeedsUpdate = true;
            target.visible = true;
          };
          const highlightMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.2,
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
        title.textContent = definition.label
          || (english ? `Section plane ${index + 1}` : `Plan de coupe ${index + 1}`);
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

        const initialPlanePosition = definition.position;
        const settings = { position: initialPlanePosition, rotation: [0, 0, 0] };
        const planeHelper = planeHelpers[index];
        const sliderControls = [];
        const hidePlane = () => {
          window.clearTimeout(planeHelper.hideTimer);
          planeHelper.group.visible = false;
        };
        const showPlane = () => {
          planeHelper.group.visible = true;
          window.clearTimeout(planeHelper.hideTimer);
          planeHelper.hideTimer = window.setTimeout(() => {
            planeHelper.group.visible = false;
          }, 900);
        };
        const updatePlane = (showPreview = true) => {
          rotation.set(...settings.rotation.map((degrees) => THREE.MathUtils.degToRad(degrees)));
          const planeNormal = definition.normal.clone().applyEuler(rotation).normalize();
          const planeOffset = definition.origin.dot(planeNormal);
          clippingPlanes[index].normal.copy(planeNormal).multiplyScalar(definition.clipSign);
          clippingPlanes[index].constant = enabledInput.checked && cutAllowed
            ? -(settings.position + planeOffset) * definition.clipSign - maxDimension * 1e-5
            : planeRadius * 2;
          planeHelper.group.position.copy(definition.origin)
            .addScaledVector(planeNormal, settings.position + 0.025);
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

        const addSlider = (
          label,
          min,
          max,
          step,
          value,
          onChange,
          suffix,
          target,
          compact = false,
          presets = [],
        ) => {
          const row = document.createElement("div");
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
          input.addEventListener("pointerup", hidePlane);
          input.addEventListener("pointercancel", hidePlane);
          input.addEventListener("keyup", hidePlane);
          let markerButtons = [];
          const updateMarkers = (nextValue) => {
            const snapTolerance = (max - min) * 0.025;
            markerButtons.forEach(({ button, markerValue }) => {
              const isSelected = Math.abs(markerValue - nextValue) <= snapTolerance;
              button.classList.toggle("is-active", isSelected);
              button.setAttribute("aria-pressed", String(isSelected));
            });
          };
          const updateValue = (nextValue) => {
            input.value = String(nextValue);
            output.value = `${Number(nextValue.toFixed(2))}${suffix}`;
            updateMarkers(nextValue);
            onChange(nextValue);
          };
          const output = document.createElement("output");
          output.value = `${Number(value.toFixed(2))}${suffix}`;
          input.addEventListener("input", () => {
            updateValue(Number(input.value));
          });
          if (compact) {
            const rangeWrap = document.createElement("div");
            rangeWrap.className = "cut-plane-range-wrap";
            rangeWrap.append(input);
            const markers = document.createElement("div");
            markers.className = "cut-plane-main-markers";
            markers.setAttribute("role", "group");
            markers.setAttribute("aria-label", english ? "Main cut positions" : "Repères de coupe principaux");
            markerButtons = presets.map(({ value: markerValue, label: markerLabel }, markerIndex) => {
              const fraction = (markerValue - min) / (max - min);
              const marker = document.createElement("button");
              marker.type = "button";
              marker.className = "cut-plane-main-marker";
              marker.style.left = `${fraction * 100}%`;
              marker.textContent = String(markerIndex + 1);
              marker.title = english
                ? `Main cut — ${markerLabel}`
                : `Coupe principale — ${markerLabel}`;
              marker.setAttribute("aria-label", marker.title);
              marker.addEventListener("click", () => {
                enabledInput.checked = true;
                updateValue(markerValue);
                enabledInput.dispatchEvent(new Event("change", { bubbles: true }));
                hidePlane();
              });
              markers.append(marker);
              return { button: marker, markerValue };
            });
            if (presets.length) rangeWrap.append(markers);
            input.addEventListener("change", () => {
              if (!presets.length) return;
              const range = max - min;
              const nearest = presets
                .map(({ value: markerValue }) => markerValue)
                .reduce((best, candidate) => Math.abs(candidate - Number(input.value))
                  < Math.abs(best - Number(input.value)) ? candidate : best);
              if (Number.isFinite(nearest)
                && Math.abs(nearest - Number(input.value)) <= range * 0.025) updateValue(nearest);
            });
            updateMarkers(value);
            row.append(title, rangeWrap, output);
          } else {
            row.append(title, input, output);
          }
          input.addEventListener("change", hidePlane);
          target.append(row);
          sliderControls.push({ input, output, suffix, updateMarkers });
        };

        const positionMin = definition.range[0];
        const positionMax = definition.range[1];
        const positionStep = (positionMax - positionMin) / 1000;
        const positionPresets = definition.presets;
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
          positionPresets,
        );
        const advanced = document.createElement("details");
        advanced.className = "cut-plane-advanced";
        advanced.hidden = true;
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
      updateCutAvailability();

      const distance = maxDimension * 3.5;
      const initialPosition = new THREE.Vector3(-distance * 1.35, distance * 1.2, distance);
      camera.position.copy(initialPosition);
      camera.near = maxDimension / 1000;
      camera.far = maxDimension * 20;
      camera.updateProjectionMatrix();
      ssaoPass.ssaoMaterial.uniforms.cameraNear.value = camera.near;
      ssaoPass.ssaoMaterial.uniforms.cameraFar.value = camera.far;
      ssaoPass.depthRenderMaterial.uniforms.cameraNear.value = camera.near;
      ssaoPass.depthRenderMaterial.uniforms.cameraFar.value = camera.far;
      controls.minDistance = maxDimension * 0.08;
      controls.maxDistance = maxDimension * 12;
      controls.target.set(0, 0, 0);
      controls.update();

      let animationId = 0;
      let userInteracted = false;
      // Cadre les couches visibles (le bâtiment seul, ou bâtiment + environnement) pour qu'elles remplissent la scène.
      function frameView(animate, resetDirection) {
        cancelAnimationFrame(animationId);
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3();
        modelLayers.forEach(({ object }) => {
          if (object.visible) box.union(new THREE.Box3().setFromObject(object));
        });
        if (box.isEmpty()) box.setFromObject(model);
        const frameCenter = box.getCenter(new THREE.Vector3());
        const direction = (resetDirection
          ? initialPosition.clone()
          : camera.position.clone().sub(controls.target)).normalize();
        const basis = new THREE.Matrix4().lookAt(direction, new THREE.Vector3(), camera.up);
        const right = new THREE.Vector3().setFromMatrixColumn(basis, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(basis, 1);
        let halfWidth = 0;
        let halfHeight = 0;
        for (let i = 0; i < 8; i += 1) {
          const corner = new THREE.Vector3(
            i & 1 ? box.max.x : box.min.x,
            i & 2 ? box.max.y : box.min.y,
            i & 4 ? box.max.z : box.min.z,
          ).sub(frameCenter);
          halfWidth = Math.max(halfWidth, Math.abs(corner.dot(right)));
          halfHeight = Math.max(halfHeight, Math.abs(corner.dot(up)));
        }
        const aspect = camera.aspect || 1;
        const zoom = Math.min(
          cameraFrustumHeight / (2 * Math.max(halfHeight, 1e-6)),
          (cameraFrustumHeight * aspect) / (2 * Math.max(halfWidth, 1e-6)),
        ) * 0.96;
        const endPosition = frameCenter.clone().addScaledVector(direction, distance);
        const startPosition = camera.position.clone();
        const startTarget = controls.target.clone();
        const startZoom = camera.zoom;
        const apply = (t) => {
          controls.target.lerpVectors(startTarget, frameCenter, t);
          camera.position.lerpVectors(startPosition, endPosition, t);
          camera.zoom = startZoom + (zoom - startZoom) * t;
          camera.updateProjectionMatrix();
          controls.update();
          updateOrientationCube();
        };
        if (!animate) {
          apply(1);
          return;
        }
        const startTime = performance.now();
        const step = (now) => {
          const progress = Math.min(1, (now - startTime) / 700);
          apply(1 - Math.pow(1 - progress, 3));
          if (progress < 1) animationId = requestAnimationFrame(step);
        };
        animationId = requestAnimationFrame(step);
      }
      controls.addEventListener("start", () => {
        userInteracted = true;
        cancelAnimationFrame(animationId);
      });
      frameView(false, true);
      // Tant que l'utilisateur n'a pas bougé, un changement de taille de la scène recadre la vue.
      const reframeOnResize = () => { if (!userInteracted) frameView(false, false); };
      new ResizeObserver(reframeOnResize).observe(stage);
      resetButton.addEventListener("click", () => {
        frameView(true, true);
      });
      document.addEventListener("fullscreenchange", () => window.setTimeout(() => frameView(false, false), 100));
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
    composer.render();
    requestAnimationFrame(render);
  };
  render();
}

document.querySelectorAll("[data-archi-viewer]").forEach((viewer) => initializeViewer(viewer));
