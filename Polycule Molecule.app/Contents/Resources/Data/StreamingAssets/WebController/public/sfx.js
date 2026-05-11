(function () {
  let ctx = null;
  let masterGain = null;
  let unlocked = false;
  let muted = false;

  function ensureCtx() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);
    return ctx;
  }

  function unlock() {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') {
      c.resume().catch(function () {  });
    }
    if (unlocked) return;
    unlocked = true;
    try {
      const buf = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(masterGain);
      src.start(0);
    } catch (_) {  }
  }

  ['touchstart', 'touchend', 'mousedown', 'keydown', 'click'].forEach(function (ev) {
    window.addEventListener(ev, unlock, { capture: true, passive: true });
  });

  function tone(opts) {
    const c = ensureCtx();
    if (!c || muted) return;
    if (c.state === 'suspended') c.resume().catch(function () { });

    const t0 = c.currentTime + (opts.delay || 0);
    const dur = Math.max(0.005, opts.dur || 0.08);
    const wave = opts.wave || 'square';
    const startHz = opts.startHz || 440;
    const endHz = (opts.endHz != null) ? opts.endHz : startHz;
    const vol = (opts.vol == null) ? 0.30 : opts.vol;
    const attack = (opts.attack == null) ? 0.004 : opts.attack;
    const release = (opts.release == null) ? Math.min(0.05, dur * 0.4) : opts.release;

    const osc = c.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(startHz, t0);
    if (endHz !== startHz) osc.frequency.linearRampToValueAtTime(endHz, t0 + dur);

    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + Math.min(attack, dur * 0.5));
    g.gain.setValueAtTime(vol, Math.max(t0 + Math.min(attack, dur * 0.5), t0 + dur - release));
    g.gain.linearRampToValueAtTime(0, t0 + dur);

    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst(opts) {
    const c = ensureCtx();
    if (!c || muted) return;
    if (c.state === 'suspended') c.resume().catch(function () { });

    const dur = Math.max(0.005, opts.dur || 0.02);
    const vol = (opts.vol == null) ? 0.12 : opts.vol;
    const t0 = c.currentTime + (opts.delay || 0);

    const frames = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, frames, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    const src = c.createBufferSource();
    src.buffer = buf;

    const g = c.createGain();
    const attack = Math.min(0.003, dur * 0.3);
    const release = Math.min(0.02, dur * 0.6);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.setValueAtTime(vol, Math.max(t0 + attack, t0 + dur - release));
    g.gain.linearRampToValueAtTime(0, t0 + dur);

    src.connect(g);
    g.connect(masterGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  function seq(notes) {
    let off = 0;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      tone(Object.assign({}, n, { delay: off + (n.delay || 0) }));
      off += (n.dur || 0.08);
    }
  }

  const ACTION_ROOTS = [523, 587, 659, 698, 784];

  const SFX = {
    setMuted: function (m) { muted = !!m; },
    isMuted: function () { return muted; },

    select: function () {
      seq([
        { startHz: 523, dur: 0.06, wave: 'square', vol: 0.30 },
        { startHz: 784, dur: 0.10, wave: 'square', vol: 0.32 }
      ]);
    },

    selectFail: function () {
      seq([
        { startHz: 220, dur: 0.09, wave: 'square', vol: 0.28 },
        { startHz: 165, dur: 0.12, wave: 'square', vol: 0.28 }
      ]);
    },

    tab: function () {
      tone({ startHz: 660, endHz: 880, dur: 0.05, wave: 'square', vol: 0.20 });
    },

    targetOn: function () {
      tone({ startHz: 880, endHz: 1320, dur: 0.07, wave: 'triangle', vol: 0.26 });
    },

    targetOff: function () {
      tone({ startHz: 660, endHz: 440, dur: 0.06, wave: 'triangle', vol: 0.20 });
    },

    action: function (idx) {
      idx = (idx | 0);
      if (idx === 5) {
        seq([
          { startHz: 660, dur: 0.09, wave: 'square', vol: 0.30 },
          { startHz: 440, dur: 0.09, wave: 'square', vol: 0.30 },
          { startHz: 220, endHz: 110, dur: 0.18, wave: 'square', vol: 0.28 }
        ]);
        return;
      }
      const root = ACTION_ROOTS[Math.max(0, Math.min(4, idx))] || 523;
      tone({ startHz: root, endHz: root * 1.5, dur: 0.09, wave: 'square', vol: 0.30 });
    },

    confirmOpen: function () {
      tone({ startHz: 330, endHz: 392, dur: 0.07, wave: 'square', vol: 0.22 });
    },

    confirmCancel: function () {
      tone({ startHz: 392, endHz: 220, dur: 0.07, wave: 'square', vol: 0.20 });
    },

    bondCreated: function () {
      const sparkle = [
        { startHz: 659,  dur: 0.060, vol: 0.22 },
        { startHz: 784,  dur: 0.060, vol: 0.24 },
        { startHz: 1047, dur: 0.060, vol: 0.26 },
        { startHz: 1319, dur: 0.060, vol: 0.28 },
        { startHz: 1568, dur: 0.080, vol: 0.30 },
        { startHz: 2093, endHz: 2349, dur: 0.320, vol: 0.32 }
      ];
      let off = 0;
      for (let i = 0; i < sparkle.length; i++) {
        const n = sparkle[i];
        tone({
          wave: 'triangle', startHz: n.startHz,
          endHz: n.endHz != null ? n.endHz : n.startHz,
          dur: n.dur, vol: n.vol, delay: off,
          attack: 0.006, release: Math.min(0.08, n.dur * 0.45)
        });
        off += n.dur;
      }
      tone({
        wave: 'sine', startHz: 392, endHz: 523,
        dur: 0.320, vol: 0.14, delay: 0,
        attack: 0.03, release: 0.08
      });
      tone({
        wave: 'sine', startHz: 523, endHz: 784,
        dur: 0.320, vol: 0.12, delay: 0.320,
        attack: 0.02, release: 0.14
      });
    },

    affinityUp: function () {
      seq([
        { startHz: 784,  dur: 0.040, wave: 'triangle', vol: 0.24 },
        { startHz: 988,  dur: 0.040, wave: 'triangle', vol: 0.26 },
        { startHz: 1175, dur: 0.080, wave: 'triangle', vol: 0.30 }
      ]);
    },

    affinityDown: function () {
      seq([
        { startHz: 330, dur: 0.055, wave: 'square',   vol: 0.26 },
        { startHz: 262, dur: 0.055, wave: 'square',   vol: 0.28 },
        { startHz: 220, endHz: 175, dur: 0.130, wave: 'square', vol: 0.30 }
      ]);
    },

    kiss: function () {
      noiseBurst({ dur: 0.016, vol: 0.10 });
      tone({ wave: 'triangle', startHz: 520, endHz: 160, dur: 0.100, vol: 0.32,
             attack: 0.003, release: 0.06 });
      tone({ wave: 'triangle', startHz: 160, endHz: 120, dur: 0.030, vol: 0.18,
             delay: 0.100, attack: 0.003, release: 0.02 });
    },

    bondBroken: function () {
      seq([
        { startHz: 660, dur: 0.09, wave: 'square', vol: 0.30 },
        { startHz: 440, dur: 0.09, wave: 'square', vol: 0.30 },
        { startHz: 220, endHz: 110, dur: 0.20, wave: 'square', vol: 0.28 }
      ]);
    },

    gameOver: function () {
      seq([
        { startHz: 523, dur: 0.13, wave: 'square', vol: 0.32 },
        { startHz: 659, dur: 0.13, wave: 'square', vol: 0.32 },
        { startHz: 784, dur: 0.13, wave: 'square', vol: 0.32 },
        { startHz: 1047, dur: 0.13, wave: 'square', vol: 0.34 },
        { startHz: 1318, dur: 0.28, wave: 'square', vol: 0.36 }
      ]);
    },

    personaArrive: function () {
      seq([
        { startHz: 220, endHz: 660, dur: 0.16, wave: 'triangle', vol: 0.30 },
        { startHz: 660, endHz: 880, dur: 0.10, wave: 'triangle', vol: 0.28 }
      ]);
    },

    roundStart: function () {
      seq([
        { startHz: 392, dur: 0.07, wave: 'triangle', vol: 0.24 },
        { startHz: 587, dur: 0.07, wave: 'triangle', vol: 0.24 },
        { startHz: 784, dur: 0.12, wave: 'triangle', vol: 0.26 }
      ]);
    }
  };

  window.SFX = SFX;
})();
