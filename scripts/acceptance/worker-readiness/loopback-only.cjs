'use strict';
// Test-process boundary only. The production worker and SDK are unchanged.
const net = require('node:net');
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const value = Array.isArray(args[0]) ? args[0] : args;
  const first = value[0];
  const host = typeof first === 'object' ? first.host : typeof value[1] === 'string' ? value[1] : undefined;
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    throw new Error('WORKER_FIXTURE_NON_LOOPBACK_DENIED');
  }
  return original.apply(this, args);
};
