// postMessage bridge between the MAIN-world script and the isolated content script.
// Isolated -> MAIN carries commands only; MAIN -> isolated carries data only.
// The isolated side picks a random channel ID and hands it to MAIN in a one-time
// handshake; MAIN accepts the first valid hello and ignores later ones.

const TAG = 'reiscrub-puller';
const CHANNEL_RE = /^[0-9a-f-]{36}$/;

type Dir = 'hello' | 'cmd' | 'data';

function post(dir: Dir, channel: string, msg?: unknown): void {
  window.postMessage({ source: TAG, dir, channel, msg }, window.location.origin);
}

function envelope(e: MessageEvent): { dir: unknown; channel: unknown; msg: unknown } | null {
  if (e.source !== window) return null;
  const d: unknown = e.data;
  if (typeof d !== 'object' || d === null) return null;
  const o = d as Record<string, unknown>;
  if (o.source !== TAG) return null;
  return { dir: o.dir, channel: o.channel, msg: o.msg };
}

export interface IsolatedChannel {
  sendCommand(cmd: unknown): void;
}

export function openIsolatedChannel(onData: (msg: unknown) => void): IsolatedChannel {
  const channel = crypto.randomUUID();
  let ready = false;

  window.addEventListener('message', (e) => {
    const env = envelope(e);
    if (!env || env.dir !== 'data' || env.channel !== channel) return;
    const m = env.msg;
    if (typeof m === 'object' && m !== null && (m as { type?: unknown }).type === 'ready') {
      ready = true;
      return;
    }
    onData(m);
  });

  // The MAIN script may load before or after us; keep saying hello until it answers.
  const timer = setInterval(() => {
    if (ready) clearInterval(timer);
    else post('hello', channel);
  }, 500);
  post('hello', channel);

  return { sendCommand: (cmd) => post('cmd', channel, cmd) };
}

export interface MainChannel {
  sendData(msg: unknown): void;
}

export function openMainChannel(onCommand: (msg: unknown) => void, onConnect: () => void): MainChannel {
  let channel: string | null = null;

  window.addEventListener('message', (e) => {
    const env = envelope(e);
    if (!env) return;
    if (env.dir === 'hello') {
      if (channel === null && typeof env.channel === 'string' && CHANNEL_RE.test(env.channel)) {
        channel = env.channel;
        post('data', channel, { type: 'ready' });
        onConnect();
      }
      return;
    }
    if (env.dir === 'cmd' && channel !== null && env.channel === channel) onCommand(env.msg);
  });

  return {
    sendData(msg) {
      if (channel !== null) post('data', channel, msg);
    },
  };
}
