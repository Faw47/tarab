/**
 * Multi-pass liquid shell rendering inside the single R3F Canvas (WebGL2 + Three.js).
 * Layer 0 → RT (metaballs), separable Gaussian blur (existing GLSL, TS-built kernel),
 * blit sharp bg to screen, then layer 1 (aurora/particles).
 * WebGPU could mirror this graph later; v1 stays on WebGL2.
 */
import { useLayoutEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import blurFragY from '@/graphics/glass/shaders/fragment-bg-hblur.glsl?raw';
import blurFragX from '@/graphics/glass/shaders/fragment-bg-vblur.glsl?raw';
import { buildGaussianKernel, gaussianKernelToUniformArray } from '@/lib/gaussian-kernel';
const GLSL_MAX_BLUR_RADIUS = 200;
const BLUR_RADIUS = 12;
const BLUR_SIGMA = 4;

const POST_VERT = `#version 300 es
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
in vec2 uv;
out vec2 v_uv;
void main() {
  v_uv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BLIT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  fragColor = texture(u_tex, v_uv);
}
`;

class LiquidShellPipeline {
  private readonly renderer: THREE.WebGLRenderer;
  private bgRT: THREE.WebGLRenderTarget;
  private blurA: THREE.WebGLRenderTarget;
  private blurB: THREE.WebGLRenderTarget;
  private rtW = 0;
  private rtH = 0;
  private readonly drawSize = new THREE.Vector2();
  private readonly postCamera: THREE.OrthographicCamera;
  private readonly blitScene: THREE.Scene;
  private readonly blurSceneX: THREE.Scene;
  private readonly blurSceneY: THREE.Scene;
  private readonly blitMat: THREE.ShaderMaterial;
  private readonly blurXMat: THREE.ShaderMaterial;
  private readonly blurYMat: THREE.ShaderMaterial;
  private readonly quadGeo: THREE.PlaneGeometry;
  private readonly blurWeights: Float32Array;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const w = 4;
    const h = 4;
    this.bgRT = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: false });
    this.blurA = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, stencilBuffer: false });
    this.blurB = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, stencilBuffer: false });

    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postCamera.position.z = 1;

    this.quadGeo = new THREE.PlaneGeometry(2, 2);

    const kernel = buildGaussianKernel(BLUR_SIGMA, BLUR_RADIUS);
    this.blurWeights = gaussianKernelToUniformArray(kernel, GLSL_MAX_BLUR_RADIUS);

    this.blitMat = new THREE.RawShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: BLIT_FRAG,
      uniforms: {
        u_tex: { value: null as unknown as THREE.Texture },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.blurXMat = new THREE.RawShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: blurFragX,
      uniforms: {
        u_prevPassTexture: { value: null as unknown as THREE.Texture },
        u_resolution: { value: new THREE.Vector2(w, h) },
        u_blurRadius: { value: BLUR_RADIUS },
        u_blurWeights: { value: this.blurWeights },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.blurYMat = new THREE.RawShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: blurFragY,
      uniforms: {
        u_prevPassTexture: { value: null as unknown as THREE.Texture },
        u_resolution: { value: new THREE.Vector2(w, h) },
        u_blurRadius: { value: BLUR_RADIUS },
        u_blurWeights: { value: this.blurWeights },
      },
      depthTest: false,
      depthWrite: false,
    });
    const blitMesh = new THREE.Mesh(this.quadGeo, this.blitMat);
    this.blitScene = new THREE.Scene();
    this.blitScene.add(blitMesh);

    const blurMeshX = new THREE.Mesh(this.quadGeo, this.blurXMat);
    this.blurSceneX = new THREE.Scene();
    this.blurSceneX.add(blurMeshX);

    const blurMeshY = new THREE.Mesh(this.quadGeo, this.blurYMat);
    this.blurSceneY = new THREE.Scene();
    this.blurSceneY.add(blurMeshY);
  }

  dispose() {
    this.bgRT.dispose();
    this.blurA.dispose();
    this.blurB.dispose();
    this.quadGeo.dispose();
    this.blitMat.dispose();
    this.blurXMat.dispose();
    this.blurYMat.dispose();
  }

  ensureSize() {
    this.renderer.getDrawingBufferSize(this.drawSize);
    const w = this.drawSize.x;
    const h = this.drawSize.y;
    if (w === this.rtW && h === this.rtH) return;
    this.rtW = w;
    this.rtH = h;
    this.bgRT.setSize(w, h);
    this.blurA.setSize(w, h);
    this.blurB.setSize(w, h);
    this.blurXMat.uniforms.u_resolution.value.set(w, h);
    this.blurYMat.uniforms.u_resolution.value.set(w, h);
  }

  render(
    scene: THREE.Object3D,
    camera: THREE.Camera,
    nativeRender: (s: THREE.Object3D, c: THREE.Camera) => void,
  ) {
    this.ensureSize();
    const w = this.rtW;
    const h = this.rtH;
    const prevMask = camera.layers.mask;

    camera.layers.disableAll();
    camera.layers.enable(0);
    this.renderer.setRenderTarget(this.bgRT);
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.clear(true, true, true);
    nativeRender(scene, camera);

    this.blurXMat.uniforms.u_prevPassTexture.value = this.bgRT.texture;
    this.renderer.setRenderTarget(this.blurA);
    this.renderer.clear(true, true, true);
    nativeRender(this.blurSceneX, this.postCamera);

    this.blurYMat.uniforms.u_prevPassTexture.value = this.blurA.texture;
    this.renderer.setRenderTarget(this.blurB);
    this.renderer.clear(true, true, true);
    nativeRender(this.blurSceneY, this.postCamera);

    this.renderer.setRenderTarget(null);
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissorTest(false);
    this.renderer.clear(true, true, true);

    this.blitMat.uniforms.u_tex.value = this.bgRT.texture;
    nativeRender(this.blitScene, this.postCamera);

    this.renderer.clearDepth();
    camera.layers.disableAll();
    camera.layers.enable(1);
    nativeRender(scene, camera);
    camera.layers.mask = prevMask;
  }
}

export function LiquidShellRenderPipeline() {
  const gl = useThree((s) => s.gl);
  const pipelineRef = useRef<LiquidShellPipeline | null>(null);

  useLayoutEffect(() => {
    const pipeline = new LiquidShellPipeline(gl);
    pipelineRef.current = pipeline;
    const nativeRender = gl.render.bind(gl);
    gl.render = (scene, camera) => {
      pipeline.render(scene, camera, nativeRender);
    };
    return () => {
      gl.render = nativeRender;
      pipeline.dispose();
      pipelineRef.current = null;
    };
  }, [gl]);

  return null;
}
