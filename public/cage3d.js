// 抽選ケージの3D演出（Three.js）
// window.Cage3D として app.js から呼び出せるAPIを公開する
// デザイン: 木製の八角ドラム式抽選器（ガラポン/新井式抽選器）風
import * as THREE from './vendor/three.module.js';

let scene, camera, renderer, cageGroup, spinGroup;
let spinning = false;
const clock = new THREE.Clock();

const DRUM_RADIUS = 1.05;
const DRUM_HALF_HEIGHT = 0.95;

function init(canvas) {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(1.7, 1.75, 4.6);
  camera.lookAt(0.25, 0.1, 0);

  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  // ---- lights ----
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  const keyLight = new THREE.DirectionalLight(0xfff3d6, 1.15);
  keyLight.position.set(3, 4, 5);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xffd98a, 0.45);
  rimLight.position.set(-3, -1, -3);
  scene.add(rimLight);

  const fillLight = new THREE.DirectionalLight(0x8f9bd9, 0.3);
  fillLight.position.set(-2, 2, 2);
  scene.add(fillLight);

  // ---- root group ----
  cageGroup = new THREE.Group();
  cageGroup.rotation.y = 0.18; // 斜めから見た構図にするための固定の傾き
  scene.add(cageGroup);

  buildDrum();
  buildStand();
  buildBase();

  resize(canvas);
  new ResizeObserver(() => resize(canvas)).observe(canvas);

  animate();
}

function buildDrum() {
  // drumPivot: 静的に「横向き」へ倒すための土台（この角度は固定）
  const drumPivot = new THREE.Group();
  drumPivot.position.set(0, 0.55, 0);
  drumPivot.rotation.z = -Math.PI / 2; // ローカルY軸(回転軸)をワールドX方向へ倒す
  cageGroup.add(drumPivot);

  // spinGroup: 毎フレーム回転させるグループ（クランクも一緒に回る）
  spinGroup = new THREE.Group();
  drumPivot.add(spinGroup);

  // 八角ドラム本体
  const drumGeo = new THREE.CylinderGeometry(DRUM_RADIUS, DRUM_RADIUS, DRUM_HALF_HEIGHT * 2, 8, 1, false);
  const drumMat = new THREE.MeshStandardMaterial({ color: 0xC9A23E, roughness: 0.55, metalness: 0.1 });
  spinGroup.add(new THREE.Mesh(drumGeo, drumMat));

  // のぞき穴（金属リング＋暗い穴）
  const faceAngle = Math.PI / 8; // 面の中心方向
  const apothem = DRUM_RADIUS * Math.cos(Math.PI / 8);
  const peepY = DRUM_HALF_HEIGHT * 0.25;
  const dirX = Math.cos(faceAngle);
  const dirZ = Math.sin(faceAngle);
  const ringRotY = Math.PI / 2 - faceAngle;

  const ringGeo = new THREE.TorusGeometry(0.11, 0.025, 8, 20);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xC7CBDA, roughness: 0.35, metalness: 0.6 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(dirX * (apothem + 0.01), peepY, dirZ * (apothem + 0.01));
  ring.rotation.y = ringRotY;
  spinGroup.add(ring);

  const holeGeo = new THREE.CircleGeometry(0.09, 20);
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x05060F });
  const hole = new THREE.Mesh(holeGeo, holeMat);
  hole.position.set(dirX * (apothem + 0.005), peepY, dirZ * (apothem + 0.005));
  hole.rotation.y = ringRotY;
  spinGroup.add(hole);

  // ---- クランク（ドラムと一緒に回転） ----
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xC7CBDA, roughness: 0.35, metalness: 0.6 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6B4A2E, roughness: 0.6, metalness: 0.05 });

  const axleGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.3, 12);
  const axle = new THREE.Mesh(axleGeo, metalMat);
  axle.position.set(0, DRUM_HALF_HEIGHT + 0.15, 0);
  spinGroup.add(axle);

  const armGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.6, 10);
  const arm = new THREE.Mesh(armGeo, metalMat);
  arm.position.set(0.26, DRUM_HALF_HEIGHT + 0.42, 0);
  arm.rotation.z = Math.PI / 2.6;
  spinGroup.add(arm);

  const handleGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.34, 12);
  const handle = new THREE.Mesh(handleGeo, woodMat);
  handle.position.set(0.56, DRUM_HALF_HEIGHT + 0.62, 0);
  handle.rotation.z = Math.PI / 2.6;
  spinGroup.add(handle);
}

function buildStand() {
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xB9BEC9, roughness: 0.4, metalness: 0.5 });

  // 三角形の板状ブラケット（フラットな金属プレート）
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(-0.58, -1.35);
  shape.lineTo(0.22, -1.35);
  shape.closePath();
  const bracketGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false });
  const bracket = new THREE.Mesh(bracketGeo, metalMat);
  bracket.position.set(0.82, 0.55, -0.05);
  cageGroup.add(bracket);

  // 回転軸の受け（ハブ）
  const hubGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.22, 16);
  const hub = new THREE.Mesh(hubGeo, metalMat);
  hub.position.set(0.82, 0.55, 0);
  hub.rotation.z = Math.PI / 2;
  cageGroup.add(hub);
}

function buildBase() {
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x05060F, roughness: 0.7, metalness: 0.05 });
  const trayMat = new THREE.MeshStandardMaterial({ color: 0x0B0D1D, roughness: 0.6, metalness: 0.1 });

  const baseGeo = new THREE.BoxGeometry(2.7, 0.12, 1.15);
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.set(0.1, -0.82, 0);
  cageGroup.add(base);

  const trayGeo = new THREE.BoxGeometry(1.1, 0.07, 0.6);
  const tray = new THREE.Mesh(trayGeo, trayMat);
  tray.position.set(-0.55, -0.74, 0.28);
  cageGroup.add(tray);
}

function setBallCount() {
  // ドラムが不透明なデザインになったため、中の玉は表示しない（見た目には影響しない）
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (spinGroup) {
    if (spinning) {
      spinGroup.rotation.y += dt * 3.6;
    } else {
      spinGroup.rotation.y += dt * 0.12;
    }
  }

  renderer.render(scene, camera);
}

function resize(canvas) {
  if (!renderer) return;
  const w = canvas.clientWidth || 260;
  const h = canvas.clientHeight || 220;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function startSpin() { spinning = true; }
function stopSpin() { spinning = false; }

window.Cage3D = { init, setBallCount, startSpin, stopSpin };
