import { medicalOutpost, worldGenerationSettings } from '@zombi-survive/content';
import type { WorldChunk, WorldPosition } from '@zombi-survive/domain';
import { generateWorldChunk } from '@zombi-survive/worldgen';

import { createMapMarkerControls } from './map-markers';
import { createMapStorage, type MapMarker } from './map-storage';

const { chunkSizeMeters, generatorVersion, initialSeed: seed } = worldGenerationSettings;
const chunkCoordinate = (meters: number): number =>
    Math.floor((meters + chunkSizeMeters / 2) / chunkSizeMeters);
const chunkId = (chunkX: number, chunkY: number): string => `${String(chunkX)},${String(chunkY)}`;
const mapChunkId = ({ xMeters, yMeters }: WorldPosition): string =>
    chunkId(chunkCoordinate(xMeters), chunkCoordinate(yMeters));
const terrainColors = { grass: '#34523e', dirt: '#5f5439', gravel: '#758373' };
const panDirections = new Map<string, readonly [number, number]>([
    ['ArrowUp', [0, -1]],
    ['ArrowDown', [0, 1]],
    ['ArrowLeft', [-1, 0]],
    ['ArrowRight', [1, 0]],
]);

export const createVisitedMap = ({
    viewport,
    coordinates,
    zoomIn,
    zoomOut,
    centerPlayer,
    markerForm,
    host,
}: {
    readonly viewport: HTMLElement;
    readonly coordinates: HTMLElement;
    readonly zoomIn: HTMLButtonElement;
    readonly zoomOut: HTMLButtonElement;
    readonly centerPlayer: HTMLButtonElement;
    readonly markerForm: HTMLFormElement;
    readonly host: string;
}): {
    accept: (worldId: string, position: WorldPosition) => void;
    disconnect: () => void;
    setOpen: (isOpen: boolean) => void;
    dispose: () => void;
} => {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const context = canvas.getContext('2d');
    let worldId: string | null = null;
    let visited = new Set<string>();
    let markers = new Map<string, MapMarker>();
    const storage = createMapStorage(host);
    let chunks = new Map<string, WorldChunk>();
    let position: WorldPosition | null = null;
    let center: WorldPosition | null = null;
    let pixelsPerMeter = 2;
    let frame = 0;
    let drag: { id: number; x: number; y: number } | null = null;

    const draw = (): void => {
        frame = 0;
        if (context === null || !canvas.isConnected) return;

        const { clientWidth: width, clientHeight: height } = viewport;
        if (width === 0 || height === 0) return;
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;

        context.fillStyle = '#0b100e';
        context.fillRect(0, 0, width, height);
        if (center === null) return;

        const left = center.xMeters - width / (2 * pixelsPerMeter);
        const top = center.yMeters - height / (2 * pixelsPerMeter);
        const nextChunks = new Map<string, WorldChunk>();
        for (
            let chunkY = chunkCoordinate(top);
            chunkY <= chunkCoordinate(top + height / pixelsPerMeter);
            chunkY++
        ) {
            for (
                let chunkX = chunkCoordinate(left);
                chunkX <= chunkCoordinate(left + width / pixelsPerMeter);
                chunkX++
            ) {
                const id = chunkId(chunkX, chunkY);
                if (!visited.has(id)) continue;

                const chunk =
                    chunks.get(id) ??
                    generateWorldChunk({ chunkX, chunkY, seed, generatorVersion });
                nextChunks.set(id, chunk);
                for (const tile of chunk.terrain) {
                    const x = (tile.xMeters - left) * pixelsPerMeter;
                    const y = (tile.yMeters - top) * pixelsPerMeter;
                    const size = chunk.tileSizeMeters * pixelsPerMeter;
                    context.fillStyle = terrainColors[tile.kind];
                    context.fillRect(
                        Math.floor(x),
                        Math.floor(y),
                        Math.ceil(x + size) - Math.floor(x),
                        Math.ceil(y + size) - Math.floor(y),
                    );
                }

                context.fillStyle = '#a6a593';
                for (const obstacle of chunk.obstacles) {
                    context.fillRect(
                        (obstacle.minXMeters - left) * pixelsPerMeter,
                        (obstacle.minYMeters - top) * pixelsPerMeter,
                        (obstacle.maxXMeters - obstacle.minXMeters) * pixelsPerMeter,
                        (obstacle.maxYMeters - obstacle.minYMeters) * pixelsPerMeter,
                    );
                }
                if (chunkX === medicalOutpost.chunkX && chunkY === medicalOutpost.chunkY) {
                    const { floor } = medicalOutpost;
                    const x = (floor.minXMeters + floor.widthMeters / 2 - left) * pixelsPerMeter;
                    const y = (floor.minYMeters + floor.heightMeters / 2 - top) * pixelsPerMeter;
                    context.fillStyle = '#f4c2ad';
                    context.fillRect(x - 4, y - 1, 8, 2);
                    context.fillRect(x - 1, y - 4, 2, 8);
                }
            }
        }

        chunks = nextChunks;
        canvas.dataset['visibleChunks'] = [...chunks.keys()].join(' ');
        canvas.dataset['pixelsPerMeter'] = String(pixelsPerMeter);
        context.strokeStyle = '#df9ced';
        context.lineWidth = 2;
        for (const marker of markers.values()) {
            const x = (marker.xMeters - left) * pixelsPerMeter;
            const y = (marker.yMeters - top) * pixelsPerMeter;
            context.strokeRect(x - 6, y - 6, 12, 12);
        }

        const centerX = width / 2;
        const centerY = height / 2;
        context.strokeStyle = '#ece7d9';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(centerX - 7, centerY);
        context.lineTo(centerX + 7, centerY);
        context.moveTo(centerX, centerY - 7);
        context.lineTo(centerX, centerY + 7);
        context.stroke();

        if (position !== null) {
            context.beginPath();
            context.arc(
                (position.xMeters - left) * pixelsPerMeter,
                (position.yMeters - top) * pixelsPerMeter,
                4,
                0,
                2 * Math.PI,
            );
            context.fillStyle = '#ffda82';
            context.fill();
            context.strokeStyle = '#0b100e';
            context.stroke();
        }
    };
    const scheduleDraw = (): void => {
        if (canvas.isConnected && frame === 0) frame = requestAnimationFrame(draw);
    };
    const resize = new ResizeObserver(scheduleDraw);
    const listeners = new AbortController();
    const { signal } = listeners;
    const canMark = (): boolean => center !== null && visited.has(mapChunkId(center));
    const locate = (location: WorldPosition): void => {
        center = location;
        markerControls.updateTarget();
        scheduleDraw();
    };
    const markerControls = createMapMarkerControls({
        form: markerForm,
        canMark,
        locate,
        signal,
        save: (label, id) => {
            const previous = id === null ? undefined : markers.get(id);
            const isNewMarker = id === null && center !== null && canMark();
            if (previous === undefined && !isNewMarker) return null;

            const location = previous ?? center;
            if (location === null) return null;

            const marker = {
                xMeters: location.xMeters,
                yMeters: location.yMeters,
                id: id ?? crypto.getRandomValues(new Uint32Array(4)).join('-'),
                label,
            };
            markers.set(marker.id, marker);
            storage.save(marker);
            scheduleDraw();

            return marker;
        },
        remove: id => {
            markers.delete(id);
            storage.remove(id);
            scheduleDraw();
        },
    });
    const pan = (xPixels: number, yPixels: number): void => {
        if (center === null) return;

        locate({
            xMeters: center.xMeters + xPixels / pixelsPerMeter,
            yMeters: center.yMeters + yPixels / pixelsPerMeter,
        });
    };
    const zoom = (factor: number): void => {
        pixelsPerMeter = Math.max(1, Math.min(8, pixelsPerMeter * factor));
        scheduleDraw();
    };
    const onZoomIn = (): void => {
        zoom(2);
    };
    const onZoomOut = (): void => {
        zoom(0.5);
    };
    const onCenter = (): void => {
        if (position === null) return;

        locate(position);
    };
    const onWheel = (event: WheelEvent): void => {
        event.preventDefault();
        if (event.deltaY !== 0) zoom(event.deltaY < 0 ? 2 : 0.5);
    };
    const onKey = (event: KeyboardEvent): void => {
        const direction = panDirections.get(event.key);
        if (direction === undefined) return;

        event.preventDefault();
        const [x, y] = direction;
        pan(x * 32, y * 32);
    };
    const onPointerDown = (event: PointerEvent): void => {
        if (event.button !== 0 || drag !== null) return;

        viewport.focus({ preventScroll: true });
        viewport.setPointerCapture(event.pointerId);
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const onPointerMove = (event: PointerEvent): void => {
        if (drag?.id !== event.pointerId) return;

        pan(drag.x - event.clientX, drag.y - event.clientY);
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const onLostCapture = (): void => {
        drag = null;
    };
    zoomIn.addEventListener('click', onZoomIn, { signal });
    zoomOut.addEventListener('click', onZoomOut, { signal });
    centerPlayer.addEventListener('click', onCenter, { signal });
    viewport.addEventListener('wheel', onWheel, { passive: false, signal });
    viewport.addEventListener('keydown', onKey, { signal });
    viewport.addEventListener('pointerdown', onPointerDown, { signal });
    viewport.addEventListener('pointermove', onPointerMove, { signal });
    viewport.addEventListener('lostpointercapture', onLostCapture, { signal });
    const updatePositionLabel = (): void => {
        const label =
            position === null
                ? 'Позиция игрока недоступна.'
                : `Игрок · ${position.xMeters.toFixed(1)}, ${position.yMeters.toFixed(1)} м`;
        if (coordinates.textContent !== label) coordinates.textContent = label;
    };
    const setOpen = (isOpen: boolean): void => {
        if (isOpen) {
            center = position ?? center;
            markerControls.updateTarget();
            updatePositionLabel();
            viewport.append(canvas);
            resize.observe(viewport);
            scheduleDraw();

            return;
        }

        resize.disconnect();
        cancelAnimationFrame(frame);
        frame = 0;
        if (drag !== null && viewport.hasPointerCapture(drag.id)) {
            viewport.releasePointerCapture(drag.id);
        }
        drag = null;
        canvas.remove();
        chunks.clear();
    };

    return {
        accept: (nextWorldId, nextPosition) => {
            const isNewWorld = nextWorldId !== worldId;
            if (isNewWorld) {
                worldId = nextWorldId;
                const records = storage.load(nextWorldId);
                visited = records.visited;
                markers = new Map(
                    [...records.markers].filter(([, marker]) => visited.has(mapChunkId(marker))),
                );
                chunks.clear();
                center = null;
                markerControls.setMarkers(markers);
            }

            const chunkX = chunkCoordinate(nextPosition.xMeters);
            const chunkY = chunkCoordinate(nextPosition.yMeters);
            const isSupportedChunk = Math.abs(chunkX) <= 1_000_000 && Math.abs(chunkY) <= 1_000_000;
            const id = chunkId(chunkX, chunkY);
            const isNewVisit = isSupportedChunk && !visited.has(id);
            if (isNewVisit) {
                visited.add(id);
                storage.visit(id);
            }
            const hasPositionChanged =
                nextPosition.xMeters !== position?.xMeters ||
                nextPosition.yMeters !== position.yMeters;
            position = nextPosition;
            center ??= position;
            centerPlayer.disabled = false;
            if (canvas.isConnected && (isNewWorld || hasPositionChanged)) {
                markerControls.updateTarget();
                updatePositionLabel();
                scheduleDraw();
            }
        },
        disconnect: () => {
            position = null;
            centerPlayer.disabled = true;
            updatePositionLabel();
            scheduleDraw();
        },
        setOpen,
        dispose: () => {
            setOpen(false);
            listeners.abort();
        },
    };
};
