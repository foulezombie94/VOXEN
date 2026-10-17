let ort;
class VoiceDetector {
  static async create(model) {
    ort ||= require('onnxruntime-node');
    const session = await ort.InferenceSession.create(model, {
      executionProviders: ['cpu'],
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
    });
    return new VoiceDetector(session);
  }
  constructor(session) {
    this.session = session;
    this.reset(2);
  }
  reset(seconds) {
    this.input = new Float32Array(576);
    this.state = new Float32Array(256);
    this.samples = 0;
    this.lastVoice = 0;
    this.candidate = null;
    this.hasSpeech = false;
    this.seconds = seconds;
    this.probability = 0;
  }
  async feed(pcm) {
    for (let i = 0; i < 512; i++) this.input[64 + i] = pcm.readInt16LE(i * 2) / 32768;
    this.samples += 512;
    const outputs = await this.session.run({
      input: new ort.Tensor('float32', this.input, [1, 576]),
      state: new ort.Tensor('float32', this.state, [2, 1, 128]),
      sr: new ort.Tensor('int64', BigInt64Array.of(16000n), []),
    });
    this.probability = outputs[this.session.outputNames[0]].data[0];
    this.state.set(outputs[this.session.outputNames[1]].data);
    this.input.copyWithin(0, 512, 576);
    const position = this.samples / 16000;
    if (this.probability >= 0.5 || (this.hasSpeech && this.probability >= 0.35)) {
      this.candidate ??= position;
      if (position - this.candidate >= 0.064 - 1e-8) this.hasSpeech = true;
      this.lastVoice = position;
    } else this.candidate = null;
    for (const value of Object.values(outputs)) value.dispose?.();
    return position - this.lastVoice >= this.seconds;
  }
  async close() {
    this.input.fill(0);
    this.state.fill(0);
    await this.session.release();
  }
}
class Waveform {
  constructor() {
    this.clear();
  }
  clear() {
    this.values = Array(12).fill(0);
    this.envelope = 0;
  }
  push(pcm) {
    let energy = 0;
    for (let i = 0; i < pcm.length; i += 2) {
      const value = pcm.readInt16LE(i);
      energy += value * value;
    }
    const rms = Math.sqrt(energy / (pcm.length / 2)) / 32768;
    const normalized =
      rms <= 0.0001 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(rms) + 62) / 42));
    const target = normalized ** 0.8;
    this.envelope += (target - this.envelope) * (target > this.envelope ? 0.7 : 0.3);
    if (this.envelope < 0.001) this.envelope = 0;
    this.values.shift();
    this.values.push(this.envelope);
    return this.values.slice();
  }
}
module.exports = { VoiceDetector, Waveform };
