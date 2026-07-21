import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { inflateSync } from "node:zlib";

const iconUrl = new URL("../src-tauri/icons/app-icon.png", import.meta.url);
const supersededSvgUrl = new URL(
  "../src-tauri/icons/app-icon.svg",
  import.meta.url,
);
const packageUrl = new URL("../package.json", import.meta.url);

function paethPredictor(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodePng(url) {
  const png = readFileSync(url);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");

  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const imageData = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      imageData.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  assert.equal(bitDepth, 8);
  assert.ok(colorType === 2 || colorType === 6, `unsupported color type ${colorType}`);
  assert.equal(interlace, 0);

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(imageData));
  const pixels = Buffer.alloc(width * height * channels);
  let inputOffset = 0;
  let previousRow = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const encoded = inflated.subarray(inputOffset, inputOffset + stride);
    inputOffset += stride;
    const row = Buffer.alloc(stride);

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const above = previousRow[x];
      const upperLeft = x >= channels ? previousRow[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paethPredictor(left, above, upperLeft);
      else assert.equal(filter, 0, `unsupported PNG filter ${filter}`);
      row[x] = (encoded[x] + predictor) & 0xff;
    }

    row.copy(pixels, y * stride);
    previousRow = row;
  }

  return {
    width,
    height,
    pixel(x, y) {
      const start = (y * width + x) * channels;
      return {
        red: pixels[start],
        green: pixels[start + 1],
        blue: pixels[start + 2],
        alpha: channels === 4 ? pixels[start + 3] : 255,
      };
    },
  };
}

test("conservative app icon repair removes only the outer white canvas", () => {
  assert.equal(existsSync(iconUrl), true, "expected repaired PNG icon source");
  assert.equal(
    existsSync(supersededSvgUrl),
    false,
    "scheme C SVG must not remain as a competing icon source",
  );

  const image = decodePng(iconUrl);
  assert.deepEqual([image.width, image.height], [1024, 1024]);

  const corners = [
    image.pixel(0, 0),
    image.pixel(1023, 0),
    image.pixel(0, 1023),
    image.pixel(1023, 1023),
  ];
  for (const corner of corners) {
    assert.equal(corner.alpha, 255);
    assert.ok(
      Math.max(corner.red, corner.green, corner.blue) < 240,
      `expected blue-gray full-bleed background, got ${JSON.stringify(corner)}`,
    );
  }

  const paperCenter = image.pixel(512, 512);
  assert.ok(
    paperCenter.red > 225 &&
      paperCenter.green > 215 &&
      paperCenter.blue > 205,
    `expected the original warm-white paper at center, got ${JSON.stringify(paperCenter)}`,
  );
});

test("package regenerates platform icons from the repaired PNG source", () => {
  const packageJson = JSON.parse(readFileSync(packageUrl, "utf8"));
  assert.equal(
    packageJson.scripts?.["icon:generate"],
    "tauri icon src-tauri/icons/app-icon.png -o src-tauri/icons",
  );
});
