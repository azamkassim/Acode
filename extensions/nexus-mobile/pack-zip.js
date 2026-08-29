const path = require("path");
const fs = require("fs");
const JSZip = require("jszip");

const root = __dirname;
const pluginJSON = path.join(root, "plugin.json");
const distFolder = path.join(root, "dist");
const json = JSON.parse(fs.readFileSync(pluginJSON, "utf8"));
const zip = new JSZip();

for (const file of ["icon.png", "plugin.json", "readme.md", "changelogs.md"]) {
  const full = path.join(root, file);
  if (fs.existsSync(full)) zip.file(file, fs.readFileSync(full));
}

loadFolder("", distFolder);

zip
  .generateNodeStream({ type: "nodebuffer", streamFiles: true })
  .pipe(fs.createWriteStream(path.join(root, "plugin.zip")))
  .on("finish", () => console.log(`${json.name} plugin.zip written.`));

function loadFolder(relativeRoot, folder) {
  for (const file of fs.readdirSync(folder)) {
    const full = path.join(folder, file);
    const relative = path.join(relativeRoot, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      loadFolder(relative, full);
    } else if (!/LICENSE\.txt$/.test(file)) {
      zip.file(relative, fs.readFileSync(full));
    }
  }
}
