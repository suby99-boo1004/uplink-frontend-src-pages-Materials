import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";

type TabKey = "ONGOING" | "DONE" | "CANCELED";

type MRRow = {
  id: number;
  project_id: number | null;
  estimate_id?: number | null;
  memo?: string | null;
  requested_by_name?: string | null;
  created_at?: string | null;
  prep_status?: "PREPARING" | "READY" | string | null;
  project_name?: string | null;
  estimate_title?: string | null;
  request_no?: string | null;
  business_name?: string | null;
  status?: string | null;
  is_pinned?: boolean | null;
};

function fmtDateTimeParts(s?: string | null) {
  if (!s) return { date: "-", time: "" };
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return { date: s, time: "" };
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return { date: `${yy}-${mm}-${dd}`, time: `${hh}:${mi}` };
  } catch {
    return { date: s || "-", time: "" };
  }
}

const PINNED_KEY = "mr_pinned_ids";
function _loadPinnedIds(): number[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY) || "[]";
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0) : [];
  } catch {
    return [];
  }
}
function _isPinnedFromStorage(id: number): boolean {
  if (!id) return false;
  const set = new Set(_loadPinnedIds());
  return set.has(id);
}

function prepLabel(v?: string | null) {
  if (v === "READY") {
    return <span style={{ color: "#2563eb", fontWeight: 700 }}>준비 완료</span>;
  }
  if (v === "PREPARING") {
    return "준비중";
  }
  if (v === "ADDITIONAL") {
    return "추가 요청";
  }
  if (!v) return "-";
  return v;
}

export default function MaterialRequestsPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [tab, setTab] = useState<TabKey>("ONGOING");
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [keyword, setKeyword] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MRRow[]>([]);

  const sortedRows = useMemo(() => {
    const arr = Array.isArray(rows) ? [...rows] : [];
    arr.sort((a, b) => {
      const ap = a?.is_pinned ? 1 : 0;
      const bp = b?.is_pinned ? 1 : 0;
      if (bp !== ap) return bp - ap; // pinned first
      // 최신 우선(생성일/ID)
      const at = a?.created_at ? Date.parse(a.created_at) : 0;
      const bt = b?.created_at ? Date.parse(b.created_at) : 0;
      if (bt !== at) return bt - at;
      return (b?.id ?? 0) - (a?.id ?? 0);
    });
    return arr;
  }, [rows]);
  const [isAdmin, setIsAdmin] = useState(false);

  const tabs = useMemo(
    () => [
      { key: "ONGOING" as const, label: "진행중" },
      { key: "DONE" as const, label: "사업완료" },
      { key: "CANCELED" as const, label: "사업취소" },
    ],
    []
  );

  async function fetchList(next?: { tab?: TabKey; year?: number; keyword?: string }) {
    const t = next?.tab ?? tab;
    const y = next?.year ?? year;
    const q = next?.keyword ?? keyword;

    setLoading(true);
    setError(null);

    try {
      const qs = new URLSearchParams();
      // year=0 은 서버에서 "전체(또는 현재년도)"로 처리하게 함. 기본은 현재년도.
      if (Number.isFinite(y) && y > 0) qs.set("year", String(y));
      qs.set("state", t);
      if (q && q.trim()) qs.set("q", q.trim());
      qs.set("_ts", String(Date.now()));

      const res = await api<{ items: MRRow[] }>(`/api/material-requests?${qs.toString()}`);
      const base = Array.isArray(res?.items) ? res.items : [];
      const enriched = base.map((r) => ({ ...r, is_pinned: typeof (r as any).is_pinned === "boolean" ? (r as any).is_pinned : _isPinnedFromStorage(r.id) }));
      setRows(enriched);
    } catch (e: any) {
      setRows([]);
      setError(e?.message || "목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function onClickNew() {
    navigate("/materials/new");
  }

  function onClickSearch() {
    fetchList();
  }

  // 관리자만 "삭제" 버튼 노출
  useEffect(() => {
    (async () => {
      try {
        const me = await api(`/api/auth/me?_ts=${Date.now()}`);
        const rid = Number(me?.role?.id ?? me?.role_id ?? me?.roleId ?? me?.role?.role_id ?? null);
        setIsAdmin(rid === 6);
      } catch {
        setIsAdmin(false);
      }
    })();
  }, []);

  // 탭/URL 변경 시 자동 조회
  useEffect(() => {
    fetchList({ tab });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, location.search]);

  async function onDelete(mrId: number) {
    if (!isAdmin) return;
    const ok = window.confirm("이 자재요청을 삭제할까요?\n삭제하면 신규등록(견적서 선택)에도 즉시 반영됩니다.");
    if (!ok) return;

    try {
      await api(`/api/material-requests/${mrId}`, { method: "DELETE" });
      await fetchList();
    } catch (e: any) {
      alert(e?.message || "삭제에 실패했습니다.");
    }
  }

  const titleText = tab === "ONGOING" ? "진행중1 자재 요청" : tab === "DONE" ? "사업완료 자재 요청" : "사업취소 자재 요청";

  return (
    <div style={{ padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div >
		<h2 style={{ marginBottom: 12 }}>자재 요청</h2>                    
        </div>
        
      </div>

      {/* 상단 컨트롤 한 줄 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "nowrap" }}>
        {/* 진행중 / 사업완료 / 사업취소 */}
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                background: active ? "linear-gradient(180deg, #2563EB 0%, #1D4ED8 100%)" : "rgba(255,255,255,0.06)",
                color: "white",
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              {t.label}
            </button>
          );
        })}

        {/* 년도 선택 (2026~2050) */}
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(17,24,39,0.70)",
            color: "white",
            outline: "none",
            fontWeight: 800,
          }}
        >
          {Array.from({ length: 2050 - 2026 + 1 }, (_, i) => 2026 + i).map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>

        {/* 검색창 */}
        <input
          value={keyword}
          onChange={(e) => {
            const v = e.target.value;
            setKeyword(v);
            fetchList({ keyword: v });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onClickSearch();
          }}
          placeholder="검색(사업명/등록자)"
          style={{
            width: 240,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(17,24,39,0.70)",
            color: "white",
            outline: "none",
          }}
        />

        <div style={{ marginLeft: "auto" }} />

        {/* 맨 오른쪽 신규 등록 */}
        <button
          onClick={onClickNew}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.16)",
            background: "linear-gradient(180deg, #2563EB 0%, #1D4ED8 100%)",
            color: "white",
            cursor: "pointer",
            fontWeight: 950,
          }}
        >
          + 신규 등록
        </button>
      </div>

{/* 에러 */}
      {error && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid rgba(255,80,80,0.45)", background: "rgba(255,80,80,0.10)" }}>
          <div style={{ fontWeight: 950 }}>불러오기 실패</div>
          <div style={{ opacity: 0.9, marginTop: 4 }}>{error}</div>
        </div>
      )}

      {/* 리스트 */}
      <div style={{ marginTop: 14, borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)", background: "rgba(0,0,0,0.22)" }}>
      
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 140px 120px 90px", gap: 0, 
		background: "#8ec7fa", padding: "10px 12px", fontWeight: 900, color: "#000000",}}>
          <div>등록일</div>
          <div>사업명</div>
          <div>등록자</div>
          <div>준비상태</div>
          <div style={{ textAlign: "center" }}>삭제</div>
        </div>

        {!loading && rows.length === 0 && <div style={{ padding: 14, opacity: 0.8 }}>표시할 데이터가 없습니다.</div>}

        {sortedRows.map((r) => {
          const title =
            (r.business_name && r.business_name.trim()) ||
            (r.project_name && r.project_name.trim()) ||
            (r.memo && r.memo.trim()) ||
            (r.estimate_title && r.estimate_title.trim()) ||
            (r.request_no && r.request_no.trim()) ||
            (r.estimate_id ? `견적서#${r.estimate_id}` : r.project_id ? `프로젝트#${r.project_id}` : `자재요청#${r.id}`);

          const dt = fmtDateTimeParts(r.created_at || null);

          return (
            <div
              key={r.id}
              onClick={() => navigate(`/materials/${r.id}`)}
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr 140px 120px 90px",
                gap: 0,
                padding: "10px 12px",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                cursor: "pointer",
              }}
            >
              <div style={{ fontVariantNumeric: "tabular-nums" }}>
                <div>{dt.date}</div>
                <div style={{ opacity: 0.8, fontSize: 12 }}>{dt.time}</div>
              </div>

              <div style={{ fontWeight: 850 }}>{title}</div>

              <div style={{ opacity: 0.95 }}>{r.requested_by_name || "-"}</div>

              <div style={{ fontWeight: 900 }}>{prepLabel(r.prep_status || null)}</div>

              <div style={{ display: "flex", justifyContent: "center" }}>
                {isAdmin ? (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onDelete(r.id);
                    }}
                    title="삭제(관리자 전용)"
                    style={{
                      minWidth: 56,
                      height: 28,
                      borderRadius: 999,
                      border: "1.5px solid rgba(239,68,68,0.85)",
                      background: "linear-gradient(180deg, rgba(20,20,20,0.95), rgba(10,10,10,0.95))",
                      color: "#F87171",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    삭제
                  </button>
                ) : (
                  <div style={{ opacity: 0.35 }}>-</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}