class VoxenRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.previous = new Float32Array(0);
    this.position = 0;
    this.pending = new Int16Array(512);
    this.count = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    const length = channels[0].length;
    const mono = new Float32Array(length);
    for (const channel of channels)
      for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length;
    const data = new Float32Array(this.previous.length + mono.length);
    data.set(this.previous);
    data.set(mono, this.previous.length);
    const ratio = sampleRate / 16000;
    while (this.position + 1 < data.length) {
      const index = Math.floor(this.position),
        fraction = this.position - index;
      const value = Math.max(
        -1,
        Math.min(1, data[index] * (1 - fraction) + data[index + 1] * fraction),
      );
      this.pending[this.count++] = Math.round(value * (value < 0 ? 32768 : 32767));
      this.position += ratio;
      if (this.count === 512) {
        this.port.postMessage(this.pending.buffer, [this.pending.buffer]);
        this.pending = new Int16Array(512);
        this.count = 0;
      }
    }
    const consumed = Math.min(Math.floor(this.position), data.length);
    this.previous = data.slice(consumed);
    this.position -= consumed;
    return true;
  }
}
registerProcessor('voxen-recorder', VoxenRecorder);
