import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

type Props = { color: string; intensity: number; quality: 'low' | 'medium' | 'high' };

function buildMaze(n: number, seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const g: number[][] = Array.from({ length: n }, () => Array(n).fill(1));
  const stack: [number, number][] = [[1, 1]];
  g[1][1] = 0;
  while (stack.length) {
    const [x, z] = stack[stack.length - 1];
    const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]].filter(([dx, dz]) => {
      const nx = x + dx, nz = z + dz;
      return nx > 0 && nz > 0 && nx < n - 1 && nz < n - 1 && g[nz][nx] === 1;
    });
    if (!dirs.length) { stack.pop(); continue; }
    const [dx, dz] = dirs[Math.floor(rnd() * dirs.length)];
    g[z + dz / 2][x + dx / 2] = 0;
    g[z + dz][x + dx] = 0;
    stack.push([x + dx, z + dz]);
  }
  const c = Math.floor(n / 2);
  for (let z = c - 1; z <= c + 1; z++) for (let x = c - 1; x <= c + 1; x++) g[z][x] = 0;
  const walls: { x: number; z: number }[] = [];
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) if (g[z][x]) walls.push({ x: (x - c) * 1.2, z: (z - c) * 1.2 });
  return walls;
}

function Sonar({ color, intensity }: { color: string; intensity: number }) {
  const walls = useMemo(() => buildMaze(23, 917), []);
  const fill = useRef<THREE.InstancedMesh>(null);
  const wire = useRef<THREE.InstancedMesh>(null);
  const rings = useRef<THREE.Mesh[]>([]);
  const base = useMemo(() => new THREE.Color(color), [color]);
  const red = useMemo(() => new THREE.Color('#ff3b55'), []);
  const tmp = useMemo(() => new THREE.Color(), []);
  const init = useRef(false);

  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime;
    if (fill.current && wire.current && !init.current) {
      const m = new THREE.Matrix4();
      walls.forEach((w, i) => {
        m.compose(new THREE.Vector3(w.x, 0.5, w.z), new THREE.Quaternion(), new THREE.Vector3(1.2, 1 + ((i * 37) % 7) * 0.08, 1.2));
        fill.current!.setMatrixAt(i, m);
        wire.current!.setMatrixAt(i, m);
      });
      init.current = true;
    }
    const period = 2.6;
    const fronts = [0, 1].map((k) => ((t + k * period * 0.5) % period) * 9);
    walls.forEach((w, i) => {
      const d = Math.hypot(w.x, w.z);
      let v = 0;
      for (const f of fronts) {
        const delta = f - d;
        if (delta > 0) v = Math.max(v, Math.exp(-delta * 0.55) * Math.max(0, 1 - f / 24));
      }
      tmp.copy(i % 29 === 0 ? red : base).multiplyScalar(v * intensity * 1.4);
      fill.current?.setColorAt(i, tmp.clone().multiplyScalar(0.25));
      wire.current?.setColorAt(i, tmp);
    });
    if (fill.current?.instanceColor) fill.current.instanceColor.needsUpdate = true;
    if (wire.current?.instanceColor) wire.current.instanceColor.needsUpdate = true;
    if (fill.current) fill.current.instanceMatrix.needsUpdate = true;
    if (wire.current) wire.current.instanceMatrix.needsUpdate = true;
    rings.current.forEach((r, k) => {
      if (!r) return;
      const f = fronts[k];
      r.scale.setScalar(Math.max(0.01, f));
      (r.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - f / 24) * 0.9;
    });
    const a = t * 0.06;
    camera.position.set(Math.sin(a) * 15, 14, Math.cos(a) * 15);
    camera.lookAt(0, 0, 0);
  });

  return (
    <>
      <instancedMesh ref={fill} args={[undefined, undefined, walls.length]}>
        <boxGeometry />
        <meshBasicMaterial transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={wire} args={[undefined, undefined, walls.length]}>
        <boxGeometry />
        <meshBasicMaterial wireframe transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      {[0, 1].map((k) => (
        <mesh key={k} ref={(el) => { if (el) rings.current[k] = el; }} rotation-x={-Math.PI / 2} position-y={0.02}>
          <ringGeometry args={[0.97, 1, 96]} />
          <meshBasicMaterial color={color} transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[0, 0.6, 0]}>
        <icosahedronGeometry args={[0.35, 1]} />
        <meshBasicMaterial color="#eef4ff" wireframe toneMapped={false} />
      </mesh>
    </>
  );
}

export default function MenuScene({ color, intensity, quality }: Props) {
  const dpr: [number, number] = quality === 'high' ? [1, 2] : quality === 'medium' ? [1, 1.5] : [1, 1];
  return (
    <Canvas dpr={dpr} camera={{ fov: 42, position: [0, 14, 15] }} gl={{ antialias: quality !== 'low' }}>
      <color attach="background" args={['#000000']} />
      <fog attach="fog" args={['#000000', 14, 34]} />
      <Sonar color={color} intensity={intensity} />
    </Canvas>
  );
}
