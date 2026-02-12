"use client";

import type React from "react";

export function LoadMoreFooter(props: {
  filteredCount: number;
  paginatedCount: number;
  hasMore: boolean;
  loadingMore: boolean;
  dataHasMore: boolean;
  dataTotalCount: number | null;
  loadMoreSentinelRef: React.RefObject<HTMLDivElement | null>;
}) {
  const {
    filteredCount,
    paginatedCount,
    hasMore,
    loadingMore,
    dataHasMore,
    dataTotalCount,
    loadMoreSentinelRef,
  } = props;

  if (filteredCount <= 0) return null;

  const baseStyle: React.CSSProperties = {
    textAlign: "center",
    padding: "16px 0",
    color: "rgba(0,0,0,0.45)",
  };

  return (
    <>
      <div
        ref={loadMoreSentinelRef}
        style={{ height: 1, width: "100%", visibility: "hidden" }}
      />

      {hasMore ? (
        <div style={baseStyle}>
          已展示 {paginatedCount} / {filteredCount} 张，下拉加载更多
        </div>
      ) : loadingMore ? (
        <div style={baseStyle}>正在加载更多...</div>
      ) : dataHasMore ? (
        <div style={baseStyle}>
          {dataTotalCount != null
            ? `共 ${dataTotalCount} 张，当前筛选 ${filteredCount} 张，下拉加载更多数据`
            : `当前筛选 ${filteredCount} 张，下拉加载更多数据`}
        </div>
      ) : (
        <div style={baseStyle}>
          {dataTotalCount != null
            ? `共 ${dataTotalCount} 张，当前筛选 ${filteredCount} 张，已全部加载`
            : `共 ${filteredCount} 张，已全部加载`}
        </div>
      )}
    </>
  );
}

