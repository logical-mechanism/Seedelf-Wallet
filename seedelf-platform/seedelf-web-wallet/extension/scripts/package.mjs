// Packages a store build of dist/ for the Chrome Web Store upload:
// checks it is a store build, adds the third-party notices, and zips it into
// release/seedelf-wallet-<version>.zip. The zip is reproducible: sorted
// entries and fixed timestamps, so the same dist/ always gives the same bytes.
//
//   npm run package        (builds with VITE_STORE_BUILD=true first)

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

import { thirdParty } from "./third-party.mjs";

const extension = fileURLToPath(new URL("..", import.meta.url));
const dist = join(extension, "dist");
const pkg = JSON.parse(readFileSync(join(extension, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));

// A dev build pins its ID with a key the store refuses; its version must be this one.
if ("key" in manifest) throw new Error("dist/ is a dev build (its manifest has a key). Run `npm run package`.");
if (manifest.version !== pkg.version) {
  throw new Error(`dist/ is version ${manifest.version}, package.json says ${pkg.version}. Rebuild.`);
}

const { text, components } = thirdParty(pkg.version);
writeFileSync(join(dist, "licenses/THIRD-PARTY.txt"), text);

function files(dir) {
  return readdirSync(dir)
    .flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]))
    .sort();
}

/** A zip of `paths` (relative to `root`), deflated where that helps, all dated 1980-01-01. */
function zip(root, paths) {
  const DOS_DATE = (0 << 9) | (1 << 5) | 1;
  const locals = [];
  const central = [];
  let offset = 0;
  for (const path of paths) {
    const name = Buffer.from(relative(root, path).split("\\").join("/"));
    const data = readFileSync(path);
    const deflated = deflateRawSync(data, { level: 9 });
    const [method, body] = deflated.length < data.length ? [8, deflated] : [0, data];
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // made by
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(paths.length, 8);
  end.writeUInt16LE(paths.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const paths = files(dist);
const archive = zip(dist, paths);
const out = join(extension, "release", `seedelf-wallet-${pkg.version}.zip`);
mkdirSync(join(extension, "release"), { recursive: true });
writeFileSync(out, archive);

const hosts = manifest.host_permissions.join(", ");
console.log(`${manifest.name} ${manifest.version}: ${hosts}`);
console.log(`Third-party notices: ${components} components (licenses/THIRD-PARTY.txt)`);
console.log(`${relative(extension, out)}: ${paths.length} files, ${Math.round(archive.length / 1024)} KB`);
console.log(`sha256 ${createHash("sha256").update(archive).digest("hex")}`);
