import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { timeFrame, CROWD, LOOK, MODELS, connect, crowdAt, net, serverToScene, startHud, townLayout } from './common.ts';

const t0 = performance.now();
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(LOOK.sky);
scene.fog = new THREE.Fog(LOOK.sky, LOOK.fogNear, LOOK.fogFar);
const camera = new THREE.PerspectiveCamera(LOOK.camera.fov, innerWidth / innerHeight, 0.1, 100);
camera.position.set(...LOOK.camera.pos);
camera.lookAt(...LOOK.camera.target);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Lighting: sky/ground fill, one sun with shadows, image-based light from an HDR sky
scene.add(new THREE.HemisphereLight(0xdff1ff, 0x6b8a4a, LOOK.hemiIntensity));
const sun = new THREE.DirectionalLight(0xfff2dd, LOOK.sunIntensity);
const [sx, sy, sz] = LOOK.sunDir;
sun.position.set(-sx * 20, -sy * 20, -sz * 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
sun.shadow.bias = -0.0005;
scene.add(sun);

const gltf = new GLTFLoader();
const load = (url: string) => new Promise<GLTF>((res, rej) => gltf.load(url, res, undefined, rej));

async function main() {
  const [hdr, robot, ...tiles] = await Promise.all([
    new RGBELoader().loadAsync('models/sky.hdr'),
    load('models/RobotExpressive.glb'),
    ...MODELS.map((m) => load(`models/city/${m}.glb`)),
  ]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = LOOK.envIntensity;
  hdr.dispose();

  // Static town: one InstancedMesh per tile model (one draw call per model)
  const layout = townLayout();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  MODELS.forEach((name, mi) => {
    const spots = layout.filter((p) => p.model === name);
    if (!spots.length) return;
    let src: THREE.Mesh | undefined;
    tiles[mi].scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && !src) src = o as THREE.Mesh; });
    if (!src) return;
    const inst = new THREE.InstancedMesh(src.geometry, src.material, spots.length);
    spots.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot);
      inst.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(1, 1, 1)));
    });
    inst.castShadow = !name.startsWith('road') && name !== 'grass' && name !== 'pavement';
    inst.receiveShadow = true;
    scene.add(inst);
  });

  // Animated characters (skinned mesh, one mixer each)
  const walk = robot.animations.find((a) => a.name === 'Walking')!;
  const run = robot.animations.find((a) => a.name === 'Running')!;
  const makeChar = () => {
    const c = cloneSkinned(robot.scene) as THREE.Object3D;
    c.scale.setScalar(LOOK.robotScale);
    c.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; (o as THREE.Mesh).frustumCulled = false; } });
    const mixer = new THREE.AnimationMixer(c);
    scene.add(c);
    return { c, mixer, walk: mixer.clipAction(walk), run: mixer.clipAction(run) };
  };
  const crowd = Array.from({ length: CROWD }, () => {
    const ch = makeChar();
    ch.walk.play();
    ch.mixer.setTime(Math.random() * 2);
    return ch;
  });
  const live = new Map<string, ReturnType<typeof makeChar>>();

  const clock = new THREE.Clock();
  startHud('Three.js r' + THREE.REVISION, t0, {
    drawCalls: () => renderer.info.render.calls,
    triangles: () => renderer.info.render.triangles,
  });
  void connect();

  renderer.setAnimationLoop(() => timeFrame(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    crowd.forEach((ch, i) => {
      const w = crowdAt(i, t);
      ch.c.position.set(w.x, 0, w.z);
      ch.c.rotation.y = w.heading;
      ch.mixer.update(dt);
    });
    // live players and Opps from the game server
    const seen = new Set<string>();
    for (const e of net.ents) {
      seen.add(e.id);
      let ch = live.get(e.id);
      if (!ch) { ch = makeChar(); ch.run.play(); live.set(e.id, ch); }
      const [x, z] = serverToScene(e.x, e.y);
      const dx = x - ch.c.position.x, dz = z - ch.c.position.z;
      if (dx * dx + dz * dz > 1e-5) ch.c.rotation.y = Math.atan2(dx, dz);
      ch.c.position.lerp(new THREE.Vector3(x, (e.z ?? 0) * 0.3, z), 0.3);
      ch.mixer.update(dt);
      if (e.id === net.you) camera.position.set(x + 7.5, 9, z + 10), camera.lookAt(x, 0, z);
    }
    for (const [id, ch] of live) if (!seen.has(id)) { scene.remove(ch.c); live.delete(id); }
    renderer.render(scene, camera);
  }));
}

main().catch((e) => { document.body.textContent = String(e); console.error(e); });
