const D = Math.PI / 180, R = 6371000;
const unit = (lat, lon)=>[
        Math.cos(lat * D) * Math.cos(lon * D),
        Math.cos(lat * D) * Math.sin(lon * D),
        Math.sin(lat * D)
    ];
export function groundDistance(a, b) {
    const p = unit(a.lat, a.lon), q = unit(b.lat, b.lon);
    const c = Math.min(1, Math.max(-1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
    const cross = Math.hypot(p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]);
    return Math.atan2(cross, c) * R;
}
export const ease = (u)=>u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
export function flight(a, b) {
    const p = unit(a.lat, a.lon), q = unit(b.lat, b.lon);
    const dist = groundDistance(a, b), omega = dist / R, so = Math.sin(omega);
    const ha = Math.max(1, a.h), hb = Math.max(1, b.h);
    const climb = Math.max(0, Math.min(dist * 0.35, 1.5e6) - Math.max(ha, hb));
    const dh = ((b.heading - a.heading) % 360 + 540) % 360 - 180;
    const ms = Math.min(6500, 2000 + 1000 * Math.abs(Math.log10(hb / ha)) + dist / 30);
    return {
        ms,
        at (u) {
            if (u <= 0) return {
                ...a
            };
            const s = ease(u);
            let lat = b.lat, lon = b.lon;
            if (u < 1 && so > 1e-12) {
                const wa = Math.sin((1 - s) * omega) / so, wb = Math.sin(s * omega) / so;
                const v = [
                    0,
                    1,
                    2
                ].map((i)=>wa * p[i] + wb * q[i]);
                lat = Math.atan2(v[2], Math.hypot(v[0], v[1])) / D;
                lon = Math.atan2(v[1], v[0]) / D;
            } else if (u < 1) {
                lat = a.lat + (b.lat - a.lat) * s;
                lon = a.lon + (b.lon - a.lon) * s;
            }
            const h = u >= 1 ? b.h : Math.exp(Math.log(ha) + (Math.log(hb) - Math.log(ha)) * s) + climb * 4 * s * (1 - s);
            const heading = ((a.heading + dh * s) % 360 + 360) % 360;
            return {
                lat,
                lon,
                h,
                heading,
                pitch: a.pitch + (b.pitch - a.pitch) * s
            };
        }
    };
}
