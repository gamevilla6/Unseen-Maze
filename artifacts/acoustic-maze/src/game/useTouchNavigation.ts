import { useCallback, useEffect, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import type { Input } from './engine';
import { EMPTY_GESTURE, TouchNavigation, type GestureState } from './touch-input';

type Options = {
  inputRef: MutableRefObject<Input>;
  sonarReq: MutableRefObject<boolean>;
  enabled: boolean;
  onGesture: () => void;
};

export function useTouchNavigation({ inputRef, sonarReq, enabled, onGesture }: Options) {
  const model = useRef(new TouchNavigation());
  const live = useRef({ enabled, onGesture });
  live.current = { enabled, onGesture };
  const surface = useRef<HTMLElement | null>(null);
  const [gesture, setGesture] = useState<GestureState>({ ...EMPTY_GESTURE });
  const sync = useCallback(() => {
    inputRef.current = { ...model.current.vector };
    setGesture({ ...model.current.gesture });
  }, [inputRef]);
  const reset = useCallback(() => {
    const ids = model.current.ids;
    model.current.reset();
    inputRef.current = { x: 0, z: 0, stealth: false };
    sonarReq.current = false;
    for (const id of ids) {
      try { if (surface.current?.hasPointerCapture(id)) surface.current.releasePointerCapture(id); } catch { /* A cancelled Android contact may already be released. */ }
    }
    setGesture({ ...EMPTY_GESTURE });
  }, [inputRef, sonarReq]);

  useEffect(() => {
    reset();
    const hidden = () => { if (document.hidden) reset(); };
    window.addEventListener('blur', reset);
    window.addEventListener('resize', reset);
    window.addEventListener('orientationchange', reset);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', reset);
      window.removeEventListener('resize', reset);
      window.removeEventListener('orientationchange', reset);
      document.removeEventListener('visibilitychange', hidden);
      model.current.reset();
      inputRef.current = { x: 0, z: 0, stealth: false };
      sonarReq.current = false;
    };
  }, [enabled, reset, inputRef, sonarReq]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!live.current.enabled || e.pointerType !== 'touch') return;
    if (e.target instanceof Element && e.target.closest('button,input,select,a,[role="button"]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!model.current.begin(e.pointerId, e.pointerType, e.clientX - rect.left, e.clientY - rect.top, e.timeStamp, rect.width)) return;
    surface.current = e.currentTarget;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    live.current.onGesture();
    sync();
  }, [sync]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!live.current.enabled || e.pointerType !== 'touch') return;
    const rect = e.currentTarget.getBoundingClientRect();
    model.current.move(e.pointerId, e.clientX - rect.left, e.clientY - rect.top);
    sync();
  }, [sync]);

  const finish = useCallback((e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    if (e.pointerType !== 'touch') return;
    if (!cancelled) {
      const rect = e.currentTarget.getBoundingClientRect();
      model.current.move(e.pointerId, e.clientX - rect.left, e.clientY - rect.top);
    }
    const tap = model.current.end(e.pointerId, e.timeStamp, cancelled);
    if (live.current.enabled && tap) sonarReq.current = true;
    sync();
  }, [sonarReq, sync]);

  return {
    touchHandlers: {
      onPointerDown, onPointerMove,
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => finish(e, false),
      onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => finish(e, true),
      onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => finish(e, true),
    },
    reset, gesture,
  };
}
