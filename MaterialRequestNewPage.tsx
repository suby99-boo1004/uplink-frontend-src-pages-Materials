import React, { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";

// IME-safe input for MANUAL rows (한글 조합/커서 유지)

function ImeSafeInput({
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  value: string;
  placeholder: string;
  disabled?: boolean;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState<string>(value ?? "");
  const composingRef = useRef(false);

  useEffect(() => {
    if (!composingRef.current) setLocal(value ?? "");
  }, [value]);

  return (
    <input
      type="text"
      inputMode="text"
      autoComplete="off"
      value={local}
      placeholder={placeholder}
      disabled={disabled}
      style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.70)", color: "white", outline: "none" }}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={(e) => {
        composingRef.current = false;
        const v = (e.target as HTMLInputElement).value;
        setLocal(v);
      }}
      onChange={(e) => {
        const v = e.target.value;
        setLocal(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onCommit((e.target as HTMLInputElement).value);
        }
      }}
      onBlur={(e) => onCommit((e.target as HTMLInputElement).value)}
    />
  );
}


/**
 * 자재 요청 신규 등록
 * 이번 수정 목표(대표님 요구):
 * - 프로젝트 진행/완료/취소 리스트와 동일한 방식으로 "진행중 자재요청"만 신규등록 가능(기존 사용 중인 견적서는 제외)
 * - 업링크 제품 추가 / 수동 추가는 상세페이지와 동일한 동작
 * - product_id 관련: 업링크 제품 선택 시 반드시 product_id 채움
 */

type EstimateRow = {
  id: number;
  title?: string | null;
  project_name?: string | null;
  client_name?: string | null;
  created_at?: string | null;
};

type LineSource = "ESTIMATE" | "PRODUCT" | "MANUAL"; // 서버 표준
type PrepStatus = "PREPARING" | "READY";

type MaterialLine = {
  id: string;
  source: LineSource;
  product_id: number | null;
  estimate_item_id: number | null;
  name: string;
  spec: string;
  unit: string;
  qty: number; // 요청수량
  stock_qty: number | null; // 표시만
  used_qty: number | null; // 표시만
  prep_status: PrepStatus;
  note: string;
};

type ProductRow = { id: number; name: string; spec?: string | null; unit?: string | null };

function labelOfEstimate(e: EstimateRow) {
  const name = (e.project_name && e.project_name.trim()) || (e.title && e.title.trim()) || `견적서 #${e.id}`;
  const client = e.client_name ? ` / ${e.client_name}` : "";
  return `${name}${client}`;
}

function toNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mkId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeSectionType(v: any): string {
  return (v ?? "").toString().trim().toUpperCase();
}

/**
 * 견적서 상세에서 MATERIAL 섹션의 라인을 자재요청 라인으로 변환
 * - product_id: line.product_id / product.id / source_id 등을 최대한 추출
 * - estimate_item_id: line.id 등을 넣되 없으면 null
 */
function extractMaterialLinesFromEstimateDetail(detail: any): MaterialLine[] {
  if (!detail || typeof detail !== "object") return [];
  const sections = Array.isArray(detail.sections)
    ? detail.sections
    : Array.isArray(detail?.data?.sections)
    ? detail.data.sections
    : null;

  if (!sections) return [];

  const materialSections = sections.filter((s: any) => normalizeSectionType(s?.section_type) === "MATERIAL");
  if (materialSections.length === 0) return [];

  const lines: any[] = materialSections.flatMap((s: any) => (Array.isArray(s?.lines) ? s.lines : []));

  const mapped = lines
    .map((l: any) => {
      const sourceType = (l?.source_type ?? "").toString().toUpperCase();
      const productId =
        sourceType === "PRODUCT"
          ? toNum(l?.source_id)
          : toNum(l?.product_id) ?? toNum(l?.productId) ?? toNum(l?.product?.id) ?? null;

      const name = (l?.name ?? l?.item_name_snapshot ?? l?.product_name ?? "").toString().trim();
      const spec = (l?.spec ?? l?.spec_snapshot ?? "").toString().trim();
      const unit = (l?.unit ?? l?.unit_snapshot ?? "EA").toString().trim();
      const qty = toNum(l?.qty) ?? toNum(l?.qty_requested) ?? 0;

      if (!name) return null;

      return {
        id: mkId(),
        source: "ESTIMATE" as const,
        product_id: productId ?? null,
        estimate_item_id: toNum(l?.id) ?? toNum(l?.estimate_item_id) ?? toNum(l?.estimateItemId) ?? null,
        name,
        spec,
        unit: unit || "EA",
        qty: qty && qty > 0 ? qty : 0,
        stock_qty: null,
        used_qty: null,
        prep_status: "PREPARING" as const,
        note: "",
      };
    })
    .filter(Boolean) as MaterialLine[];

  // 중복 제거(같은 품목이 여러 번 나오면 1건만)
  const uniq: MaterialLine[] = [];
  const set = new Set<string>();
  for (const m of mapped) {
    const k = `${m.product_id ?? ""}|${m.name}|${m.spec}|${m.unit}|${m.source}`;
    if (set.has(k)) continue;
    set.add(k);
    uniq.push(m);
  }
  return uniq;
}

export default function MaterialRequestNewPage() {
  const navigate = useNavigate();
  const { user } = useAuth() as any;

  const [projectName, setProjectName] = useState("");
  const [estimateId, setEstimateId] = useState<number | "">("");
  const [estimates, setEstimates] = useState<EstimateRow[]>([]);

  const [loadingEst, setLoadingEst] = useState(false);
  const [errorEst, setErrorEst] = useState<string | null>(null);

  const [lines, setLines] = useState<MaterialLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [errorLines, setErrorLines] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 제품 선택 모달
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [productKeyword, setProductKeyword] = useState("");
  const [productLoading, setProductLoading] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);

  function addManualLine() {
    setLines((prev) => [
      ...prev,
      {
        id: mkId(),
        source: "MANUAL",
        product_id: null,
        estimate_item_id: null,
        name: "",
        spec: "",
        unit: "EA",
        qty: 0,
        stock_qty: null,
        used_qty: null,
        prep_status: "PREPARING",
        note: "",
      },
    ]);
  }

  function updateLine(id: string, patch: Partial<MaterialLine>) {
    setLines((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((x) => x.id !== id));
  }

  async function loadEstimatesOngoing() {
    setLoadingEst(true);
    setErrorEst(null);

    try {
      const qs = new URLSearchParams();
      qs.set("status", "ONGOING");
      const res = await api(`/api/estimates?${qs.toString()}`);

      const items = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : [];
      const normalized: EstimateRow[] = items
        .map((x: any) => ({
          id: Number(x?.id),
          title: x?.title ?? null,
          project_name: x?.project_name ?? x?.projectName ?? null,
          client_name: x?.client_name ?? x?.clientName ?? null,
          created_at: x?.created_at ?? x?.createdAt ?? null,
        }))
        .filter((x: any) => Number.isFinite(x.id));

      // 이미 자재요청으로 사용된 견적서는 신규등록에서 제외(진행중 기준)
      const mrRes = await api(`/api/material-requests?year=0&state=ONGOING&q=&v=1&_ts=${Date.now()}`);
      const mrItems = Array.isArray(mrRes) ? mrRes : Array.isArray(mrRes?.items) ? mrRes.items : [];
      const usedEstimateIds = new Set<number>();

      for (const it of mrItems as any[]) {
        const eid = Number(it?.estimate_id ?? it?.estimateId ?? null);
        if (Number.isFinite(eid) && eid > 0) usedEstimateIds.add(eid);
      }

      const filtered = usedEstimateIds.size > 0 ? normalized.filter((e) => !usedEstimateIds.has(e.id)) : normalized;
      setEstimates(filtered);
    } catch (e: any) {
      setEstimates([]);
      setErrorEst(e?.message || "진행중 견적서 목록을 불러오지 못했습니다.");
    } finally {
      setLoadingEst(false);
    }
  }

  async function loadEstimateDetailAndFill(estimateIdNum: number) {
    setLoadingLines(true);
    setErrorLines(null);

    try {
      const detail = await api(`/api/estimates/${estimateIdNum}`);
      const extracted = extractMaterialLinesFromEstimateDetail(detail);

      // ✅ 버그 수정: estimate_item_id 없는 ESTIMATE 라인은 저장 시 MANUAL로 강제
      const extractedNormalized = extracted.map((x) => (x.source === "ESTIMATE" && !x.estimate_item_id ? { ...x, source: "MANUAL" as const } : x));

      setLines((prev) => {
        const keptProduct = prev.filter((x) => x.source === "PRODUCT");
        const keptManual = prev.filter((x) => x.source === "MANUAL");
        return [...extractedNormalized, ...keptProduct, ...keptManual];
      });

      const fallbackName =
        (detail?.title ?? detail?.project_name ?? detail?.projectName ?? "")?.toString().trim() || `견적서 #${estimateIdNum}`;
      if (!projectName.trim()) setProjectName(fallbackName);

      if (extracted.length === 0) setErrorLines("견적서 재료비(MATERIAL) 섹션에서 자재 라인을 찾지 못했습니다.");
    } catch (e: any) {
      setErrorLines(e?.message || "견적서 상세를 불러오지 못했습니다.");
    } finally {
      setLoadingLines(false);
    }
  }

  function onSelectEstimate(nextId: number | "") {
    setEstimateId(nextId);
    if (nextId === "") return;

    const found = estimates.find((x) => x.id === nextId);
    if (found) {
      const name = (found.project_name && found.project_name.trim()) || (found.title && found.title.trim()) || `견적서 #${found.id}`;
      if (!projectName.trim()) setProjectName(name);
    }


    loadEstimateDetailAndFill(nextId);
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

      const items = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : Array.isArray(res?.data) ? res.data : [];
      const normalized: ProductRow[] = items
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

  // 자동 검색(디바운스)
  useEffect(() => {
    if (!productModalOpen) return;
    const t = window.setTimeout(() => loadProducts(productKeyword), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productKeyword, productModalOpen]);

  function addUplinkProductAndClose(p: ProductRow) {
    // ✅ 한 번에 1개만 추가
    setLines((prev) => [
      ...prev,
      {
        id: mkId(),
        source: "PRODUCT",
        product_id: p.id,
        estimate_item_id: null,
        name: p.name,
        spec: (p.spec ?? "").toString(),
        unit: (p.unit ?? "EA").toString() || "EA",
        qty: 1,
        stock_qty: null,
        used_qty: null,
        prep_status: "PREPARING",
        note: "",
      },
    ]);

    setProductModalOpen(false);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);

    try {
      if (!projectName.trim()) { setSaveError("자재요청 건명을 넣으세요"); setSaving(false); return; }

      // ✅ 저장 직전 안전 정규화(소스/단위/수량)
      const normalized = lines.map((ln) => {
        const unit = (ln.unit || "EA").toString().trim() || "EA";
        const qty = Number.isFinite(Number(ln.qty)) ? Number(ln.qty) : 0;
        const src: LineSource =
          ln.source === "ESTIMATE" && !ln.estimate_item_id ? "MANUAL" : (ln.source as LineSource);

        return { ...ln, unit, qty: qty < 0 ? 0 : qty, source: src };
      });

      const payload: any = {
        project_name: projectName || "",
        memo: projectName || "",
        estimate_id: estimateId ? Number(estimateId) : undefined,
        items: normalized.map((ln) => ({
          source: ln.source, // ESTIMATE/PRODUCT/MANUAL
          product_id: ln.product_id ?? null,
          estimate_item_id: ln.estimate_item_id ?? null,
          item_name_snapshot: ln.name ?? "",
          spec_snapshot: ln.spec ?? "",
          unit_snapshot: ln.unit ?? "EA",
          qty_requested: Number(ln.qty ?? 0),
          note: ln.note ?? "",
        })),
      };

      await api(`/api/material-requests?v=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // 저장 후 리스트 강제 재조회(메인 페이지는 location.search 변화 감지)
      navigate(`/materials?refresh=${Date.now()}`);
    } catch (e: any) {
      setSaveError(e?.message || "등록에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadEstimatesOngoing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const estimateLines = lines.filter((x) => x.source === "ESTIMATE");
  const productLines = lines.filter((x) => x.source === "PRODUCT");
  const manualLines = lines.filter((x) => x.source === "MANUAL");

  const productListTitle = useMemo(() => {
    const kw = productKeyword.trim();
    if (productLoading) return "검색중…";
    if (kw) return `검색 결과 · ${products.length}건`;
    return `전체 · ${products.length}건`;
  }, [productKeyword, productLoading, products.length]);

  const topUserName = (user?.name ?? user?.username ?? "").toString() || "-";

  // IME-safe input for MANUAL rows (한글 조합/커서 튐 방지)


  const renderTable = (list: MaterialLine[], emptyHint?: string) => (
    <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 90px 120px 1fr 54px", gap: 8, padding: "10px 12px", fontWeight: 900, opacity: 0.85, background: "rgba(255,255,255,0.06)" }}>
        <div>자재명</div>
        <div>규격</div>
        <div>단위</div>
        <div style={{ textAlign: "right" }}>요청수량</div>
        <div>비고</div>
        <div style={{ textAlign: "center" }}>삭제</div>
      </div>

      {!loadingLines && list.length === 0 && <div style={{ padding: 12, opacity: 0.8 }}>{emptyHint || "표시할 데이터가 없습니다."}</div>}

      {list.map((ln) => (
        <div key={ln.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 90px 120px 1fr 54px", gap: 8, padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {
            ln.source === "MANUAL" ? (
              <ImeSafeInput
                value={ln.name}
                placeholder="자재명"
                disabled={false}
                onCommit={(v) => updateLine(ln.id, { name: v })}
              />
            ) : (
              <input
                value={ln.name}
                onChange={(e) => updateLine(ln.id, { name: e.target.value })}
                placeholder="자재명"
                style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.70)", color: "white", outline: "none" }}
                disabled={ln.source === "ESTIMATE"}
              />
            )
          }
          {
            ln.source === "MANUAL" ? (
              <ImeSafeInput
                value={ln.spec}
                placeholder="규격"
                disabled={false}
                onCommit={(v) => updateLine(ln.id, { spec: v })}
              />
            ) : (
              <input
                value={ln.spec}
                onChange={(e) => updateLine(ln.id, { spec: e.target.value })}
                placeholder="규격"
                style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.70)", color: "white", outline: "none" }}
                disabled={ln.source === "ESTIMATE"}
              />
            )
          }
          {
            ln.source === "MANUAL" ? (
              <ImeSafeInput
                value={ln.unit}
                placeholder="EA"
                disabled={false}
                onCommit={(v) => updateLine(ln.id, { unit: v })}
              />
            ) : (
              <input
                value={ln.unit}
                onChange={(e) => updateLine(ln.id, { unit: e.target.value })}
                placeholder="EA"
                style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.70)", color: "white", outline: "none" }}
                disabled={ln.source === "ESTIMATE"}
              />
            )
          }
          <input
            value={ln.qty}
            onChange={(e) => updateLine(ln.id, { qty: Number(e.target.value) || 0 })}
            placeholder="0"
            style={{ width: "100%", textAlign: "right", padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.70)", color: "white", outline: "none", fontVariantNumeric: "tabular-nums" }}
          />
          {
            ln.source === "MANUAL" ? (
              <ImeSafeInput
                value={ln.note}
                placeholder="비고"
                disabled={false}
                onCommit={(v) => updateLine(ln.id, { note: v })}
              />
            ) : (
              <input
                value={ln.note}
                onChange={(e) => updateLine(ln.id, { note: e.target.value })}
                placeholder="비고"
                style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.70)", color: "white", outline: "none" }}
                disabled={ln.source === "ESTIMATE"}
              />
            )
          }
          <div style={{ display: "flex", justifyContent: "center" }}>
            <button
              onClick={() => removeLine(ln.id)}
              style={{ width: 44, height: 34, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,80,80,0.15)", color: "white", cursor: "pointer", fontWeight: 900 }}
              disabled={ln.source === "ESTIMATE"}
              title={ln.source === "ESTIMATE" ? "견적서 항목은 삭제할 수 없습니다" : "삭제"}
            >
              삭제
            </button>
          </div>
        </div>
      ))}
    
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
        
      </div>
</div>
  );

  const SectionBox = ({ kind, title, count, right, children }: { kind: "estimate" | "product" | "manual"; title: string; count: number; right?: React.ReactNode; children: React.ReactNode }) => {
    const styleMap: Record<string, any> = {
      estimate: { border: "rgba(80,160,255,0.50)", bg: "rgba(80,160,255,0.10)" },
      product: { border: "rgba(80,220,160,0.50)", bg: "rgba(80,220,160,0.10)" },
      manual: { border: "rgba(255,180,80,0.50)", bg: "rgba(255,180,80,0.10)" },
    };
    const s = styleMap[kind];
    return (
      <div style={{ marginTop: 12, borderRadius: 16, border: `1px solid ${s.border}`, background: s.bg, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 950 }}>{title}</div>
            <div style={{ padding: "4px 8px", borderRadius: 999, border: `1px solid ${s.border}`, background: "rgba(0,0,0,0.18)", fontWeight: 900, fontSize: 12 }}>
              {count}
            </div>
          </div>
          {right}
        </div>
        <div style={{ marginTop: 10 }}>{children}</div>
      </div>
    );
  };

  return (
    <div style={{ padding: 18, color: "white" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 950 }}>자재 요청 신규 등록</div>
          <div style={{ opacity: 0.85, marginTop: 4, fontSize: 13 }}>
            등록자: <b>{topUserName}</b>
          </div>
        </div>

        <button
          onClick={() => navigate("/materials")}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "white", cursor: "pointer", fontWeight: 900 }}
        >
          목록으로
        </button>
      </div>

      {/* 견적서 선택 */}
      <div style={{ marginTop: 14, padding: 12, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.22)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <select
            value={estimateId === "" ? "" : String(estimateId)}
            onChange={(e) => onSelectEstimate(e.target.value ? Number(e.target.value) : "")}
            disabled={loadingEst}
            style={{ minWidth: 340, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(17,24,39,0.70)", color: "white", outline: "none", opacity: loadingEst ? 0.7 : 1, fontWeight: 800 }}
          >
            <option value="">진행중 견적서를 선택하세요</option>
            {estimates.map((e) => (
              <option key={e.id} value={e.id}>
                {labelOfEstimate(e)}
              </option>
            ))}
          </select>

          <button
            onClick={() => loadEstimatesOngoing()}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "white", cursor: "pointer", fontWeight: 900 }}
          >
            {loadingEst ? "불러오는 중…" : "새로고침"}
          </button>
        </div>

        {errorEst && <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid rgba(255,80,80,0.45)", background: "rgba(255,80,80,0.10)" }}>{errorEst}</div>}

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder={"자재요청 건명(필수) - 직접 입력하세요 (견적서 선택 시 자동 입력 가능)"}
            style={{ width: "40%", minWidth: 280, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(17,24,39,0.70)", color: "white", outline: "none" }}
          />
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button onClick={openProductModal} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", color: "white", cursor: "pointer", fontWeight: 900 }}>
              업링크 제품 추가
            </button>
            <button onClick={addManualLine} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "white", cursor: "pointer", fontWeight: 900 }}>
              수동 추가
            </button>
          </div>
        </div>
      </div>

      {/* 자재 리스트 */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontWeight: 950, fontSize: 18 }}>자재 리스트</div>
          
        </div>

        {loadingLines && <div style={{ marginTop: 10, opacity: 0.85, fontWeight: 800 }}>불러오는 중…</div>}
        {errorLines && <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid rgba(255,80,80,0.45)", background: "rgba(255,80,80,0.10)" }}>{errorLines}</div>}

        <SectionBox kind="estimate" title="견적서 재료비" count={estimateLines.length}>
          {renderTable(estimateLines, "견적서에서 가져온 재료비 항목이 없습니다.")}
        </SectionBox>

        <SectionBox kind="product" title="업링크 제품" count={productLines.length}>
          {renderTable(productLines, "업링크 제품을 추가하세요.")}
        </SectionBox>

        <SectionBox kind="manual" title="수동 추가" count={manualLines.length}>
          {renderTable(manualLines, "수동으로 자재를 추가하세요.")}
        </SectionBox>
      </div>

      {/* 하단 액션 */}
      <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", alignItems: "flex-end", gap: 10 }}>
        {saveError && <div style={{ padding: 10, borderRadius: 12, border: "1px solid rgba(255,80,80,0.45)", background: "rgba(255,80,80,0.10)" }}>{saveError}</div>}

        <button
          onClick={handleSave}
          disabled={saving}
          style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: saving ? "rgba(255,255,255,0.08)" : "rgba(34,197,94,0.22)", color: "white", cursor: saving ? "not-allowed" : "pointer", fontWeight: 950, fontSize: 13 }}
        >
          {saving ? "등록 중…" : "등록 완료"}
        </button>
      </div>

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

            <div style={{ marginTop: 10, opacity: 0.85, fontWeight: 900 }}>{productListTitle}</div>
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

            <div style={{ opacity: 0.8, fontSize: 12 }}>· “추가”를 누르면 즉시 모달이 닫히며, “업링크 제품” 그룹에 1건만 추가됩니다.</div>
          </div>
        </div>
      )}
    </div>
  );
}