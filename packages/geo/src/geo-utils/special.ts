export const lngLatToText = (coordinates: [number, number]) => {
    /**
     * @param coordinates - Should be in longitude, latitude order
     */
    return `${Math.abs(coordinates[1])}°${coordinates[1] > 0 ? "N" : "S"}, ${Math.abs(coordinates[0])}°${coordinates[0] > 0 ? "E" : "W"}`;
};

export const extractStationName = (stationPlace: any) =>
    stationPlace.properties["name:en"] || stationPlace.properties.name;

export const extractStationLabel = (stationPlace: any) =>
    extractStationName(stationPlace) ||
    lngLatToText(stationPlace.geometry.coordinates);

export const groupObjects = (objects: any[]): any[][] => {
    const filteredObjects = objects.filter(
        (obj) =>
            obj.properties.name !== undefined ||
            obj.properties["name:en"] !== undefined ||
            obj.properties.network !== undefined,
    );

    const n = filteredObjects.length;
    const parent: number[] = Array.from({ length: n }, (_, i) => i);

    const find = (i: number): number => {
        if (parent[i] !== i) {
            parent[i] = find(parent[i]);
        }
        return parent[i];
    };

    const union = (i: number, j: number): void => {
        const rootI = find(i);
        const rootJ = find(j);
        if (rootI !== rootJ) {
            parent[rootJ] = rootI;
        }
    };

    const keys = ["name", "name:en", "network"];
    const paramMap: Record<string, number> = {};

    for (let i = 0; i < n; i++) {
        const obj = filteredObjects[i];
        for (const key of keys) {
            const value = obj.properties[key];
            if (value !== undefined) {
                const mapKey = `${key}:${value}`;
                if (paramMap[mapKey] === undefined) {
                    paramMap[mapKey] = i;
                } else {
                    union(i, paramMap[mapKey]);
                }
            }
        }
    }

    const groups: Record<number, any[]> = {};
    for (let i = 0; i < n; i++) {
        const root = find(i);
        if (!groups[root]) {
            groups[root] = [];
        }
        groups[root].push(filteredObjects[i]);
    }
    return Object.values(groups);
};

const naiveDistance = (
    point1: [number, number],
    point2: [number, number],
): number => {
    const dx: number = point1[0] - point2[0];
    const dy: number = point1[1] - point2[1];
    return Math.sqrt(dx * dx + dy * dy);
};

// Step 3.2: Spatial grid for O(1) neighbor lookup instead of O(n) scan
class SpatialGrid {
    private cells = new Map<string, number[]>();
    private cellSize: number;

    constructor(cellSize: number) {
        this.cellSize = cellSize;
    }

    private key(x: number, y: number): string {
        const cx = Math.floor(x / this.cellSize);
        const cy = Math.floor(y / this.cellSize);
        return `${cx},${cy}`;
    }

    insert(point: [number, number], index: number): void {
        const k = this.key(point[0], point[1]);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k)!.push(index);
    }

    remove(index: number, point: [number, number]): void {
        const k = this.key(point[0], point[1]);
        const cell = this.cells.get(k);
        if (cell) {
            const idx = cell.indexOf(index);
            if (idx !== -1) cell.splice(idx, 1);
        }
    }

    queryNeighbors(point: [number, number]): number[] {
        const cx = Math.floor(point[0] / this.cellSize);
        const cy = Math.floor(point[1] / this.cellSize);
        const results: number[] = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const cell = this.cells.get(`${cx + dx},${cy + dy}`);
                if (cell) results.push(...cell);
            }
        }
        return results;
    }
}

export const connectToSeparateLines = (
    lines: [number, number][][],
    maxJumpDistance: number = 0.01,
): [number, number][][] => {
    if (lines.length <= 1) return lines.length === 1 ? [lines[0]] : [];

    // Build spatial grid indexed by both endpoints of each line
    const grid = new SpatialGrid(maxJumpDistance);
    const remaining = new Set<number>();

    for (let i = 0; i < lines.length; i++) {
        remaining.add(i);
        grid.insert(lines[i][0], i);
        grid.insert(lines[i][lines[i].length - 1], i);
    }

    const result: [number, number][][] = [];
    let currentLine: [number, number][] = [];

    // Start with the first line
    const firstIdx = remaining.values().next().value!;
    remaining.delete(firstIdx);
    grid.remove(firstIdx, lines[firstIdx][0]);
    grid.remove(firstIdx, lines[firstIdx][lines[firstIdx].length - 1]);
    currentLine.push(...lines[firstIdx]);

    while (remaining.size > 0) {
        const lastPoint: [number, number] = currentLine[currentLine.length - 1];

        // Query grid for nearby candidates
        const candidates = grid
            .queryNeighbors(lastPoint)
            .filter((i) => remaining.has(i));

        let bestIndex: number = -1;
        let minDistance: number = Infinity;
        let shouldReverse: boolean = false;

        if (candidates.length > 0) {
            // Check only nearby lines
            for (const index of candidates) {
                const line = lines[index];
                const distToStart = naiveDistance(lastPoint, line[0]);
                if (distToStart < minDistance) {
                    minDistance = distToStart;
                    bestIndex = index;
                    shouldReverse = false;
                }
                const distToEnd = naiveDistance(
                    lastPoint,
                    line[line.length - 1],
                );
                if (distToEnd < minDistance) {
                    minDistance = distToEnd;
                    bestIndex = index;
                    shouldReverse = true;
                }
            }
        } else {
            // Fallback: scan all remaining (rare — only when no neighbors within grid range)
            for (const index of remaining) {
                const line = lines[index];
                const distToStart = naiveDistance(lastPoint, line[0]);
                if (distToStart < minDistance) {
                    minDistance = distToStart;
                    bestIndex = index;
                    shouldReverse = false;
                }
                const distToEnd = naiveDistance(
                    lastPoint,
                    line[line.length - 1],
                );
                if (distToEnd < minDistance) {
                    minDistance = distToEnd;
                    bestIndex = index;
                    shouldReverse = true;
                }
            }
        }

        // Remove from tracking
        remaining.delete(bestIndex);
        grid.remove(bestIndex, lines[bestIndex][0]);
        grid.remove(bestIndex, lines[bestIndex][lines[bestIndex].length - 1]);

        let nextLine: [number, number][] = lines[bestIndex];
        if (shouldReverse) {
            nextLine = nextLine.slice().reverse();
        }

        if (minDistance > maxJumpDistance) {
            result.push(currentLine);
            currentLine = [...nextLine];
        } else {
            const firstPointOfNextLine: [number, number] = nextLine[0];
            if (naiveDistance(lastPoint, firstPointOfNextLine) < 0.0001) {
                currentLine.push(...nextLine.slice(1));
            } else {
                currentLine.push(...nextLine);
            }
        }
    }

    if (currentLine.length > 0) {
        result.push(currentLine);
    }

    return result;
};
