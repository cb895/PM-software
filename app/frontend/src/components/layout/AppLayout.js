import React, { useState } from 'react';
import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import api from '../../api/client';
import './AppLayout.css';

const NAV_ITEMS = [
  { to: '/',                label: 'Dashboard',       icon: '⬡', roles: null },
  { to: '/projects',         label: 'Projects',         icon: '◆', roles: null },
  { to: '/purchase-orders', label: 'Purchase orders',  icon: '◈', roles: null },
  { to: '/suppliers',       label: 'Suppliers',        icon: '◇', roles: null },
  { to: '/consumables',     label: 'Consumables',      icon: '◎', roles: null },
  { to: '/daily-logs',      label: 'Daily logs',       icon: '◱', roles: null },
  { to: '/tasks',           label: 'Tasks & Gantt',    icon: '◫', roles: null },
  { to: '/budget',          label: 'Budget',           icon: '◈', roles: ['ops_manager','ceo'] },
  { to: '/kpi',             label: 'KPI tracking',     icon: '◉', roles: ['ops_manager','ceo'] },
  { to: '/reports',         label: 'Weekly reports',   icon: '◧', roles: null },
  { to: '/hr',               label: 'HR portal',        icon: '♦', roles: ['ops_manager','ceo'] },
  { to: '/admin',            label: 'User management',  icon: '◉', roles: ['ops_manager'] },
];

const ROLE_LABELS = {
  lab_tech:    'Lab technician',
  ops_manager: 'Operations manager',
  qm_director: 'QM director',
  ceo:         'CEO',
};

export default function AppLayout() {
  const { user, logout, hasRole } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const { data: notifications } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => api.get('/notifications?unread=true').then(r => r.data),
    refetchInterval: 30000,
  });

  const unreadCount = notifications?.length || 0;

  const visibleItems = NAV_ITEMS.filter(item =>
    !item.roles || item.roles.some(r => hasRole(r))
  );

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <span className="logo-mark">MT</span>
            {!collapsed && <span className="logo-text">MetabolicTrack</span>}
          </div>
          <button
            className="collapse-btn"
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {visibleItems.map((item, i) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `nav-item ${isActive ? 'nav-item--active' : ''}`
              }
              title={collapsed ? item.label : undefined}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
              {/* Phosphor green timeline connector for active item */}
              <span className="nav-trace" aria-hidden="true" />
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          {!collapsed && (
            <div className="user-info">
              <div className="user-avatar">
                {user?.full_name?.split(' ').map(n => n[0]).join('').slice(0,2)}
              </div>
              <div className="user-details">
                <span className="user-name truncate">{user?.full_name}</span>
                <span className="user-role">{ROLE_LABELS[user?.role]}</span>
              </div>
            </div>
          )}
          <Link to="/profile" className="profile-link" title="My profile">
            <span aria-hidden="true">◎</span>
            {!collapsed && <span>My profile</span>}
          </Link>
          <button className="logout-btn" onClick={handleLogout} title="Log out">
            <span aria-hidden="true">⏻</span>
            {!collapsed && <span>Log out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="main-content">
        <header className="topbar">
          <div className="topbar-left" />
          <div className="topbar-right">
            <button className="notif-btn" aria-label={`${unreadCount} unread notifications`}>
              <span aria-hidden="true">◔</span>
              {unreadCount > 0 && (
                <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </button>
          </div>
        </header>
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
