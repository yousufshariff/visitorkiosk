// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhotoCapture } from './PhotoCapture';

const DATA_URL = 'data:image/jpeg;base64,AAAA';

function makeStream() {
  const track = { stop: vi.fn(), kind: 'video' };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

let getUserMedia: ReturnType<typeof vi.fn>;
let canvasDims: [number, number][];
let ctx: { drawImage: ReturnType<typeof vi.fn>; scale: ReturnType<typeof vi.fn>; translate: ReturnType<typeof vi.fn> };
let toDataURL: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { get: () => 1920, configurable: true });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { get: () => 1080, configurable: true });
  canvasDims = [];
  ctx = { drawImage: vi.fn(), scale: vi.fn(), translate: vi.fn() };
  toDataURL = vi.fn(function (this: HTMLCanvasElement) {
    canvasDims.push([this.width, this.height]);
    return DATA_URL;
  });
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = toDataURL as unknown as typeof HTMLCanvasElement.prototype.toDataURL;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const takeButton = () => screen.findByRole('button', { name: /take photo/i });

describe('PhotoCapture', () => {
  it("requests the front camera: getUserMedia({ video: { facingMode: 'user' }, audio: false })", async () => {
    getUserMedia.mockResolvedValue(makeStream().stream);
    render(<PhotoCapture onCapture={vi.fn()} />);
    await takeButton();
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'user' }, audio: false });
  });

  it('renders an inline, muted, autoplaying, mirrored <video> (iPad Safari)', async () => {
    getUserMedia.mockResolvedValue(makeStream().stream);
    const { container } = render(<PhotoCapture onCapture={vi.fn()} />);
    await takeButton();
    const video = container.querySelector('video')!;
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.style.transform).toBe('scaleX(-1)');
  });

  it('capture sends a JPEG data URL, scaled so the longest edge is 1280, quality 0.8, not mirrored', async () => {
    getUserMedia.mockResolvedValue(makeStream().stream);
    const onCapture = vi.fn();
    render(<PhotoCapture onCapture={onCapture} />);
    await userEvent.click(await takeButton());
    expect(onCapture).toHaveBeenCalledWith(DATA_URL);
    expect(canvasDims).toEqual([[1280, 720]]);
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.8);
    expect(ctx.scale).not.toHaveBeenCalled();
    expect(ctx.translate).not.toHaveBeenCalled();
  });

  it('stops every camera track after capture', async () => {
    const { stream, track } = makeStream();
    getUserMedia.mockResolvedValue(stream);
    render(<PhotoCapture onCapture={vi.fn()} />);
    await userEvent.click(await takeButton());
    expect(track.stop).toHaveBeenCalled();
  });

  it('stops every camera track on unmount', async () => {
    const { stream, track } = makeStream();
    getUserMedia.mockResolvedValue(stream);
    const { unmount } = render(<PhotoCapture onCapture={vi.fn()} />);
    await takeButton();
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it('stops the stream if unmounted before getUserMedia resolves', async () => {
    const { stream, track } = makeStream();
    let resolve!: (s: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise<MediaStream>((r) => (resolve = r)));
    const { unmount } = render(<PhotoCapture onCapture={vi.fn()} />);
    unmount();
    resolve(stream);
    await waitFor(() => expect(track.stop).toHaveBeenCalled());
  });

  it('permission denied: shows an alert, calls onError, offers no capture button', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const onError = vi.fn();
    render(<PhotoCapture onCapture={vi.fn()} onError={onError} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/camera/i);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(screen.queryByRole('button', { name: /take photo/i })).toBeNull();
  });

  it('Try again after an error requests the camera again', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError')).mockResolvedValueOnce(makeStream().stream);
    render(<PhotoCapture onCapture={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));
    await takeButton();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('Retake restarts the preview with a fresh stream', async () => {
    getUserMedia.mockImplementation(async () => makeStream().stream);
    render(<PhotoCapture onCapture={vi.fn()} />);
    await userEvent.click(await takeButton());
    await userEvent.click(await screen.findByRole('button', { name: /retake/i }));
    await takeButton();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('shows the face guide by default and hides it when showFaceGuide is false', async () => {
    getUserMedia.mockImplementation(async () => makeStream().stream);
    const { rerender } = render(<PhotoCapture onCapture={vi.fn()} />);
    await takeButton();
    expect(screen.getByTestId('face-guide')).toBeTruthy();
    rerender(<PhotoCapture onCapture={vi.fn()} showFaceGuide={false} />);
    expect(screen.queryByTestId('face-guide')).toBeNull();
  });
});
