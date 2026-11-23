// Filtre « One Euro » (Casiez et al., 2012) : lisse les tremblements à basse vitesse sans ajouter de retard aux mouvements rapides.
class LowPass {
  constructor() { this.y = null; }
  filter(x, a) { this.y = this.y === null ? x : a * x + (1 - a) * this.y; return this.y; }
}
const alpha = (cutoff, dt) => { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); };

export class OneEuro {
  constructor({ minCutoff = 1.2, beta = 0.02, dCutoff = 1.0 } = {}) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.x = new LowPass(); this.dx = new LowPass(); this.t = null; this.prev = null;
  }
  filter(value, tMs) {
    const dt = this.t === null ? 1 / 30 : Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const d = this.prev === null ? 0 : (value - this.prev) / dt;
    this.prev = value;
    const ed = this.dx.filter(d, alpha(this.dCutoff, dt));
    return this.x.filter(value, alpha(this.minCutoff + this.beta * Math.abs(ed), dt));
  }
  reset() { this.x = new LowPass(); this.dx = new LowPass(); this.t = null; this.prev = null; }
}

// Un filtre par coordonnée de chaque point (landmarks de visage ou de main).
export class PointsFilter {
  constructor(opts) { this.opts = opts; this.f = []; }
  filter(points, tMs) {
    return points.map((p, i) => {
      const f = (this.f[i] ||= [new OneEuro(this.opts), new OneEuro(this.opts), new OneEuro(this.opts)]);
      return { x: f[0].filter(p.x, tMs), y: f[1].filter(p.y, tMs), z: f[2].filter(p.z || 0, tMs) };
    });
  }
  reset() { this.f = []; }
}
