export function build(capacity, grow) {
    const NIL = -1;
    const cap = capacity;
    let used = 0;
    const I = new Int32Array(cap);
    const X = new Float64Array(cap);
    const Y = new Float64Array(cap);
    const P = new Int32Array(cap);
    const N = new Int32Array(cap);
    const PZ = new Int32Array(cap);
    const NZ = new Int32Array(cap);
    const Z = new Int32Array(cap);
    const FULL = {
        full: true
    };
    function createNode(i, x, y) {
        const k = used++;
        I[k] = i;
        X[k] = x;
        Y[k] = y;
        Z[k] = 0;
        PZ[k] = NIL;
        NZ[k] = NIL;
        return k;
    }
    const steiners = new Set();
    const splitStack = [];
    let filteredOut = false;
    let zLinked = false;
    function run(data, holeIndices, dim = 2) {
        const need = (data.length / dim | 0) + (holeIndices ? 2 * holeIndices.length : 0) + 16;
        if (need > cap) return grow(data, holeIndices, dim, need);
        try {
            return earcut(data, holeIndices, dim);
        } catch (e) {
            if (e !== FULL) throw e;
            splitStack.length = 0;
            indexActive = false;
            return grow(data, holeIndices, dim, 2 * cap);
        }
    }
    function earcut(data, holeIndices, dim) {
        const hasHoles = !!holeIndices && holeIndices.length > 0;
        const outerLen = hasHoles ? holeIndices[0] * dim : data.length;
        if (steiners.size) steiners.clear();
        zLinked = false;
        used = 0;
        let outerNode = linkedList(data, 0, outerLen, dim, true);
        const triangles = [];
        if (outerNode === NIL || N[outerNode] === P[outerNode]) return triangles;
        let minX = 0, minY = 0, invSize = 0;
        if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);
        if (data.length > 80 * dim) {
            minX = data[0];
            minY = data[1];
            let maxX = minX, maxY = minY;
            for(let i = dim; i < outerLen; i += dim){
                const x = data[i], y = data[i + 1];
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
            invSize = Math.max(maxX - minX, maxY - minY);
            invSize = invSize !== 0 ? 32767 / invSize : 0;
        }
        earcutLinked(outerNode, triangles, minX, minY, invSize);
        while(splitStack.length)earcutLinked(splitStack.pop(), triangles, minX, minY, invSize);
        return triangles;
    }
    function linkedList(data, start, end, dim, clockwise) {
        const n = (end - start) / dim | 0;
        if (n <= 0) return NIL;
        const base = used, lastK = base + n - 1;
        used += n;
        const first = start / dim | 0;
        if (clockwise === signedArea(data, start, end, dim) > 0) {
            for(let j = 0, k = base, o = start; j < n; j++, k++, o += dim){
                I[k] = first + j;
                X[k] = data[o];
                Y[k] = data[o + 1];
                P[k] = k - 1;
                N[k] = k + 1;
            }
        } else {
            for(let j = 0, k = base, o = end - dim; j < n; j++, k++, o -= dim){
                I[k] = first + n - 1 - j;
                X[k] = data[o];
                Y[k] = data[o + 1];
                P[k] = k - 1;
                N[k] = k + 1;
            }
        }
        P[base] = lastK;
        N[lastK] = base;
        let last = lastK;
        if (X[last] === X[N[last]] && Y[last] === Y[N[last]]) {
            removeNode(last);
            last = N[last];
        }
        return last;
    }
    function filterPoints(start, end = start) {
        const full = end === start;
        let p = start, again;
        do {
            again = false;
            const n = N[p];
            if (p !== n && (steiners.size === 0 || !steiners.has(p)) && (X[p] === X[n] && Y[p] === Y[n] || area(P[p], p, n) === 0)) {
                if (full || p === end) end = P[p];
                filteredOut = true;
                removeNode(p);
                p = P[p];
                again = true;
            } else if (full || p !== end) {
                p = n;
                again = !full;
            }
        }while (again || p !== end)
        return end;
    }
    function earcutLinked(ear, triangles, minX, minY, invSize) {
        if (invSize) {
            indexCurve(ear, minX, minY, invSize);
            zLinked = true;
        }
        let stop = ear, cured = false, convex = invSize ? isConvex(ear) : false;
        while(P[ear] !== N[ear]){
            const prev = P[ear], next = N[ear];
            if (area(prev, ear, next) < 0 && (convex || (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)))) {
                triangles.push(I[prev], I[ear], I[next]);
                removeNode(ear);
                ear = next;
                stop = next;
                continue;
            }
            convex = false;
            ear = next;
            if (ear === stop) {
                filteredOut = false;
                ear = filterPoints(ear);
                if (filteredOut) {
                    stop = ear;
                    continue;
                }
                if (!cured) {
                    ear = cureLocalIntersections(ear, triangles);
                    stop = ear;
                    cured = true;
                    continue;
                }
                splitEarcut(ear);
                break;
            }
        }
    }
    function isConvex(start) {
        let p = start;
        do {
            if (area(P[p], p, N[p]) >= 0) return false;
            p = N[p];
        }while (p !== start)
        return true;
    }
    function isEar(ear) {
        const x = X, y = Y, prv = P, nxt = N;
        const a = prv[ear], c = nxt[ear];
        const ax = x[a], bx = x[ear], cx = x[c], ay = y[a], by = y[ear], cy = y[c];
        const x0 = Math.min(ax, bx, cx), y0 = Math.min(ay, by, cy), x1 = Math.max(ax, bx, cx), y1 = Math.max(ay, by, cy);
        let p = nxt[c];
        while(p !== a){
            const px = x[p], py = y[p];
            if (px >= x0 && px <= x1 && py >= y0 && py <= y1 && !(ax === px && ay === py) && pointInTriangle(ax, ay, bx, by, cx, cy, px, py) && area(prv[p], p, nxt[p]) >= 0) return false;
            p = nxt[p];
        }
        return true;
    }
    function isEarHashed(ear, minX, minY, invSize) {
        const x = X, y = Y, z = Z, prv = P, nxt = N;
        const a = prv[ear], c = nxt[ear];
        const ax = x[a], bx = x[ear], cx = x[c], ay = y[a], by = y[ear], cy = y[c];
        const x0 = Math.min(ax, bx, cx), y0 = Math.min(ay, by, cy), x1 = Math.max(ax, bx, cx), y1 = Math.max(ay, by, cy);
        const minZ = zOrder(x0, y0, minX, minY, invSize), maxZ = zOrder(x1, y1, minX, minY, invSize);
        let p = PZ[ear];
        while(p !== NIL && z[p] >= minZ){
            const px = x[p], py = y[p];
            if (px >= x0 && px <= x1 && py >= y0 && py <= y1 && p !== c && !(ax === px && ay === py) && pointInTriangle(ax, ay, bx, by, cx, cy, px, py) && area(prv[p], p, nxt[p]) >= 0) return false;
            p = PZ[p];
        }
        let n = NZ[ear];
        while(n !== NIL && z[n] <= maxZ){
            const nx = x[n], ny = y[n];
            if (nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1 && n !== c && !(ax === nx && ay === ny) && pointInTriangle(ax, ay, bx, by, cx, cy, nx, ny) && area(prv[n], n, nxt[n]) >= 0) return false;
            n = NZ[n];
        }
        return true;
    }
    function cureLocalIntersections(start, triangles) {
        let p = start, cured = false;
        do {
            const a = P[p], b = N[N[p]];
            if (intersects(a, p, N[p], b, false) && locallyInside(a, b) && locallyInside(b, a)) {
                triangles.push(I[a], I[p], I[b]);
                removeNode(p);
                removeNode(N[p]);
                p = start = b;
                cured = true;
            }
            p = N[p];
        }while (p !== start)
        return cured ? filterPoints(p) : p;
    }
    function splitEarcut(start) {
        let a = start;
        do {
            let b = N[N[a]];
            while(b !== P[a]){
                if (I[a] !== I[b] && isValidDiagonal(a, b)) {
                    let c = splitPolygon(a, b);
                    a = filterPoints(a, N[a]);
                    c = filterPoints(c, N[c]);
                    splitStack.push(c, a);
                    return;
                }
                b = N[b];
            }
            a = N[a];
        }while (a !== start)
    }
    let indexActive = false;
    function eliminateHoles(data, holeIndices, outerNode, dim) {
        const queue = [];
        for(let i = 0, len = holeIndices.length; i < len; i++){
            const start = holeIndices[i] * dim;
            const end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
            const list = linkedList(data, start, end, dim, false);
            if (list === NIL) continue;
            if (list === N[list]) steiners.add(list);
            queue.push(getLeftmost(list));
        }
        queue.sort(compareXYSlope);
        buildBlockIndex(data.length / dim, holeIndices.length);
        indexSegment(outerNode, outerNode);
        indexActive = true;
        for(let i = 0; i < queue.length; i++)outerNode = eliminateHole(queue[i], outerNode);
        indexActive = false;
        return filterPoints(outerNode);
    }
    function compareXYSlope(a, b) {
        return X[a] - X[b] || Y[a] - Y[b] || (Y[N[a]] - Y[a]) / (X[N[a]] - X[a]) - (Y[N[b]] - Y[b]) / (X[N[b]] - X[b]);
    }
    function eliminateHole(hole, outerNode) {
        const bridge = findHoleBridge(hole, outerNode);
        if (bridge === NIL) return outerNode;
        const bridgeReverse = splitPolygon(bridge, hole);
        const bridge2 = N[bridgeReverse];
        indexSegment(bridge, N[bridge2]);
        filterPoints(P[bridgeReverse], bridgeReverse);
        const a = P[bridge];
        if (area(a, bridge, hole) === 0 && (X[a] - X[bridge]) * (X[hole] - X[bridge]) + (Y[a] - Y[bridge]) * (Y[hole] - Y[bridge]) < 0) return bridge;
        return filterPoints(bridge, N[bridge]);
    }
    const K = 16;
    let blockBBox = new Float64Array(0);
    let blockHead = new Int32Array(0);
    let blockStop = new Int32Array(0);
    let numBlocks = 0;
    function buildBlockIndex(maxNodes, numHoles) {
        const maxBlocks = Math.ceil((maxNodes + 2 * numHoles) / K) + numHoles + 2;
        if (blockHead.length < maxBlocks) {
            blockBBox = new Float64Array(maxBlocks * 4);
            blockHead = new Int32Array(maxBlocks);
            blockStop = new Int32Array(maxBlocks);
        }
        numBlocks = 0;
    }
    function indexSegment(head, stop) {
        let p = head;
        do {
            const b = numBlocks++;
            blockHead[b] = p;
            let minX = X[p], minY = Y[p], maxX = minX, maxY = minY, k = 0;
            do {
                const c = N[p];
                Z[p] = b;
                const cx = X[c], cy = Y[c];
                if (cx < minX) minX = cx;
                if (cx > maxX) maxX = cx;
                if (cy < minY) minY = cy;
                if (cy > maxY) maxY = cy;
                p = c;
            }while (++k < K && p !== stop)
            blockStop[b] = p;
            const g = b * 4;
            blockBBox[g] = minX;
            blockBBox[g + 1] = minY;
            blockBBox[g + 2] = maxX;
            blockBBox[g + 3] = maxY;
        }while (p !== stop)
    }
    function growBlock(head, tail) {
        const g = Z[head] * 4, tx = X[tail], ty = Y[tail];
        if (tx < blockBBox[g]) blockBBox[g] = tx;
        if (ty < blockBBox[g + 1]) blockBBox[g + 1] = ty;
        if (tx > blockBBox[g + 2]) blockBBox[g + 2] = tx;
        if (ty > blockBBox[g + 3]) blockBBox[g + 3] = ty;
    }
    function liveBlockStop(b) {
        let s = blockStop[b];
        while(N[P[s]] !== s)s = N[s];
        return blockStop[b] = s;
    }
    function liveBlockHead(b) {
        let h = blockHead[b];
        while(N[P[h]] !== h)h = N[h];
        return blockHead[b] = h;
    }
    function findHoleBridge(hole, outerNode) {
        const x = X, y = Y, nxt = N;
        const hx = x[hole], hy = y[hole];
        let qx = -Infinity, m = NIL, p = outerNode;
        if (hx === x[p] && hy === y[p]) return p;
        for(let b = 0, g = 0; b < numBlocks; b++, g += 4){
            if (hy < blockBBox[g + 1] || hy > blockBBox[g + 3] || blockBBox[g] > hx || blockBBox[g + 2] <= qx) continue;
            const stop = liveBlockStop(b);
            p = liveBlockHead(b);
            do {
                const n = nxt[p];
                if (hx === x[n] && hy === y[n]) return n;
                const py = y[p], ny = y[n];
                if (hy <= py && hy >= ny && ny !== py) {
                    const px = x[p], qxn = px + (hy - py) * (x[n] - px) / (ny - py);
                    if (qxn <= hx && qxn > qx) {
                        qx = qxn;
                        m = px < x[n] ? p : n;
                        if (qxn === hx) return m;
                    }
                }
                p = n;
            }while (p !== stop)
        }
        if (m === NIL) return NIL;
        const mx = x[m], my = y[m];
        const tminY = hy < my ? hy : my, tmaxY = hy < my ? my : hy;
        let tanMin = Infinity;
        for(let b = 0, g = 0; b < numBlocks; b++, g += 4){
            if (blockBBox[g + 2] < mx || blockBBox[g] > hx || blockBBox[g + 3] < tminY || blockBBox[g + 1] > tmaxY) continue;
            const stop = liveBlockStop(b);
            p = liveBlockHead(b);
            do {
                const px = x[p], py = y[p];
                if (hx >= px && px >= mx && hx !== px && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, px, py)) {
                    const tan = Math.abs(hy - py) / (hx - px);
                    if ((locallyInside(p, hole) || py === hy && y[nxt[p]] === hy && x[nxt[p]] > hx) && (tan < tanMin || tan === tanMin && (px > x[m] || px === x[m] && sectorContainsSector(m, p)))) {
                        m = p;
                        tanMin = tan;
                    }
                }
                p = nxt[p];
            }while (p !== stop)
        }
        return m;
    }
    function sectorContainsSector(m, p) {
        return area(P[m], m, P[p]) < 0 && area(N[p], m, N[m]) < 0;
    }
    const sortA = new Int32Array(cap);
    const sortB = new Int32Array(cap);
    const zA = new Uint32Array(cap);
    const zB = new Uint32Array(cap);
    const counts = new Uint32Array(256);
    function indexCurve(start, minX, minY, invSize) {
        const arr = sortA, z = Z, x = X, y = Y;
        let p = start, n = 0;
        do {
            const v = zOrder(x[p], y[p], minX, minY, invSize);
            z[p] = v;
            arr[n] = p;
            zA[n++] = v;
            p = N[p];
        }while (p !== start)
        if (n <= 32) {
            for(let i = 1; i < n; i++){
                const node = arr[i], v = zA[i];
                let j = i - 1;
                while(j >= 0 && zA[j] > v){
                    arr[j + 1] = arr[j];
                    zA[j + 1] = zA[j];
                    j--;
                }
                arr[j + 1] = node;
                zA[j + 1] = v;
            }
        } else {
            radixPass(n, sortA, zA, sortB, zB, 0);
            radixPass(n, sortB, zB, sortA, zA, 8);
            radixPass(n, sortA, zA, sortB, zB, 16);
            radixPass(n, sortB, zB, sortA, zA, 24);
        }
        let prev = NIL;
        for(let i = 0; i < n; i++){
            const node = arr[i];
            PZ[node] = prev;
            if (prev !== NIL) NZ[prev] = node;
            prev = node;
        }
        NZ[prev] = NIL;
    }
    function radixPass(n, src, srcZ, dst, dstZ, shift) {
        counts.fill(0);
        for(let i = 0; i < n; i++)counts[srcZ[i] >>> shift & 0xff]++;
        let sum = 0;
        for(let b = 0; b < 256; b++){
            const c = counts[b];
            counts[b] = sum;
            sum += c;
        }
        for(let i = 0; i < n; i++){
            const v = srcZ[i], pos = counts[v >>> shift & 0xff]++;
            dst[pos] = src[i];
            dstZ[pos] = v;
        }
    }
    function zOrder(px, py, minX, minY, invSize) {
        let x = (px - minX) * invSize | 0, y = (py - minY) * invSize | 0;
        x = (x | x << 8) & 0x00ff00ff;
        x = (x | x << 4) & 0x0f0f0f0f;
        x = (x | x << 2) & 0x33333333;
        x = (x | x << 1) & 0x55555555;
        y = (y | y << 8) & 0x00ff00ff;
        y = (y | y << 4) & 0x0f0f0f0f;
        y = (y | y << 2) & 0x33333333;
        y = (y | y << 1) & 0x55555555;
        return x | y << 1;
    }
    function getLeftmost(start) {
        let p = start, leftmost = start;
        do {
            if (X[p] < X[leftmost] || X[p] === X[leftmost] && Y[p] < Y[leftmost]) leftmost = p;
            p = N[p];
        }while (p !== start)
        return leftmost;
    }
    function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
        return (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py);
    }
    function isValidDiagonal(a, b) {
        const zeroLength = X[a] === X[b] && Y[a] === Y[b] && area(P[a], a, N[a]) > 0 && area(P[b], b, N[b]) > 0;
        return I[N[a]] !== I[b] && (zeroLength || locallyInside(a, b) && locallyInside(b, a) && (area(P[a], a, P[b]) !== 0 || area(a, P[b], b) !== 0)) && !intersectsPolygon(a, b) && (zeroLength || middleInside(a, b));
    }
    function area(p, q, r) {
        return (Y[q] - Y[p]) * (X[r] - X[q]) - (X[q] - X[p]) * (Y[r] - Y[q]);
    }
    function intersects(p1, q1, p2, q2, includeBoundary = true) {
        const o1 = area(p1, q1, p2), o2 = area(p1, q1, q2), o3 = area(p2, q2, p1), o4 = area(p2, q2, q1);
        if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0) && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) return true;
        if (!includeBoundary) return false;
        if (o1 === 0 && onSegment(p1, p2, q1)) return true;
        if (o2 === 0 && onSegment(p1, q2, q1)) return true;
        if (o3 === 0 && onSegment(p2, p1, q2)) return true;
        if (o4 === 0 && onSegment(p2, q1, q2)) return true;
        return false;
    }
    function onSegment(p, q, r) {
        const qx = X[q], qy = Y[q];
        return qx <= Math.max(X[p], X[r]) && qx >= Math.min(X[p], X[r]) && qy <= Math.max(Y[p], Y[r]) && qy >= Math.min(Y[p], Y[r]);
    }
    function intersectsPolygon(a, b) {
        const x = X, y = Y, nxt = N, idx = I;
        const ax = x[a], ay = y[a], bx = x[b], by = y[b];
        const minX = ax < bx ? ax : bx, maxX = ax < bx ? bx : ax, minY = ay < by ? ay : by, maxY = ay < by ? by : ay;
        const ai = idx[a], bi = idx[b];
        let p = a;
        do {
            const n = nxt[p];
            const px = x[p], py = y[p], nx = x[n], ny = y[n];
            if (!(px > maxX && nx > maxX || px < minX && nx < minX || py > maxY && ny > maxY || py < minY && ny < minY) && idx[p] !== ai && idx[n] !== ai && idx[p] !== bi && idx[n] !== bi && intersects(p, n, a, b)) return true;
            p = n;
        }while (p !== a)
        return false;
    }
    function locallyInside(a, b) {
        return area(P[a], a, N[a]) < 0 ? area(a, b, N[a]) >= 0 && area(a, P[a], b) >= 0 : area(a, b, P[a]) < 0 || area(a, N[a], b) < 0;
    }
    function middleInside(a, b) {
        const x = X, y = Y, nxt = N;
        const px = (x[a] + x[b]) / 2, py = (y[a] + y[b]) / 2;
        let p = a, inside = false;
        do {
            const n = nxt[p];
            if (y[p] > py !== y[n] > py && px < (x[n] - x[p]) * (py - y[p]) / (y[n] - y[p]) + x[p]) inside = !inside;
            p = n;
        }while (p !== a)
        return inside;
    }
    function splitPolygon(a, b) {
        if (used + 2 > cap) throw FULL;
        const a2 = createNode(I[a], X[a], Y[a]), b2 = createNode(I[b], X[b], Y[b]);
        const an = N[a], bp = P[b];
        N[a] = b;
        P[b] = a;
        N[a2] = an;
        P[an] = a2;
        N[b2] = a2;
        P[a2] = b2;
        N[bp] = b2;
        P[b2] = bp;
        return b2;
    }
    function insertNode(i, x, y, last) {
        const p = createNode(i, x, y);
        if (last === NIL) {
            P[p] = p;
            N[p] = p;
        } else {
            const ln = N[last];
            N[p] = ln;
            P[p] = last;
            P[ln] = p;
            N[last] = p;
        }
        return p;
    }
    function removeNode(p) {
        const prv = P[p], nxt = N[p];
        P[nxt] = prv;
        N[prv] = nxt;
        if (zLinked) {
            const pz = PZ[p], nz = NZ[p];
            if (pz !== NIL) NZ[pz] = nz;
            if (nz !== NIL) PZ[nz] = pz;
        }
        if (indexActive) growBlock(prv, nxt);
    }
    function signedArea(data, start, end, dim) {
        let sum = 0;
        for(let i = start, j = end - dim; i < end; i += dim){
            sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
            j = i;
        }
        return sum;
    }
    return {
        run,
        cap,
        signedArea
    };
}
let compiled = false;
function fresh(capacity) {
    try {
        const make = new Function(`return ${build.toString()}`)();
        const pool = make(capacity, grow);
        compiled = true;
        return pool;
    } catch  {
        compiled = false;
        return build(capacity, grow);
    }
}
let large = null;
export function largePool() {
    return large && {
        cap: large.cap,
        compiled
    };
}
function grow(data, holeIndices, dim, need) {
    if (!large || large.cap < need) {
        let c = large ? large.cap : first.cap;
        while(c < need)c *= 2;
        large = fresh(c);
    }
    return large.run(data, holeIndices, dim);
}
const first = build(1 << 13, grow);
const signedArea = first.signedArea;
const earcut = first.run;
export default earcut;
export function deviation(data, holeIndices, dim, triangles) {
    const hasHoles = !!holeIndices && holeIndices.length > 0;
    const outerLen = hasHoles ? holeIndices[0] * dim : data.length;
    let polygonArea = Math.abs(signedArea(data, 0, outerLen, dim));
    if (hasHoles) {
        for(let i = 0, len = holeIndices.length; i < len; i++){
            const start = holeIndices[i] * dim;
            const end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
            polygonArea -= Math.abs(signedArea(data, start, end, dim));
        }
    }
    let trianglesArea = 0;
    for(let i = 0; i < triangles.length; i += 3){
        const a = triangles[i] * dim, b = triangles[i + 1] * dim, c = triangles[i + 2] * dim;
        trianglesArea += Math.abs((data[a] - data[c]) * (data[b + 1] - data[a + 1]) - (data[a] - data[b]) * (data[c + 1] - data[a + 1]));
    }
    if (trianglesArea === 0) {
        let max = 0;
        for(let i = 0; i < data.length; i += dim)max = Math.max(max, Math.abs(data[i]), Math.abs(data[i + 1]));
        return Math.abs(polygonArea) <= data.length * max * max * Number.EPSILON ? 0 : 1;
    }
    return Math.abs((trianglesArea - polygonArea) / polygonArea);
}
export function flatten(data) {
    const vertices = [], holes = [];
    const dimensions = data[0][0].length;
    let holeIndex = 0;
    for(let r = 0; r < data.length; r++){
        const ring = data[r];
        for(let k = 0; k < ring.length; k++)for(let d = 0; d < dimensions; d++)vertices.push(ring[k][d]);
        if (holeIndex && ring.length) holes.push(holeIndex);
        holeIndex += ring.length;
    }
    return {
        vertices,
        holes,
        dimensions
    };
}
