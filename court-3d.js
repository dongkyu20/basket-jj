'use strict';

const courtPlaybackSpeed = Number(getComputedStyle(document.documentElement).getPropertyValue('--court-playback-speed')) || 1;
const courtTime = milliseconds => milliseconds / courtPlaybackSpeed;

function setupAttackCourt3D(svg) {
  const panel = document.getElementById('offCourt3d');
  const button2D = document.getElementById('off2d');
  const button3D = document.getElementById('off3d');
  const status = document.getElementById('off3dStatus');
  const angles = document.getElementById('off3dAngles');
  let view, latest;
  let selected = false;
  let active = false;
  let request = 0;

  function show3D(ready) {
    svg.classList.toggle('court-view-hidden', ready);
    panel.hidden = !ready;
    angles.hidden = !ready;
    button2D.setAttribute('aria-pressed', String(!ready));
    button3D.setAttribute('aria-pressed', String(ready));
    view?.setVisible(ready && active);
  }

  button2D.addEventListener('click', () => {
    selected = false;
    request++;
    button3D.removeAttribute('aria-busy');
    status.textContent = '';
    show3D(false);
  });

  button3D.addEventListener('click', async () => {
    if (selected) return;
    selected = true;
    const currentRequest = ++request;
    button3D.setAttribute('aria-busy', 'true');
    status.textContent = '3D 코트를 불러오는 중…';
    try {
      if (!view) {
        const [three, { OrbitControls }] = await Promise.all([
          import('three'),
          import('three/addons/controls/OrbitControls.js')
        ]);
        if (request !== currentRequest) return;
        view = createAttackCourt3D(three, OrbitControls, panel);
      }
      if (latest) view.setFrame(latest, svg, false);
      show3D(true);
      status.textContent = '';
    } catch (error) {
      if (request !== currentRequest) return;
      selected = false;
      show3D(false);
      status.textContent = '3D 코트를 열 수 없습니다. 2D 화면에서 계속 볼 수 있습니다.';
      console.error('3D court could not be loaded:', error);
    } finally {
      if (request === currentRequest) button3D.removeAttribute('aria-busy');
    }
  });

  angles.addEventListener('click', event => {
    const button = event.target.closest('button[data-angle]');
    if (!button || !view) return;
    view.setAngle(button.dataset.angle);
  });

  return {
    update(frame, animate) {
      latest = frame;
      if (selected && view) view.setFrame(frame, svg, animate);
    },
    setActive(value) {
      active = value;
      view?.setVisible(selected && !panel.hidden && active);
    }
  };
}

function createAttackCourt3D(T, OrbitControls, panel) {
  const width = 500;
  const depth = 360;
  const rim = [250, 52];
  const rimHeight = 85;
  const handHeight = 32;
  const strideTime = courtTime(550);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const rootStyle = getComputedStyle(document.documentElement);
  const defenseColors = Object.fromEntries(['top', 'mid', 'bot'].map(group =>
    [group, rootStyle.getPropertyValue('--' + group).trim()]
  ));
  const scene = new T.Scene();
  scene.background = new T.Color('#111820');
  const camera = new T.OrthographicCamera(-320, 320, 240, -240, 1, 2000);
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', '선수와 공의 위치를 보여 주는 3D 농구 코트');
  panel.replaceChildren(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minZoom = 0.75;
  controls.maxZoom = 2.2;
  controls.maxPolarAngle = Math.PI * 0.42;
  scene.add(new T.HemisphereLight('#fff4e1', '#536679', 2.1));
  const light = new T.DirectionalLight('#fff8ef', 2.1);
  light.position.set(-200, 350, 200);
  scene.add(light);

  function material(color) {
    return new T.MeshStandardMaterial({ color, roughness: 0.76 });
  }

  function mesh(parent, geometry, paint, x = 0, y = 0, z = 0) {
    const object = new T.Mesh(geometry, paint);
    object.position.set(x, y, z);
    parent.add(object);
    return object;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = depth * 2;
  const paint = canvas.getContext('2d');
  paint.fillStyle = '#e1b277';
  paint.fillRect(0, 0, canvas.width, canvas.height);
  const surface = new T.CanvasTexture(canvas);
  surface.colorSpace = T.SRGBColorSpace;
  surface.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const floor = mesh(scene, new T.PlaneGeometry(width, depth), new T.MeshBasicMaterial({ map: surface }));
  floor.rotation.x = -Math.PI / 2;
  mesh(scene, new T.BoxGeometry(width + 8, 8, depth + 8), material('#49382c'), 0, -4.1, 0);

  const hoop = new T.Group();
  hoop.position.set(rim[0] - width / 2, 0, rim[1] - depth / 2);
  scene.add(hoop);
  const post = material('#435467');
  const white = material('#f4f7fb');
  mesh(hoop, new T.BoxGeometry(5, 98, 5), post, 0, 49, -37);
  mesh(hoop, new T.BoxGeometry(5, 5, 24), post, 0, 96, -26);
  mesh(hoop, new T.BoxGeometry(58, 32, 2.5),
    new T.MeshStandardMaterial({ color: '#c5e0ef', transparent: true, opacity: 0.46 }), 0, 94, -13);
  for (const x of [-12, 12]) mesh(hoop, new T.BoxGeometry(1.5, 12, 1), white, x, 91, -11.5);
  for (const y of [85, 97]) mesh(hoop, new T.BoxGeometry(24, 1.5, 1), white, 0, y, -11.5);
  const ring = mesh(hoop, new T.TorusGeometry(8.3, 1.15, 8, 32), material('#ed5716'), 0, rimHeight, 0);
  ring.rotation.x = -Math.PI / 2;
  mesh(hoop, new T.CylinderGeometry(7.7, 4.7, 11, 12, 3, true),
    new T.MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.45 }),
    0, rimHeight - 6, 0);

  const sphere = new T.SphereGeometry(1, 16, 12);
  const torso = new T.CylinderGeometry(7, 5, 16, 12);
  const limb = new T.CapsuleGeometry(2.1, 9, 4, 8);
  const base = new T.CylinderGeometry(10.5, 11.5, 2.2, 24);
  const shoe = new T.BoxGeometry(5.3, 3.4, 8);
  const dark = material('#172431');
  const skin = material('#b97955');
  const players = new Map();

  function makeLabel(number, color) {
    const badge = document.createElement('canvas');
    badge.width = badge.height = 96;
    const context = badge.getContext('2d');
    context.beginPath();
    context.arc(48, 48, 40, 0, 2 * Math.PI);
    context.fillStyle = color;
    context.fill();
    context.lineWidth = 6;
    context.strokeStyle = '#152131';
    context.stroke();
    context.fillStyle = '#152131';
    context.font = 'bold 54px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(number, 48, 50);
    const map = new T.CanvasTexture(badge);
    map.colorSpace = T.SRGBColorSpace;
    return new T.SpriteMaterial({ map, depthTest: false });
  }

  function makePlayer(number, color) {
    const group = new T.Group();
    scene.add(group);
    const jersey = material(color);
    mesh(group, base, jersey, 0, 1.2);
    const body = new T.Group();
    group.add(body);
    mesh(body, torso, jersey, 0, 25);
    mesh(body, sphere, skin, 0, 39).scale.setScalar(5.2);
    mesh(body, sphere, dark, 0, 41.8, -1.3).scale.set(4.7, 2.2, 4.5);
    const legs = [];
    for (const side of [-1, 1]) {
      const leg = new T.Group();
      leg.position.set(side * 3.5, 17, 0);
      body.add(leg);
      mesh(leg, limb, dark, 0, -6.5);
      mesh(leg, shoe, white, 0, -13, 1.8);
      legs.push(leg);
      mesh(body, limb, skin, side * 7.5, 23, 1.3).rotation.z = side * 0.27;
    }
    const label = new T.Sprite(makeLabel(number, color));
    label.position.y = 54;
    label.scale.set(22, 22, 1);
    label.renderOrder = 5;
    group.add(label);
    const screen = mesh(group, new T.RingGeometry(13, 15, 28), new T.MeshBasicMaterial({
      color: '#c72532', side: T.DoubleSide
    }), 0, 0.3);
    screen.rotation.x = -Math.PI / 2;
    return { group, body, legs, screen, jersey, label, color };
  }

  const basketball = new T.Group();
  scene.add(basketball);
  mesh(basketball, sphere, material('#f07a23')).scale.setScalar(4.6);
  for (let i = 0; i < 3; i++) {
    const seam = mesh(basketball, new T.TorusGeometry(4.56, 0.19, 5, 24), dark);
    if (i === 1) seam.rotation.x = Math.PI / 2;
    if (i === 2) seam.rotation.y = Math.PI / 2;
  }

  let visible = false;
  let frameRequest = 0;
  let lastFrame;
  let ballMotion;
  let courtImage = '';
  let playerEnd = 0;

  function showCourtMarkings(svg) {
    const board = svg.cloneNode(true);
    board.querySelectorAll('.mv').forEach(node => node.remove());
    board.setAttribute('width', canvas.width);
    board.setAttribute('height', canvas.height);
    const markup = new XMLSerializer().serializeToString(board).replace(
      /var\(--(top|mid|bot)\)/g, (_, group) => defenseColors[group]
    );
    if (markup === courtImage) return;
    courtImage = markup;
    const image = new Image();
    image.onload = () => {
      if (courtImage !== markup) return;
      paint.clearRect(0, 0, canvas.width, canvas.height);
      paint.drawImage(image, 0, 0);
      surface.needsUpdate = true;
      draw();
    };
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  }

  const clamp = value => Math.max(0, Math.min(1, value));
  const lerp = T.MathUtils.lerp;
  const eased = t => 1 - (1 - t) ** 3;
  const hand = ([x, z]) => [x + 9, handHeight, z - 7];

  function sampleBall(now) {
    const { from, to, start, duration, action, shot } = ballMotion;
    const elapsed = Math.max(0, now - start);
    if (shot && elapsed >= duration) {
      const t = shot.duration ? clamp((elapsed - duration) / shot.duration) : 1;
      return [
        lerp(to[0], rim[0], t),
        lerp(to[1], rimHeight - 7, t) + 63 * 4 * t * (1 - t),
        lerp(to[2], rim[1], t)
      ];
    }
    const t = duration ? clamp(elapsed / duration) : 1;
    const progress = action === 'pass' ? t : eased(t);
    let y = lerp(from[1], to[1], progress);
    if (action === 'pass') y += 18 * 4 * t * (1 - t);
    if (action === 'dribble') y = 5 + (y - 5) * Math.abs(Math.cos(2 * Math.PI * t));
    return [lerp(from[0], to[0], progress), y, lerp(from[2], to[2], progress)];
  }

  function draw(now = performance.now()) {
    if (!visible) return;
    for (const player of players.values()) {
      if (!player.group.visible) continue;
      const t = player.duration ? clamp((now - player.start) / player.duration) : 1;
      const progress = eased(t);
      player.group.position.set(
        lerp(player.fromX, player.x, progress) - width / 2,
        0,
        lerp(player.fromZ, player.z, progress) - depth / 2
      );
      const gait = Math.sin(t * 4 * Math.PI) * 0.48;
      player.legs[0].rotation.x = gait;
      player.legs[1].rotation.x = -gait;
    }
    if (ballMotion) {
      const [x, y, z] = sampleBall(now);
      basketball.position.set(x - width / 2, y, z - depth / 2);
      basketball.rotation.set(z / 9, 0, x / 9);
    }
    renderer.render(scene, camera);
  }

  function schedule() {
    if (!visible || frameRequest) return;
    frameRequest = requestAnimationFrame(now => {
      frameRequest = 0;
      draw(now);
      const ballEnd = ballMotion ? ballMotion.start + ballMotion.duration + (ballMotion.shot?.duration || 0) : 0;
      if (now < Math.max(ballEnd, playerEnd)) schedule();
    });
  }

  function resize() {
    const { clientWidth, clientHeight } = panel;
    if (!clientWidth || !clientHeight) return;
    const aspect = clientWidth / clientHeight;
    const halfWidth = Math.max(310, 205 * aspect);
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfWidth / aspect;
    camera.bottom = -camera.top;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight, false);
    draw();
  }

  function setAngle(angle) {
    if (angle === 'top') camera.position.set(0, 690, 0.5);
    else camera.position.set(185, 490, 500);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, -14);
    controls.update();
    draw();
  }

  controls.addEventListener('change', () => draw());
  new ResizeObserver(resize).observe(panel);
  setAngle('angled');

  return {
    setAngle,
    setVisible(value) {
      if (value === visible) return;
      visible = value;
      if (visible) {
        resize();
        schedule();
      } else if (frameRequest) {
        cancelAnimationFrame(frameRequest);
        frameRequest = 0;
      }
    },
    setFrame(frame, svg, animate) {
      const now = performance.now();
      const samePattern = lastFrame?.pattern === frame.pattern;
      const sameStep = samePattern && lastFrame.step === frame.step;
      const motion = animate && samePattern && !reducedMotion.matches;
      const incoming = new Set();
      draw(now);
      playerEnd = now;
      for (const { key, number, x, z, group, gaze, screened } of frame.players) {
        incoming.add(key);
        const color = defenseColors[group] || '#f9fafb';
        const previous = players.get(key);
        const player = previous || makePlayer(number, color);
        if (!previous) players.set(key, player);
        if (player.color !== color) {
          player.jersey.color.set(color);
          player.label.material.map.dispose();
          player.label.material.dispose();
          player.label.material = makeLabel(number, color);
          player.color = color;
        }
        const continuing = sameStep && previous && player.x === x && player.z === z;
        if (!continuing) {
          player.fromX = motion && previous?.group.visible ? previous.group.position.x + width / 2 : x;
          player.fromZ = motion && previous?.group.visible ? previous.group.position.z + depth / 2 : z;
          player.x = x;
          player.z = z;
          player.start = now;
          const moving = Math.hypot(x - player.fromX, z - player.fromZ) > 0.5;
          player.duration = motion && moving ? strideTime : 0;
          const [lookX, lookZ] = gaze || (moving ? [x + x - player.fromX, z + z - player.fromZ] : rim);
          player.body.rotation.y = Math.atan2(lookX - x, lookZ - z);
        }
        player.group.visible = true;
        player.screen.visible = Boolean(screened);
        playerEnd = Math.max(playerEnd, player.start + player.duration);
      }
      for (const [key, player] of players) player.group.visible = incoming.has(key);

      if (!sameStep || !animate || !ballMotion) {
        const to = hand(frame.ball);
        const from = motion && ballMotion ? sampleBall(now) : to;
        const pass = samePattern && lastFrame.holder !== frame.holder;
        const advancing = samePattern && frame.step === lastFrame.step + 1;
        const duration = motion && (pass || Math.hypot(to[0] - from[0], to[2] - from[2]) > 0.5)
          ? (pass ? courtTime(630) : strideTime) : 0;
        ballMotion = {
          from, to, start: now, duration,
          action: pass && duration ? 'pass' : advancing && frame.dribble && duration ? 'dribble' : 'carry',
          shot: animate && samePattern && !sameStep && frame.shot ? { duration: motion ? courtTime(660) : 0 } : null
        };
      }
      lastFrame = frame;
      showCourtMarkings(svg);
      draw(now);
      schedule();
    }
  };
}
