// minimal ZIP reader and writer
// DOCX is a ZIP container, so importing and exporting Word files needs both directions. The
// browser's CompressionStream handles DEFLATE, which keeps this to header parsing rather than a
// bundled compression library

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const textEncoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8");

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot decompress DOCX files. Try a recent Chrome, Edge, Firefox or Safari.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream !== "function") return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// reads a ZIP archive into a Map of path -> Uint8Array. Walks the central directory rather than
// scanning local headers so that archives with data descriptors (streamed writers) still read
// correctly
export async function readZip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocd = findEndOfCentralDirectory(view, bytes.length);
  if (eocd < 0) throw new Error("Not a valid ZIP or DOCX archive.");

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  if (offset === 0xffffffff || entryCount === 0xffff) {
    throw new Error("ZIP64 archives are not supported. Re-save the document from Word and try again.");
  }

  const files = new Map();
  for (let i = 0; i < entryCount; i += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) break;

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = utf8Decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue;

    // the local header repeats the name and extra field with its own lengths
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      files.set(name, raw);
    } else if (method === 8) {
      files.set(name, await inflateRaw(raw));
    }
    // other methods are rare enough in DOCX that skipping beats failing
  }

  if (!files.size) throw new Error("The archive is empty or uses an unsupported compression method.");
  return files;
}

function findEndOfCentralDirectory(view, length) {
  const minimum = Math.max(0, length - 0xffff - 22);
  for (let i = length - 22; i >= minimum; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

// writes a ZIP archive. `entries` is an array of { name, data } where data is a string or
// Uint8Array. Entries are deflated when the browser supports it and stored otherwise, which
// stays a valid archive either way
export async function writeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const source = typeof entry.data === "string" ? textEncoder.encode(entry.data) : entry.data;
    const checksum = crc32(source);

    let method = 0;
    let payload = source;
    if (source.length > 256) {
      const deflated = await deflateRaw(source);
      if (deflated && deflated.length < source.length) {
        method = 8;
        payload = deflated;
      }
    }

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); // UTF-8 filenames
    localView.setUint16(8, method, true);
    localView.setUint16(10, 0, true); // DOS time
    localView.setUint16(12, 0x2821, true); // DOS date, fixed for reproducible output
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, payload.length, true);
    localView.setUint32(22, source.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    locals.push(localHeader, payload);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, method, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0x2821, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, payload.length, true);
    centralView.setUint32(24, source.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    central.push(centralHeader);

    offset += localHeader.length + payload.length;
  }

  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return new Blob([...locals, ...central, end], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export const decodeUtf8 = (bytes) => utf8Decoder.decode(bytes);
