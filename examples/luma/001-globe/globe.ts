/**
 * Globe geometry and Earth texture generation for luma.gl 3D Globe reproduction.
 * Zero runtime external dependencies.
 */

export interface SphereMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
}

export function createSphereMesh(latBands: number, lonBands: number, radius = 1.0): SphereMesh {
  const vertexCount = (latBands + 1) * (lonBands + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  let vOffset = 0;
  let uvOffset = 0;

  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat * Math.PI) / latBands; // 0 (north pole) to PI (south pole)
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let lon = 0; lon <= lonBands; lon++) {
      const phi = (lon * 2 * Math.PI) / lonBands; // 0 to 2*PI
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

  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
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

  return { positions, normals, uvs, indices };
}

export function computeSunDirection(timeRad: number): [number, number, number] {
  // Sun moves along equatorial plane with slight 23.4 degree axial tilt
  const tilt = (23.44 * Math.PI) / 180;
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);

  const x = Math.cos(timeRad);
  const z = Math.sin(timeRad);
  const y = sinT * Math.sin(timeRad);

  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

interface ContinentBox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

const CONTINENTS: ContinentBox[] = [
  // North America
  { minLon: -168, maxLon: -52, minLat: 15, maxLat: 72 },
  // Central America
  { minLon: -92, maxLon: -77, minLat: 7, maxLat: 18 },
  // South America
  { minLon: -82, maxLon: -34, minLat: -56, maxLat: 13 },
  // Europe
  { minLon: -10, maxLon: 60, minLat: 36, maxLat: 71 },
  // Africa
  { minLon: -18, maxLon: 52, minLat: -35, maxLat: 37 },
  // Asia
  { minLon: 60, maxLon: 180, minLat: 8, maxLat: 75 },
  // Southeast Asia & Indonesia
  { minLon: 95, maxLon: 141, minLat: -11, maxLat: 20 },
  // Australia
  { minLon: 113, maxLon: 154, minLat: -44, maxLat: -10 },
  // Japan
  { minLon: 128, maxLon: 146, minLat: 30, maxLat: 46 },
  // Antarctica
  { minLon: -180, maxLon: 180, minLat: -90, maxLat: -60 },
  // Greenland
  { minLon: -73, maxLon: -12, minLat: 60, maxLat: 84 },
];

export function isLandCoordinate(lonDeg: number, latDeg: number): boolean {
  // Normalize lon to [-180, 180]
  let lon = ((lonDeg + 180) % 360) - 180;
  if (lon < -180) lon += 360;

  for (const box of CONTINENTS) {
    if (lon >= box.minLon && lon <= box.maxLon && latDeg >= box.minLat && latDeg <= box.maxLat) {
      // Exclude Gulf of Mexico / central Atlantic water pockets
      if (lon >= -95 && lon <= -82 && latDeg >= 20 && latDeg <= 30) return false;
      // Exclude Mediterranean Sea roughly
      if (lon >= 0 && lon <= 35 && latDeg >= 30 && latDeg <= 42 && latDeg < 36 && lon < 25) return false;
      return true;
    }
  }
  return false;
}

export interface CityLightSeed {
  lon: number;
  lat: number;
  radius: number;
  intensity: number;
}

const MAJOR_METROS: CityLightSeed[] = [
  // North America
  { lon: -74.0, lat: 40.7, radius: 5, intensity: 1.0 }, // NYC
  { lon: -118.2, lat: 34.0, radius: 6, intensity: 0.9 }, // LA
  { lon: -87.6, lat: 41.9, radius: 4, intensity: 0.8 }, // Chicago
  { lon: -95.4, lat: 29.8, radius: 4, intensity: 0.7 }, // Houston
  { lon: -122.4, lat: 37.8, radius: 3, intensity: 0.9 }, // SF
  // Europe
  { lon: -0.1, lat: 51.5, radius: 4, intensity: 1.0 }, // London
  { lon: 2.3, lat: 48.9, radius: 4, intensity: 0.9 }, // Paris
  { lon: 13.4, lat: 52.5, radius: 3, intensity: 0.8 }, // Berlin
  { lon: 37.6, lat: 55.7, radius: 5, intensity: 0.9 }, // Moscow
  // East Asia
  { lon: 139.7, lat: 35.7, radius: 6, intensity: 1.0 }, // Tokyo
  { lon: 135.5, lat: 34.7, radius: 4, intensity: 0.9 }, // Osaka
  { lon: 126.9, lat: 37.6, radius: 4, intensity: 0.9 }, // Seoul
  { lon: 121.5, lat: 31.2, radius: 6, intensity: 1.0 }, // Shanghai
  { lon: 116.4, lat: 39.9, radius: 6, intensity: 1.0 }, // Beijing
  { lon: 113.3, lat: 23.1, radius: 5, intensity: 0.9 }, // Guangzhou
  { lon: 114.2, lat: 22.3, radius: 3, intensity: 0.9 }, // HK
  // South Asia
  { lon: 72.8, lat: 18.9, radius: 5, intensity: 0.8 }, // Mumbai
  { lon: 77.2, lat: 28.6, radius: 5, intensity: 0.8 }, // Delhi
  // Latin America
  { lon: -46.6, lat: -23.5, radius: 6, intensity: 0.9 }, // Sao Paulo
  { lon: -99.1, lat: 19.4, radius: 5, intensity: 0.9 }, // Mexico City
  // Australia
  { lon: 151.2, lat: -33.8, radius: 3, intensity: 0.8 }, // Sydney
  // Africa
  { lon: 31.2, lat: 30.0, radius: 4, intensity: 0.8 }, // Cairo
  { lon: 28.0, lat: -26.2, radius: 4, intensity: 0.8 }, // Johannesburg
];

export function generateEarthTextures(width: number, height: number): { day: Uint8Array; night: Uint8Array } {
  const day = new Uint8Array(width * height * 4);
  const night = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const latDeg = 90 - (y / height) * 180;
    const isPolarIce = latDeg < -60 || latDeg > 76;

    for (let x = 0; x < width; x++) {
      const lonDeg = (x / width) * 360 - 180;
      const idx = (y * width + x) * 4;

      const isLand = isLandCoordinate(lonDeg, latDeg);

      if (isPolarIce) {
        // Ice cap
        day[idx] = 235;
        day[idx + 1] = 242;
        day[idx + 2] = 250;
        day[idx + 3] = 40; // specular glint on ice
      } else if (isLand) {
        // Desert zones (Sahara, Arabian, Australian desert)
        const isDesert = (latDeg >= 16 && latDeg <= 32 && lonDeg >= -15 && lonDeg <= 55) ||
                         (latDeg <= -18 && latDeg >= -30 && lonDeg >= 115 && lonDeg <= 145);
        if (isDesert) {
          day[idx] = 198;
          day[idx + 1] = 160;
          day[idx + 2] = 104;
        } else {
          // Lush land / forest
          day[idx] = 34;
          day[idx + 1] = 112;
          day[idx + 2] = 52;
        }
        day[idx + 3] = 0; // zero specular on land
      } else {
        // Ocean - deep navy blue with specular mask = 255
        day[idx] = 14;
        day[idx + 1] = 32;
        day[idx + 2] = 68;
        day[idx + 3] = 255; // high specular reflection on water
      }

      // Night city lights computation
      let lightLuminosity = 0;
      for (const metro of MAJOR_METROS) {
        const dLon = (lonDeg - metro.lon) * Math.cos((latDeg * Math.PI) / 180);
        const dLat = latDeg - metro.lat;
        const dist = Math.hypot(dLon, dLat);
        if (dist < metro.radius) {
          const falloff = 1 - dist / metro.radius;
          lightLuminosity = Math.max(lightLuminosity, falloff * falloff * metro.intensity);
        }
      }

      if (lightLuminosity > 0.02) {
        // Golden glowing city lights: rgb(255, 210, 120)
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

  return { day, night };
}
