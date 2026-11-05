// Mission tab: a live close-up of the gimbal, in the panel under the mini bench. It has its own small scene and
// renderer, draws at 30 fps at most, and stops drawing while the panel is hidden.
import * as THREE from 'three';

export function createNozzleView(el) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
  catch { el.hidden = true; return { update() {} }; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1.6, 0.05, 30);
  camera.position.set(1.9, -0.25, 2.6);
  camera.lookAt(0, -0.42, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xfff3e6, 2.2); sun.position.set(2, 3, 4); scene.add(sun);

  const white = new THREE.MeshStandardMaterial({ color: 0xe8e8ec, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8b9099, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.7, 40), white); body.position.y = 0.35; scene.add(body);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.425, 0.425, 0.1, 40), dark); base.position.y = 0.05; scene.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.022, 12, 40), metal); ring.rotation.x = Math.PI / 2; scene.add(ring);

  // Nozzle: pivots at the origin, like the rocket's
  const nozzle = new THREE.Group(); nozzle.rotation.order = 'XYZ'; scene.add(nozzle);
  const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.14, 24), metal); throat.position.y = -0.07; nozzle.add(throat);
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.27, 0.46, 32, 1, true), metal); bell.position.y = -0.37; nozzle.add(bell);

  const plumeMat = (color, k) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uC: { value: new THREE.Color(color) }, uK: { value: k } },
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ vY = position.y; vec4 mv = modelViewMatrix*vec4(position,1.0);
        vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uC; uniform float uK; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ float along = pow(clamp(1.0 + vY, 0.0, 1.0), 1.6);
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.3);
        gl_FragColor = vec4(uC * along * edge * uK, 1.0); }`,
  });
  const plumeGeo = new THREE.ConeGeometry(1, 1, 24, 1, true); plumeGeo.rotateX(Math.PI); plumeGeo.translate(0, -0.5, 0);
  const plume = new THREE.Group(); plume.position.y = -0.6;
  const inner = new THREE.Mesh(plumeGeo, plumeMat(0xfff0c8, 1)); inner.scale.set(0.45, 0.55, 0.45);
  plume.add(new THREE.Mesh(plumeGeo, plumeMat(0xff7a2f, 0.75)), inner);
  nozzle.add(plume);

  // Where the edge of the bell reaches at the ±8° limit
  const limitPts = [];
  for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2, r = 0.6 * Math.tan(8 * Math.PI / 180) + 0.27; limitPts.push(new THREE.Vector3(r * Math.cos(a), -0.6, r * Math.sin(a))); }
  const limit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(limitPts),
    new THREE.LineDashedMaterial({ color: 0xff4d5e, dashSize: 0.05, gapSize: 0.04, transparent: true, opacity: 0.7 }));
  limit.computeLineDistances(); scene.add(limit);

  let last = 0, w = 0, h = 0;
  return {
    // gp, gy = gimbal angles in radians (same as the rocket's nozzles), thr = 0..1
    update(now, gp, gy, thr) {
      if (now - last < 33 || !el.offsetWidth || !el.offsetHeight) return;
      last = now;
      if (el.clientWidth !== w || el.clientHeight !== h) {
        w = el.clientWidth; h = el.clientHeight;
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
      }
      nozzle.rotation.set(gy, 0, gp);
      plume.visible = thr > 0.02;
      if (plume.visible) { const f = thr * (0.9 + Math.random() * 0.2); plume.scale.set(0.24, 0.75 * f, 0.24); }
      renderer.render(scene, camera);
    },
  };
}
