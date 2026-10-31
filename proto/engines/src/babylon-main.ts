import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { HDRCubeTexture } from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Axis } from '@babylonjs/core/Maths/math.axis';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import '@babylonjs/core/Materials/PBR/pbrMaterial';
import '@babylonjs/core/Helpers/sceneHelpers';
import '@babylonjs/loaders/glTF';
import { timeFrame, CROWD, LOOK, MODELS, connect, crowdAt, net, serverToScene, startHud, townLayout } from './common.ts';

const t0 = performance.now();
const canvas = document.createElement('canvas');
canvas.style.cssText = 'width:100%;height:100%;display:block';
document.body.appendChild(canvas);
const engine = new Engine(canvas, true, { powerPreference: 'high-performance' }, true);
engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio, 2));
addEventListener('resize', () => engine.resize());

const scene = new Scene(engine);
scene.useRightHandedSystem = true; // same axes as Three.js and glTF, so the layout code is shared
const hex = (n: number) => Color3.FromHexString('#' + n.toString(16).padStart(6, '0'));
scene.clearColor = Color4.FromColor3(hex(LOOK.sky));
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogColor = hex(LOOK.sky);
scene.fogStart = LOOK.fogNear;
scene.fogEnd = LOOK.fogFar;
scene.imageProcessingConfiguration.toneMappingEnabled = true;
scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;

const camera = new FreeCamera('cam', new Vector3(...LOOK.camera.pos), scene);
camera.fov = (LOOK.camera.fov * Math.PI) / 180;
camera.minZ = 0.1;
camera.maxZ = 100;
camera.setTarget(new Vector3(...LOOK.camera.target));

const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
hemi.diffuse = hex(0xdff1ff);
hemi.groundColor = hex(0x6b8a4a);
hemi.intensity = LOOK.hemiIntensity;
const sun = new DirectionalLight('sun', new Vector3(...LOOK.sunDir), scene);
sun.position = new Vector3(...LOOK.sunDir).scale(-20);
sun.diffuse = hex(0xfff2dd);
sun.intensity = LOOK.sunIntensity;
const shadows = new ShadowGenerator(2048, sun);
shadows.usePercentageCloserFiltering = true;
shadows.bias = 0.001;

async function main() {
  const env = new HDRCubeTexture('models/sky.hdr', scene, 256, false, true, false, true);
  scene.environmentTexture = env;
  scene.environmentIntensity = LOOK.envIntensity;

  const [robot, ...tiles] = await Promise.all([
    LoadAssetContainerAsync('models/RobotExpressive.glb', scene),
    ...MODELS.map((m) => LoadAssetContainerAsync(`models/city/${m}.glb`, scene)),
  ]);

  // Static town: thin instances, one draw call per tile model
  const layout = townLayout();
  MODELS.forEach((name, mi) => {
    const spots = layout.filter((p) => p.model === name);
    const c = tiles[mi];
    const mesh = c.meshes.find((m) => m.getTotalVertices() > 0) as Mesh | undefined;
    if (!spots.length || !mesh) return;
    c.addAllToScene();
    mesh.setParent(null);
    mesh.position.setAll(0);
    mesh.rotationQuaternion = Quaternion.Identity();
    mesh.scaling.setAll(1);
    const buf = new Float32Array(spots.length * 16);
    spots.forEach((p, i) => {
      Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(Axis.Y, p.rot), new Vector3(p.x, 0, p.z)).copyToArray(buf, i * 16);
    });
    mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
    mesh.thinInstanceRefreshBoundingInfo();
    mesh.receiveShadows = true;
    if (!name.startsWith('road') && name !== 'grass' && name !== 'pavement') shadows.addShadowCaster(mesh);
    mesh.freezeWorldMatrix();
  });

  // Animated characters (skinned mesh, own animation groups each)
  const makeChar = () => {
    const holder = new TransformNode('char', scene);
    const inst = robot.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    for (const r of inst.rootNodes) {
      r.parent = holder;
      r.getChildMeshes().forEach((m) => { shadows.addShadowCaster(m); m.alwaysSelectAsActiveMesh = true; });
    }
    holder.scaling.setAll(LOOK.robotScale);
    const group = (n: string) => inst.animationGroups.find((g) => g.name === n) as AnimationGroup;
    inst.animationGroups.forEach((g) => g.stop());
    return { holder, walk: group('Walking'), run: group('Running') };
  };
  const crowd = Array.from({ length: CROWD }, () => {
    const ch = makeChar();
    ch.walk.start(true, 1, ch.walk.from + Math.random() * (ch.walk.to - ch.walk.from));
    return ch;
  });
  const live = new Map<string, ReturnType<typeof makeChar>>();

  const instr = new SceneInstrumentation(scene);
  instr.captureFrameTime = false;
  startHud('Babylon.js ' + Engine.Version, t0, {
    drawCalls: () => instr.drawCallsCounter.current,
    triangles: () => scene.getActiveIndices() / 3,
  });
  void connect();

  const start = performance.now();
  engine.runRenderLoop(() => timeFrame(() => {
    const t = (performance.now() - start) / 1000;
    crowd.forEach((ch, i) => {
      const w = crowdAt(i, t);
      ch.holder.position.set(w.x, 0, w.z);
      ch.holder.rotation.y = w.heading;
    });
    const seen = new Set<string>();
    for (const e of net.ents) {
      seen.add(e.id);
      let ch = live.get(e.id);
      if (!ch) { ch = makeChar(); ch.run.start(true); live.set(e.id, ch); }
      const [x, z] = serverToScene(e.x, e.y);
      const p = ch.holder.position;
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz > 1e-5) ch.holder.rotation.y = Math.atan2(dx, dz);
      Vector3.LerpToRef(p, new Vector3(x, (e.z ?? 0) * 0.3, z), 0.3, p);
      if (e.id === net.you) { camera.position.set(x + 7.5, 9, z + 10); camera.setTarget(new Vector3(x, 0, z)); }
    }
    for (const [id, ch] of live) if (!seen.has(id)) { ch.holder.dispose(); live.delete(id); }
    scene.render();
  }));
}

main().catch((e) => { document.body.textContent = String(e); console.error(e); });
