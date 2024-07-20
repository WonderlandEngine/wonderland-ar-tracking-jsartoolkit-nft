import path from "node:path";
import fs from "node:fs";
import Jimp from "jimp";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

let params = [];

let validImageExt = [".jpg", ".jpeg", ".png"];

let buffer;

let imageData = {
  sizeX: 0,
  sizeY: 0,
  nc: 0,
  dpi: 0,
  array: [],
};

let markerFunction = null;
export async function generateMarker(input, output) {
  if (markerFunction === null) {
    throw new Error("Marker generator not initialized");
  }
  return await markerFunction(input, output);
}

import("./NftMarkerCreator_wasm.js").then(({ run, Module }) => {
  Module.onRuntimeInitialized = async function () {
    markerFunction = async (srcImage, outputPath) => {
      let fileNameWithExt = path.basename(srcImage);
      let fileName = path.parse(fileNameWithExt).name;
      let extName = path.parse(fileNameWithExt).ext;

      if (!validImageExt.includes(extName.toLowerCase())) {
        throw new Error(
          "\nERROR: Invalid image TYPE!\n Valid types:(jpg,JPG,jpeg,JPEG,png,PNG)\n"
        );
      }

      if (!fs.existsSync(srcImage)) {
        throw new Error(
          "\nERROR: Not possible to read image, probably invalid image PATH!\n"
        );
      } else {
        buffer = fs.readFileSync(srcImage);
      }

      console.log("Read image file");

      const outDir = path.dirname(outputPath);
      if (!fs.existsSync(outDir)) {
        console.log("Creating output directory", outDir);
        fs.mkdirSync(outDir);
      }

      if (
        extName.toLowerCase() === ".jpg" ||
        extName.toLowerCase() === ".jpeg" ||
        extName.toLowerCase() === ".png"
      ) {
        console.log("Processing image");
        await processImage(buffer);
      }

      console.log("Calculating quality");
      let confidence = calculateQuality();

      let txt = " - - - - - ";
      if (confidence.l != 0) {
        let str = txt.split(" ");
        str.pop();
        str.shift();
        for (let i = 0; i < parseInt(confidence.l); i++) {
          str[i] = " *";
        }
        str.push(" ");
        txt = str.join("");
      }

      console.log(
        "\nConfidence level: [" +
          txt +
          "] %f/5 || Entropy: %f || Current max: 5.17 min: 4.6\n",
        confidence.l,
        confidence.e
      );

      const paramStr = params.join(" ");

      const strBuffer = Module._malloc(paramStr.length + 1);
      Module.stringToUTF8(paramStr, strBuffer);

      console.log("Write Success");
      const heapSpace = Module._malloc(
        imageData.array.length * imageData.array.BYTES_PER_ELEMENT
      );
      Module.HEAPU8.set(imageData.array, heapSpace);

      console.log("Setting heap success.. sontinue to create image set..");
      Module._createNftDataSet(
        heapSpace,
        imageData.dpi,
        imageData.sizeX,
        imageData.sizeY,
        imageData.nc,
        strBuffer
      );

      Module._free(heapSpace);
      Module._free(strBuffer);

      let filenameIset = "tempFilename.iset";
      let filenameFset = "tempFilename.fset";
      let filenameFset3 = "tempFilename.fset3";

      let ext = ".iset";
      let ext2 = ".fset";
      let ext3 = ".fset3";

      let content = Module.FS.readFile(filenameIset);
      let contentFset = Module.FS.readFile(filenameFset);
      let contentFset3 = Module.FS.readFile(filenameFset3);

      console.log("Creating iset, fset and fset3 files");
      fs.writeFileSync(outputPath + ext, content);
      fs.writeFileSync(outputPath + ext2, contentFset);
      fs.writeFileSync(outputPath + ext3, contentFset3);
    };
  };
  run();

  async function processImage(buf) {
    const image = await Jimp.read(buf);
    const metadata = {
      width: image.bitmap.width,
      height: image.bitmap.height,
      channels: 4, // Jimp uses RGBA by default
      density: image._exif?.tags?.XResolution || null,
    };

    if (metadata.density) {
      imageData.dpi = metadata.density;
    } else {
      console.warn("No DPI value found! Using 150 as default value.");
      imageData.dpi = 150;
    }

    if (metadata.width) {
      imageData.sizeX = metadata.width;
    }
    if (metadata.height) {
      imageData.sizeY = metadata.height;
    }
    if (metadata.channels) {
      imageData.nc = metadata.channels;
    }

    const data = await image.getBufferAsync(Jimp.MIME_PNG);
    const dt = Buffer.from(data);
    const uint = new Uint8Array(dt);
    const rgb = new Uint8Array((uint.length / 4) * 3);
    for (let s = 0, d = 0; s < uint.length; ++s) {
      if ((s & 0x11) == 0) continue;
      rgb[d] = uint[s];
      ++d;
    }
    imageData.nc = 3;
    imageData.array = rgb;
  }

  function rgbaToRgb(arr) {
    let newArr = [];
    let BGColor = {
      R: 255,
      G: 255,
      B: 255,
    };

    for (let i = 0; i < arr.length; i += 4) {
      let r = parseInt(
        255 * ((1 - arr[i + 3]) * BGColor.R + arr[i + 3] * arr[i])
      );
      let g = parseInt(
        255 * ((1 - arr[i + 3]) * BGColor.G + arr[i + 3] * arr[i + 1])
      );
      let b = parseInt(
        255 * ((1 - arr[i + 3]) * BGColor.B + arr[i + 3] * arr[i + 2])
      );

      newArr.push(r);
      newArr.push(g);
      newArr.push(b);
    }
    return newArr;
  }

  function calculateQuality() {
    let gray = toGrayscale(imageData.array);
    let hist = getHistogram(gray);
    let ent = 0;
    let totSize = imageData.sizeX * imageData.sizeY;
    for (let i = 0; i < 255; i++) {
      if (hist[i] > 0) {
        let temp = (hist[i] / totSize) * Math.log(hist[i] / totSize);
        ent += temp;
      }
    }

    let entropy = (-1 * ent).toFixed(2);
    let oldRange = 5.17 - 4.6;
    let newRange = 5 - 0;
    let level = ((entropy - 4.6) * newRange) / oldRange;

    if (level > 5) {
      level = 5;
    } else if (level < 0) {
      level = 0;
    }
    return { l: level.toFixed(2), e: entropy };
  }

  function toGrayscale(arr) {
    let gray = [];
    for (let i = 0; i < arr.length; i += 3) {
      let avg = (arr[i] + arr[i + 1] + arr[i + 2]) / 3;
      gray.push(parseInt(avg));
    }
    return gray;
  }

  function getHistogram(arr) {
    let hist = [256];
    for (let i = 0; i < arr.length; i++) {
      hist[i] = 0;
    }
    for (let i = 0; i < arr.length; i++) {
      hist[arr[i]]++;
    }
    return hist;
  }
});
