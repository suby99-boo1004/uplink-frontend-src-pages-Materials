import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";

// 화면 블랙스크린 방지용 ErrorBoundary(상세 페이지)
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; message?: string }>{
  constructor(props: any){ super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(err: any){ return { hasError: true, message: err?.message || String(err) }; }
  componentDidCatch(err: any){ console.error(err); }
  render(){
    if(this.state.hasError){
      return (
        <div style={{ padding: 18, color: 'white' }}>
          <div style={{ padding: 12, borderRadius: 12, border: '1px solid rgba(255,80,80,0.45)', background: 'rgba(255,80,80,0.10)' }}>
            <div style={{ fontWeight: 950, marginBottom: 6 }}>화면 렌더링 오류</div>
            <div style={{ whiteSpace: 'pre-wrap', opacity: 0.9, fontSize: 13 }}>{this.state.message}</div>
          </div>
        </div>
      );
    }
    return this.props.children as any;
  }
}


type MRHeader = {
  id: number;
  memo?: string | null;
  status?: string | null;
  warehouse_id?: number | null;
  requested_by_name?: string | null;
  created_at?: string | null;
  business_name?: string | null;
};

type MRItem = {
  id: number;
  source?: string | null; // ESTIMATE / PRODUCT / MANUAL (서버 표준, 호환)
  estimate_item_id?: number | null;
  product_id?: number | null;
  item_name_snapshot: string;
  spec_snapshot: string;
  unit_snapshot: string;
  qty_requested: number;
  qty_used?: number | null;
  qty_on_hand?: number | null;
  prep_status?: string | null; // PREPARING/READY
  note?: string | null;
};

type DetailRes = {
  can_see_sensitive: boolean;
  header: MRHeader;
  prep_status: string;
  items: MRItem[];
};

type ProductRow = { id: number; name: string; spec?: string | null; unit?: string | null };

function fmtDateTime(s?: string | null) {
  if (!s) return "-";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yy}-${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return s;
  }
}

function sourceKey(it: MRItem): "ESTIMATE" | "PRODUCT" | "MANUAL" {
  const s = (it.source || "").toUpperCase();
  const pid = typeof it.product_id === "number" ? it.product_id : null;
  const eid = typeof it.estimate_item_id === "number" ? it.estimate_item_id : null;

  // 0) 둘 다 없으면 수동
  if ((!pid || pid <= 0) && (!eid || eid <= 0)) return "MANUAL";

  // 1) 견적서 우선 (FROM_ESTIMATE 포함). product_id가 같이 있어도 견적서 섹션으로
  if (eid && eid > 0) return "ESTIMATE";
  if (s.includes("ESTIMATE") || s.includes("FROM_ESTIMATE") || s.includes("FROM_QUOTE") || s.includes("QUOTE") || s === "EST") return "ESTIMATE";

  // 2) 업링크 제품(자재) — product_id가 있을 때만
  if (pid && pid > 0) return "PRODUCT";
  if (s.includes("PRODUCT") || s.includes("UPLINK") || s.includes("MATERIAL") || s.includes("STOCK") || s.includes("ITEM") || s.includes("GOODS")) return "PRODUCT";

  // 3) 나머지는 수동
  return "MANUAL";
}

type SectionKind = "estimate" | "uplink" | "manual";

function SectionBox({
  kind,
  title,
  count,
  right,
  children,
}: {
  kind: SectionKind;
  title: string;
  count: number;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const styleMap: Record<SectionKind, any> = {
    estimate: { border: "rgba(80,160,255,0.50)", bg: "rgba(80,160,255,0.10)", badgeBorder: "rgba(80,160,255,0.55)" },
    uplink: { border: "rgba(80,220,160,0.50)", bg: "rgba(80,220,160,0.10)", badgeBorder: "rgba(80,220,160,0.55)" },
    manual: { border: "rgba(255,180,80,0.50)", bg: "rgba(255,180,80,0.10)", badgeBorder: "rgba(255,180,80,0.55)" },
  };
  const s = styleMap[kind];
  return (
    <div style={{ marginTop: 12, borderRadius: 16, border: `1px solid ${s.border}`, background: s.bg, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontWeight: 950 }}>{title}</div>
          <div style={{ padding: "4px 8px", borderRadius: 999, border: `1px solid ${s.badgeBorder}`, background: "rgba(0,0,0,0.18)", fontWeight: 900, fontSize: 12 }}>
            {count}
          </div>
        </div>
        {right}
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

function SmallBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.15)",
        background: disabled ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.08)",
        color: "white",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 900,
      }}
    >
      {children}
    </button>
  );
}

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function MaterialRequestDetailPage() {
  const navigate = useNavigate();
  const params = useParams();
  const mrId = Number(params.id);

  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [canSeeSensitive, setCanSeeSensitive] = useState(false);
  const [header, setHeader] = useState<MRHeader | null>(null);
  const [items, setItems] = useState<MRItem[]>([]);

  // 자재요청 참고사항(헤더 메모)
  const [mrMemo, setMrMemo] = useState<string>("");
  const [mrMemoSaving, setMrMemoSaving] = useState(false);
  const memoInitRef = useRef(false);

  // 업링크 제품 모달
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [productKeyword, setProductKeyword] = useState("");
  const [productLoading, setProductLoading] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);

  // 수동 추가(임시 입력)
  const [manualDraft, setManualDraft] = useState<{ name: string; spec: string; unit: string; qty: number; note: string } | null>(null);

  const reloadRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    async function fetchDetail() {
      if (!mrId || Number.isNaN(mrId)) {
        setError("잘못된 자재요청 ID 입니다.");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const res = (await api(`/api/material-requests/${mrId}`)) as DetailRes;
        setCanSeeSensitive(!!(res as any)?.can_see_sensitive);
        setHeader((res as any)?.header ?? null);
        if (!memoInitRef.current) {
          const h: any = (res as any)?.header ?? {};
          const rawMemo = (h?.memo ?? "") as string;
          const biz = (h?.business_name ?? "") as string;
          // 기본값으로 사업명이 들어오는 경우(의도치 않은 프리필) 제거
          const nextMemo = rawMemo?.trim() !== "" && rawMemo?.trim() === biz?.trim() ? "" : rawMemo;
          setMrMemo(nextMemo);
          memoInitRef.current = true;
        }
        setItems(Array.isArray((res as any)?.items) ? (res as any).items : []);
      } catch (e: any) {
        setError(e?.message || "상세를 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    }

    reloadRef.current = fetchDetail;
    fetchDetail();
  }, [mrId]);

  const title =
    (header?.business_name && header.business_name.trim()) || (header?.memo && header.memo.trim()) || `자재요청 #${mrId}`;

  const grouped = useMemo(() => {
    const est: MRItem[] = [];
    const prod: MRItem[] = [];
    const man: MRItem[] = [];

    for (const it of items) {
      const k = sourceKey(it);
      if (k === "ESTIMATE") est.push(it);
      else if (k === "PRODUCT") prod.push(it);
      else man.push(it);
    }

    return { est, prod, man };
  }, [items]);

  async function patchItem(itemId: number, patch: Partial<MRItem>) {
    setSavingId(itemId);

    try {
      await api(`/api/material-requests/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qty_requested: patch.qty_requested,
          qty_used: patch.qty_used,
          prep_status: patch.prep_status,
          note: patch.note,
        }),
      });

      // UI 즉시 반영
      setItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, ...patch } : x)));

      // ✅ 재고/현재수량이 다른 라인에도 영향을 주는 변경(READY/CHANGED/qty_used)은 서버 재조회로 동기화
      const needReload = patch.qty_used !== undefined || patch.prep_status === "READY" || patch.prep_status === "CHANGED";
      if (needReload) {
        await reloadRef.current();
      }
    } catch (e: any) {
      alert(e?.message || "저장에 실패했습니다.");
    } finally {
      setSavingId(null);
    }
  }

  async function addItem(payload: {
    product_id?: number | null;
    estimate_item_id?: number | null;
    item_name_snapshot: string;
    spec_snapshot: string;
    unit_snapshot: string;
    qty_requested: number;
    note?: string;
    source: string;
  }) {
    try {
      // ✅ 안전: unit/qty 보정(백엔드가 unit 빈 값이면 에러 나는 케이스 방지)
      const unit = (payload.unit_snapshot || "EA").toString().trim() || "EA";
      const qty = Number.isFinite(Number(payload.qty_requested)) ? Number(payload.qty_requested) : 0;

      await api(`/api/material-requests/${mrId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          unit_snapshot: unit,
          qty_requested: qty < 0 ? 0 : qty,
        }),
      });

      await reloadRef.current();
    } catch (e: any) {
      alert(e?.message || "추가에 실패했습니다.");
    }
  }

  async function deleteItem(itemId: number) {
    if (!confirm("해당 항목을 삭제할까요?")) return;

    try {
      await api(`/api/material-requests/items/${itemId}`, { method: "DELETE" });
      await reloadRef.current();
    } catch (e: any) {
      alert(e?.message || "삭제에 실패했습니다.");
    }
  }

  async function saveMrMemo() {
    if (!mrId) return;
    setMrMemoSaving(true);
    try {
      await api(`/api/material-requests/${mrId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo: mrMemo }),
      });
      // 저장 후 최신값 반영
      memoInitRef.current = false;
      await reloadRef.current();
      alert("참고사항이 저장되었습니다.");
    } catch (e: any) {
      alert(e?.message || "참고사항 저장에 실패했습니다.");
    } finally {
      setMrMemoSaving(false);
    }
  }


  async function loadProducts(keywordOverride?: string) {
    const kw = (keywordOverride ?? productKeyword).trim();
    setProductLoading(true);
    setProductError(null);

    try {
      const tryUrls = [`/api/products?keyword=${encodeURIComponent(kw)}`, `/api/products?q=${encodeURIComponent(kw)}`, `/api/products`];
      let res: any = null;
      let lastErr: any = null;

      for (const url of tryUrls) {
        try {
          res = await api(url);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (lastErr) throw lastErr;

      const itemsArr = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : Array.isArray(res?.data) ? res.data : [];
      const normalized: ProductRow[] = itemsArr
        .map((x: any) => ({
          id: Number(x?.id),
          name: (x?.name ?? x?.product_name ?? x?.productName ?? "").toString(),
          spec: x?.spec ?? x?.specification ?? x?.product_spec ?? null,
          unit: x?.unit ?? x?.unit_name ?? x?.unitName ?? null,
        }))
        .filter((x: any) => Number.isFinite(x.id) && x.name);

      const lower = kw.toLowerCase();
      const filtered = lower ? normalized.filter((p) => `${p.name} ${p.spec ?? ""}`.toLowerCase().includes(lower)) : normalized;

      setProducts(filtered);
    } catch (e: any) {
      setProducts([]);
      setProductError(e?.message || "제품 리스트를 불러오지 못했습니다.");
    } finally {
      setProductLoading(false);
    }
  }

  function openProductModal() {
    setProductModalOpen(true);
    setProductKeyword("");
    loadProducts("");
  }

  useEffect(() => {
    if (!productModalOpen) return;
    const t = window.setTimeout(() => loadProducts(productKeyword), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productKeyword, productModalOpen]);

  function addUplinkProductAndClose(p: ProductRow) {
    // ✅ 한 번에 1개만 추가(신규등록과 동일한 UX)
    addItem({
      source: "PRODUCT", // 서버 표준
      product_id: p.id,
      estimate_item_id: null,
      item_name_snapshot: p.name,
      spec_snapshot: (p.spec ?? "").toString(),
      unit_snapshot: (p.unit ?? "EA").toString() || "EA",
      qty_requested: 1,
      note: "",
    });

    setProductModalOpen(false);
  }

  function renderEditableTable(list: MRItem[], allowDelete: boolean, kind: SectionKind) {
    const showSensitive = canSeeSensitive; // role.id 6(관리자),7(운영자)만 민감정보/조작 표시
    return (
      <div style={{ width: "100%", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: showSensitive
              ? "12% 19% 3% 7% 8% 7% 8% 8% 15% 5%"
              : "12% 25% 3% 11% 40%",
            gap: 8,
            padding: "10px 12px",
            fontWeight: 900,
            opacity: 0.85,
			textAlign: "left",
            background: "rgba(255,255,255,0.06)",
          }}
        >
          <div>자재명</div>
          <div>규격</div>
          <div>단위</div>
          <div style={{ textAlign: "right" }}>요청수량</div>

          {showSensitive && <div style={{ textAlign: "right" }}>현재수량</div>}
          {showSensitive && <div style={{ textAlign: "right" }}>사용수량</div>}
          {showSensitive && <div style={{ textAlign: "right" }}>재고(잔량)</div>}

          {showSensitive ? (
            <>
              <div style={{ textAlign: "center" }}>준비상황</div>
              <div>비고</div>
              <div style={{ textAlign: "center" }}>삭제</div>
            </>
          ) : (
            <div>비고</div>
          )}
        </div>

        {list.map((it) => {
          const qtyOnHand = it.qty_on_hand == null ? null : num(it.qty_on_hand);
          const usedDefault = it.qty_used == null || (num(it.qty_used) === 0 && num(it.qty_requested) > 0) ? num(it.qty_requested) : num(it.qty_used);
          const stockChange = qtyOnHand == null ? null : qtyOnHand - usedDefault;
          const isReady = ((it.prep_status || '').toUpperCase() === 'READY');

          return (
            <div
            key={it.id}
            style={{
              display: "grid",
              gridTemplateColumns: showSensitive
              ? "12% 20% 3% 7% 7% 7% 7% 9% 15% 5%"
              : "12% 25% 5% 10% 40%",
              gap: 8,
              padding: "10px 12px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              background: ((it.prep_status || "").toUpperCase() === "READY" ? "rgba(255,255,255,0.06)" : "transparent"),
              opacity: ((it.prep_status || "").toUpperCase() === "READY" ? 0.75 : 1),
            }}
          >
              <div style={{ fontWeight: 900, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.item_name_snapshot || "-"}</div>
              <div style={{ opacity: 0.95, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.spec_snapshot || "-"}</div>
              <div style={{ opacity: 0.95 }}>{it.unit_snapshot || "-"}</div>

              <input
                defaultValue={num(it.qty_requested)}
                disabled={kind === "estimate" || isReady}
                onBlur={(e) => {
                  const v = num(e.currentTarget.value);
                  const prev = num(it.qty_requested);

                  if (v === prev) return;

                  // 견적서 재료비(estimate)는 요청수량 변경 불가 (UI 안전장치)
                  if (kind === "estimate") {
                    e.currentTarget.value = String(prev);
                    return;
                  }

                  // 업링크 제품/수동추가 수량 변경 시 재확인
                  if (kind === "uplink" || kind === "manual") {
                    const ok = window.confirm("변경하시겠습니까?");
                    if (!ok) {
                      e.currentTarget.value = String(prev);
                      return;
                    }
                    patchItem(it.id, { qty_requested: v, prep_status: "CHANGED" });
                    return;
                  }

                  patchItem(it.id, { qty_requested: v, prep_status: "CHANGED" });
                }}
                style={{
                  width: "100%",
                  textAlign: "right",
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: (kind === "estimate" || isReady) ? "rgba(255,255,255,0.06)" : "rgba(17,24,39,0.65)",
                  color: "white",
                  outline: "none",
                  fontVariantNumeric: "tabular-nums",
                  cursor: (kind === "estimate" || isReady) ? "not-allowed" : "text",
                  opacity: (kind === "estimate" || isReady) ? 0.7 : 1,
                }}
              />

              {showSensitive && (
                <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", opacity: qtyOnHand == null ? 0.7 : 1 }}>
                  {qtyOnHand == null ? "-" : qtyOnHand}
                </div>
              )}

              {showSensitive && (
                <>
              <input
                type="number"
                step="0.01"
                defaultValue={usedDefault}
                disabled={isReady}
                onBlur={(e) => {
                  const v = num(e.currentTarget.value);
                  if (v !== usedDefault) patchItem(it.id, { qty_used: v });
                }}
                style={{
                  width: "100%",
                  textAlign: "right",
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: isReady ? "rgba(255,255,255,0.06)" : "rgba(17,24,39,0.65)",
                  color: "white",
                  outline: "none",
                  fontVariantNumeric: "tabular-nums",
                  cursor: isReady ? "not-allowed" : "text",
                  opacity: isReady ? 0.7 : 1,
                }}
              />

              <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", opacity: stockChange == null ? 0.7 : 1 }}>
                {stockChange == null ? "-" : stockChange}
              </div>
                </>
              )}

              {showSensitive ? (
                <>
                  <select
                    value={(it.prep_status || "PREPARING") as any}
                    onChange={(e) => {
                      const v = e.target.value;

                      // '준비완료'는 실수 방지를 위해 확인 팝업 후 처리
                      if (v === "READY" && (v !== (it.prep_status || "PREPARING"))) {
                        const ok = window.confirm(`준비완료 처리하시겠습니까?\n(요청수량: ${num(it.qty_requested)}, 사용수량: ${usedDefault})`);
                        if (!ok) return; // 상태 변경 취소
                      }

                      if (v !== (it.prep_status || "PREPARING")) patchItem(it.id, { prep_status: v });
                    }}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(17,24,39,0.65)",
                      color: "white",
                      outline: "none",
                      fontWeight: 900,
                    }}
                  >
                    <option value="PREPARING">준비중</option>
                    <option value="CHANGED">수량변경</option>
                    <option value="READY">준비완료</option>
                  </select>

                  <input
                    defaultValue={it.note || ""}
                    onBlur={(e) => {
                      const v = e.currentTarget.value;
                      if (v !== (it.note || "")) patchItem(it.id, { note: v });
                    }}
                    placeholder="비고"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.65)", color: "white", outline: "none" }}
                  />

                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <button
                      onClick={() => (allowDelete && it.prep_status !== "READY") && deleteItem(it.id)}
                      disabled={!(allowDelete && it.prep_status !== "READY")}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.15)",
                        background: (allowDelete && it.prep_status !== "READY") ? "rgba(255,80,80,0.18)" : "rgba(255,255,255,0.04)",
                        color: "white",
                        cursor: (allowDelete && it.prep_status !== "READY") ? "pointer" : "not-allowed",
                        fontWeight: 900,
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </>
              ) : (
                <input
                  defaultValue={it.note || ""}
                  onBlur={(e) => {
                    const v = e.currentTarget.value;
                    if (v !== (it.note || "")) patchItem(it.id, { note: v });
                  }}
                  placeholder="비고"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.65)", color: "white", outline: "none" }}
                />
              )}
            </div>
          );
        })}

        {savingId !== null && <div style={{ padding: 10, opacity: 0.85, fontWeight: 900 }}>저장 중…</div>}
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <div style={{ padding: 18, color: "white" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 950 }}>자재요청 사업명 : {title}</div>
          
        </div>

        <button
          onClick={() => navigate("/materials")}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "white", cursor: "pointer", fontWeight: 900 }}
        >
          목록으로
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid rgba(255,80,80,0.45)", background: "rgba(255,80,80,0.10)" }}>
          <div style={{ fontWeight: 950 }}>불러오기 실패</div>
          <div style={{ opacity: 0.9, marginTop: 4 }}>{error}</div>
        </div>
      )}

      {/* 추가/수정 영역 */}
      <div style={{ marginTop: 14, padding: 12, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.22)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          
		  <div style={{ 
  marginTop: 4, 
  fontSize: 20,
  display: "flex",
  gap: 50
}}>
  <div>등록자: {header?.requested_by_name || "-"},</div>
  <div>등록일: {fmtDateTime(header?.created_at || null)}</div>
</div>
		  
		  

          <div style={{ display: "flex", gap: 8 }}>
  <button
    type="button"
    onClick={openProductModal}
    style={{
      background: "linear-gradient(180deg, #2563EB 0%, #1D4ED8 100%)",
      color: "#fff",
      border: "1px solid #1d4ed8",
      padding: "10px 12px",
      borderRadius: 10,
      cursor: "pointer",
      fontSize: 15,
      fontWeight: 900,
    }}
  >
    업링크 제품 추가
  </button>

  <button
    type="button"
    onClick={() => setManualDraft({ name: "", spec: "", unit: "EA", qty: 0, note: "" })}
    style={{
      background: "linear-gradient(180deg, #2563EB 0%, #1D4ED8 100%)",
      color: "#fff",
      border: "1px solid #1d4ed8",
      padding: "10px 12px",
      borderRadius: 10,
      cursor: "pointer",
      fontSize: 15,
      fontWeight: 900,
    }}
  >
    수동 추가
  </button>
  
</div>
		  
        </div>

        {manualDraft && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.18)" }}>
            <div style={{ fontWeight: 950 }}>수동 자재 추가</div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1.2fr 1fr 90px 120px 1.2fr 120px", gap: 8 }}>
              <input
                value={manualDraft.name}
                onChange={(e) => setManualDraft((p) => (p ? { ...p, name: e.target.value } : p))}
                placeholder="자재명"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)", color: "white", outline: "none" }}
              />
              <input
                value={manualDraft.spec}
                onChange={(e) => setManualDraft((p) => (p ? { ...p, spec: e.target.value } : p))}
                placeholder="규격"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)", color: "white", outline: "none" }}
              />
              <input
                value={manualDraft.unit}
                onChange={(e) => setManualDraft((p) => (p ? { ...p, unit: e.target.value } : p))}
                placeholder="EA"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)", color: "white", outline: "none" }}
              />
              <input
                value={manualDraft.qty}
                onChange={(e) => setManualDraft((p) => (p ? { ...p, qty: num(e.target.value) } : p))}
                placeholder="요청수량"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)", color: "white", outline: "none", textAlign: "right", fontVariantNumeric: "tabular-nums" }}
              />
              <input
                value={manualDraft.note}
                onChange={(e) => setManualDraft((p) => (p ? { ...p, note: e.target.value } : p))}
                placeholder="비고"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)", color: "white", outline: "none" }}
              />

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <SmallBtn
                  onClick={() => {
                    const d = manualDraft;
                    if (!d || !d.name.trim()) return alert("자재명을 입력하세요.");

                    addItem({
                      source: "MANUAL",
                      product_id: null,
                      estimate_item_id: null,
                      item_name_snapshot: d.name.trim(),
                      spec_snapshot: d.spec ?? "",
                      unit_snapshot: (d.unit ?? "EA").toString() || "EA",
                      qty_requested: num(d.qty),
                      note: d.note ?? "",
                    });

                    setManualDraft(null);
                  }}
                >
                  추가
                </SmallBtn>
                <SmallBtn onClick={() => setManualDraft(null)}>취소</SmallBtn>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 요청 항목 */}
      <div style={{ marginTop: 14, fontWeight: 950, fontSize: 18 }}>
        요청 항목 {loading ? "(불러오는 중…)" : `(${items.length})`}
      </div>

      {!loading && grouped.est.length > 0 && <SectionBox kind="estimate" title="견적서 재료비" count={grouped.est.length}>{renderEditableTable(grouped.est, false, "estimate")}</SectionBox>}

      {!loading && grouped.prod.length > 0 && (
        <SectionBox
          kind="uplink"
          title="업링크 제품"
          count={grouped.prod.length}
          right={<SmallBtn onClick={openProductModal}>추가</SmallBtn>}
        >
          {renderEditableTable(grouped.prod, canSeeSensitive, "uplink")}
        </SectionBox>
      )}

      {!loading && grouped.man.length > 0 && (
        <SectionBox
          kind="manual"
          title="수동 추가"
          count={grouped.man.length}
          right={<SmallBtn onClick={() => setManualDraft({ name: "", spec: "", unit: "EA", qty: 0, note: "" })}>추가</SmallBtn>}
        >
          {renderEditableTable(grouped.man, canSeeSensitive, "manual")}
        </SectionBox>
      )}

      {!loading && items.length === 0 && <div style={{ marginTop: 10, opacity: 0.85 }}>저장된 요청 항목이 없습니다.</div>}


      {/* 자재요청 참고사항(수기) */}
      {!loading && (
        <div style={{ marginTop: 14, padding: 12, border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>자재요청 참고사항</div>
          <textarea
            value={mrMemo}
            onChange={(e) => setMrMemo(e.target.value)}
            placeholder="자재 요청 및 준비시 참고사항에 대해 적어주세요"
            rows={4}
            style={{
              width: "100%",
              resize: "vertical",
              padding: 10,
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(0,0,0,0.2)",
              color: "white",
              outline: "none",
              fontSize: 13,
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button
              onClick={saveMrMemo}
              disabled={mrMemoSaving}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.2)",
                background: mrMemoSaving ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.12)",
                color: "white",
                cursor: mrMemoSaving ? "not-allowed" : "pointer",
                fontWeight: 900,
              }}
            >
              {mrMemoSaving ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      )}

      {/* 업링크 제품 선택 모달 */}
      {productModalOpen && (
        <div
          onClick={() => setProductModalOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 860, height: 640, overflow: "hidden", borderRadius: 16, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(17,24,39,0.98)", color: "white", padding: 14, display: "flex", flexDirection: "column" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 950 }}>업링크 제품 선택</div>
              <button onClick={() => setProductModalOpen(false)} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "white", cursor: "pointer", fontWeight: 900 }}>
                닫기
              </button>
            </div>

            <input
              value={productKeyword}
              onChange={(e) => setProductKeyword(e.target.value)}
              placeholder="제품 검색(이름/규격) - 입력하면 자동 검색됩니다"
              style={{ width: "100%", marginTop: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.25)", color: "white", outline: "none" }}
            />

            <div style={{ marginTop: 10, opacity: 0.85, fontWeight: 900 }}>
              {productLoading ? "검색중…" : productKeyword.trim() ? `검색 결과 · ${products.length}건` : `전체 · ${products.length}건`}
            </div>
            {productError && <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid rgba(255,80,80,0.45)", background: "rgba(255,80,80,0.10)" }}>{productError}</div>}

            <div style={{ marginTop: 10, overflow: "auto", paddingRight: 4, flex: 1 }}>
              {!productLoading && products.length === 0 && <div style={{ padding: 12, opacity: 0.85 }}>표시할 제품이 없습니다.</div>}

              {products.map((p) => (
                <div key={p.id} style={{ padding: "10px 10px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 950 }}>{p.name}</div>
                    <div style={{ opacity: 0.85, fontSize: 13, marginTop: 2 }}>
                      {p.spec ?? "-"} · 단위: {p.unit ?? "EA"}
                    </div>
                  </div>
                  <button onClick={() => addUplinkProductAndClose(p)} style={{ flexShrink: 0, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.10)", color: "white", cursor: "pointer", fontWeight: 900 }}>
                    추가
                  </button>
                </div>
              ))}
            </div>

            <div style={{ opacity: 0.8, fontSize: 12 }}>· “추가”를 누르면 즉시 모달이 닫히며, 업링크 자재 리스트에 1건이 추가됩니다.</div>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}