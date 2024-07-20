function patchCopyImageToHeap() {
  ARControllerNFT.prototype._copyImageToHeap = function (image) {
    if (!image) {
      console.error("Error: no provided imageData to ARControllerNFT");
      return;
    }
    const data = image;

    // Here we have access to the unmodified video image.
    // We now need to add the videoLuma chanel to be able to serve
    // the underlying ARTK API
    if (this.videoLuma) {
      // Create luma from video data assuming Pixelformat
      // AR_PIXEL_FORMAT_RGBA (ARToolKitJS.cpp L: 43)

      let q = 0;
      for (let p = 0; p < this.videoSize; ++p) {
        const r = data[q + 0],
          g = data[q + 1],
          b = data[q + 2];
        this.videoLuma[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        q += 4;
      }
      artoolkitNFT.passVideoData(this.id, data, this.videoLuma);
      return true;
    }

    return false;
  };
}

self.onmessage = function (e) {
  var msg = e.data;
  switch (msg.type) {
    case "load": {
      load(msg);
      return;
    }
    case "process": {
      next = msg.image;
      process();
      return;
    }
  }
};

var next = null;
let ar = null;
var markerResult = null;

function load(msg) {
  if (msg.simd) {
    importScripts("./artoolkitNFT_wasm.js");
  } else {
    importScripts("./artoolkitNFT_wasm.simd.js");
  }

  self.addEventListener("artoolkitNFT-loaded", () => {
    console.debug("Loading marker at: ", msg.marker);

    var param;
    const onLoad = () => {
      patchCopyImageToHeap();

      ar = new ARControllerNFT(msg.pw, msg.ph, param);
      const cameraMatrix = ar.getCameraMatrix();

      ar.addEventListener("getNFTMarker", (ev) => {
        markerResult = {
          type: "found",
          index: ev.data.index,
          matrix: ev.data.matrixGL_RH,
          buffer: next.buffer,
        };
      });

      ar.addEventListener("lostNFTMarker", function () {});

      let markers = msg.marker;
      ar.loadNFTMarkers(markers, (ids) => {
        for (let i = 0; i < ids.length; ++i) {
          ar.trackNFTMarkerId(i);
        }
        markers = markers.map((_, i) => {
          return ar.getNFTData(ar.id, i);
        });
        postMessage({
          type: "markerInfos",
          markers: markers,
        });
        console.log("loadNFTMarker -> ", ids);
        postMessage({ type: "endLoading", end: true }),
          (err) => {
            console.error("Error in loading marker on Worker", err);
          };
      });

      postMessage({ type: "loaded", proj: cameraMatrix });
    };

    var onError = function (error) {
      console.error(error);
    };

    console.debug("Loading camera at:", msg.camera_para);

    // we cannot pass the entire ARControllerNFT, so we re-create one inside the Worker, starting from camera_param
    param = new ARCameraParamNFT(msg.camera_para, onLoad, onError);
  });
}

function process() {
  markerResult = null;

  if (ar && ar.process) {
    ar.process(next);
  }

  if (markerResult) {
    postMessage(markerResult, [next.buffer]);
  } else {
    postMessage({ type: "not found", buffer: next.buffer }, [next.buffer]);
  }

  next = null;
}
