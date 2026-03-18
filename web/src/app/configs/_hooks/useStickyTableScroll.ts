"use client";

import { useEffect, RefObject } from "react";

export type StickyHScrollState = {
  visible: boolean;
  left: number;
  width: number;
  scrollWidth: number;
};

export function useStickyTableScroll({
  tableWrapRef,
  isNarrowScreen,
  setStickyHScroll,
  stickyHScrollRef,
  tableScrollElRef,
  syncScrollingRef,
  deps
}: {
  tableWrapRef: RefObject<HTMLDivElement | null>;
  isNarrowScreen: boolean;
  setStickyHScroll: React.Dispatch<React.SetStateAction<StickyHScrollState>>;
  stickyHScrollRef: RefObject<HTMLDivElement | null>;
  tableScrollElRef: RefObject<HTMLElement | null>;
  syncScrollingRef: RefObject<"table" | "sticky" | null>;
  deps: unknown[];
}) {
  useEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap) return;

    if (!isNarrowScreen) {
      setStickyHScroll((prev) =>
        prev.visible ? { ...prev, visible: false } : prev
      );
      return;
    }

    const findScrollEl = () =>
      (wrap.querySelector(".ant-table-content") as HTMLElement | null) ||
      (wrap.querySelector(".ant-table-body") as HTMLElement | null) ||
      null;

    const update = () => {
      const sc = findScrollEl();
      tableScrollElRef.current = sc;

      const rect = wrap.getBoundingClientRect();
      const width = Math.max(0, Math.floor(rect.width));
      const left = Math.floor(rect.left);

      const scrollWidth0 = sc ? Math.floor(sc.scrollWidth || 0) : 0;
      const clientWidth0 = sc ? Math.floor(sc.clientWidth || 0) : 0;
      const visible = Boolean(sc);
      const scrollWidth = Math.max(scrollWidth0, clientWidth0 + 2);

      setStickyHScroll((prev) => {
        const next = { visible, left, width, scrollWidth };
        if (
          prev.visible === next.visible &&
          prev.left === next.left &&
          prev.width === next.width &&
          prev.scrollWidth === next.scrollWidth
        ) {
          return prev;
        }
        return next;
      });

      if (visible && sc && stickyHScrollRef.current) {
        stickyHScrollRef.current.scrollLeft = sc.scrollLeft;
      }
    };

    const onTableScroll = () => {
      const sc = tableScrollElRef.current;
      const sticky = stickyHScrollRef.current;
      if (!sc || !sticky) return;
      if (syncScrollingRef.current === "sticky") return;
      syncScrollingRef.current = "table";
      sticky.scrollLeft = sc.scrollLeft;
      queueMicrotask(() => {
        if (syncScrollingRef.current === "table")
          syncScrollingRef.current = null;
      });
    };

    const onStickyScroll = () => {
      const sc = tableScrollElRef.current;
      const sticky = stickyHScrollRef.current;
      if (!sc || !sticky) return;
      if (syncScrollingRef.current === "table") return;
      syncScrollingRef.current = "sticky";
      sc.scrollLeft = sticky.scrollLeft;
      queueMicrotask(() => {
        if (syncScrollingRef.current === "sticky")
          syncScrollingRef.current = null;
      });
    };

    const ro = new ResizeObserver(() => update());
    ro.observe(wrap);

    const raf = requestAnimationFrame(update);
    window.addEventListener("resize", update);

    const sc0 = findScrollEl();
    if (sc0) sc0.addEventListener("scroll", onTableScroll, { passive: true });
    const sticky0 = stickyHScrollRef.current;
    if (sticky0)
      sticky0.addEventListener("scroll", onStickyScroll, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      ro.disconnect();
      const sc = findScrollEl();
      if (sc) sc.removeEventListener("scroll", onTableScroll as any);
      if (sticky0) sticky0.removeEventListener("scroll", onStickyScroll as any);
    };
  }, [isNarrowScreen, setStickyHScroll, stickyHScrollRef, syncScrollingRef, tableScrollElRef, tableWrapRef, ...deps]);
}
