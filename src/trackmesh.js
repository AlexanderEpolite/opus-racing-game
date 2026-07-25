import * as THREE from 'three';
import * as TX from './textures.js';

/**
 * Turns the abstract Track into geometry.
 *
 * Everything is built as "strips" that run along the centreline: the road, its
 * kerbs, the dirt run-off, the barriers, and the underside of the deck. A strip
 * is defined by two edges, each of which is a (lateral, height) offset from the
 * banked centreline frame -- that one primitive covers flat surfaces and vertical
 * walls alike.
 */

const KERB_WIDTH = 1.2;
const KERB_LIFT = 0.07;
const DECK_THICKNESS = 1.3;
const RAIL_BOTTOM = 0.5;
const RAIL_TOP = 1.45;

/**
 * @param {Track} track
 * @param {(hw:number)=>{x:number,y:number}} edgeA
 * @param {(hw:number)=>{x:number,y:number}} edgeB
 * @param {object} opts  vScale = metres per texture repeat along the track
 */
function buildStrip(track, edgeA, edgeB, opts = {}) {
  const { vScale = 12, skipGaps = true } = opts;
  const n = track.sampleCount;
  const frame = track.frameAt(0);
  const positions = [];
  const uvs = [];
  const indices = [];

  // One extra ring so the loop closes with continuous UVs.
  for (let i = 0; i <= n; i++) {
    const s = i * track.sampleSpacing;
    track.frameAt(s, frame);
    const hw = frame.halfWidth;
    for (const edge of [edgeA(hw), edgeB(hw)]) {
      positions.push(
        frame.position.x + frame.right.x * edge.x + frame.normal.x * edge.y,
        frame.position.y + frame.right.y * edge.x + frame.normal.y * edge.y,
        frame.position.z + frame.right.z * edge.x + frame.normal.z * edge.y
      );
    }
    uvs.push(0, s / vScale, 1, s / vScale);
  }

  const solid = (i) => !skipGaps || !track.isGapSample[i % n];
  for (let i = 0; i < n; i++) {
    if (!solid(i) || !solid(i + 1)) continue;
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return { geo };
}

/** Sample indices where solid road meets a gap, so we can cap the cut ends. */
function findGapEdges(track) {
  const n = track.sampleCount;
  const edges = [];
  for (let i = 0; i < n; i++) {
    const here = !track.isGapSample[i];
    const next = !track.isGapSample[(i + 1) % n];
    if (here && !next) edges.push({ index: i, facing: 1 });
    if (!here && next) edges.push({ index: (i + 1) % n, facing: -1 });
  }
  return edges;
}

function makeMesh(geo, material, name) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export function buildTrackMesh(track) {
  const group = new THREE.Group();
  group.name = 'circuit';

  const roadTex = TX.roadTexture();
  roadTex.repeat.set(1, 1);
  const kerbTex = TX.kerbTexture();
  const dirtTex = TX.shoulderTexture();

  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92, metalness: 0.02 });
  const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.6 });
  const dirtMat = new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1.0 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x4a4a55, roughness: 0.95 });
  const railMat = new THREE.MeshStandardMaterial({
    color: 0xd7dbe4, roughness: 0.35, metalness: 0.75, side: THREE.DoubleSide,
  });

  const shoulder = track.shoulderWidth();
  const dirtInner = KERB_WIDTH;
  const wall = shoulder;

  // --- Road surface -------------------------------------------------------
  group.add(makeMesh(
    buildStrip(track, (hw) => ({ x: -hw, y: 0 }), (hw) => ({ x: hw, y: 0 }), { vScale: 13 }).geo,
    roadMat, 'road'
  ));

  // --- Kerbs --------------------------------------------------------------
  for (const side of [-1, 1]) {
    group.add(makeMesh(
      buildStrip(
        track,
        (hw) => ({ x: side * hw, y: 0 }),
        (hw) => ({ x: side * (hw + KERB_WIDTH), y: KERB_LIFT }),
        { vScale: 2.4 }
      ).geo,
      kerbMat, `kerb${side}`
    ));
  }

  // --- Dirt run-off -------------------------------------------------------
  for (const side of [-1, 1]) {
    group.add(makeMesh(
      buildStrip(
        track,
        (hw) => ({ x: side * (hw + dirtInner), y: KERB_LIFT }),
        (hw) => ({ x: side * (hw + wall), y: -0.35 }),
        { vScale: 9 }
      ).geo,
      dirtMat, `dirt${side}`
    ));
  }

  // --- Deck underside and skirts (makes viaducts read as solid) -----------
  group.add(makeMesh(
    buildStrip(
      track,
      (hw) => ({ x: -(hw + wall), y: -DECK_THICKNESS }),
      (hw) => ({ x: hw + wall, y: -DECK_THICKNESS }),
      { vScale: 10 }
    ).geo,
    deckMat, 'deck'
  ));
  for (const side of [-1, 1]) {
    group.add(makeMesh(
      buildStrip(
        track,
        (hw) => ({ x: side * (hw + wall), y: -0.35 }),
        (hw) => ({ x: side * (hw + wall), y: -DECK_THICKNESS }),
        { vScale: 10 }
      ).geo,
      deckMat, `skirt${side}`
    ));
  }

  // --- Barriers -----------------------------------------------------------
  for (const side of [-1, 1]) {
    const railGeo = buildStrip(
      track,
      (hw) => ({ x: side * (hw + wall), y: RAIL_BOTTOM }),
      (hw) => ({ x: side * (hw + wall), y: RAIL_TOP }),
      { vScale: 10 }
    ).geo;
    const rail = makeMesh(railGeo, railMat, `rail${side}`);
    rail.castShadow = false;
    group.add(rail);
  }
  group.add(buildRailPosts(track, wall));

  // --- Cut faces where the road stops at a gap ----------------------------
  group.add(buildGapCaps(track, wall, deckMat));

  const boostPads = buildBoostPads(track);
  group.add(boostPads.group);

  group.add(buildFinishLine(track));
  const gantry = buildStartGantry(track);
  group.add(gantry);
  group.add(buildBanners(track, wall));

  group.updateMatrixWorld(true);

  return { group, boostPads: boostPads.pads };
}

function buildRailPosts(track, wall) {
  const spacing = 7.5;
  const count = Math.floor(track.length / spacing);
  const geo = new THREE.CylinderGeometry(0.11, 0.13, RAIL_TOP + 0.3, 6);
  geo.translate(0, (RAIL_TOP + 0.3) / 2 - 0.2, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8b90a0, roughness: 0.5, metalness: 0.7 });

  const slots = [];
  const frame = track.frameAt(0);
  const dummy = new THREE.Object3D();
  const q = new THREE.Quaternion();
  const yUp = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const s = i * spacing;
    if (track.inGap(s)) continue;
    track.frameAt(s, frame);
    q.setFromUnitVectors(yUp, frame.normal);
    for (const side of [-1, 1]) {
      dummy.position
        .copy(frame.position)
        .addScaledVector(frame.right, side * (frame.halfWidth + wall + 0.02));
      dummy.quaternion.copy(q);
      dummy.updateMatrix();
      slots.push(dummy.matrix.clone());
    }
  }

  const mesh = new THREE.InstancedMesh(geo, mat, slots.length);
  slots.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.name = 'railPosts';
  return mesh;
}

/** Vertical faces closing off the road where it is interrupted by a gap. */
function buildGapCaps(track, wall, mat) {
  const positions = [];
  const frame = track.frameAt(0);
  const edges = findGapEdges(track);
  for (const e of edges) {
    track.frameAt(e.index * track.sampleSpacing, frame);
    const hw = frame.halfWidth + wall;
    const a = frame.position.clone().addScaledVector(frame.right, -hw);
    const b = frame.position.clone().addScaledVector(frame.right, hw);
    const down = frame.normal.clone().multiplyScalar(-DECK_THICKNESS);
    const c = b.clone().add(down);
    const d = a.clone().add(down);
    const quad = e.facing > 0 ? [a, b, c, a, c, d] : [b, a, d, b, d, c];
    for (const v of quad) positions.push(v.x, v.y, v.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'gapCaps';
  return mesh;
}

function buildBoostPads(track) {
  const group = new THREE.Group();
  group.name = 'boostPads';
  const tex = TX.boostTexture();
  const pads = [];
  const frame = track.frameAt(0);

  for (const pad of track.boostPads) {
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const geo = new THREE.PlaneGeometry(pad.halfWidth * 2, pad.halfLength * 2 * 2.4);
    const mesh = new THREE.Mesh(geo, mat);
    track.frameAt(pad.s, frame);
    mesh.position.copy(frame.position)
      .addScaledVector(frame.right, pad.x)
      .addScaledVector(frame.normal, 0.06);
    // Lay flat, then align to the road's banked frame with the arrows pointing
    // in the direction of travel.
    const m = new THREE.Matrix4().makeBasis(
      frame.right,
      frame.normal,
      frame.tangent.clone().negate()
    );
    mesh.quaternion.setFromRotationMatrix(m);
    mesh.rotateX(-Math.PI / 2);
    mesh.renderOrder = 2;
    group.add(mesh);
    pads.push({ def: pad, mesh, mat });
  }
  return { group, pads };
}

function buildFinishLine(track) {
  const frame = track.frameAt(0);
  const tex = TX.checkerTexture();
  tex.repeat.set(10, 2);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  const geo = new THREE.PlaneGeometry(frame.halfWidth * 2, 4);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(frame.position).addScaledVector(frame.normal, 0.045);
  const m = new THREE.Matrix4().makeBasis(frame.right, frame.normal, frame.tangent.clone().negate());
  mesh.quaternion.setFromRotationMatrix(m);
  mesh.rotateX(-Math.PI / 2);
  mesh.receiveShadow = true;
  mesh.name = 'finishLine';
  return mesh;
}

function buildStartGantry(track) {
  const group = new THREE.Group();
  group.name = 'gantry';
  const frame = track.frameAt(0);
  const hw = frame.halfWidth;

  const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3d, roughness: 0.5, metalness: 0.5 });
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x1b1f2b, roughness: 0.6 });

  const legGeo = new THREE.BoxGeometry(1.1, 9, 1.1);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.copy(frame.position)
      .addScaledVector(frame.right, side * (hw + 2.2))
      .addScaledVector(frame.normal, 4.5);
    leg.castShadow = true;
    group.add(leg);
  }

  const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 6, 2.4, 1.0), beamMat);
  beam.position.copy(frame.position).addScaledVector(frame.normal, 9.6);
  beam.castShadow = true;
  group.add(beam);

  // Text panel on the gantry.
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, '#ff6b3d');
  grad.addColorStop(0.5, '#ffd23f');
  grad.addColorStop(1, '#35d1ff');
  ctx.fillStyle = '#0e1119';
  ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = grad;
  ctx.font = 'bold 74px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SUNSET RIDGE GP', 512, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(hw * 2 + 5, 2.0),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  panel.position.copy(beam.position).addScaledVector(frame.tangent, -0.55);
  const m = new THREE.Matrix4().makeBasis(
    frame.right, frame.normal, frame.tangent.clone().negate()
  );
  panel.quaternion.setFromRotationMatrix(m);
  group.add(panel);

  // Aim the whole rig down the road.
  const yaw = Math.atan2(frame.tangent.x, frame.tangent.z);
  for (const child of group.children) {
    if (child === panel) continue;
    child.rotation.y = yaw;
  }
  return group;
}

/**
 * Trackside hoardings. Every panel is merged into a single geometry (plus a
 * matching one wound the other way for the plain backs) so the whole set costs
 * two draw calls and no panel ever shows mirrored lettering.
 */
function buildBanners(track, wall) {
  const group = new THREE.Group();
  group.name = 'banners';
  const frame = track.frameAt(0);
  const SPACING = 46;
  const LENGTH = 24;
  const HEIGHT = 2.4;

  const front = { pos: [], uv: [], idx: [] };
  const back = { pos: [], uv: [], idx: [] };
  const along = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const outward = new THREE.Vector3();

  for (let s = 20; s < track.length - LENGTH; s += SPACING) {
    if (track.inGap(s) || track.inGap(s + LENGTH)) continue;
    track.frameAt(s + LENGTH / 2, frame);
    for (const side of [-1, 1]) {
      // Skip the inside of a corner, where a hoarding would hide the apex.
      // Negative curvature is a right-hander, whose inside is the driver's right.
      if (frame.curvature * side < -0.002) continue;

      outward.copy(frame.right).multiplyScalar(side).setY(0).normalize();
      along.crossVectors(up, outward).normalize();

      const centre = frame.position.clone()
        .addScaledVector(frame.right, side * (frame.halfWidth + wall + 0.7))
        .addScaledVector(frame.normal, 1.0);

      // Corners: bottom-left, bottom-right, top-right, top-left as seen from
      // the track side.
      const corners = [
        centre.clone().addScaledVector(along, -LENGTH / 2),
        centre.clone().addScaledVector(along, LENGTH / 2),
        centre.clone().addScaledVector(along, LENGTH / 2).addScaledVector(up, HEIGHT),
        centre.clone().addScaledVector(along, -LENGTH / 2).addScaledVector(up, HEIGHT),
      ];
      const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];

      for (const [target, winding] of [[front, [0, 1, 2, 0, 2, 3]], [back, [0, 2, 1, 0, 3, 2]]]) {
        const base = target.pos.length / 3;
        for (let i = 0; i < 4; i++) {
          target.pos.push(corners[i].x, corners[i].y, corners[i].z);
          target.uv.push(uvs[i][0], uvs[i][1]);
        }
        for (const i of winding) target.idx.push(base + i);
      }
    }
  }

  const toMesh = (data, material, name) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
    geo.setIndex(data.idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    return mesh;
  };

  group.add(toMesh(
    front,
    new THREE.MeshStandardMaterial({ map: TX.bannerTexture(), roughness: 0.85 }),
    'bannerFronts'
  ));
  group.add(toMesh(
    back,
    new THREE.MeshStandardMaterial({ color: 0x2b2e3a, roughness: 0.9 }),
    'bannerBacks'
  ));
  return group;
}
