export function packCloudVertices(cloud) {
    const buffer = new ArrayBuffer(cloud.count * 16);
    const floats = new Float32Array(buffer), bytes = new Uint8Array(buffer);
    for(let i = 0; i < cloud.count; i++){
        const source = i * 3, vertex = i * 4, color = i * 16 + 12;
        floats[vertex] = cloud.positions[source];
        floats[vertex + 1] = cloud.positions[source + 1];
        floats[vertex + 2] = cloud.positions[source + 2];
        bytes[color] = cloud.colors[source];
        bytes[color + 1] = cloud.colors[source + 1];
        bytes[color + 2] = cloud.colors[source + 2];
    }
    return buffer;
}
