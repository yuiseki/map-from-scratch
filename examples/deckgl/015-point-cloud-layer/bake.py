"""Convert the pinned Kaarta LAZ sample to a single GPU-ready point stream."""
import struct
import sys
import numpy as np
import laspy

cloud = laspy.read(sys.argv[1])
coords = [np.asarray(axis, dtype=np.float64) for axis in (cloud.x, cloud.y, cloud.z)]
mins = [float(axis.min()) for axis in coords]
maxs = [float(axis.max()) for axis in coords]
packed = np.zeros(len(coords[0]), dtype=np.uint32)
axes = []
for shift, axis, low, high in zip((0, 10, 20), coords, mins, maxs):
    quantized = np.rint((axis - low) * (1023 / (high - low))).astype(np.uint32)
    axes.append(quantized)
    packed |= quantized << shift
def spread(value):
    value = (value | value << 16) & np.uint32(0x030000FF)
    value = (value | value << 8) & np.uint32(0x0300F00F)
    value = (value | value << 4) & np.uint32(0x030C30C3)
    return (value | value << 2) & np.uint32(0x09249249)
morton = spread(axes[0]) | spread(axes[1]) << 1 | spread(axes[2]) << 2
packed = packed[np.argsort(morton, kind='stable')]
with open(sys.argv[2], 'wb') as output:
    output.write(struct.pack('<4sI6f', b'PC01', len(packed), *mins, *maxs))
    output.write(packed.tobytes())
print(f'{len(packed):,} points, {32 + packed.nbytes:,} bytes')
