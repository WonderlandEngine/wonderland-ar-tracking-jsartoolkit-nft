// Ref: https://jaantollander.com/post/noise-filtering-using-one-euro-filter/#mjx-eqn%3A1

const smoothingFactor = (te, cutoff) => {
  const r = 2 * Math.PI * cutoff * te;
  return r / (r + 1);
};

const exponentialSmoothing = (a, x, xPrev) => {
  return a * x + (1 - a) * xPrev;
};

export class OneEuroFilter {
  dCutOff = 1; // period in milliseconds, so default to 1 = 1Hz

  xPrev = null;
  dxPrev = null;
  tPrev = null;
  initialized = false;

  minCutOff: number;
  beta: number;

  dxHat: Float32Array;
  xHat: Float32Array;

  constructor({ minCutOff, beta }) {
    this.minCutOff = minCutOff;
    this.beta = beta;
  }

  reset() {
    this.initialized = false;
  }

  filter(t: number, x: Float32Array) {
    if (!this.initialized) {
      this.initialized = true;
      this.xPrev = x.slice();
      this.dxPrev = x.slice().fill(0);
      this.tPrev = t;

      this.dxHat = new Float32Array(x.length);
      this.xHat = new Float32Array(x.length);

      return x;
    }

    const { xPrev, tPrev, dxPrev } = this;

    const te = t - tPrev;

    const ad = smoothingFactor(te, this.dCutOff);

    for (let i = 0; i < x.length; ++i) {
      // The filtered derivative of the signal.
      const dx = (x[i] - xPrev[i]) / te;
      this.dxHat[i] = exponentialSmoothing(ad, dx, dxPrev[i]);

      // The filtered signal
      const cutOff = this.minCutOff + this.beta * Math.abs(this.dxHat[i]);
      const a = smoothingFactor(te, cutOff);
      this.xHat[i] = exponentialSmoothing(a, x[i], xPrev[i]);
    }

    // update prev
    xPrev.set(this.xHat);
    dxPrev.set(this.dxHat);
    this.tPrev = t;

    return this.xHat;
  }
}
