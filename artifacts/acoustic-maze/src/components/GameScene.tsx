import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  consumeEvents, createGame, emitPulse, getGuidance, getPathTiles, getVisibility,
  isLaserActive, tickGame, TILE, type GameState, type Input,
} from '../game/engine';
import { audio } from '../game/audio';
import type { Settings } from '../game/storage';
import { SIGNAL_HEX } from '../i18n';

export type HudData = {
  steps: number; echo: number; elapsed: number; guidance: string; warning: string;
  angleToExit: number; shiftIn: number; pulses: number;
};

type Props = {
  levelId: number; runKey: number; paused: boolean; settings: Settings;
  inputRef: MutableRefObject<Input>; sonarReq: MutableRefObject<boolean>;
  onHud: (h: HudData) => void; onWin: (r: { steps: number; seconds: number; echoes: number }) => void;
};

const THEME_TINT: Record<string, string> = {
  standard: '', vault: '#c9d6ff', crystal: '#9ef0ff', water: '#3fe0d0', cyber: '#ff3b55', void: '#eef4ff',
};

function World({ levelId, runKey, paused, settings, inputRef, sonarReq, onHud, onWin }: Props) {
  const game = useMemo<GameState>(() => createGame(levelId), [levelId, runKey]);
  const theme = game.level.theme;
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const cb = useRef({ onHud, onWin }); cb.current = { onHud, onWin };
  const echoes = useRef(0);
  const reported = useRef(false);
  const hudT = useRef(0);
  const { camera, size } = useThree();

  useEffect(() => { echoes.current = 0; reported.current = false; audio.setTheme(theme); }, [game, theme]);

  const sig = useMemo(() => new THREE.Color(SIGNAL_HEX[settings.color]), [settings.color]);
  const wallColor = useMemo(() => {
    const c = sig.clone();
    if (THEME_TINT[theme] && theme !== 'cyber') c.lerp(new THREE.Color(THEME_TINT[theme]), 0.45);
    return c;
  }, [sig, theme]);
  const danger = useMemo(() => new THREE.Color('#ff3b55'), []);
  const wallH = theme === 'vault' ? 3.4 : theme === 'crystal' ? 1.4 : 1.8;
  const thick = theme === 'vault' ? 1.12 : 1;
  const k = settings.intensity;
  const q = settings.quality;

  const fill = useRef<THREE.InstancedMesh>(null);
  const wire = useRef<THREE.InstancedMesh>(null);
  const tiles = useRef<THREE.InstancedMesh>(null);
  const crystals = useRef<THREE.InstancedMesh>(null);
  const player = useRef<THREE.Group>(null);
  const playerMat = useRef<THREE.MeshBasicMaterial>(null);
  const exitG = useRef<THREE.Group>(null);
  const exitMats = useRef<THREE.MeshBasicMaterial[]>([]);
  const hz = useRef<THREE.Group[]>([]);
  const rings = useRef<THREE.Mesh[]>([]);
  const ripples = useRef<THREE.Mesh[]>([]);
  const tileCache = useRef<{ phase: number; list: { x: number; z: number }[] }>({ phase: -1, list: [] });
  const tmpC = useMemo(() => new THREE.Color(), []);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const camTarget = useMemo(() => new THREE.Vector3(game.player.x, 0, game.player.z), [game]);

  const crystalSpots = useMemo(() => theme !== 'crystal' ? [] : game.walls.filter((_, i) => i % 3 === 0), [game, theme]);

  useEffect(() => {
    const q0 = new THREE.Quaternion();
    game.walls.forEach((w, i) => {
      m4.compose(new THREE.Vector3(w.x, wallH / 2, w.z), q0, new THREE.Vector3(w.w * thick, wallH, w.d * thick));
      fill.current?.setMatrixAt(i, m4); wire.current?.setMatrixAt(i, m4);
      fill.current?.setColorAt(i, new THREE.Color(0, 0, 0)); wire.current?.setColorAt(i, new THREE.Color(0, 0, 0));
    });
    [fill, wire].forEach((r) => { if (r.current) { r.current.instanceMatrix.needsUpdate = true; r.current.count = game.walls.length; } });
    crystalSpots.forEach((w, i) => {
      const e = new THREE.Euler(0.3 * i, i, 0.2);
      m4.compose(new THREE.Vector3(w.x, wallH + 0.5, w.z), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(0.45, 0.9 + (i % 3) * 0.3, 0.45));
      crystals.current?.setMatrixAt(i, m4);
      crystals.current?.setColorAt(i, new THREE.Color(0, 0, 0));
    });
    if (crystals.current) crystals.current.instanceMatrix.needsUpdate = true;
    camera.position.set(game.player.x, 16, game.player.z + 10);
    camera.lookAt(game.player.x, 0, game.player.z);
  }, [game, wallH, thick, crystalSpots, m4, camera]);

  useFrame((st, rawDt) => {
    const g = game;
    const dt = Math.min(rawDt, 0.05);
    const t = st.clock.elapsedTime;
    if (!pausedRef.current && !g.won) {
      if (sonarReq.current) {
        sonarReq.current = false;
        if (emitPulse(g)) { echoes.current++; audio.play('sonar'); }
      }
      tickGame(g, inputRef.current, dt);
      for (const e of consumeEvents(g)) if (e !== 'sonar') audio.play(e);
    } else sonarReq.current = false;
    if (g.won && !reported.current) {
      reported.current = true;
      cb.current.onWin({ steps: g.steps, seconds: g.elapsed, echoes: echoes.current });
    }

    // walls
    if (fill.current && wire.current) {
      for (let i = 0; i < g.walls.length; i++) {
        const w = g.walls[i];
        const v = Math.min(1, getVisibility(g, w.x, w.z)) * k;
        const c = theme === 'cyber' && i % 5 === 0 ? danger : wallColor;
        tmpC.copy(c).multiplyScalar(v * 1.3); wire.current.setColorAt(i, tmpC);
        tmpC.multiplyScalar(theme === 'vault' ? 0.32 : 0.18); fill.current.setColorAt(i, tmpC);
      }
      if (wire.current.instanceColor) wire.current.instanceColor.needsUpdate = true;
      if (fill.current.instanceColor) fill.current.instanceColor.needsUpdate = true;
    }
    if (crystals.current) {
      crystalSpots.forEach((w, i) => {
        const v = getVisibility(g, w.x, w.z) * k;
        tmpC.setHSL((0.5 + i * 0.07 + t * 0.03) % 1, 0.8, 0.6).multiplyScalar(v * 1.4);
        crystals.current!.setColorAt(i, tmpC);
      });
      if (crystals.current.instanceColor) crystals.current.instanceColor.needsUpdate = true;
      crystals.current.rotation.y = 0;
    }
    // void tiles
    if (tiles.current && theme === 'void') {
      if (tileCache.current.phase !== g.phase) tileCache.current = { phase: g.phase, list: getPathTiles(g) };
      const list = tileCache.current.list;
      const n = Math.min(list.length, 400);
      tiles.current.count = n;
      for (let i = 0; i < n; i++) {
        const p = list[i];
        m4.makeTranslation(p.x, 0.02 + Math.sin(t * 1.5 + i) * 0.04, p.z);
        tiles.current.setMatrixAt(i, m4);
        tmpC.copy(wallColor).multiplyScalar(getVisibility(g, p.x, p.z) * k);
        tiles.current.setColorAt(i, tmpC);
      }
      tiles.current.instanceMatrix.needsUpdate = true;
      if (tiles.current.instanceColor) tiles.current.instanceColor.needsUpdate = true;
    }
    // hazards
    g.hazards.forEach((h, i) => {
      const grp = hz.current[i]; if (!grp) return;
      const near = Math.hypot(h.x - g.player.x, h.z - g.player.z);
      let v = getVisibility(g, h.x, h.z);
      if (h.kind === 'spike') v = Math.max(v, Math.max(0, 1 - near / (TILE * 1.6)) * 0.9);
      let on = 1;
      if (h.kind === 'laser') on = isLaserActive(g, h) ? 1 : 0.12;
      grp.position.set(h.x, h.kind === 'drone' ? 1.1 + Math.sin(t * 3 + i) * 0.15 : 0, h.z);
      if (h.kind === 'drone') grp.rotation.y = t * 2.4;
      grp.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if (mat && mat.color) mat.color.copy(danger).multiplyScalar(Math.min(1, v) * on * k * (settings.color === 'red' ? 2.2 : 1.4));
      });
    });
    // exit
    if (exitG.current) {
      const v = getVisibility(g, g.exit.x, g.exit.z) * k;
      exitG.current.rotation.y = t * 0.8;
      exitMats.current.forEach((m, i) => m.color.setRGB(1, 1, 1).lerp(sig, i ? 0.6 : 0.1).multiplyScalar(v * (1 + Math.sin(t * 4) * 0.15)));
    }
    // pulses
    rings.current.forEach((r, i) => {
      const p = g.pulses[i];
      const rm = ripples.current[i];
      if (!p) { r.visible = false; if (rm) rm.visible = false; return; }
      const rad = Math.min(p.range, p.age * 10);
      const a = Math.max(0, 1 - rad / p.range) * k;
      r.visible = true; r.position.set(p.x, 0.04, p.z); r.scale.setScalar(Math.max(0.05, rad));
      (r.material as THREE.MeshBasicMaterial).opacity = a;
      if (rm) {
        rm.visible = theme === 'water';
        rm.position.set(p.x, 0.03, p.z); rm.scale.setScalar(Math.max(0.05, rad * 0.72));
        (rm.material as THREE.MeshBasicMaterial).opacity = a * 0.6;
      }
    });
    // player
    if (player.current) {
      player.current.position.lerp(new THREE.Vector3(g.player.x, 0, g.player.z), 0.5);
      player.current.rotation.y = THREE.MathUtils.lerp(player.current.rotation.y, -g.heading, 0.2);
      player.current.children[0].rotation.y = t * 0.9;
      player.current.children[0].position.y = 0.75 + Math.sin(t * 2.2) * 0.08;
      if (playerMat.current) playerMat.current.opacity = inputRef.current.stealth ? 0.35 : 0.95;
    }
    // camera
    const portrait = size.width < size.height;
    camTarget.lerp(new THREE.Vector3(g.player.x, 0, g.player.z), 1 - Math.pow(0.002, dt));
    camera.position.set(camTarget.x, portrait ? 20 : 15, camTarget.z + (portrait ? 9 : 10));
    camera.lookAt(camTarget);

    hudT.current += dt;
    if (hudT.current > 0.1) {
      hudT.current = 0;
      cb.current.onHud({
        steps: g.steps, echo: g.echo, elapsed: g.elapsed, guidance: getGuidance(g), warning: g.warning,
        angleToExit: Math.atan2(g.exit.x - g.player.x, -(g.exit.z - g.player.z)), shiftIn: g.shiftIn, pulses: echoes.current,
      });
    }
  });

  const maxW = Math.max(1, game.walls.length);
  const pool = 10;
  const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false } as const;

  return (
    <>
      <instancedMesh key={`f${runKey}${levelId}`} ref={fill} args={[undefined, undefined, maxW]} frustumCulled={false}>
        <boxGeometry />
        <meshBasicMaterial {...additive} />
      </instancedMesh>
      <instancedMesh key={`w${runKey}${levelId}`} ref={wire} args={[undefined, undefined, maxW]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1, q === 'high' ? 2 : 1, q === 'high' ? 2 : 1, q === 'high' ? 2 : 1]} />
        <meshBasicMaterial wireframe {...additive} />
      </instancedMesh>
      {theme === 'crystal' && (
        <instancedMesh ref={crystals} args={[undefined, undefined, Math.max(1, crystalSpots.length)]} frustumCulled={false}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial wireframe={q === 'low'} {...additive} />
        </instancedMesh>
      )}
      {theme === 'void' && (
        <instancedMesh ref={tiles} args={[undefined, undefined, 400]} frustumCulled={false}>
          <boxGeometry args={[TILE * 0.82, 0.06, TILE * 0.82]} />
          <meshBasicMaterial {...additive} />
        </instancedMesh>
      )}
      {game.hazards.map((h, i) => (
        <group key={`${runKey}-${i}`} ref={(el) => { if (el) hz.current[i] = el; }}>
          {h.kind === 'spike' && [-0.45, 0, 0.45].map((dx) => [-0.45, 0.45].map((dz) => (
            <mesh key={`${dx}${dz}`} position={[dx, 0.3, dz]}>
              <coneGeometry args={[0.18, 0.6, 4]} />
              <meshBasicMaterial wireframe {...additive} />
            </mesh>
          )))}
          {h.kind === 'laser' && (
            <>
              <mesh position-y={0.7}><boxGeometry args={[TILE, 0.05, 0.05]} /><meshBasicMaterial {...additive} /></mesh>
              <mesh position-y={0.35}><boxGeometry args={[TILE, 0.05, 0.05]} /><meshBasicMaterial {...additive} /></mesh>
              <mesh position-y={0.01} rotation-x={-Math.PI / 2}><planeGeometry args={[TILE, 0.6]} /><meshBasicMaterial {...additive} /></mesh>
            </>
          )}
          {h.kind === 'drone' && (
            <>
              <mesh><octahedronGeometry args={[0.42, 0]} /><meshBasicMaterial wireframe {...additive} /></mesh>
              <mesh rotation-x={Math.PI / 2}><torusGeometry args={[0.7, 0.03, 6, 24]} /><meshBasicMaterial {...additive} /></mesh>
            </>
          )}
        </group>
      ))}
      <group ref={exitG} position={[game.exit.x, 0, game.exit.z]}>
        <mesh position-y={1.6}>
          <cylinderGeometry args={[0.5, 0.5, 3.2, 6, 1, true]} />
          <meshBasicMaterial ref={(m) => { if (m) exitMats.current[0] = m; }} wireframe {...additive} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
          <ringGeometry args={[0.7, 1.05, 6]} />
          <meshBasicMaterial ref={(m) => { if (m) exitMats.current[1] = m; }} {...additive} side={THREE.DoubleSide} />
        </mesh>
      </group>
      {Array.from({ length: pool }).map((_, i) => (
        <group key={i}>
          <mesh ref={(el) => { if (el) rings.current[i] = el; }} rotation-x={-Math.PI / 2} visible={false}>
            <ringGeometry args={[0.95, 1, q === 'low' ? 48 : 96]} />
            <meshBasicMaterial color={sig} {...additive} />
          </mesh>
          <mesh ref={(el) => { if (el) ripples.current[i] = el; }} rotation-x={-Math.PI / 2} visible={false}>
            <ringGeometry args={[0.97, 1, 64]} />
            <meshBasicMaterial color="#3fe0d0" {...additive} />
          </mesh>
        </group>
      ))}
      <group ref={player} position={[game.player.x, 0, game.player.z]}>
        <group>
          <mesh>
            <icosahedronGeometry args={[0.38, 1]} />
            <meshBasicMaterial ref={playerMat} color="#eef4ff" wireframe transparent toneMapped={false} />
          </mesh>
          <mesh position-y={-0.45}>
            <coneGeometry args={[0.36, 0.7, 7, 1, true]} />
            <meshBasicMaterial color={sig} wireframe transparent opacity={0.7} toneMapped={false} />
          </mesh>
        </group>
        <mesh position={[0, 0.3, -0.55]} rotation-x={-Math.PI / 2}>
          <coneGeometry args={[0.12, 0.3, 3]} />
          <meshBasicMaterial color={sig} toneMapped={false} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
          <ringGeometry args={[0.55, 0.6, 40]} />
          <meshBasicMaterial color={sig} transparent opacity={0.35} toneMapped={false} />
        </mesh>
      </group>
    </>
  );
}

export default function GameScene(props: Props) {
  const q = props.settings.quality;
  const dpr: [number, number] = q === 'high' ? [1, 2] : q === 'medium' ? [1, 1.4] : [0.75, 1];
  return (
    <Canvas
      key={q}
      dpr={dpr}
      gl={{ antialias: q !== 'low', powerPreference: q === 'low' ? 'low-power' : 'high-performance' }}
      camera={{ fov: 45, near: 0.1, far: 120, position: [2.4, 16, 12] }}
      onPointerDown={() => { props.sonarReq.current = true; }}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={['#000000']} />
      <World {...props} />
    </Canvas>
  );
}
