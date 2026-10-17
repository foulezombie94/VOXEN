import { captureConstraints } from './audio-config.cjs';
let active = null,
  generation = 0;
async function release(session) {
  if (!session) return;
  if (session.node) {
    session.node.port.onmessage = null;
    session.node.disconnect();
  }
  if (session.stream) for (const track of session.stream.getTracks()) track.stop();
  if (session.context) await session.context.close().catch(() => {});
}
async function stop() {
  generation++;
  const previous = active;
  active = null;
  await release(previous);
}
window.voxen.onAudioCommand(async (command) => {
  if (command.command === 'stop' || command.command === 'cancel') {
    if (active?.id === command.sessionId) await stop();
    return;
  }
  if (command.command !== 'start') return;
  // Reserve generation before asynchronous close: late permission results cannot
  // replace or stop a newer capture session.
  const token = ++generation;
  const previous = active;
  const session = { id: command.sessionId, stream: null, context: null, node: null };
  active = session;
  await release(previous);
  if (token !== generation) return;
  try {
    session.stream = await navigator.mediaDevices.getUserMedia(
      captureConstraints(command.deviceId),
    );
    if (token !== generation) {
      await release(session);
      return;
    }
    session.context = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
    await session.context.audioWorklet.addModule('recorder-worklet.js');
    if (token !== generation) {
      await release(session);
      return;
    }
    const source = session.context.createMediaStreamSource(session.stream);
    session.node = new AudioWorkletNode(session.context, 'voxen-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const mute = session.context.createGain();
    mute.gain.value = 0;
    source.connect(session.node);
    session.node.connect(mute);
    mute.connect(session.context.destination);
    session.node.port.onmessage = (event) => {
      if (token === generation) window.voxen.audioFrame(session.id, event.data);
    };
    await session.context.resume();
    if (token === generation) window.voxen.audioStarted(session.id);
  } catch {
    if (token === generation) {
      active = null;
      generation++;
      await release(session);
      window.voxen.audioError(session.id);
    } else await release(session);
  }
});
