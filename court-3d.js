'use strict';

const followStartDefaults = { distance: 112, height: 38 };

const courtPlaybackSpeed = Number(getComputedStyle(document.documentElement).getPropertyValue('--court-playback-speed')) || 1;
const courtTime = milliseconds => milliseconds / courtPlaybackSpeed;

const courtBallHistory = new WeakMap();
function trackCourtBallAction(svg, { pattern, step, holder, dribble }, animate) {
  const previous = courtBallHistory.get(svg);
  let action;
  if (animate && previous?.pattern === pattern) {
    if (previous.holder !== holder) action = 'pass';
    // The delayed defense can be rendered a second time for the same step.
    else if (previous.step === step) action = previous.action;
    else if (dribble && step === previous.step + 1) action = 'dribble';
  }
  courtBallHistory.set(svg, { pattern, step, holder, action });
  if (action) svg.dataset.courtBallAction = action;
  else delete svg.dataset.courtBallAction;
  return action;
}

function setupCourt3D(svg, prefix) {
  const controls = document.getElementById('court3dControls').content.cloneNode(true);
  const fields = Object.fromEntries(Array.from(controls.querySelectorAll('[id]'), element => {
    const key = element.id;
    element.id = prefix + key;
    return [key, element];
  }));
  const {
    Court3d: panel, '2d': button2D, '3d': button3D, '3dStatus': status,
    '3dAngles': angles, '3dFollow': follow, FollowSettings: followSettings,
    FollowDistance: followDistance, FollowHeight: followHeight, FollowReset: followReset
  } = fields;
  button2D.setAttribute('aria-controls', svg.id);
  button3D.setAttribute('aria-controls', panel.id);
  svg.before(controls);
  svg.after(panel);
  followDistance.defaultValue = followStartDefaults.distance;
  followHeight.defaultValue = followStartDefaults.height;

  function applyFollowStart() {
    view?.setFollowStart(followDistance.valueAsNumber, followHeight.valueAsNumber);
  }
  followDistance.addEventListener('input', applyFollowStart);
  followHeight.addEventListener('input', applyFollowStart);
  followReset.addEventListener('click', () => {
    followDistance.value = followDistance.defaultValue;
    followHeight.value = followHeight.defaultValue;
    applyFollowStart();
  });
  let view, latest;
  let selected = false;
  let active = false;
  let request = 0;

  function show3D(ready) {
    svg.classList.toggle('court-view-hidden', ready);
    panel.hidden = !ready;
    angles.hidden = !ready;
    followSettings.hidden = !ready || !follow.value;
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

  async function open3D() {
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
        view = createCourt3D(three, OrbitControls, panel, key => {
          if (follow.value === key) return;
          follow.value = key;
          updateFollowSelection();
        });
        applyFollowStart();
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
  }

  button3D.addEventListener('click', open3D);

  angles.addEventListener('click', event => {
    const button = event.target.closest('button[data-angle]');
    if (!button || !view) return;
    follow.value = '';
    followSettings.hidden = true;
    view.setAngle(button.dataset.angle);
  });
  function updateFollowSelection() {
    followSettings.hidden = panel.hidden || !follow.value;
    view?.setFollow(follow.value);
  }
  follow.addEventListener('change', updateFollowSelection);

  return {
    update(frame, animate) {
      latest = { ...frame, ballAction: trackCourtBallAction(svg, frame, animate) };
      if (selected && view) view.setFrame(latest, svg, animate);
    },
    setActive(value) {
      active = value;
      view?.setVisible(selected && !panel.hidden && active);
      if (active && request === 0) open3D();
    }
  };
}

function createCourt3D(T, OrbitControls, panel, onPlayerPick) {
  const width = 500;
  const depth = 360;
  const rim = [250, 52];
  const rimHeight = 85;
  const handHeight = 32;
  const shotRelease = 0.22;
  const screenSetTime = courtTime(260);
  const torsoHeight = 25;
  const ballCarryTime = courtTime(550);
  const ballPassTime = courtTime(630);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const rootStyle = getComputedStyle(document.documentElement);
  const playerSpeed = Number(rootStyle.getPropertyValue('--court-player-speed')) || 1;
  const playerMoveTime = courtTime(550) / playerSpeed;
  const trailingDefenseSpeed = Number(rootStyle.getPropertyValue('--court-trailing-defense-speed')) || 1;
  const defenseArrivalGap = courtTime(Number(rootStyle.getPropertyValue('--court-defense-arrival-gap-ms')) || 190);
  const trailingDefenseMoveTime = playerMoveTime / trailingDefenseSpeed;
  const passDefenseMoveTime = Math.max(trailingDefenseMoveTime, ballPassTime + defenseArrivalGap);
  const dribbleDefenseMoveTime = Math.max(trailingDefenseMoveTime,
    Math.max(ballCarryTime, playerMoveTime) + defenseArrivalGap);
  const defenseColors = Object.fromEntries(['top', 'mid', 'bot'].map(group =>
    [group, rootStyle.getPropertyValue('--' + group).trim()]
  ));
  const scene = new T.Scene();
  scene.background = new T.Color('#111820');
  const camera = new T.OrthographicCamera(-320, 320, 240, -240, 1, 2000);
  const followCamera = new T.PerspectiveCamera(58, 1, 3, 1600);
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
  const limb = new T.CapsuleGeometry(1.9, 5.7, 4, 8);
  const limbAxis = new T.Vector3(0, 1, 0);
  const limbDirection = new T.Vector3();
  const base = new T.CylinderGeometry(10.5, 11.5, 2.2, 24);
  const shoe = new T.BoxGeometry(5.3, 3.4, 8);
  const dark = material('#172431');
  const skin = material('#b97955');
  const players = new Map();
  const hoverRing = mesh(scene, new T.RingGeometry(16, 19, 32),
    new T.MeshBasicMaterial({ color: '#075b65' }));
  hoverRing.rotation.x = -Math.PI / 2;
  hoverRing.visible = false;

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

  function makePlayer(key, number, color) {
    const group = new T.Group();
    group.userData.playerKey = key;
    scene.add(group);
    const jersey = material(color);
    mesh(group, base, jersey, 0, 1.2);
    const body = new T.Group();
    body.name = 'player-body';
    group.add(body);
    mesh(body, torso, jersey, 0, torsoHeight);
    mesh(body, sphere, skin, 0, 39).scale.setScalar(5.2);
    mesh(body, sphere, dark, 0, 41.8, -1.3).scale.set(4.7, 2.2, 4.5);
    const legs = [];
    const arms = [];
    for (const side of [-1, 1]) {
      const sideName = side < 0 ? 'left' : 'right';
      const shoeMesh = mesh(body, shoe, white);
      shoeMesh.name = sideName + '-shoe';
      legs.push({
        side, shoe: shoeMesh, thigh: mesh(body, limb, dark), shin: mesh(body, limb, dark),
        hip: new T.Vector3(), knee: new T.Vector3(), ankle: new T.Vector3()
      });

      const shoulder = new T.Group();
      shoulder.name = sideName + '-shoulder';
      shoulder.position.set(side * 7.4, 30, 0);
      body.add(shoulder);
      mesh(shoulder, limb, skin, 0, -4);
      const elbow = new T.Group();
      elbow.name = sideName + '-elbow';
      elbow.position.y = -8;
      shoulder.add(elbow);
      mesh(elbow, limb, skin, 0, -4);
      mesh(elbow, sphere, skin, 0, -8).scale.setScalar(2.1);
      arms.push({ side, shoulder, elbow });
    }
    const label = new T.Sprite(makeLabel(number, color));
    label.position.y = 54;
    label.scale.set(22, 22, 1);
    label.renderOrder = 5;
    group.add(label);
    const marker = mesh(group, new T.RingGeometry(13, 15, 28), new T.MeshBasicMaterial({
      color: '#c72532', side: T.DoubleSide
    }), 0, 0.3);
    marker.rotation.x = -Math.PI / 2;
    return { key, group, body, legs, arms, marker, jersey, label, color };
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
  let followKey = '';
  let followYaw;
  let lastFollowDraw = 0;
  let followEnd = 0;
  let followDistance = Math.hypot(followStartDefaults.distance, followStartDefaults.height);
  let followStartPitch = Math.atan2(followStartDefaults.height, followStartDefaults.distance);
  let followOrbitYaw = 0;
  let followPitch = followStartPitch;
  const pickRay = new T.Raycaster();
  const pickPoint = new T.Vector2();
  const dragThreshold = 5;
  let gesture = null;
  let hoverPoint = null;

  function playerAt(event, activeCamera) {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (!rect.width || !rect.height || x < 0 || x > 1 || y < 0 || y > 1) return;
    pickPoint.set(2 * x - 1, 1 - 2 * y);
    activeCamera.updateMatrixWorld();
    pickRay.setFromCamera(pickPoint, activeCamera);
    const groups = Array.from(players.values(), player => player.group).filter(group => group.visible);
    const hits = pickRay.intersectObjects(groups, true).filter(({ object, uv }) =>
      object.visible && (!object.isSprite || (uv && Math.hypot(uv.x - 0.5, uv.y - 0.5) <= 0.45))
    );
    // Number badges are rendered over the meshes, so they also take priority for selection.
    let object = (hits.find(hit => hit.object.isSprite) || hits[0])?.object;
    while (object && !object.userData.playerKey) object = object.parent;
    return object?.userData.playerKey;
  }

  function clearPlayerHover() {
    hoverPoint = null;
    if (hoverRing.visible) draw();
  }

  function renderCourt(activeCamera) {
    let hoveredPlayer;
    if (hoverPoint) {
      scene.updateMatrixWorld();
      hoveredPlayer = players.get(playerAt(hoverPoint, activeCamera));
    }
    renderer.domElement.classList.toggle('is-player-hovered', Boolean(hoveredPlayer));
    hoverRing.visible = Boolean(hoveredPlayer);
    if (hoveredPlayer) {
      hoverRing.position.copy(hoveredPlayer.group.position);
      hoverRing.position.y += 0.6;
    }
    renderer.render(scene, activeCamera);
  }

  function endGesture(pointerId = gesture?.id) {
    if (!gesture || pointerId !== gesture.id) return;
    const { follow } = gesture;
    gesture = null;
    if (follow && renderer.domElement.hasPointerCapture(pointerId)) {
      renderer.domElement.releasePointerCapture(pointerId);
    }
  }

  renderer.domElement.addEventListener('pointerdown', event => {
    if (!visible) return;
    if (gesture) {
      gesture.dragged = true;
      return;
    }
    if (!event.isPrimary || event.button !== 0) return;
    clearPlayerHover();
    gesture = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      follow: Boolean(followKey), dragged: false
    };
    if (gesture.follow) renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener('pointerleave', clearPlayerHover);
  renderer.domElement.addEventListener('pointermove', event => {
    if (!gesture) {
      if (visible && onPlayerPick && event.pointerType !== 'touch' && !event.buttons) {
        hoverPoint = { clientX: event.clientX, clientY: event.clientY };
        draw();
      }
      return;
    }
    if (event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.dragged && Math.hypot(dx, dy) < dragThreshold) return;
    gesture.dragged = true;
    if (!gesture.follow) return;
    followOrbitYaw -= dx * 0.008;
    followPitch = T.MathUtils.clamp(followPitch - dy * 0.006, 0.08, 1.23);
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    draw();
  });
  renderer.domElement.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const clicked = !gesture.dragged &&
      Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < dragThreshold;
    endGesture(event.pointerId);
    if (clicked && onPlayerPick) {
      const activeCamera = players.get(followKey)?.group.visible ? followCamera : camera;
      const key = playerAt(event, activeCamera);
      if (key) onPlayerPick(key);
    }
  });
  for (const name of ['pointercancel', 'lostpointercapture']) {
    renderer.domElement.addEventListener(name, event => endGesture(event.pointerId));
  }

  function resetFollowAngles() {
    endGesture();
    followYaw = undefined;
    followOrbitYaw = 0;
    followPitch = followStartPitch;
  }

  function setFollowTarget(key) {
    followKey = key;
    resetFollowAngles();
    controls.enabled = !key;
    renderer.domElement.classList.toggle('is-following', Boolean(key));
  }

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

  function trailingDefenseProgress(t) {
    const approach = t ** 1.5;
    return approach * approach * (3 - 2 * approach);
  }
  const hand = ([x, z]) => [x + 9, handHeight, z - 7];

  function sampleBall(now) {
    const { from, to, start, duration, action, shot } = ballMotion;
    const elapsed = Math.max(0, now - start);
    if (shot && elapsed >= duration) {
      const stage = shot.duration ? clamp((elapsed - duration) / shot.duration) : 1;
      const release = shot.origin;
      if (stage < shotRelease) {
        const lift = eased(stage / shotRelease);
        return to.map((value, axis) => lerp(value, release[axis], lift));
      }
      const t = (stage - shotRelease) / (1 - shotRelease);
      return [
        lerp(release[0], rim[0], t),
        lerp(release[1], rimHeight - 7, t) + 63 * 4 * t * (1 - t),
        lerp(release[2], rim[1], t)
      ];
    }
    const t = duration ? clamp(elapsed / duration) : 1;
    const progress = action === 'pass' ? t : eased(t);
    let y = lerp(from[1], to[1], progress);
    if (action === 'pass') y += 18 * 4 * t * (1 - t);
    if (action === 'dribble') y = 5 + (y - 5) * Math.abs(Math.cos(2 * Math.PI * t));
    return [lerp(from[0], to[0], progress), y, lerp(from[2], to[2], progress)];
  }


  function bendPlayerArm(arm, pitch, spread, bend) {
    arm.shoulder.rotation.set(pitch, 0, arm.side * spread);
    arm.elbow.rotation.x = bend;
  }

  function placeLegSegment(segment, from, to) {
    segment.position.copy(from).lerp(to, 0.5);
    limbDirection.subVectors(to, from);
    segment.scale.y = (limbDirection.length() + 2.8) / 9.5;
    segment.quaternion.setFromUnitVectors(limbAxis, limbDirection.normalize());
  }

  function plantPlayerFoot(leg, hipHeight, width, step, lift, crouch) {
    leg.hip.set(leg.side * 3.8, 17, 0);
    leg.ankle.set(leg.side * width, 4 - hipHeight + lift, step);
    leg.knee.copy(leg.hip).lerp(leg.ankle, 0.5);
    leg.knee.z += 1.6 + crouch * 0.72;
    placeLegSegment(leg.thigh, leg.hip, leg.knee);
    placeLegSegment(leg.shin, leg.knee, leg.ankle);
    leg.shoe.position.copy(leg.ankle);
    leg.shoe.position.z += 1.8;
  }

  function posePlayer(player, phase, now) {
    const stride = Math.sin(phase * 4 * Math.PI);
    const moving = phase < 1;
    let yaw = player.yaw;
    let hipHeight = moving ? Math.abs(stride) * 0.8 : 0;
    let width = 5.2;
    let sideShift = 0;
    let leftStep = stride * 4.8;
    let rightStep = -leftStep;
    let leftLift = moving ? Math.max(0, stride) * 3 : 0;
    let rightLift = moving ? Math.max(0, -stride) * 3 : 0;
    let left = [-0.22 + stride * 0.45, 0.2, -0.32];
    let right = [-0.22 - stride * 0.45, 0.2, -0.32];

    if (player.guard) {
      const man = player.guard === 'man';
      const target = man ? players.get(player.matchup)?.group.position : basketball.position;
      if (target) {
        const dx = target.x - player.group.position.x;
        const dz = target.z - player.group.position.z;
        if (Math.hypot(dx, dz) > 2) yaw = Math.atan2(dx, dz);
      }

      const sideMove = Math.cos(yaw) * (player.x - player.fromX) -
        Math.sin(yaw) * (player.z - player.fromZ);
      const slide = (moving ? stride : 0) * (Math.sign(sideMove) || 1);
      hipHeight = (man ? -2.1 : -6.1) + Math.abs(slide) * (man ? 1.05 : 0.55);
      width = (man ? 6.5 : 10) + Math.abs(slide) * (man ? 1.1 : 1.6);
      sideShift = slide * (man ? 0.7 : 3.5);
      leftStep = man ? 4.6 + slide * 3.5 : slide * 0.8;
      rightStep = -leftStep;
      leftLift = Math.max(0, -slide) * (man ? 2.4 : 1.8);
      rightLift = Math.max(0, slide) * (man ? 2.4 : 1.8);
      if (man) {
        left = [-0.58, 0.78, -0.76];
        right = [-2.02 + slide * 0.24, 0.25, -0.22];
      } else {
        left = right = [-0.22, 1.39, -0.32];
      }
    } else {
      if (player.screenYaw !== undefined) {
        const brace = eased(clamp(player.duration
          ? (phase - 0.58) / 0.42 : (now - player.screenStart) / screenSetTime));
        const turn = player.screenYaw - yaw;
        yaw += Math.atan2(Math.sin(turn), Math.cos(turn)) * brace;
        hipHeight = lerp(hipHeight, -3, brace);
        width = lerp(width, 9.8, brace);
        leftStep *= 1 - brace;
        rightStep *= 1 - brace;
        leftLift *= 1 - brace;
        rightLift *= 1 - brace;
        if (brace > 0) {
          left = [lerp(left[0], -0.72, brace), lerp(left[1], -0.18, brace), lerp(left[2], -1.21, brace)];
          right = [lerp(right[0], -0.72, brace), lerp(right[1], -0.18, brace), lerp(right[2], -1.21, brace)];
        }
      }

      const elapsed = ballMotion ? Math.max(0, now - ballMotion.start) : 0;
      const pass = ballMotion?.action === 'pass' ? ballMotion : null;
      const shot = ballMotion?.shot;
      if (shot?.key === player.key && elapsed >= ballMotion.duration) {
        const stage = shot.duration ? clamp((elapsed - ballMotion.duration) / shot.duration) : 1;
        const rise = clamp(stage / shotRelease);
        const follow = clamp((stage - shotRelease) / (1 - shotRelease));
        yaw = Math.atan2(rim[0] - player.x, rim[1] - player.z);
        hipHeight = -2.6 * (1 - rise) + 5.5 * Math.sin(Math.PI * follow);
        leftLift = rightLift = Math.max(0, hipHeight);
        leftStep = -1;
        rightStep = 1;
        left = [lerp(-0.98, -2.28, rise) + follow * 0.72, 0.28, lerp(-1.4, -0.38, rise)];
        right = [lerp(-1.08, -2.62, rise) + follow * 0.32, 0.12, lerp(-1.42, -0.12, rise) - follow * 0.35];
      } else if (pass && elapsed < pass.duration) {
        const stage = elapsed / pass.duration;
        if (player.key === pass.passer && stage < 0.55) {
          const push = eased(clamp(stage / 0.14 + 0.3));
          const relax = clamp((stage - 0.22) / 0.33);
          yaw = pass.yaw;
          const pitch = lerp(lerp(-0.74, -1.56, push), -0.25, relax);
          const bend = lerp(lerp(-1.35, -0.12, push), -0.28, relax);
          left = right = [pitch, 0.17, bend];
        } else if (player.key === pass.receiver && stage > 0.58) {
          const receive = eased(clamp((stage - 0.58) / 0.24)) * (1 - clamp((stage - 0.89) / 0.11));
          yaw = pass.yaw + Math.PI;
          left = right = [lerp(-0.24, -1.14, receive), 0.24, lerp(-0.28, -0.65, receive)];
        }
      }
    }

    player.body.rotation.y = yaw;
    player.body.position.y = hipHeight;
    player.label.position.y = 54 + hipHeight;
    bendPlayerArm(player.arms[0], ...left);
    bendPlayerArm(player.arms[1], ...right);
    const crouch = Math.max(0, -hipHeight);
    plantPlayerFoot(player.legs[0], hipHeight, width - sideShift, leftStep, leftLift, crouch);
    plantPlayerFoot(player.legs[1], hipHeight, width + sideShift, rightStep, rightLift, crouch);
  }

  function draw(now = performance.now()) {
    if (!visible) return;
    for (const player of players.values()) {
      if (!player.group.visible) continue;
      const t = player.duration ? clamp((now - player.start) / player.duration) : 1;
      const progress = player.trailingDefense ? trailingDefenseProgress(t) : eased(t);
      player.group.position.set(
        lerp(player.fromX, player.x, progress) - width / 2,
        0,
        lerp(player.fromZ, player.z, progress) - depth / 2
      );
      player.phase = t;
    }
    if (ballMotion) {
      const [x, y, z] = sampleBall(now);
      basketball.position.set(x - width / 2, y, z - depth / 2);
      basketball.rotation.set(z / 9, 0, x / 9);
    }
    for (const player of players.values()) {
      if (player.group.visible) posePlayer(player, player.phase, now);
    }
    const followed = players.get(followKey);
    if (!followed?.group.visible) {
      renderCourt(camera);
      return;
    }

    const desiredYaw = followed.body.rotation.y;
    const elapsed = Math.max(0, now - lastFollowDraw);
    if (followYaw === undefined || reducedMotion.matches) {
      followYaw = desiredYaw;
    } else {
      const turn = desiredYaw - followYaw;
      const shortestTurn = Math.atan2(Math.sin(turn), Math.cos(turn));
      followYaw += shortestTurn * (1 - Math.exp(-elapsed / 105));
    }
    lastFollowDraw = now;
    const { x, y, z } = followed.group.position;
    const pivotY = y + followed.body.position.y + torsoHeight;
    const viewYaw = followYaw + followOrbitYaw;
    const forwardX = Math.sin(viewYaw);
    const forwardZ = Math.cos(viewYaw);
    const horizontalDistance = followDistance * Math.cos(followPitch);
    followCamera.position.set(
      x - horizontalDistance * forwardX + 12 * forwardZ,
      pivotY + followDistance * Math.sin(followPitch),
      z - horizontalDistance * forwardZ - 12 * forwardX
    );
    followCamera.lookAt(x, pivotY, z);
    renderCourt(followCamera);
  }

  function schedule() {
    if (!visible || frameRequest) return;
    frameRequest = requestAnimationFrame(now => {
      frameRequest = 0;
      draw(now);
      const ballEnd = ballMotion ? ballMotion.start + ballMotion.duration + (ballMotion.shot?.duration || 0) : 0;
      if (now < Math.max(ballEnd, playerEnd, followKey ? followEnd : 0)) schedule();
    });
  }

  function resize() {
    const { clientWidth, clientHeight } = panel;
    if (!clientWidth || !clientHeight) return;
    const aspect = clientWidth / clientHeight;
    followCamera.aspect = aspect;
    followCamera.updateProjectionMatrix();
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
    setFollowTarget('');
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
    setFollow(key) {
      setFollowTarget(key);
      draw();
      schedule();
    },
    setFollowStart(distance, height) {
      followDistance = Math.hypot(distance, height);
      followStartPitch = Math.atan2(height, distance);
      resetFollowAngles();
      draw();
    },
    setVisible(value) {
      if (value === visible) return;
      visible = value;
      if (!visible) {
        endGesture();
        hoverPoint = null;
        hoverRing.visible = false;
        renderer.domElement.classList.remove('is-player-hovered');
      }
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
      for (const { key, number, x, z, group, gaze, screened, selected, guard, matchup, screen } of frame.players) {
        incoming.add(key);
        const color = defenseColors[group] || '#f9fafb';
        const previous = players.get(key);
        const player = previous || makePlayer(key, number, color);
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
          player.trailingDefense = Boolean(frame.ballAction && guard);
          const moveTime = player.trailingDefense
            ? (frame.ballAction === 'dribble' ? dribbleDefenseMoveTime : passDefenseMoveTime)
            : playerMoveTime;
          player.duration = motion && moving ? moveTime : 0;
          const [lookX, lookZ] = gaze || (moving ? [x + x - player.fromX, z + z - player.fromZ] : rim);
          player.yaw = Math.atan2(lookX - x, lookZ - z);
        }
        player.guard = guard;
        player.matchup = matchup;
        if (screen && (!sameStep || player.screenYaw === undefined)) {
          player.screenStart = motion ? now : now - screenSetTime;
        }
        player.screenYaw = screen ? (Math.hypot(...screen) > 0 ? Math.atan2(...screen) : player.yaw) : undefined;
        if (screen) playerEnd = Math.max(playerEnd, player.screenStart + screenSetTime);
        player.group.visible = true;
        player.marker.visible = Boolean(screened || selected);
        if (player.marker.visible) player.marker.material.color.set(screened ? '#c72532' : '#ffffff');
        playerEnd = Math.max(playerEnd, player.start + player.duration);
      }
      for (const [key, player] of players) player.group.visible = incoming.has(key);

      if (!sameStep || !animate || !ballMotion) {
        const to = hand(frame.ball);
        const from = motion && ballMotion ? sampleBall(now) : to;
        const pass = samePattern && lastFrame.holder !== frame.holder;
        const advancing = samePattern && frame.step === lastFrame.step + 1;
        const duration = motion && (pass || Math.hypot(to[0] - from[0], to[2] - from[2]) > 0.5)
          ? (pass ? ballPassTime : ballCarryTime) : 0;
        let shot = null;
        if (animate && samePattern && !sameStep && frame.shot) {
          const [x, z] = frame.ball;
          const dx = rim[0] - x;
          const dz = rim[1] - z;
          const aimLength = Math.hypot(dx, dz) || 1;
          shot = {
            key: 'a' + frame.holder, duration: motion ? courtTime(660) : 0,
            origin: [x + dx * 10 / aimLength, 48, z + dz * 10 / aimLength]
          };
        }
        ballMotion = {
          from, to, start: now, duration, shot,
          action: pass && duration ? 'pass' : advancing && frame.dribble && duration ? 'dribble' : 'carry',
          passer: pass ? 'a' + lastFrame.holder : null,
          receiver: 'a' + frame.holder,
          yaw: Math.atan2(to[0] - from[0], to[2] - from[2])
        };
      }
      lastFrame = frame;
      followEnd = now + (animate && !reducedMotion.matches ? 480 : 0);
      if (!animate) followYaw = undefined;
      showCourtMarkings(svg);
      draw(now);
      schedule();
    }
  };
}
