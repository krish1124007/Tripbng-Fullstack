// Liveness / readiness state. Liveness flips false only on uncaught crashes; readiness
// flips off during startup before deps are wired and during graceful shutdown. Kubernetes-
// style: a failed liveness probe restarts the container; a failed readiness probe pulls
// the pod out of the load balancer.
let ready = false;
let live = true;

export function setReady(value: boolean): void {
  ready = value;
}

export function setLive(value: boolean): void {
  live = value;
}

export function isReady(): boolean {
  return ready;
}

export function isLive(): boolean {
  return live;
}
