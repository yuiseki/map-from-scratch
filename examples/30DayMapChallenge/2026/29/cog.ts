export interface TiffHeader {
  littleEndian: boolean;
  firstIfdOffset: number;
}

export interface TiffTag {
  type: number;
  count: number;
  values: number[];
  text?: string;
}

export interface ParsedIfd {
  tags: Map<number, TiffTag>;
  nextIfdOffset: number;
}

function requireBytes(bytes: Uint8Array, offset: number, length: number): DataView {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new RangeError('TIFF data range is outside the supplied bytes');
  }
  return new DataView(bytes.buffer, bytes.byteOffset + offset, length);
}

export function parseTiffHeader(bytes: Uint8Array): TiffHeader {
  const header = requireBytes(bytes, 0, 8);
  const byte0 = header.getUint8(0);
  const byte1 = header.getUint8(1);
  const littleEndian = byte0 === 0x49 && byte1 === 0x49;
  if (!littleEndian && !(byte0 === 0x4d && byte1 === 0x4d)) throw new Error('Invalid TIFF byte order marker');
  const version = header.getUint16(2, littleEndian);
  if (version !== 42) throw new Error('Only classic TIFF is supported');
  return { littleEndian, firstIfdOffset: header.getUint32(4, littleEndian) };
}

function readUnsignedValues(bytes: Uint8Array, entryOffset: number, count: number, type: number, littleEndian: boolean): number[] {
  const widths: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 11: 4, 12: 8 };
  const width = widths[type];
  if (!width) throw new Error(`Unsupported TIFF field type ${type}`);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100_000_000) throw new RangeError('Invalid TIFF tag value count');
  const byteLength = width * count;
  if (!Number.isSafeInteger(byteLength)) throw new RangeError('TIFF tag value byte length is unsafe');
  const view = requireBytes(bytes, entryOffset, byteLength);
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const offset = i * width;
    let value: number;
    if (type === 1) value = view.getUint8(offset);
    else if (type === 2) value = view.getUint8(offset);
    else if (type === 3) value = view.getUint16(offset, littleEndian);
    else if (type === 4) value = view.getUint32(offset, littleEndian);
    else if (type === 11) value = view.getFloat32(offset, littleEndian);
    else if (type === 12) value = view.getFloat64(offset, littleEndian);
    else throw new Error(`Unsupported TIFF field type ${type}`);
    values.push(value);
  }
  return values;
}

export function parseIfd(bytes: Uint8Array, offset: number, littleEndian = true): ParsedIfd {
  const countWidth = 2;
  const entrySize = 12;
  const inlineSize = 4;
  const nextSize = 4;
  const countView = requireBytes(bytes, offset, countWidth);
  const entryCount = countView.getUint16(0, littleEndian);
  const entriesLength = entryCount * entrySize;
  const entriesStart = offset + countWidth;
  requireBytes(bytes, entriesStart, entriesLength + nextSize);
  const tags = new Map<number, TiffTag>();
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = entriesStart + i * entrySize;
    const entry = requireBytes(bytes, entryOffset, entrySize);
    const tag = entry.getUint16(0, littleEndian);
    const type = entry.getUint16(2, littleEndian);
    const count = entry.getUint32(4, littleEndian);
    const valueBytes = ({ 1: 1, 2: 1, 3: 2, 4: 4, 11: 4, 12: 8 } as Record<number, number>)[type];
    if (!valueBytes) continue;
    if (count < 1 || count > 100_000_000) throw new RangeError(`Invalid count for TIFF tag ${tag}`);
    const total = count * valueBytes;
    const valueFieldOffset = entryOffset + 8;
    let valueOffset: number;
    if (total <= inlineSize) valueOffset = valueFieldOffset;
    else {
      const fieldView = requireBytes(bytes, valueFieldOffset, inlineSize);
      valueOffset = fieldView.getUint32(0, littleEndian);
    }
    const values = readUnsignedValues(bytes, valueOffset, count, type, littleEndian);
    const text = type === 2 ? String.fromCharCode(...values).replace(/\0+$/, '') : undefined;
    tags.set(tag, { type, count, values, ...(text === undefined ? {} : { text }) });
  }
  const nextView = requireBytes(bytes, entriesStart + entriesLength, nextSize);
  return { tags, nextIfdOffset: nextView.getUint32(0, littleEndian) };
}

export interface TiffRasterMetadata {
  width: number;
  height: number;
  bitsPerSample: number;
  compression: number;
  samplesPerPixel: number;
  predictor: number;
  tileWidth: number;
  tileHeight: number;
  tileOffsets: number[];
  tileByteCounts: number[];
  nodata: number;
  transform: [number, number, number, number, number, number];
  totalLength: number;
}

function requiredTag(ifd: ParsedIfd, tag: number): TiffTag {
  const value = ifd.tags.get(tag);
  if (!value) throw new Error(`TIFF source is missing required tag ${tag}`);
  return value;
}

function scalarTag(ifd: ParsedIfd, tag: number): number {
  const value = requiredTag(ifd, tag).values[0];
  if (!Number.isSafeInteger(value)) throw new Error(`TIFF tag ${tag} is not a safe integer`);
  return value!;
}

export function readTiffRasterMetadata(ifd: ParsedIfd, totalLength: number): TiffRasterMetadata {
  const width = scalarTag(ifd, 256);
  const height = scalarTag(ifd, 257);
  const bitsPerSample = scalarTag(ifd, 258);
  const compression = scalarTag(ifd, 259);
  const samplesPerPixel = scalarTag(ifd, 277);
  const planarConfiguration = scalarTag(ifd, 284);
  const predictor = scalarTag(ifd, 317);
  const tileWidth = scalarTag(ifd, 322);
  const tileHeight = scalarTag(ifd, 323);
  const sampleFormat = scalarTag(ifd, 339);
  if (width !== 43200 || height !== 21600 || bitsPerSample !== 32 || compression !== 8 || samplesPerPixel !== 1 || planarConfiguration !== 1 || predictor !== 3 || tileWidth !== 256 || tileHeight !== 256 || sampleFormat !== 3) {
    throw new Error('TIFF file does not match the supported NOAA ETOPO 30 arc-second Float32/DEFLATE/Predictor=3 profile');
  }
  const columns = Math.ceil(width / tileWidth);
  const rows = Math.ceil(height / tileHeight);
  const tileOffsets = requiredTag(ifd, 324).values;
  const tileByteCounts = requiredTag(ifd, 325).values;
  const expectedTiles = columns * rows;
  if (tileOffsets.length !== expectedTiles || tileByteCounts.length !== expectedTiles) throw new Error(`TIFF tile arrays have ${tileOffsets.length}/${tileByteCounts.length} entries; expected ${expectedTiles}`);
  for (let i = 0; i < expectedTiles; i++) {
    const offset = tileOffsets[i]!;
    const count = tileByteCounts[i]!;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(count) || offset < 0 || count <= 0 || offset + count > totalLength) throw new RangeError(`TIFF tile ${i} lies outside the source object`);
  }
  const scale = requiredTag(ifd, 33550).values;
  const tiepoint = requiredTag(ifd, 33922).values;
  if (scale.length !== 3 || tiepoint.length !== 6 || scale[0]! <= 0 || scale[1]! <= 0) throw new Error('Unsupported GeoTIFF scale/tiepoint transform');
  const transform: [number, number, number, number, number, number] = [tiepoint[3]!, scale[0]!, 0, tiepoint[4]!, 0, -scale[1]!];
  if (transform[0] !== -180 || transform[3] !== 90 || Math.abs(transform[1] - 1 / 120) > 1e-12 || Math.abs(transform[5] + 1 / 120) > 1e-12) {
    throw new Error('TIFF GeoTransform does not match the global 30 arc-second ETOPO grid');
  }
  const nodataText = requiredTag(ifd, 42113).text;
  const nodata = Number(nodataText);
  if (!nodataText || !Number.isFinite(nodata) || nodata !== -99999) throw new Error('TIFF GDAL_NODATA tag is not -99999');
  return { width, height, bitsPerSample, compression, samplesPerPixel, predictor, tileWidth, tileHeight, tileOffsets, tileByteCounts, nodata, transform, totalLength };
}

export interface TileIndex {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  tileOffsets: number[];
  tileByteCounts: number[];
  totalLength: number;
}

export interface PixelWindow {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlannedTile {
  x: number;
  y: number;
  index: number;
  offset: number;
  byteCount: number;
}

export function planTiles(index: TileIndex, window: PixelWindow): PlannedTile[] {
  const { width, height, tileWidth, tileHeight, tileOffsets, tileByteCounts, totalLength } = index;
  if (![width, height, tileWidth, tileHeight, totalLength].every(Number.isSafeInteger) || width <= 0 || height <= 0 || tileWidth <= 0 || tileHeight <= 0 || totalLength <= 0) {
    throw new RangeError('Invalid TIFF tile index dimensions');
  }
  if (![window.x, window.y, window.width, window.height].every(Number.isSafeInteger) || window.x < 0 || window.y < 0 || window.width <= 0 || window.height <= 0 || window.x + window.width > width || window.y + window.height > height) {
    throw new RangeError('Pixel window is outside the TIFF raster');
  }
  const columns = Math.ceil(width / tileWidth);
  const x0 = Math.floor(window.x / tileWidth);
  const x1 = Math.floor((window.x + window.width - 1) / tileWidth);
  const y0 = Math.floor(window.y / tileHeight);
  const y1 = Math.floor((window.y + window.height - 1) / tileHeight);
  const tiles: PlannedTile[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const tileIndex = y * columns + x;
    if (tileIndex >= tileOffsets.length || tileIndex >= tileByteCounts.length) throw new RangeError('TIFF tile index arrays are incomplete');
    const offset = tileOffsets[tileIndex]!;
    const byteCount = tileByteCounts[tileIndex]!;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(byteCount) || offset < 0 || byteCount <= 0 || offset + byteCount > totalLength) {
      throw new RangeError(`TIFF tile ${tileIndex} range is outside the source file`);
    }
    tiles.push({ x, y, index: tileIndex, offset, byteCount });
  }
  return tiles;
}
