// Generate icons
// Run using `node generateIcons.js`
const Jimp = require("jimp");
 
const originalIconPath = "src/assets/logo.png";
const generateIcons = (outDir) => {
  return new Promise((resolve, reject) => {
    Jimp.read(originalIconPath, (err, icon) => {
      if (err) {
        reject();
      }

      [16, 24, 32, 48, 128].forEach((size) => { 
        const colorIcon = icon.clone();
        colorIcon
          .resize(size, size)
          .write(`${outDir}assets/logo-${size}x${size}.png`);
        const grayIcon = icon.clone();
        grayIcon
          .resize(size, size)
          .greyscale()
          .write(`${outDir}assets/logo-gray-${size}x${size}.png`);
      });
      resolve();
    });
  });
};

generateIcons("build/")