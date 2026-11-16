const MAX_DECODED_TILE_BYTES = 16 * 1024 * 1024;

export async function inflateDeflate(compressed: Uint8Array, expectedBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > MAX_DECODED_TILE_BYTES) {
    throw new RangeError('DEFLATE output size exceeds bounded tile limit');
  }
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser does not support native DEFLATE decompression');
  const inputBuffer = new ArrayBuffer(compressed.byteLength);
  new Uint8Array(inputBuffer).set(compressed);
  const body = new Response(inputBuffer).body;
  if (!body) throw new Error('Could not create a DEFLATE input stream');
  const reader = body.pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > expectedBytes) {
        await reader.cancel('DEFLATE output exceeds tile bounds');
        throw new Error('DEFLATE output exceeds expected tile byte count');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (length !== expectedBytes) throw new Error(`DEFLATE decoded ${length} bytes; expected ${expectedBytes}`);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

export function undoFloatPredictor3(predicted: Uint8Array, width: number, height: number, littleEndian: boolean): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height * 4 !== predicted.byteLength) {
    throw new RangeError('Float Predictor 3 input must be one complete Float32 tile');
  }
  const output = new Uint8Array(predicted.byteLength);
  const lineBytes = width * 4;
  const line = new Uint8Array(lineBytes);
  for (let y = 0; y < height; y++) {
    const start = y * lineBytes;
    line.set(predicted.subarray(start, start + lineBytes));
    for (let i = 1; i < lineBytes; i++) line[i] = (line[i]! + line[i - 1]!) & 0xff;
    for (let x = 0; x < width; x++) {
      for (let byte = 0; byte < 4; byte++) {
        const plane = littleEndian ? 3 - byte : byte;
        output[start + x * 4 + byte] = line[plane * width + x]!;
      }
    }
  }
  return output;
}

export async function decodeFloat32DeflateTile(compressed: Uint8Array, width: number, height: number, littleEndian: boolean): Promise<Float32Array> {
  const bytes = await inflateDeflate(compressed, width * height * 4);
  const corrected = undoFloatPredictor3(bytes, width, height, littleEndian);
  const values = new Float32Array(width * height);
  const view = new DataView(corrected.buffer, corrected.byteOffset, corrected.byteLength);
  for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(i * 4, littleEndian);
  return values;
}
