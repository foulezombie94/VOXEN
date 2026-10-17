'use strict';

function shouldSuspendForFocusedWindow(virtualKey, windowFocused) {
  return windowFocused && virtualKey !== 123;
}

module.exports = { shouldSuspendForFocusedWindow };
