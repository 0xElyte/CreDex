"use client";
import { useEffect, useRef } from "react";

export function CustomCursor() {
  const dotRef  = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const ringPos = useRef({ x: 0, y: 0 });
  const mousePos = useRef({ x: 0, y: 0 });
  const rafRef  = useRef<number>(0);

  useEffect(() => {
    // Track mouse position and move dot immediately (no lag)
    const onMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY };
      if (dotRef.current) {
        dotRef.current.style.left = e.clientX + "px";
        dotRef.current.style.top  = e.clientY + "px";
      }
    };

    // Lerp ring toward mouse
    const lerp = () => {
      ringPos.current.x += (mousePos.current.x - ringPos.current.x) * 0.1;
      ringPos.current.y += (mousePos.current.y - ringPos.current.y) * 0.1;
      if (ringRef.current) {
        ringRef.current.style.left = ringPos.current.x + "px";
        ringRef.current.style.top  = ringPos.current.y + "px";
      }
      rafRef.current = requestAnimationFrame(lerp);
    };

    // ── Event delegation on document: works for all elements including
    //    those added by React re-renders and route transitions ──────────────
    const INTERACTIVE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL"]);

    const onEnter = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      const ring = ringRef.current;
      if (!ring) return;

      if (el.dataset.locked !== undefined || el.closest("[data-locked]")) {
        ring.classList.remove("hovering");
        ring.classList.add("locked");
      } else if (
        INTERACTIVE.has(el.tagName) ||
        el.closest("a, button, [data-hover]") ||
        el.dataset.hover !== undefined
      ) {
        ring.classList.remove("locked");
        ring.classList.add("hovering");
      }
    };

    const onLeave = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (
        INTERACTIVE.has(el.tagName) ||
        el.closest("a, button, [data-hover], [data-locked]") ||
        el.dataset.hover !== undefined ||
        el.dataset.locked !== undefined
      ) {
        ringRef.current?.classList.remove("hovering", "locked");
      }
    };

    document.addEventListener("mousemove",  onMove);
    document.addEventListener("mouseover",  onEnter);
    document.addEventListener("mouseout",   onLeave);
    rafRef.current = requestAnimationFrame(lerp);

    return () => {
      document.removeEventListener("mousemove",  onMove);
      document.removeEventListener("mouseover",  onEnter);
      document.removeEventListener("mouseout",   onLeave);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <>
      <div id="cursor-dot"  ref={dotRef}  />
      <div id="cursor-ring" ref={ringRef} />
    </>
  );
}
