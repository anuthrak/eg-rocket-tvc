// Mission tab: soft particles for pad smoke, Max-Q vapour, separation puffs and landing dust.
import * as THREE from 'three';

const N = 1600;

export function createParticles(scene) {
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N);
  const p = Array.from({ length: N }, () => ({ life: 0, max: 0 }));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uScale: { value: 500 } },
    vertexShader: `uniform float uScale; attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
      varying vec3 vC; varying float vA;
      void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = min(aSize * uScale / max(-mv.z, 0.01), 420.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA;
      void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard;
        gl_FragColor = vec4(vC, vA * pow(1.0 - r, 1.4)); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  let next = 0;
  // o = { x, y, z, vx, vy, vz, life, s0, s1, a, c, drag }
  function emit(o) {
    const q = p[next];
    Object.assign(q, o, { age: 0, max: o.life, life: o.life });
    pos.set([o.x, o.y, o.z], next * 3);
    col.set([o.c, o.c, o.c], next * 3);
    next = (next + 1) % N;
  }
  function update(dt) {
    for (let i = 0; i < N; i++) {
      const q = p[i];
      if (q.life <= 0) { if (alpha[i]) { alpha[i] = 0; size[i] = 0; } continue; }
      q.life -= dt; q.age += dt;
      const k = Math.max(0, 1 - q.drag * dt);
      q.vx *= k; q.vy *= k; q.vz *= k;
      pos[i * 3] += q.vx * dt; pos[i * 3 + 1] += q.vy * dt; pos[i * 3 + 2] += q.vz * dt;
      const u = Math.min(1, q.age / q.max);
      size[i] = q.s0 + (q.s1 - q.s0) * Math.sqrt(u);
      alpha[i] = q.a * Math.min(1, q.age * 12) * Math.pow(1 - u, 1.3);
    }
    for (const a of ['position', 'aColor', 'aSize', 'aAlpha']) geo.attributes[a].needsUpdate = true;
  }
  function clear() { p.forEach(q => { q.life = 0; }); alpha.fill(0); size.fill(0); }

  return { emit, update, clear, setScale(s) { mat.uniforms.uScale.value = s; } };
}
