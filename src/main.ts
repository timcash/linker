import './style.css';
import * as THREE from 'three';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#020617');

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.z = 3.2;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.setAttribute('aria-label', 'Three.js canvas');
document.body.append(renderer.domElement);

const geometry = new THREE.TorusKnotGeometry(0.72, 0.22, 192, 32);
const material = new THREE.MeshStandardMaterial({
  color: '#7dd3fc',
  metalness: 0.25,
  roughness: 0.18,
});
const knot = new THREE.Mesh(geometry, material);
scene.add(knot);

scene.add(new THREE.AmbientLight(0xffffff, 0.65));

const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
keyLight.position.set(3, 2, 4);
scene.add(keyLight);

const fillLight = new THREE.PointLight(0x38bdf8, 12, 10);
fillLight.position.set(-2.5, -1.5, 1.5);
scene.add(fillLight);

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', resize);

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const elapsed = clock.getElapsedTime();
  knot.rotation.x = elapsed * 0.35;
  knot.rotation.y = elapsed * 0.55;
  knot.position.y = Math.sin(elapsed * 1.2) * 0.08;
  renderer.render(scene, camera);
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener('resize', resize);
    renderer.setAnimationLoop(null);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  });
}
