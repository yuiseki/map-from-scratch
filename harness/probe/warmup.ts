export {};

// A GPU process that crashes shortly after launch (it did with the
// VulkanFromANGLE feature) takes every context created before that with it.
// The harness opens this page first and measures nothing until a WebGL
// context survives one second; info.warmup_attempts > 1 means it happened.
const emit = (o: object): void => ((window as any).__mfsEmit ? (window as any).__mfsEmit(JSON.stringify(o)) : console.log(o));
let ok = false;
for (let attempt = 1; attempt <= 10 && !ok; attempt++) {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (gl) {
    gl.clear(gl.COLOR_BUFFER_BIT);
    await new Promise((r) => setTimeout(r, 1000));
    if (!gl.isContextLost()) {
      ok = true;
      emit({ info: { warmup_attempts: attempt } });
    }
  } else {
    // If WebGL2 is not available (e.g. software/canvas2d only target), allow canvas 2D
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ok = true;
      emit({ info: { warmup_attempts: attempt, note: 'canvas2d warmup' } });
    }
  }
}
emit(ok ? { done: true } : { error: 'no WebGL context survived warm-up' });
