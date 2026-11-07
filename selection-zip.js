// Uncompressed ZIP: images are already compressed. No network dependency is needed.
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function header(length) {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  return { bytes, u16: (p, n) => view.setUint16(p, n, true), u32: (p, n) => view.setUint32(p, n, true) };
}

export class ImageZip {
  parts = [];
  directory = [];
  offset = 0;

  async add(name, blob) {
    const filename = new TextEncoder().encode(name);
    if (this.directory.length >= 65535 || this.offset + blob.size + filename.length + 30 > 0xffffffff) {
      throw new Error("Archivio troppo grande. Esporta meno immagini per volta.");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(bytes);
    const local = header(30);
    local.u32(0, 0x04034b50);
    local.u16(4, 20);
    local.u16(6, 0x800); // UTF-8 names
    local.u16(12, 33); // 1980-01-01, earliest valid ZIP date
    local.u32(14, crc);
    local.u32(18, bytes.length);
    local.u32(22, bytes.length);
    local.u16(26, filename.length);
    const central = header(46);
    central.u32(0, 0x02014b50);
    central.u16(4, 20);
    central.u16(6, 20);
    central.u16(8, 0x800);
    central.u16(14, 33);
    central.u32(16, crc);
    central.u32(20, bytes.length);
    central.u32(24, bytes.length);
    central.u16(28, filename.length);
    central.u32(42, this.offset);
    this.parts.push(local.bytes, filename, blob);
    this.directory.push([central.bytes, filename]);
    this.offset += 30 + filename.length + bytes.length;
  }

  toBlob() {
    const central = this.directory.flat();
    const size = central.reduce((sum, part) => sum + part.length, 0);
    if (this.offset + size + 22 > 0xffffffff) throw new Error("Archivio troppo grande. Esporta meno immagini per volta.");
    const end = header(22);
    end.u32(0, 0x06054b50);
    end.u16(8, this.directory.length);
    end.u16(10, this.directory.length);
    end.u32(12, size);
    end.u32(16, this.offset);
    return new Blob([...this.parts, ...central, end.bytes], { type: "application/zip" });
  }
}
