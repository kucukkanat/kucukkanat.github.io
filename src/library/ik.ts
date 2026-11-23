// Analytic two-bone IK in world space, blended over the animated pose.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Vector3();
const _t = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion();

/** Rotate `bone` (world space) so the point `from` moves towards `to` about the bone's head. */
function aim(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  bone.getWorldPosition(_p);
  const u = from.clone().sub(_p).normalize();
  const v = to.clone().sub(_p).normalize();
  _q.setFromUnitVectors(u, v);
  bone.getWorldQuaternion(_qw);
  _qw.premultiply(_q);
  bone.parent!.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_qw));
  bone.updateMatrixWorld(true);
}

/**
 * upper/lower: the two bones (e.g. upper_arm, forearm); end: the effector (hand socket);
 * target: world point; pole: world point the elbow bends towards; weight 0..1 over the animated pose.
 * Returns how far the target was out of reach (0 = reached).
 */
export function solveTwoBone(upper: THREE.Bone, lower: THREE.Bone, end: THREE.Object3D,
  target: THREE.Vector3, pole: THREE.Vector3, weight: number): number {
  if (weight <= 0) return 0;
  upper.updateMatrixWorld(true);
  const q0u = upper.quaternion.clone(), q0l = lower.quaternion.clone();
  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  const la = _a.distanceTo(_b), lb = _b.distanceTo(_c);
  const full = _a.distanceTo(target);
  const dist = THREE.MathUtils.clamp(full, Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
  _d.copy(target).sub(_a).normalize();
  _t.copy(_a).addScaledVector(_d, dist);
  // elbow: law of cosines in the plane of (shoulder, target, pole)
  const cosA = THREE.MathUtils.clamp((la * la + dist * dist - lb * lb) / (2 * la * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const bendDir = pole.clone().sub(_a);
  bendDir.addScaledVector(_d, -bendDir.dot(_d));
  if (bendDir.lengthSq() < 1e-8) bendDir.set(0, -1, 0);
  bendDir.normalize();
  _e.copy(_a).addScaledVector(_d, la * cosA).addScaledVector(bendDir, la * sinA);
  aim(upper, _b, _e);
  end.getWorldPosition(_c);
  lower.getWorldPosition(_b);
  aim(lower, _c, _t);
  if (weight < 1) {
    upper.quaternion.copy(q0u.slerp(upper.quaternion.clone(), weight));
    lower.quaternion.copy(q0l.slerp(lower.quaternion.clone(), weight));
    upper.updateMatrixWorld(true);
  }
  return Math.max(0, full - (la + lb));
}
