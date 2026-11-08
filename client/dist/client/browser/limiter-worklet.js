/**
 * Limiteur à anticipation (lookahead) pour la sortie master.
 *
 * Contrairement au DynamicsCompressorNode, le gain ne suit pas chaque crête de l'onde :
 * on calcule le gain nécessaire pour chaque échantillon, on garde le minimum sur une
 * fenêtre de maintien (plus longue qu'une période de basse), on remonte lentement
 * (release), puis on lisse par une moyenne glissante de la durée d'anticipation.
 * Le signal est retardé d'autant : le gain a fini de descendre quand la crête arrive,
 * la sortie ne dépasse jamais le plafond et un son tenu garde un gain quasi constant
 * (pas de modulation audible sur un sinus pur).
 */
class LimiterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.ceiling = o.ceiling ?? 0.9;
    // Anticipation = durée de la descente du gain = retard du signal.
    this.lookahead = Math.max(1, Math.round((o.lookahead ?? 0.005) * sampleRate));
    // Maintien du gain minimum : plus long qu'une période de basse (25 ms à 40 Hz), et au moins l'anticipation + 1.
    this.hold = Math.max(this.lookahead + 1, Math.round((o.hold ?? 0.08) * sampleRate));
    this.releaseCoef = 1 - Math.exp(-1 / ((o.release ?? 0.4) * sampleRate));

    this.delay = [new Float32Array(this.lookahead), new Float32Array(this.lookahead)];
    this.delayPos = 0;

    // File monotone (minimum glissant sur la fenêtre de maintien), en anneau.
    const size = this.hold + 1;
    this.qValue = new Float32Array(size);
    this.qTime = new Float64Array(size);
    this.qHead = 0;
    this.qLength = 0;
    this.qSize = size;
    this.time = 0;

    this.released = 1;
    // Moyenne glissante du gain sur la durée d'anticipation.
    this.box = new Float32Array(this.lookahead).fill(1);
    this.boxPos = 0;
    this.boxSum = this.lookahead;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const frames = output[0].length;
    const inL = input[0];
    const inR = input[1] ?? input[0];
    const outL = output[0];
    const outR = output[1] ?? output[0];
    const delayL = this.delay[0];
    const delayR = this.delay[1];
    const { ceiling, lookahead, hold, releaseCoef, qValue, qTime, qSize, box } = this;

    for (let i = 0; i < frames; i++) {
      const l = inL ? inL[i] : 0;
      const r = inR ? inR[i] : 0;
      const peak = Math.max(Math.abs(l), Math.abs(r));
      const needed = peak > ceiling ? ceiling / peak : 1;

      // Minimum glissant : on retire de la fin tout ce qui est plus grand, puis les valeurs trop anciennes.
      const t = this.time++;
      while (this.qLength > 0 && qValue[(this.qHead + this.qLength - 1) % qSize] >= needed) this.qLength--;
      const tail = (this.qHead + this.qLength) % qSize;
      qValue[tail] = needed;
      qTime[tail] = t;
      this.qLength++;
      while (qTime[this.qHead] <= t - hold) {
        this.qHead = (this.qHead + 1) % qSize;
        this.qLength--;
      }
      const held = qValue[this.qHead];

      // Descente immédiate (le lissage s'en charge), remontée exponentielle lente.
      this.released = held < this.released ? held : this.released + (held - this.released) * releaseCoef;

      this.boxSum += this.released - box[this.boxPos];
      box[this.boxPos] = this.released;
      this.boxPos = (this.boxPos + 1) % lookahead;
      const gain = Math.min(1, this.boxSum / lookahead);

      const p = this.delayPos;
      outL[i] = delayL[p] * gain;
      outR[i] = delayR[p] * gain;
      delayL[p] = l;
      delayR[p] = r;
      this.delayPos = (p + 1) % lookahead;
    }
    // Recalcul exact de la somme de temps en temps (dérive des arrondis).
    if (this.time % sampleRate < frames) this.boxSum = box.reduce((a, b) => a + b, 0);
    return true;
  }
}

registerProcessor('master-limiter', LimiterProcessor);
