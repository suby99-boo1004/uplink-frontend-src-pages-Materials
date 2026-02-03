import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";

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
  source?: string | null; // FROM_ESTIMATE / FROM_PRODUCT / MANUAL_TEXT ...
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
  if (s.includes("ESTIMATE")) return "ESTIMATE";
  if (s.includes("PRODUCT") || s.includes("UPLINK")) return "PRODUCT";
  if (s.includes("MANUAL") || s.includes("TEXT")) return "MANUAL";

  // fallback
  if (typeof it.estimate_item_id === "number" && it.estimate_item_id > 0) return "ESTIMATE";
  if (typeof it.product_id === "number" && it.product_id > 0) return "PRODUCT";
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
  const styleMap: Record<SectionKind, { border: string; bg: string; badgeBg: string; badgeBorder: string }> = {
    estimate: {
      border: "rgba(80,160,255,0.50)",
      bg: "rgba(80,160,255,0.10)",
      badgeBg: "rgba(80,160,255,0.18)",
      badgeBorder: "rgba(80,160,255,0.50)",
    },
    uplink: {
      border: "rgba(80,220,160,0.50)",
      bg: "rgba(80,220,160,0.10)",
      badgeBg: "rgba(80,220,160,0.18)",
      badgeBorder: "rgba(80,220,160,0.50)",
    },
    manual: {
      border: "rgba(255,180,80,0.50)",
      bg: "rgba(255,180,80,0.10)",
      badgeBg: "rgba(255,180,80,0.18)",
      badgeBorder: "rgba(255,180,80,0.50)",
    },
  };
  const s = styleMap[kind];

  return (
    <div style={{ marginTop: 14, borderRadius: 16, border: `2px solid ${s.border}`, background: s.bg, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div style={{ fontWeight: 900, whiteSpace: "nowrap" }}>{title}</div>
          <div
            style={{
              border: `1px solid ${s.badgeBorder}`,
              background: s.badgeBg,
              padding: "4px 10px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 900,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {count}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>{right}</div>
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

function SmallBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!!disabled}
      style={{
        padding: "8px 10px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.15)",
        background: disabled ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)",
        color: "white",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 900,
        whiteSpace: "nowrap",
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
        const res = await api<DetailRes>(`/api/material-requests/${mrId}`);
        setCanSeeSensitive(!!res?.can_see_sensitive);
        setHeader(res?.header ?? null);
        setItems(Array.isArray(res?.items) ? res.items : []);
      } catch (e: any) {
        setError(e?.message || "상세를 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    }

    reloadRef.current = fetchDetail;
    fetchDetail();
  }, [mrId]);

  const title = (header?.business_name && header.business_name.trim()) || (header?.memo && header.memo.trim()) || `자재요청 #${mrId}`;

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
      await api(`/api/material-requests/${mrId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

  async function loadProducts(keywordOverride?: string) {
    const kw = (keywordOverride ?? productKeyword).trim();

    setProductLoading(true);
    setProductError(null);

    try {
      const tryUrls = [
        `/api/products?keyword=${encodeURIComponent(kw)}`,
        `/api/products?q=${encodeURIComponent(kw)}`,
        `/api/products`,
      ];

      let res: any = null;
      let lastErr: any = null;

      for (const url of tryUrls) {
        try {
          res = await api<any>(url);
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
    // 한 번에 1개만 추가(신규등록과 동일한 UX)
    addItem({
      source: "UPLINK_PRODUCT",
      product_id: p.id,
      estimate_item_id: null,
      item_name_snapshot: p.name,
      spec_snapshot: (p.spec ?? "").toString(),
      unit_snapshot: (p.unit ?? "EA").toString(),
      qty_requested: 1,
      note: "",
    });
    setProductModalOpen(false);
  }

  function renderEditableTable(list: MRItem[], allowDelete: boolean) {
    return (
      <div style={{ marginTop: 10, borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.05)" }}>
              <th style={{ textAlign: "left", padding: 10, fontSize: 12, opacity: 0.85 }}>자재명</th>
              <th style={{ textAlign: "left", padding: 10, fontSize: 12, opacity: 0.85 }}>규격</th>
              <th style={{ textAlign: "left", padding: 10, fontSize: 12, opacity: 0.85, width: 60 }}>단위</th>
              <th style={{ textAlign: "right", padding: 10, fontSize: 12, opacity: 0.85, width: 80 }}>요청수량</th>
              <th style={{ textAlign: "right", padding: 10, fontSize: 12, opacity: 0.85, width: 80 }}>현재수량</th>
              <th style={{ textAlign: "right", padding: 10, fontSize: 12, opacity: 0.85, width: 80, display: canSeeSensitive ? undefined : "none" }}>사용수량</th>
              <th style={{ textAlign: "right", padding: 10, fontSize: 12, opacity: 0.85, width: 110, display: canSeeSensitive ? undefined : "none" }}>재고변경수량</th>
              <th style={{ textAlign: "left", padding: 10, fontSize: 12, opacity: 0.85, width: 210 }}>준비상황 / 비고</th>
              <th style={{ textAlign: "center", padding: 10, fontSize: 12, opacity: 0.85, width: 62 }}>삭제</th>
            </tr>
          </thead>
          <tbody>
            {list.map((it) => (
              <tr key={it.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <td style={{ padding: 10, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.item_name_snapshot || "-"}>{it.item_name_snapshot || "-"}</td>
                <td style={{ padding: 10, opacity: 0.95, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.spec_snapshot || "-"}>{it.spec_snapshot || "-"}</td>
                <td style={{ padding: 10, opacity: 0.95, width: 60, whiteSpace: "nowrap" }}>{it.unit_snapshot || "-"}</td>

                <td style={{ padding: 10, textAlign: "right", width: 80 }}>
                  <input
                    defaultValue={String(num(it.qty_requested))}
                    onBlur={(e) => {
                      const v = num(e.currentTarget.value);
                      if (v !== num(it.qty_requested)) patchItem(it.id, { qty_requested: v });
                    }}
                    style={{
                      width: "100%",
                      textAlign: "right",
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(17,24,39,0.65)",
                      color: "white",
                      outline: "none",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  />
                </td>

                <td style={{ padding: 10, textAlign: "right", opacity: 0.95 }}>
                  {it.qty_on_hand == null ? (it.product_id ? 0 : "-") : num(it.qty_on_hand)}
                </td>

                <td style={{ padding: 10, display: canSeeSensitive ? undefined : "none" }}>
                  <input
                    defaultValue={String((it.qty_used == null || (num(it.qty_used) === 0 && num(it.qty_requested) > 0)) ? num(it.qty_requested) : num(it.qty_used))}
                    onBlur={(e) => {
                      const v = num(e.currentTarget.value);
                      if (v !== (it.qty_used == null || (num(it.qty_used) === 0 && num(it.qty_requested) > 0)) ? num(it.qty_requested) : num(it.qty_used)) patchItem(it.id, { qty_used: v });
                    }}
                    style={{
                      width: "100%",
                      textAlign: "right",
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(17,24,39,0.65)",
                      color: "white",
                      outline: "none",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  />
                </td>

                <td style={{ padding: 10, textAlign: "right", fontVariantNumeric: "tabular-nums", display: canSeeSensitive ? undefined : "none" }}>
                  {it.qty_on_hand == null ? (it.product_id ? 0 - num(it.qty_used ?? it.qty_requested) : "-") : num(it.qty_on_hand) - num(it.qty_used ?? it.qty_requested)}
                </td>

                <td style={{ padding: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select
                      defaultValue={(it.prep_status || "PREPARING") as any}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v !== (it.prep_status || "PREPARING")) patchItem(it.id, { prep_status: v });
                      }}
                      style={{
                        width: 110,
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "rgba(17,24,39,0.65)",
                        color: "white",
                        outline: "none",
                        fontWeight: 900,
                        flex: "0 0 auto",
                      }}
                    >
                      <option value="PREPARING">준비중</option>
                      <option value="READY">준비완료</option>
                    </select>

                    <input
                      defaultValue={it.note || ""}
                      onBlur={(e) => {
                        const v = e.currentTarget.value;
                        if (v !== (it.note || "")) patchItem(it.id, { note: v });
                      }}
                      placeholder="비고"
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "rgba(17,24,39,0.65)",
                        color: "white",
                        outline: "none",
                      }}
                    />
                  </div>
                </td>

                <td style={{ padding: 10, textAlign: "center", width: 62 }}>
                  <button
                    type="button"
                    disabled={!allowDelete}
                    onClick={() => deleteItem(it.id)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.15)",
                      background: allowDelete ? "rgba(255,80,80,0.18)" : "rgba(255,255,255,0.04)",
                      color: "white",
                      cursor: allowDelete ? "pointer" : "not-allowed",
                      fontWeight: 900,
                    }}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {savingId !== null && (
          <div style={{ padding: 10, fontSize: 12, opacity: 0.75, borderTop: "1px solid rgba(255,255,255,0.06)" }}>저장 중…</div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900 }}>{title}</div>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
            등록자: {header?.requested_by_name || "-"} · 등록일: {fmtDateTime(header?.created_at || null)} · 상태: {header?.status || "-"}
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate("/materials")}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.06)",
            color: "white",
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          목록으로
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid rgba(255,80,80,0.35)", background: "rgba(255,80,80,0.10)" }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>불러오기 실패</div>
          <div style={{ opacity: 0.9 }}>{error}</div>
        </div>
      )}

      {/* 추가/수정 영역(신규등록 스타일) */}
      <div style={{ marginTop: 14, padding: 12, borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 900 }}>추가 / 수정</div>
            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>업링크 제품 추가 / 수동 추가 / 요청수량·준비상황·비고 수정</div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <SmallBtn onClick={openProductModal}>업링크 제품 추가</SmallBtn>
            <SmallBtn
              onClick={() =>
                setManualDraft({
                  name: "",
                  spec: "",
                  unit: "",
                  qty: 0,
                  note: "",
                })
              }
            >
              수동 추가
            </SmallBtn>
          </div>
        </div>

        {manualDraft && (
          <div style={{ marginTop: 12, borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.55)", padding: 12 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>수동 자재 추가</div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 1fr", gap: 10 }}>
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
                placeholder="단위"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)", color: "white", outline: "none" }}
              />
              <input
                value={String(manualDraft.qty ?? 0)}
                onChange={(e) => setManualDraft((p) => (p ? { ...p, qty: num(e.target.value) } : p))}
                placeholder="요청수량"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)", color: "white", outline: "none", textAlign: "right", fontVariantNumeric: "tabular-nums" }}
              />
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
              <input
                value={manualDraft.note}
                onChange={(e) => setManualDraft((p) => (p ? { ...p, note: e.target.value } : p))}
                placeholder="비고"
                style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)", color: "white", outline: "none" }}
              />
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
                    unit_snapshot: d.unit ?? "",
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
        )}
      </div>

      <div style={{ marginTop: 18, fontWeight: 900 }}>요청 항목 {loading ? "(불러오는 중…)" : `(${items.length})`}</div>

      {/* 섹션(신규등록처럼) */}
      {!loading && grouped.est.length > 0 && (
        <SectionBox kind="estimate" title="견적서 리스트" count={grouped.est.length} right={undefined}>
          {renderEditableTable(grouped.est, false)}
        </SectionBox>
      )}

      {!loading && grouped.prod.length > 0 && (
        <SectionBox
          kind="uplink"
          title="업링크 자재 리스트"
          count={grouped.prod.length}
          right={<SmallBtn onClick={openProductModal}>추가</SmallBtn>}
        >
          {renderEditableTable(grouped.prod, true)}
        </SectionBox>
      )}

      {!loading && grouped.man.length > 0 && (
        <SectionBox
          kind="manual"
          title="수동 자재 리스트"
          count={grouped.man.length}
          right={<SmallBtn onClick={() => setManualDraft({ name: "", spec: "", unit: "", qty: 0, note: "" })}>추가</SmallBtn>}
        >
          {renderEditableTable(grouped.man, true)}
        </SectionBox>
      )}

      {!loading && items.length === 0 && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.04)",
            opacity: 0.9,
          }}
        >
          저장된 요청 항목이 없습니다.
        </div>
      )}

      {/* 업링크 제품 선택 모달 */}
      {productModalOpen && (
        <div
          onClick={() => setProductModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 860,
              height: 640,
              overflow: "hidden",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(17,24,39,0.98)",
              color: "white",
              padding: 14,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>업링크 제품 선택</div>
              <SmallBtn onClick={() => setProductModalOpen(false)}>닫기</SmallBtn>
            </div>

            <div style={{ marginTop: 12 }}>
              <input
                value={productKeyword}
                onChange={(e) => setProductKeyword(e.target.value)}
                placeholder="제품 검색(이름/규격) - 입력하면 자동 검색됩니다"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(0,0,0,0.25)",
                  color: "white",
                  outline: "none",
                }}
              />
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                {productLoading ? "검색중…" : productKeyword.trim() ? `검색 결과 · ${products.length}건` : `전체 · ${products.length}건`}
              </div>
            </div>

            {productError && <div style={{ marginTop: 10, fontSize: 12, color: "#ffb4b4", whiteSpace: "pre-wrap" }}>{productError}</div>}

            <div style={{ marginTop: 12, flex: 1, overflow: "auto", paddingRight: 4 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {!productLoading && products.length === 0 && (
                  <div style={{ padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", opacity: 0.75 }}>
                    표시할 제품이 없습니다.
                  </div>
                )}

                {products.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: 12,
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(255,255,255,0.04)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.spec ?? "-"} · 단위: {p.unit ?? "EA"}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => addUplinkProductAndClose(p)}
                      style={{
                        flexShrink: 0,
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.15)",
                        background: "rgba(255,255,255,0.10)",
                        color: "white",
                        cursor: "pointer",
                        fontWeight: 900,
                      }}
                    >
                      추가
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>· “추가”를 누르면 즉시 모달이 닫히며, 업링크 자재 리스트에 1건이 추가됩니다.</div>
          </div>
        </div>
      )}
    </div>
  );
}