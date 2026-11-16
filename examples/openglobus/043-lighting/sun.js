const RAD = Math.PI / 180;
export function subsolarPoint(date) {
    const ms = date.getTime();
    const jd = ms / 86400000 + 2440587.5;
    const t = (jd - 2451545.0) / 36525;
    const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
    const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
    const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    const c = Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * m * RAD) * 0.000289;
    const omega = 125.04 - 1934.136 * t;
    const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
    const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
    const declination = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
    const y = Math.tan(eps * RAD / 2) ** 2;
    const eotMinutes = 4 / RAD * (y * Math.sin(2 * l0 * RAD) - 2 * e * Math.sin(m * RAD) + 4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) - 0.5 * y * y * Math.sin(4 * l0 * RAD) - 1.25 * e * e * Math.sin(2 * m * RAD));
    const utcMinutes = (ms % 86400000 + 86400000) % 86400000 / 60000;
    let lon = -(utcMinutes - 720 + eotMinutes) / 4;
    lon = ((lon + 180) % 360 + 360) % 360 - 180;
    return {
        lat: declination,
        lon
    };
}
export function sunDirection(date) {
    const { lat, lon } = subsolarPoint(date);
    const cl = Math.cos(lat * RAD);
    return [
        Math.sin(lon * RAD) * cl,
        Math.sin(lat * RAD),
        Math.cos(lon * RAD) * cl
    ];
}
