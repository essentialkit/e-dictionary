const fs = require("fs");
const { exec } = require("child_process");
const esbuild = require("esbuild");
const Jimp = require("jimp");
const Jasmine = require("jasmine");
const puppeteer = require("puppeteer");

class Build {
  outputBase = "build";
  browser = "chrome";
  isProd = false;
  outDir = "build/chrome-dev";
  maybeTask = "build";

  testSpecs = ["spec/e2e-spec.ts"];
  compiledTestSpecs = ["spec/e2e-spec.js"];
  originalIconPath = "src/assets/icon.png";

  constructor() {
    const args = this.parse(process.argv);

    if (args.output_base) {
      this.outputBase = args.output_base;
    }

    if (args.prod) {
      this.isProd = true;
    }

    // Ensure browser is lowercase.
    if (args.browser) {
      this.browser = args.browser.toLowerCase();
    }

    // Set the output directory
    this.outDir = `${this.outputBase}/${this.browser}-${
      this.isProd ? "prod" : "dev"
    }/`;

    switch (this.maybeTask) {
      case "generateIcons":
        this.generateIcons();
        break;
      case "start":
        this.launchBrowser();
        break;
      case "test":
        this.test();
        break;
      default:
        this.buildExtension();
    }
  }

  /* Straight-forward node.js arguments parser.
   * From https://github.com/eveningkid/args-parser/blob/master/parse.js
   */
  parse(argv) {
    const ARGUMENT_SEPARATION_REGEX = /([^=\s]+)=?\s*(.*)/;

    // Removing node/bin and called script name
    argv = argv.slice(2);

    const parsedArgs = {};
    let argName, argValue;

    if (argv.length > 0) {
      this.maybeTask = argv[0];
    }

    argv.forEach(function (arg) {
      // Separate argument for a key/value return
      arg = arg.match(ARGUMENT_SEPARATION_REGEX);
      arg.splice(0, 1);

      // Retrieve the argument name
      argName = arg[0];

      // Remove "--" or "-"
      if (argName.indexOf("-") === 0) {
        argName = argName.slice(argName.slice(0, 2).lastIndexOf("-") + 1);
      }

      // Parse argument value or set it to `true` if empty
      argValue =
        arg[1] !== ""
          ? parseFloat(arg[1]).toString() === arg[1]
            ? +arg[1]
            : arg[1]
          : true;

      parsedArgs[argName] = argValue;
    });

    return parsedArgs;
  }

  // Clean output directory
  clean(dir) {
    return new Promise((resolve, reject) => {
      fs.rm(dir, { recursive: true }, (err) => {
        if (err) {
          if (err.code == "ENOENT") {
            // Directory already deleted or doesn't exist.
            resolve();
          } else {
            reject(err);
          }
          return;
        }
        resolve();
      });
    });
  }

  // Bundle scripts.
  bundleScripts() {
    return esbuild
      .build({
        entryPoints: [
          "src/background-script/background.ts",
          "src/content-script/content-script.ts",
          "src/popup/popup.ts",
          "src/options-page/options.js",
        ],
        bundle: true,
        minify: this.isProd,
        sourcemap: !this.isProd,
        outdir: this.outDir,
        target: ["chrome58", "firefox57", "safari11", "edge16"],
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  }

  // Generate manifest
  // NB: This function would fail if outDir doesn't exist yet.
  // For browser manifest.json compatibility see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Browser_compatibility_for_manifest.json
  generateManifest() {
    return new Promise((resolve, reject) => {
      let rawdata = fs.readFileSync("src/manifest.json");
      let manifest = JSON.parse(rawdata);

      const browserManifest = {};
      for (const [key, value] of Object.entries(manifest)) {
        if (!key.startsWith("__")) {
          browserManifest[key] = value;
        } else if (key.startsWith(`__${this.browser}__`)) {
          browserManifest[key.replace(`__${this.browser}__`, "")] = value;
        }
      }

      const formattedJson = JSON.stringify(browserManifest, null, 4);
      fs.writeFile(this.outDir + "manifest.json", formattedJson, (err) => {
        if (err) {
          reject();
        } else {
          resolve();
        }
      });
    });
  }

  // Generate icons
  generateIcons() {
    return new Promise((resolve, reject) => {
      Jimp.read(this.originalIconPath, (err, icon) => {
        if (err) {
          reject();
        }

        [16, 24, 32, 48, 128].forEach((size) => {
          const colorIcon = icon.clone();
          colorIcon
            .resize(size, size)
            .write(`${this.outDir}assets/icon-${size}x${size}.png`);
          const grayIcon = icon.clone();
          grayIcon
            .resize(size, size)
            .greyscale()
            .write(`${this.outDir}assets/icon-gray-${size}x${size}.png`);
        });
        resolve();
      });
    });
  }

  // Copy assets.
  copyAssets() {
    // Map of static files/directories to destinations we want to copy them to.
    const fileMap = {
      "src/assets/": "assets",
      "src/_locales": "_locales",
      "src/popup/popup.html": "popup/popup.html",
      "src/content-script/content-script.css":
        "content-script/content-script.css",
      "src/options-page/options.html": "options-page/options.html",
      "src/welcome": "welcome",
    };

    return new Promise((resolve, reject) => {
      let copied = 0;
      for (const [src, dest] of Object.entries(fileMap)) {
        fs.cp(
          src,
          this.outDir + dest,
          { force: true, recursive: true },
          (err) => {
            if (err) {
              reject(err);
              return;
            } else {
              copied++;

              // Resolve when all files are succcessfully copied.
              if (copied === Object.keys(fileMap).length) {
                resolve();
              }
            }
          }
        );
      }
    });
  }

  // Package extension.
  zipDir() {
    const zipFile = `${this.outputBase}/${this.browser}-${
      this.isProd ? "prod" : "dev"
    }.zip`;
    return new Promise((resolve, reject) => {
      exec(`zip -r ${zipFile}  ${this.outDir}`, (error, stdout, stderr) => {
        if (error) {
          reject(`zip error: ${error.message}`);
          return;
        }
        if (stderr) {
          reject(`zip stderr: ${stderr}`);
          return;
        }
        resolve(`Zipped files... \n${stdout}`);
      });
    });
  }

  // Tests
  buildAndExecuteTests() {
    const buildTest = esbuild
      .build({
        entryPoints: this.testSpecs,
        bundle: true,
        outdir: "spec",
        platform: "node",
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });

    return new Promise((resolve) => {
      buildTest.then(() => {
        const jasmine = new Jasmine();
        jasmine.loadConfig({
          spec_files: this.compiledTestSpecs,
          random: false,
        });
        jasmine.exitOnCompletion = false;

        jasmine.execute().then((doneInfo) => {
          // multiple execute calls on jasmine env errors. See https://github.com/jasmine/jasmine/issues/1231#issuecomment-26404527
          // compiledTestSpecs.forEach((f) => decache(f));
          resolve(doneInfo);
        });
      });
    });
  }

  // TODO: Watch.
  buildExtension() {
    return this.clean(this.outDir).then(() => {
      console.log(`Deleted ${this.outDir}`);

      Promise.all([this.bundleScripts(), this.copyAssets()]).then(() => {
        console.log("Successfully built extension");

        this.generateIcons();
        this.generateManifest().then(() => {
          this.zipDir().then((zipOut) => {
            console.log(zipOut);
          });
        });
      });
    });
  }

  async launchBrowser() {
    const launchOptions = {
      headless: false,
      ignoreDefaultArgs: ["--disable-extensions", "--enable-automation"],
      args: [
        `--disable-extensions-except=${process.env.PWD}/${this.outDir}`,
        `--load-extension=${process.env.PWD}/${this.outDir}`,
      ],
    };
    if (this.browser === "firefox") {
      /* If this command fails with firefox not found, run:
       * `PUPPETEER_PRODUCT=firefox npm i -D puppeteer --prefix ./node_modules/firefox-puppeteer`
       */
      launchOptions.product = "firefox";
    }
    await puppeteer.launch(launchOptions);
  }

  test() {
    this.buildExtension().then(() => {
      // Set output dir for test environment.
      process.env["XTENSION_OUTPUT_DIR"] = this.outDir;

      // Build and run tests.
      this.buildAndExecuteTests();
    });
  }

  watch() {
    // For any changes in src/ rebuild the whole thing.
    // https://esbuild.github.io/api/#watch
  }
}

new Build();
