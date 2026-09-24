/**
 * Tao 1 file icon.png don gian (vien tron mau xanh + chu "Q") chi bang cac module co san cua
 * Node.js (zlib) - KHONG can cai them thu vien nao (giu dung nguyen tac cua ca du an: khong phu
 * thuoc module native/ben thu 3 khong can thiet). Chay 1 LAN: `node generate-icon.js`.
 * Ban co the thay file icon.png nay bang logo rieng cua don vi truoc khi dong goi ung dung.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

// Bang CRC32 chuan (dung cho tung chunk PNG)
const CRC_TABLE = (() => {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// Ve pixel: nen xanh duong (#2563eb) hinh vuong bo goc tron, chu "Q" mau trang don gian (hinh khoi)
const bg = [0x25, 0x63, 0xeb, 0xff];
const fg = [0xff, 0xff, 0xff, 0xff];
const transparent = [0, 0, 0, 0];
const radius = SIZE * 0.18;

function isInsideRoundedSquare(x, y) {
  const cx = Math.min(Math.max(x, radius), SIZE - radius);
  const cy = Math.min(Math.max(y, radius), SIZE - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

// Chu "Q" ve don gian bang 1 vong tron rong + net cheo nho o goc duoi-phai
function isLetterQ(x, y) {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r = SIZE * 0.28;
  const thickness = SIZE * 0.09;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const onRing = dist >= r - thickness / 2 && dist <= r + thickness / 2;
  // Net cheo nho o goc duoi phai vong tron, tao net dac trung cua chu Q
  const tailOnDiag =
    x > cx + r * 0.15 && x < cx + r * 1.05 && y > cy + r * 0.15 && y < cy + r * 1.05 &&
    Math.abs(x - cx - (y - cy)) < thickness * 0.9;
  return onRing || tailOnDiag;
}

const rowBytes = SIZE * 4 + 1; // +1 cho filter byte moi dong
const raw = Buffer.alloc(rowBytes * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * rowBytes] = 0; // filter type 0 (None)
  for (let x = 0; x < SIZE; x++) {
    const offset = y * rowBytes + 1 + x * 4;
    let color;
    if (!isInsideRoundedSquare(x, y)) color = transparent;
    else if (isLetterQ(x, y)) color = fg;
    else color = bg;
    raw[offset] = color[0];
    raw[offset + 1] = color[1];
    raw[offset + 2] = color[2];
    raw[offset + 3] = color[3];
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const idat = zlib.deflateSync(raw);

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
console.log('Da tao icon.png (' + SIZE + 'x' + SIZE + ') tai:', path.join(__dirname, 'icon.png'));
