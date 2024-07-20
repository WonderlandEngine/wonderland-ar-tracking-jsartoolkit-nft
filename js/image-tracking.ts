import { Component, Texture, ViewComponent } from "@wonderlandengine/api";
import { property } from "@wonderlandengine/api/decorators.js";
import { mat4, quat, quat2, vec3 } from "gl-matrix";
import { simd } from "wasm-feature-detect";

import { OneEuroFilter } from "./one-euro-filter.js";

function isMobile() {
  return /Android|mobile|iPad|iPhone/i.test(navigator.userAgent);
}

function computeFOV(proj: mat4): { vertical: number; horizontal: number } {
  const m00 = proj[0];
  const m11 = proj[5];

  const verticalFOV = 2 * Math.atan(1 / m11);
  const aspectRatio = m11 / m00;
  const horizontalFOV = 2 * Math.atan(aspectRatio * Math.tan(verticalFOV / 2));

  return {
    vertical: verticalFOV,
    horizontal: horizontalFOV,
  };
}

const ZERO = [0, 0, 0];
const AxisX = [1, 0, 0];
const tempQuat = quat.create();
const tempQuat2 = quat2.create();
const tempVec3 = vec3.create();

interface MarkerInfo {
  id: number;
  width: number;
  height: number;
  dpi: number;
}

const MARKER_URLS = [];
const MARKERS = [];

export class Marker extends Component {
  static TypeName = "image-tracking-marker";

  @property.string()
  markerUrl!: string;

  markerInfo?: MarkerInfo;
  tracked = false;

  filter = new OneEuroFilter({ minCutOff: 100, beta: 0.005 });

  start() {
    MARKER_URLS.push(this.markerUrl);
    MARKERS.push(this);
  }

  setMarkerInfo(i) {
    this.markerInfo = i;
  }

  setMatrix(m?: Float32Array) {
    if (!m) {
      // TODO: onTrackingLost event
      this.tracked = false;
      return;
    }

    mat4.getRotation(tempQuat, m);
    quat.normalize(tempQuat, tempQuat);

    mat4.getTranslation(tempVec3, m);

    const mw =
      this.markerInfo.width / this.markerInfo.dpi / window.devicePixelRatio;
    vec3.scale(tempVec3, tempVec3, 1 / mw);

    quat2.fromRotationTranslation(
      tempQuat2,
      tempQuat, //this.filter.filter(Date.now(), tempQuat as Float32Array),
      tempVec3
    );

    this.object.setTransformLocal(tempQuat2);
    //this.object.rotateAxisAngleDegObject(AxisX, 90);
    /* Anchor point should be the marker center */
    const c = window.devicePixelRatio / 2;
    this.object.translateObject([c, c, 0]);

    //this.object.setScalingLocal(this.originalScaling);
  }
}

/**
 * image-tracking
 */
export class ImageTracking extends Component {
  static TypeName = "image-tracking";

  /* Properties that are configurable in the editor */

  @property.string("webarkit-camera-params.dat")
  cameraParams!: string;

  @property.float(0.01)
  filterBeta: number = 0.01;
  @property.float(0.0001)
  filterMinCF: number = 0.0001;

  worker?: Worker;
  processingContext?: CanvasRenderingContext2D;
  video?: HTMLVideoElement;
  world = mat4.create();
  trackedFrame = false;

  curVideoTexture = 0;
  videoTextures?: (Texture | null)[] = [null, null];

  processingWidth = 0;
  processingHeight = 0;

  offsetX = 0;
  offsetY = 0;

  videoWidth = 0;
  videoHeight = 0;

  width = 0;
  height = 0;

  processingFrame = false;

  view?: ViewComponent;

  projectionMatrix?: Float32Array;

  hasSimd: Promise<boolean> = null;

  bufferCopy: ArrayBuffer | null = null;

  start() {
    this.hasSimd = simd();
    this.worker = new Worker("./artoolkitNFT.multi_worker.js");
    this.view = this.object.getComponent("view");
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: "environment",
          frameRate: {
            ideal: 60,
          },
        },
      })
      .then((stream) => {
        this.video = document.createElement("video");
        this.video.playsInline = true;
        this.video.srcObject = stream;

        this.video.addEventListener("loadedmetadata", () => {
          this.video.play();
          this.video.width = this.video.videoWidth;
          this.video.height = this.video.videoHeight;

          this.initAR();
        });
      });
  }

  async initAR() {
    let processingCanvas = document.createElement("canvas");
    this.processingContext = processingCanvas.getContext("2d", {
      willReadFrequently: true,
    })!;

    document.body.appendChild(processingCanvas);

    /* LOAD */
    this.videoWidth = this.video.videoWidth;
    this.videoHeight = this.video.videoHeight;

    const pscale = 640 / Math.max(this.videoWidth, (this.videoHeight / 3) * 4);

    this.width = this.videoWidth * pscale;
    this.height = this.videoHeight * pscale;
    this.processingWidth = Math.max(this.width, (this.height / 3) * 4);
    this.processingHeight = Math.max(this.height, (this.width / 4) * 3);
    this.offsetX = (this.processingWidth - this.width) / 2;
    this.offsetY = (this.processingHeight - this.height) / 2;

    processingCanvas.style.clientWidth = this.processingWidth + "px";
    processingCanvas.style.clientHeight = this.processingHeight + "px";
    processingCanvas.width = this.processingWidth;
    processingCanvas.height = this.processingHeight;

    // const sscale = isMobile() ? window.outerWidth / this.videoWidth : 1;
    // const sw = this.videoWidth * sscale;
    // const sh = this.videoHeight * sscale;
    // set size (sw, sh)

    const beta = this.filterBeta;
    const minCF = this.filterMinCF;
    console.log(beta, minCF);
    this.worker.onmessage = this.processResult;
    this.worker.postMessage({
      type: "load",
      pw: this.processingWidth,
      ph: this.processingHeight,
      minCF,
      beta,
      camera_para: this.cameraParams,
      marker: MARKER_URLS,
      simd: await this.hasSimd,
    });

    this.videoTextures = [
      this.engine.textures.create(this.video),
      this.engine.textures.create(this.video),
    ];
  }

  displayNextFrame() {
    const curTex = this.videoTextures[this.curVideoTexture];
    if (curTex) this.engine.scene.skyMaterial.texture = curTex;
    this.curVideoTexture = (this.curVideoTexture + 1) & 0x1;
  }

  processFrame() {
    /* Upload currently tracked frame in texture */
    const curTex = this.videoTextures[this.curVideoTexture];
    if (!curTex) return;
    /* Do this after rendering to avoid blocking texture reads */
    setTimeout(() => curTex.update(), 0);
    this.processingFrame = true;

    /* Copy frame to processing canvas and send to worker */
    this.processingContext.drawImage(
      this.video,
      0,
      0,
      this.videoWidth,
      this.videoHeight,
      this.offsetX,
      this.offsetY,
      this.width,
      this.height
    );

    const imageData = this.processingContext.getImageData(
      0,
      0,
      this.processingWidth,
      this.processingHeight
    );

    let data = null;
    if (!this.bufferCopy) {
      this.bufferCopy = imageData.data.buffer.slice();
      data = new Uint8ClampedArray(this.bufferCopy);
    } else {
      data = new Uint8ClampedArray(this.bufferCopy);
      data.set(imageData.data);
    }

    // Pass the copied buffer to the worker
    this.worker.postMessage({ type: "process", image: data }, [
      this.bufferCopy,
    ]);
  }

  processResult = (ev: {
    data: {
      type: string;
      proj?: Float32Array;
      matrix?: Float32Array;
      markers?: MarkerInfo[];
      index?: number;
      buffer?: ArrayBuffer;
    };
  }) => {
    const msg = ev.data;
    switch (msg.type) {
      case "loaded": {
        const proj = msg.proj;
        const ratioW = this.processingWidth / this.width;
        const ratioH = this.processingHeight / this.height;
        proj[0] *= ratioW;
        proj[4] *= ratioW;
        proj[8] *= ratioW;
        proj[12] *= ratioW;
        proj[1] *= ratioH;
        proj[5] *= ratioH;
        proj[9] *= ratioH;
        proj[13] *= ratioH;

        this.view.fov = (computeFOV(proj).horizontal * 180) / Math.PI;
      }
      case "endLoading": {
        break;
      }
      case "found": {
        this.trackedFrame = true;
        this.processingFrame = false;
        MARKERS[msg.index].setMatrix(msg.matrix);
        this.bufferCopy = msg.buffer;
        break;
      }
      case "not found": {
        this.trackedFrame = false;
        this.processingFrame = false;
        this.bufferCopy = msg.buffer;
        break;
      }
      case "markerInfos": {
        msg.markers!.forEach((e, i) => {
          MARKERS[i].setMarkerInfo(e);
        });
      }
    }
    // TODO: Call tracking update
  };

  update(dt: number) {
    if (!this.processingFrame) {
      this.displayNextFrame();
      this.processFrame();
    } else if (!this.trackedFrame && this.processingFrame) {
      /* While detecting the marker, the frame rate drops extremely
       * low, we don't need to wait for any tracking results */
      this.videoTextures[this.curVideoTexture].update();
      this.displayNextFrame();
    }
  }
}
