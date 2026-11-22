// Landing tab: the orbit-scale scene (Mars from 200 km down to ~12 km), drawn behind the ship.
// Units are km. The ship stays at the origin with world up = +y and prograde = +x (the same frame as the ground scene),
// so the planet sits below at (0, -(R + h), 0) and turns about z as the ship flies over it. The ship itself is drawn
// in a second pass by landing.js at metre scale, with the same camera orientation.
import * as THREE from 'three';

export const R_MARS = 3389.5;

const NOISE = /* glsl */`
  float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 7; i++) { s += a * n3(p); p *= 2.03; a *= 0.5; } return s; }
`;

export function createOrbitScene(sunDir) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 1e6);
  const sun = sunDir.clone().normalize();

  // The planet: procedural albedo (ochre plains, dark basaltic regions, bright dust, polar cap), relief shading,
  // a soft terminator and haze toward the limb
  const planet = new THREE.Mesh(new THREE.SphereGeometry(R_MARS, 256, 160), new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sun } },
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vW;
      void main(){ vP = position / ${R_MARS.toFixed(1)}; vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uSun; varying vec3 vP; varying vec3 vN; varying vec3 vW; ${NOISE}
      void main(){
        vec3 p = vP * 3.0;
        float big = fbm(p * 0.9 + 4.0), dark = smoothstep(0.52, 0.62, fbm(p * 1.6 + 9.0) + 0.15 * big);
        float fine = fbm(p * 24.0), finer = fbm(p * 140.0);
        vec3 ochre = vec3(0.88, 0.40, 0.15), rust = vec3(0.64, 0.23, 0.09), basalt = vec3(0.30, 0.12, 0.06), dust = vec3(0.98, 0.58, 0.30);
        vec3 c = mix(ochre, rust, smoothstep(0.35, 0.7, big));
        c = mix(c, dust, smoothstep(0.55, 0.75, fine) * 0.5);
        c = mix(c, basalt, dark * 0.75);
        c *= 0.78 + 0.44 * finer;
        float cap = smoothstep(0.88, 0.92, abs(vP.z) + 0.03 * fine);   // poles on the z axis: the ship flies over the equator
        c = mix(c, vec3(0.95, 0.93, 0.9), cap);
        // relief: tilt the normal by the noise gradient (cheap bump)
        float e = 0.002; vec3 q = p * 24.0;
        vec3 g = vec3(fbm(q + vec3(e,0,0)), fbm(q + vec3(0,e,0)), fbm(q + vec3(0,0,e))) - fine;
        vec3 n = normalize(vN - g * 34.0);
        float d = dot(n, uSun), lit = smoothstep(-0.03, 0.3, dot(normalize(vN), uSun)) * (0.12 + 0.95 * max(d, 0.0));
        vec3 V = normalize(cameraPosition - vW);
        float limb = pow(1.0 - max(dot(normalize(vN), V), 0.0), 3.0);
        vec3 haze = vec3(1.0, 0.55, 0.26);
        c = mix(c * lit * 1.15, haze * smoothstep(-0.1, 0.3, dot(normalize(vN), uSun)), limb * 0.55);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  scene.add(planet);

  // Thin cloud / dust shell at ~20 km
  const cloud = new THREE.Mesh(new THREE.SphereGeometry(R_MARS + 20, 192, 128), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uSun: { value: sun }, uT: { value: 0 } },
    vertexShader: `varying vec3 vP; varying vec3 vN; void main(){ vP = position / ${(R_MARS + 20).toFixed(1)}; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uSun; uniform float uT; varying vec3 vP; varying vec3 vN; ${NOISE}
      void main(){ float n = fbm(vP * 9.0 + vec3(uT * 0.002, 0.0, 0.0)) * 0.7 + fbm(vP * 60.0) * 0.3;
        float a = smoothstep(0.5, 0.75, n) * 0.55;
        float lit = smoothstep(-0.1, 0.3, dot(normalize(vN), uSun));
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.85) * (0.3 + 0.7 * lit), a * (0.25 + 0.75 * lit)); }`,
  }));
  scene.add(cloud);

  // Atmosphere: a glowing shell that shows as a thin bright limb, blue-ish where the sun grazes it
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R_MARS + 60, 128, 96), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uSun: { value: sun } },
    vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vW;
      void main(){ vec3 V = normalize(cameraPosition - vW); float d = max(dot(normalize(vN), V), 0.0);
        float rim = pow(1.0 - d, 3.5) * smoothstep(0.0, 0.12, d);
        float lit = smoothstep(-0.2, 0.4, dot(normalize(vN), uSun));
        // dusty orange haze over the disc, a thin blue line right at the limb (as in Mars sunset photos)
        vec3 c = mix(vec3(1.0, 0.55, 0.25) * 0.9, vec3(1.0, 0.85, 0.7) * 1.2, smoothstep(0.85, 0.98, 1.0 - d));   // an orange glow, white-hot at the very limb
        gl_FragColor = vec4(c * rim * lit * 1.1, 1.0); }`,
  }));
  scene.add(atmo);

  // Stars and a small sun
  {
    const n = 6000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos.set([r * Math.cos(a) * 5e5, u * 5e5, r * Math.sin(a) * 5e5], i * 3);
      const b = Math.pow(Math.random(), 3) * 0.9 + 0.1; col.set([b, b, b * (0.9 + Math.random() * 0.2)], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, vertexColors: true, depthWrite: false })));
    const s = new THREE.Mesh(new THREE.SphereGeometry(1200, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff4e0 }));
    s.position.copy(sun).multiplyScalar(4e5); scene.add(s);
  }

  const group = [planet, cloud, atmo];
  return {
    scene, camera,
    // h: ship altitude (km); phi: how far the planet has turned under the ship (rad); camOffM / quat: the ship camera's
    // offset from the ship (metres) and orientation, so both passes line up
    set(h, phi, camOffM, quat, t) {
      for (const m of group) { m.position.set(0, -(R_MARS + h), 0); m.rotation.set(0.35, 0, phi); }
      cloud.material.uniforms.uT.value = t;
      camera.position.copy(camOffM).multiplyScalar(0.001);
      camera.quaternion.copy(quat);
      const near = Math.max(0.05, h * 0.25);
      if (Math.abs(camera.near - near) / near > 0.2) { camera.near = near; camera.updateProjectionMatrix(); }
    },
    resize(aspect, fov) { camera.aspect = aspect; camera.fov = fov; camera.updateProjectionMatrix(); },
  };
}
