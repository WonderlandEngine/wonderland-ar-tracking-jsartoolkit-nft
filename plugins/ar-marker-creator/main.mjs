import { EditorPlugin, ui, project } from "@wonderlandengine/editor-api";
import { generateMarker } from "./NFTMarkerCreator.js";
import fs from "node:fs";

/* This is an example of a Wonderland Editor plugin */
export default class CustomFolderPlugin extends EditorPlugin {
  /* The constructor is called when your plugin is loaded */
  constructor() {
    super();
    this.name = "jsartoolkit NFT - Marker Creator";
    this.files = [];
    this.promises = [];
    this.errors = [];
  }

  /* Use this function for drawing UI */
  draw() {
    ui.text("Warning: Wonderland Editor may freeze for several minutes");
    ui.text("               while generating the marker.");

    ui.separator();
    ui.text('Put your images into "marker-images".');
    if (ui.button("Refresh")) {
      fs.readdir(project.root + "/marker-images", {}, (error, files) => {
        if (error) return;
        this.files = files;
      });
    }

    if (this.files.length == 0) {
      ui.text("No files found.");
    } else {
      ui.text("Found:");
      this.files.forEach((f, i) => {
        ui.label(f);
        const p = this.promises[i];
        if (this.errors[i]) {
          ui.text("... error:" + this.errors[i].toString());
        } else if (p) {
          const done = Promise.allSettled([p]);
          if (!done) {
            ui.text("... processing");
          } else {
            ui.text("... done");
          }
        } else {
          if (ui.button("Generate")) {
            this.promises[i] = generateMarker(
              project.root + "/marker-images/" + f,
              project.root + "/static/" + f.split(".")[0]
            ).catch((e) => (this.errors[i] = e));
          }
        }
      });
    }

    if (this.error) {
      ui.text(this.error.toString());
    }
  }
}
