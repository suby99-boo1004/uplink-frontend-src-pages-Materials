import React, { useMemo, useState } from "react";

/**
 * 자재 요청(Material Requests) - 1차 기본 페이지
 * 목표(이번 단계): 화면 구조 고정(탭/검색/버튼/리스트 영역) + 라우팅 정상 표시
 * - 백엔드 연동/DB 로직/신규등록/상세 화면은 다음 단계에서 진행
 */

type TabKey = "ONGOING" | "DONE" | "CANCELED";

export default function MaterialRequestsPage() {
  const [tab, setTab] = useState<TabKey>("ONGOING");
  const [year, setYear] = useState<number>(2026);
  const [keyword, setKeyword] = useState<string>("");

  const tabs = useMemo(
    () => [
      { key: "ONGOING" as const, label: "진행중" },
      { key: "DONE" as const, label: "사업완료" },
      { key: "CANCELED" as const, label: "사업취소" },
    ],
    []
  );

  function onClickNew() {
    alert("다음 단계에서 구현: 자재요청 신규 등록");
  }

  function onClickSearch() {
    // 다음 단계에서 API 연동 예정
    alert("다음 단계에서 구현: 검색/조회 API 연동");
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>자재 요청</div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
            견적서 연동 자재요청 (1차: 화면 틀 고정)
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onClickNew}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.06)",
              color: "white",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            신규 등록
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: "10px 12px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.15)",
                background: active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)",
                color: "white",
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 검색 영역 */}
      <div
        style={{
          marginTop: 14,
          padding: 12,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.04)",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 700 }}>연도</div>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(17,24,39,0.7)",
                color: "white",
                outline: "none",
              }}
            >
              {[year, year - 1, year - 2].map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1, minWidth: 220 }}>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="검색(사업명/등록자)"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(17,24,39,0.7)",
                color: "white",
                outline: "none",
              }}
            />
          </div>

          <button
            type="button"
            onClick={onClickSearch}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.06)",
              color: "white",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            검색
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
          기본값: 연도={2026}년 / 명칭=공란 · 탭에 따라 진행중/사업완료/사업취소 리스트가 표시됩니다.
        </div>
      </div>

      {/* 리스트 영역(1차: UI 틀만) */}
      <div
        style={{
          marginTop: 14,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.12)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 12, background: "rgba(255,255,255,0.06)", fontWeight: 800 }}>
          {tab === "ONGOING" && "진행중 자재 요청"}
          {tab === "DONE" && "사업완료 자재 요청"}
          {tab === "CANCELED" && "사업취소 자재 요청"}
        </div>

        <div style={{ width: "100%", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                <th style={{ textAlign: "left", padding: 12, fontSize: 12, opacity: 0.85 }}>사업명</th>
                <th style={{ textAlign: "left", padding: 12, fontSize: 12, opacity: 0.85 }}>등록자</th>
                <th style={{ textAlign: "left", padding: 12, fontSize: 12, opacity: 0.85 }}>준비상태</th>
                <th style={{ textAlign: "left", padding: 12, fontSize: 12, opacity: 0.85 }}>등록일</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} style={{ padding: 16, opacity: 0.75 }}>
                  아직 데이터가 없습니다. (다음 단계에서 API 연동 후 리스트 출력)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 안내 */}
      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7, lineHeight: 1.5 }}>
        <div>다음 단계에서 할 일:</div>
        <div>1) 진행중 리스트 API 연동</div>
        <div>2) 신규 등록(/materials/new) 라우팅 및 화면</div>
        <div>3) 상세 화면(/materials/:id) + 품목 준비상태/사용량 변경</div>
      </div>
    </div>
  );
}
