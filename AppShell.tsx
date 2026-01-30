import React, { useMemo, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

type NavItem = {
  label: string;
  to?: string;
  adminOnly?: boolean;
  children?: NavItem[];
};

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const isAdmin = user?.role_code === "ADMIN";

  // ✅ 좌측 메뉴(레이아웃) 네비게이션 목록
  // - 이번 단계: "자재 요청"(/materials) 링크를 확실히 추가/고정
  const nav = useMemo<NavItem[]>(
    () => [
      { to: "/attendance", label: "출퇴근기록" },
      { to: "/projects", label: "프로젝트(부서별업무)" },
      { to: "/products", label: "제품(자재관리)" },
      { to: "/estimates", label: "견적서" },

      // ✅ 자재 요청 (대표님이 만든 pages/Materials 화면으로 라우팅될 경로)
      { to: "/materials", label: "자재 요청" },

      { to: "/maintenance", label: "유지보수" },
      { to: "/design", label: "설계" },
      { to: "/ideas", label: "대시보드(아이디어/기술팁)" },
      {
        label: "운영관리",
        adminOnly: true,
        children: [
          { to: "/admin/attendance-report", label: "근태관리", adminOnly: true },
          { to: "/admin/departments", label: "부서관리", adminOnly: true },
          { to: "/admin/projects", label: "프로젝트관리", adminOnly: true },
          { to: "/admin/staff-management", label: "직원관리", adminOnly: true },
          { to: "/admin/users", label: "사용자관리", adminOnly: true },
        ],
      },
    ],
    []
  );

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(true);

  function onLogout() {
    logout();
    navigate("/login");
  }

  const Side = (
    <div className="vstack" style={{ gap: 8 }}>
      <div className="hstack" style={{ justifyContent: "space-between" }}>
        <div className="hstack">
          <div className="badge">UPLINK</div>
          <div style={{ fontWeight: 700 }}>회사 엔진</div>
        </div>
      </div>

      <div className="small">{user?.name} 님</div>

      <div className="hr" />

      <div className="vstack" style={{ gap: 6 }}>
        <NavLink
          to="/"
          end
          className={({ isActive }) => `sideItem ${isActive ? "active" : ""}`}
          onClick={() => setDrawerOpen(false)}
        >
          홈
        </NavLink>

        {nav
          .filter((it) => !it.adminOnly || isAdmin)
          .map((it) => {
            const isGroup = Array.isArray(it.children) && it.children.length > 0;

            if (!isGroup) {
              return (
                <NavLink
                  key={it.to}
                  to={it.to as string}
                  className={({ isActive }) => `sideItem ${isActive ? "active" : ""}`}
                  onClick={() => setDrawerOpen(false)}
                >
                  {it.label}
                </NavLink>
              );
            }

            return (
              <div key={it.label} className="vstack" style={{ gap: 6 }}>
                <button
                  type="button"
                  className="sideItem"
                  onClick={() => setAdminMenuOpen((v) => !v)}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <span>{it.label}</span>
                  <span style={{ opacity: 0.7 }}>{adminMenuOpen ? "▾" : "▸"}</span>
                </button>

                {adminMenuOpen &&
                  (it.children || [])
                    .filter((c) => !c.adminOnly || isAdmin)
                    .map((c) => (
                      <NavLink
                        key={c.to}
                        to={c.to as string}
                        className={({ isActive }) => `sideItem sub ${isActive ? "active" : ""}`}
                        onClick={() => setDrawerOpen(false)}
                        style={{ marginLeft: 12 }}
                      >
                        {c.label}
                      </NavLink>
                    ))}
              </div>
            );
          })}
      </div>

      <div className="hr" />

      <button className="btn danger" onClick={onLogout}>
        로그아웃
      </button>
    </div>
  );

  return (
    <>
      <div className="shell">
        <aside className="sidebar">{Side}</aside>

        <div>
          <div className="topbar">
            <button className="btn" onClick={() => setDrawerOpen(true)}>
              ☰ 메뉴
            </button>

            <div className="hstack" style={{ gap: 8 }}>
              <div className="badge">UPLINK</div>
              <div style={{ fontWeight: 700 }}>업링크</div>
            </div>

            <button className="btn danger" onClick={onLogout}>
              로그아웃
            </button>
          </div>

          <main className="main">
            <Outlet />
          </main>
        </div>
      </div>

      {drawerOpen && (
        <div className="drawerBackdrop" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            {Side}
          </div>
        </div>
      )}
    </>
  );
}
