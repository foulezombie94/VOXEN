'use strict';
// Shared by the capture renderer and isolated checks; never opens a device.
function captureConstraints(deviceId = '') {
  const audio = {
    channelCount: 1,
    sampleRate: 16000,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (typeof deviceId === 'string' && deviceId.trim()) audio.deviceId = { exact: deviceId.trim() };
  return { audio, video: false };
}
module.exports = { captureConstraints };
