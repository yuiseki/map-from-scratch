export function createSphereMesh(latBands, lonBands, radius = 1.0) {
    const vertexCount = (latBands + 1) * (lonBands + 1);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    let vOffset = 0;
    let uvOffset = 0;
    for(let lat = 0; lat <= latBands; lat++){
        const theta = lat * Math.PI / latBands;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        for(let lon = 0; lon <= lonBands; lon++){
            const phi = lon * 2 * Math.PI / lonBands;
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);
            const x = cosPhi * sinTheta;
            const y = cosTheta;
            const z = sinPhi * sinTheta;
            normals[vOffset] = x;
            normals[vOffset + 1] = y;
            normals[vOffset + 2] = z;
            positions[vOffset] = x * radius;
            positions[vOffset + 1] = y * radius;
            positions[vOffset + 2] = z * radius;
            vOffset += 3;
            uvs[uvOffset] = lon / lonBands;
            uvs[uvOffset + 1] = lat / latBands;
            uvOffset += 2;
        }
    }
    const indexCount = latBands * lonBands * 6;
    const indices = new Uint16Array(indexCount);
    let idx = 0;
    for(let lat = 0; lat < latBands; lat++){
        for(let lon = 0; lon < lonBands; lon++){
            const first = lat * (lonBands + 1) + lon;
            const second = first + lonBands + 1;
            indices[idx++] = first;
            indices[idx++] = second;
            indices[idx++] = first + 1;
            indices[idx++] = second;
            indices[idx++] = second + 1;
            indices[idx++] = first + 1;
        }
    }
    return {
        positions,
        normals,
        uvs,
        indices
    };
}
export function computeSunDirection(timeRad) {
    const tilt = 23.44 * Math.PI / 180;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    const x = Math.cos(timeRad);
    const z = Math.sin(timeRad);
    const y = sinT * Math.sin(timeRad);
    const len = Math.hypot(x, y, z);
    return [
        x / len,
        y / len,
        z / len
    ];
}
const CONTINENTS = [
    {
        minLon: -168,
        maxLon: -52,
        minLat: 15,
        maxLat: 72
    },
    {
        minLon: -92,
        maxLon: -77,
        minLat: 7,
        maxLat: 18
    },
    {
        minLon: -82,
        maxLon: -34,
        minLat: -56,
        maxLat: 13
    },
    {
        minLon: -10,
        maxLon: 60,
        minLat: 36,
        maxLat: 71
    },
    {
        minLon: -18,
        maxLon: 52,
        minLat: -35,
        maxLat: 37
    },
    {
        minLon: 60,
        maxLon: 180,
        minLat: 8,
        maxLat: 75
    },
    {
        minLon: 95,
        maxLon: 141,
        minLat: -11,
        maxLat: 20
    },
    {
        minLon: 113,
        maxLon: 154,
        minLat: -44,
        maxLat: -10
    },
    {
        minLon: 128,
        maxLon: 146,
        minLat: 30,
        maxLat: 46
    },
    {
        minLon: -180,
        maxLon: 180,
        minLat: -90,
        maxLat: -60
    },
    {
        minLon: -73,
        maxLon: -12,
        minLat: 60,
        maxLat: 84
    }
];
export function isLandCoordinate(lonDeg, latDeg) {
    let lon = (lonDeg + 180) % 360 - 180;
    if (lon < -180) lon += 360;
    for (const box of CONTINENTS){
        if (lon >= box.minLon && lon <= box.maxLon && latDeg >= box.minLat && latDeg <= box.maxLat) {
            if (lon >= -95 && lon <= -82 && latDeg >= 20 && latDeg <= 30) return false;
            if (lon >= 0 && lon <= 35 && latDeg >= 30 && latDeg <= 42 && latDeg < 36 && lon < 25) return false;
            return true;
        }
    }
    return false;
}
const MAJOR_METROS = [
    {
        lon: -74.0,
        lat: 40.7,
        radius: 5,
        intensity: 1.0
    },
    {
        lon: -118.2,
        lat: 34.0,
        radius: 6,
        intensity: 0.9
    },
    {
        lon: -87.6,
        lat: 41.9,
        radius: 4,
        intensity: 0.8
    },
    {
        lon: -95.4,
        lat: 29.8,
        radius: 4,
        intensity: 0.7
    },
    {
        lon: -122.4,
        lat: 37.8,
        radius: 3,
        intensity: 0.9
    },
    {
        lon: -0.1,
        lat: 51.5,
        radius: 4,
        intensity: 1.0
    },
    {
        lon: 2.3,
        lat: 48.9,
        radius: 4,
        intensity: 0.9
    },
    {
        lon: 13.4,
        lat: 52.5,
        radius: 3,
        intensity: 0.8
    },
    {
        lon: 37.6,
        lat: 55.7,
        radius: 5,
        intensity: 0.9
    },
    {
        lon: 139.7,
        lat: 35.7,
        radius: 6,
        intensity: 1.0
    },
    {
        lon: 135.5,
        lat: 34.7,
        radius: 4,
        intensity: 0.9
    },
    {
        lon: 126.9,
        lat: 37.6,
        radius: 4,
        intensity: 0.9
    },
    {
        lon: 121.5,
        lat: 31.2,
        radius: 6,
        intensity: 1.0
    },
    {
        lon: 116.4,
        lat: 39.9,
        radius: 6,
        intensity: 1.0
    },
    {
        lon: 113.3,
        lat: 23.1,
        radius: 5,
        intensity: 0.9
    },
    {
        lon: 114.2,
        lat: 22.3,
        radius: 3,
        intensity: 0.9
    },
    {
        lon: 72.8,
        lat: 18.9,
        radius: 5,
        intensity: 0.8
    },
    {
        lon: 77.2,
        lat: 28.6,
        radius: 5,
        intensity: 0.8
    },
    {
        lon: -46.6,
        lat: -23.5,
        radius: 6,
        intensity: 0.9
    },
    {
        lon: -99.1,
        lat: 19.4,
        radius: 5,
        intensity: 0.9
    },
    {
        lon: 151.2,
        lat: -33.8,
        radius: 3,
        intensity: 0.8
    },
    {
        lon: 31.2,
        lat: 30.0,
        radius: 4,
        intensity: 0.8
    },
    {
        lon: 28.0,
        lat: -26.2,
        radius: 4,
        intensity: 0.8
    }
];
export function generateEarthTextures(width, height) {
    const day = new Uint8Array(width * height * 4);
    const night = new Uint8Array(width * height * 4);
    for(let y = 0; y < height; y++){
        const latDeg = 90 - y / height * 180;
        const isPolarIce = latDeg < -60 || latDeg > 76;
        for(let x = 0; x < width; x++){
            const lonDeg = x / width * 360 - 180;
            const idx = (y * width + x) * 4;
            const isLand = isLandCoordinate(lonDeg, latDeg);
            if (isPolarIce) {
                day[idx] = 235;
                day[idx + 1] = 242;
                day[idx + 2] = 250;
                day[idx + 3] = 40;
            } else if (isLand) {
                const isDesert = latDeg >= 16 && latDeg <= 32 && lonDeg >= -15 && lonDeg <= 55 || latDeg <= -18 && latDeg >= -30 && lonDeg >= 115 && lonDeg <= 145;
                if (isDesert) {
                    day[idx] = 198;
                    day[idx + 1] = 160;
                    day[idx + 2] = 104;
                } else {
                    day[idx] = 34;
                    day[idx + 1] = 112;
                    day[idx + 2] = 52;
                }
                day[idx + 3] = 0;
            } else {
                day[idx] = 14;
                day[idx + 1] = 32;
                day[idx + 2] = 68;
                day[idx + 3] = 255;
            }
            let lightLuminosity = 0;
            for (const metro of MAJOR_METROS){
                const dLon = (lonDeg - metro.lon) * Math.cos(latDeg * Math.PI / 180);
                const dLat = latDeg - metro.lat;
                const dist = Math.hypot(dLon, dLat);
                if (dist < metro.radius) {
                    const falloff = 1 - dist / metro.radius;
                    lightLuminosity = Math.max(lightLuminosity, falloff * falloff * metro.intensity);
                }
            }
            if (lightLuminosity > 0.02) {
                night[idx] = Math.min(255, Math.floor(255 * lightLuminosity));
                night[idx + 1] = Math.min(255, Math.floor(210 * lightLuminosity));
                night[idx + 2] = Math.min(255, Math.floor(120 * lightLuminosity));
                night[idx + 3] = 255;
            } else {
                night[idx] = 0;
                night[idx + 1] = 0;
                night[idx + 2] = 0;
                night[idx + 3] = 0;
            }
        }
    }
    return {
        day,
        night
    };
}
