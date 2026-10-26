import * as THREE from "three";
import { FSPass, PH, PW } from "./gl";

const yieldChannel =
  typeof MessageChannel === "undefined" ? null : new MessageChannel();
const yieldQueue: (() => void)[] = [];
if (yieldChannel) {
  yieldChannel.port1.onmessage = () => yieldQueue.shift()?.();
}
const yieldTask = (): Promise<void> =>
  new Promise<void>((res) => {
    if (!yieldChannel) {
      setTimeout(res, 0);
      return;
    }
    yieldQueue.push(res);
    yieldChannel.port2.postMessage(0);
  });

export class Readback {
  static readonly BYTES = PW * PH * 3;

  private r: THREE.WebGLRenderer;
  private packs: ({ buf: WebGLBuffer; sync: WebGLSync } | undefined)[] = [];
  private rgbRT = new THREE.WebGLRenderTarget((PW * 3) / 4, PH, {
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  private rgbPass = new FSPass(
    `
	    uniform sampler2D src;
	    void main() {
	      ivec2 o = ivec2(gl_FragCoord.xy);
	      vec4 v;
	      for (int c = 0; c < 4; c++) {
	        int b = o.x * 4 + c, i = b / 3, ch = b - i * 3;
	        vec4 p = texelFetch(src, ivec2(i, o.y), 0);
	        v[c] = ch == 0 ? p.r : ch == 1 ? p.g : p.b;
	      }
	      fragColor = v;
	    }`,
    { src: { value: null } },
  );

  constructor(r: THREE.WebGLRenderer) {
    this.r = r;
  }

  start(slot: number, src: THREE.Texture): void {
    const { r } = this;
    const gl = r.getContext() as WebGL2RenderingContext;
    const old = this.packs[slot];
    if (old) {
      gl.deleteSync(old.sync);
      gl.deleteBuffer(old.buf);
    }
    const buf = gl.createBuffer()!;
    this.rgbPass.u.src!.value = src;
    this.rgbPass.render(r, this.rgbRT);
    r.setRenderTarget(this.rgbRT);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, Readback.BYTES, gl.STREAM_READ);
    gl.readPixels(0, 0, this.rgbRT.width, PH, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.packs[slot] = {
      buf,
      sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!,
    };
    gl.flush();
  }

  async finish(slot: number, out: Uint8Array): Promise<Uint8Array> {
    const gl = this.r.getContext() as WebGL2RenderingContext;
    const p = this.packs[slot];
    if (!p) {
      throw new Error(`readFinish: nothing queued in slot ${slot}`);
    }
    for (;;) {
      const s = gl.clientWaitSync(p.sync, 0, 0);
      if (s === gl.ALREADY_SIGNALED || s === gl.CONDITION_SATISFIED) {
        break;
      }
      if (s === gl.WAIT_FAILED) {
        throw new Error("readFinish: fence wait failed");
      }
      await yieldTask();
    }
    this.packs[slot] = undefined;
    gl.deleteSync(p.sync);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, p.buf);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.deleteBuffer(p.buf);
    return out;
  }

  dispose(): void {
    const gl = this.r.getContext() as WebGL2RenderingContext;
    for (const p of this.packs) {
      if (!p) {
        continue;
      }
      gl.deleteSync(p.sync);
      gl.deleteBuffer(p.buf);
    }
    this.packs.length = 0;
    this.rgbRT.dispose();
    this.rgbPass.dispose();
  }
}
