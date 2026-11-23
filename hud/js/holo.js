// Scène holographique Jarvis (Three.js + EffectComposer + UnrealBloomPass).
// - Orbe central : shader holographique (fresnel, scanlines, scintillement), déformé par le niveau de la voix.
// - Particules flottantes, coquilles filaires, anneaux.
// - Perspective « fenêtre » : projection hors axe pilotée par la position de la tête.
// Le canvas est en mix-blend-mode « screen » : le noir est transparent, la carte reste visible dessous.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const PX = 100;          // pixels CSS par unité du monde (le plan z = 0 coïncide avec l'écran)
const EYE_Z = 9;         // distance de l'œil au plan de l'écran, en unités
const CYAN = new THREE.Color("#49c6ff"), AMBER = new THREE.Color("#ffb547");

const HOLO_VERT = /* glsl */`
  uniform float uTime; uniform float uLevel; uniform float uWarp;
  varying vec3 vN; varying vec3 vV; varying vec3 vPos;
  void main() {
    vec3 p = position;
    float n = sin(p.x * 4.0 + uTime * 2.1) * sin(p.y * 5.0 + uTime * 1.7) * sin(p.z * 4.5 + uTime * 2.5);
    p += normal * n * (0.03 + uLevel * 0.22) * uWarp;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vPos = p;
    gl_Position = projectionMatrix * mv;
  }`;
const HOLO_FRAG = /* glsl */`
  uniform vec3 uColor; uniform vec3 uAccent; uniform float uTime; uniform float uLevel; uniform float uOpacity; uniform float uThink;
  varying vec3 vN; varying vec3 vV; varying vec3 vPos;
  void main() {
    float fres = pow(1.0 - abs(dot(vN, vV)), 2.3);
    float scan = 0.6 + 0.4 * sin(vPos.y * 55.0 - uTime * 6.0);
    float flick = 0.93 + 0.07 * sin(uTime * 37.0) * sin(uTime * 13.0);
    vec3 col = mix(uColor, uAccent, clamp(uThink * 0.8 + uLevel * 0.25, 0.0, 1.0));
    float a = (fres * 1.1 + 0.015 + uLevel * 0.22) * scan * flick * uOpacity;
    gl_FragColor = vec4(col * (0.35 + fres * 1.5 + uLevel * 1.0), a);
  }`;
const POINTS_VERT = /* glsl */`
  uniform float uTime; uniform float uScale; attribute float aSeed;
  varying float vTw;
  void main() {
    vec3 p = position;
    p.y += mod(uTime * (0.05 + aSeed * 0.08) + aSeed * 20.0, 14.0) - 7.0;
    p.x += sin(uTime * 0.3 + aSeed * 30.0) * 0.15;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vTw = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 50.0);
    gl_PointSize = uScale * (0.6 + aSeed) * (8.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const POINTS_FRAG = /* glsl */`
  uniform vec3 uColor; varying float vTw;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * (0.25 + 0.75 * vTw);
    gl_FragColor = vec4(uColor * (0.5 + vTw * 0.8), a * 0.4);
  }`;

export function supportsWebGL() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (_) { return false; }
}

export function createHolo({ orbElement } = {}) {
  const canvas = document.createElement("canvas");
  canvas.id = "holo";
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.5, 0.16);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let W = 1, H = 1;
  const eye = new THREE.Vector3(0, 0, EYE_Z), eyeTarget = eye.clone();
  function applyProjection() {
    const n = 0.1, f = 200, l = -W / 2, r = W / 2, b = -H / 2, t = H / 2;
    camera.position.copy(eye); camera.quaternion.identity();
    camera.projectionMatrix.makePerspective((l - eye.x) * n / eye.z, (r - eye.x) * n / eye.z, (t - eye.y) * n / eye.z, (b - eye.y) * n / eye.z, n, f);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.updateMatrixWorld(true);
  }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    W = w / PX; H = h / PX;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    applyProjection();
  }
  window.addEventListener("resize", resize);

  // ---------- conversions écran ↔ monde ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), tmp = new THREE.Vector3();
  function screenToWorld(sx, sy, z) {
    ndc.set((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    plane.constant = -z;
    return ray.ray.intersectPlane(plane, tmp) ? tmp.clone() : new THREE.Vector3((sx / PX) - W / 2, H / 2 - sy / PX, z);
  }

  // ---------- orbe ----------
  const orb = new THREE.Group(); scene.add(orb);
  const holoUniforms = { uTime: { value: 0 }, uLevel: { value: 0 }, uThink: { value: 0 }, uOpacity: { value: 1 }, uWarp: { value: 1 },
    uColor: { value: CYAN.clone() }, uAccent: { value: AMBER.clone() } };
  const coreMat = new THREE.ShaderMaterial({ uniforms: holoUniforms, vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 6), coreMat); orb.add(core);
  const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 3), new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
  orb.add(inner);
  const shellMat = (op) => new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false });
  const shellA = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.28, 1)), shellMat(0.22));
  const shellB = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.5, 0)), shellMat(0.14));
  orb.add(shellA, shellB);
  const ringMat = (c, op) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const ring1 = new THREE.Mesh(new THREE.RingGeometry(1.72, 1.78, 128, 1, 0, Math.PI * 1.5), ringMat(CYAN, 0.8));
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(1.92, 1.95, 128, 1, 0, Math.PI * 0.45), ringMat(AMBER, 0.9));
  const ring3 = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.115, 160), ringMat(CYAN, 0.35));
  orb.add(ring1, ring2, ring3);
  // halo de particules en orbite
  const haloN = 380, haloPos = new Float32Array(haloN * 3), haloSeed = new Float32Array(haloN);
  for (let i = 0; i < haloN; i++) {
    const r = 1.4 + Math.random() * 1.1, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    haloPos.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.35, r * Math.cos(ph)], i * 3); haloSeed[i] = Math.random();
  }
  const haloGeo = new THREE.BufferGeometry(); haloGeo.setAttribute("position", new THREE.BufferAttribute(haloPos, 3)); haloGeo.setAttribute("aSeed", new THREE.BufferAttribute(haloSeed, 1));
  const halo = new THREE.Points(haloGeo, new THREE.PointsMaterial({ color: CYAN, size: 0.035, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  orb.add(halo);

  // ---------- particules d'ambiance ----------
  const N = 900, pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos.set([(Math.random() - 0.5) * 34, (Math.random() - 0.5) * 14, -1.5 - Math.random() * 14], i * 3); seed[i] = Math.random(); }
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); pGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const pUniforms = { uTime: { value: 0 }, uScale: { value: 3.2 * Math.min(window.devicePixelRatio || 1, 1.5) }, uColor: { value: CYAN.clone() } };
  const dust = new THREE.Points(pGeo, new THREE.ShaderMaterial({ uniforms: pUniforms, vertexShader: POINTS_VERT, fragmentShader: POINTS_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(dust);
  // grille de sol en perspective (donne la profondeur)
  const grid = new THREE.GridHelper(60, 60, 0x1b6a96, 0x0c3550);
  grid.material.transparent = true; grid.material.opacity = 0.16; grid.material.depthWrite = false;
  grid.position.set(0, -6, -10); scene.add(grid);

  // ---------- état ----------
  let levelFn = () => 0, state = "idle", dim = 0, orbSpin = 0, orbScale = 1;
  const orbTarget = new THREE.Vector3(), headSmooth = new THREE.Vector3(0, 0, EYE_Z);
  function setEye(nx, ny, dist) {
    // nx, ny ∈ [-1, 1] : position de la tête devant l'écran ; dist ≈ 1 à distance normale
    eyeTarget.set(THREE.MathUtils.clamp(nx, -1, 1) * W * 0.32, THREE.MathUtils.clamp(ny, -1, 1) * H * 0.3, THREE.MathUtils.clamp(EYE_Z * dist, EYE_Z * 0.6, EYE_Z * 1.8));
  }
  function resetEye() { eyeTarget.set(0, 0, EYE_Z); }

  function placeOrb() {
    if (!orbElement) return;
    const r = orbElement.getBoundingClientRect();
    if (!r.width) return;
    const p = screenToWorld(r.left + r.width / 2, r.top + r.height / 2, -0.4);
    orbTarget.copy(p);
    orbScale = (r.width / PX) * 0.24;
  }

  // ---------- boucle ----------
  const clock = new THREE.Clock(); let running = true, level = 0, think = 0;
  // Qualité adaptative : si les images tardent, on baisse la résolution du rendu (et on la remonte quand tout va bien).
  const RATIOS = [Math.min(window.devicePixelRatio || 1, 1.5), 1, 0.75, 0.6];
  let niveau = 0, moyenne = 16, compteur = 0;
  function adapter(dtMs) {
    moyenne = moyenne * 0.95 + dtMs * 0.05;
    if (++compteur < 90) return;
    compteur = 0;
    const avant = niveau;
    if (moyenne > 24 && niveau < RATIOS.length - 1) niveau++;
    else if (moyenne < 14 && niveau > 0) niveau--;
    if (niveau !== avant) { renderer.setPixelRatio(RATIOS[niveau]); resize(); }
  }
  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const brut = clock.getDelta(), dt = Math.min(brut, 0.05), t = clock.elapsedTime;
    adapter(brut * 1000);
    // tête → perspective
    headSmooth.lerp(eyeTarget, 1 - Math.pow(0.001, dt));
    eye.copy(headSmooth); applyProjection();
    // orbe
    placeOrb();
    orb.position.lerp(orbTarget, 1 - Math.pow(0.002, dt));
    const target = Math.max(0, Math.min(1, levelFn() || 0));
    level += (target - level) * (target > level ? 0.5 : 0.12);
    think += ((state === "thinking" ? 1 : 0) - think) * 0.06;
    const listening = state === "listening" ? 1 : 0;
    const s = orbScale * (1 + level * 0.28 + listening * 0.06 + Math.sin(t * 2) * 0.015);
    orb.scale.setScalar(orb.scale.x + (s - orb.scale.x) * 0.25);
    holoUniforms.uTime.value = t; holoUniforms.uLevel.value = level; holoUniforms.uThink.value = think;
    holoUniforms.uOpacity.value = 1 - dim * 0.75;
    core.rotation.y += dt * (0.25 + think * 1.5) + orbSpin * dt; orbSpin *= 0.95;
    shellA.rotation.y -= dt * (0.15 + think * 0.9); shellA.rotation.x += dt * 0.07;
    shellB.rotation.y += dt * (0.1 + level * 0.8); shellB.rotation.z -= dt * 0.05;
    ring1.rotation.z += dt * (0.4 + think * 2.5 + listening * 1.5);
    ring2.rotation.z -= dt * (0.7 + think * 3 + level * 3);
    ring3.material.opacity = 0.25 + listening * 0.5 + level * 0.4;
    halo.rotation.y += dt * (0.2 + level * 1.2 + think);
    inner.material.opacity = (0.12 + level * 0.5) * (1 - dim * 0.8);
    // ambiance
    pUniforms.uTime.value = t; dust.material.opacity = 1 - dim * 0.7;
    grid.material.opacity = 0.14 * (1 - dim);
    composer.render();
  }
  resize(); frame();
  document.body.classList.add("holo-on");

  return {
    setLevelSource(fn) { levelFn = fn; },
    setState(s) { state = s || "idle"; },
    setDim(v) { dim = v; },
    setEye, resetEye,
    spin(delta) { orbSpin += delta * 2; },
    stop() { running = false; renderer.dispose(); canvas.remove(); document.body.classList.remove("holo-on"); },
  };
}
