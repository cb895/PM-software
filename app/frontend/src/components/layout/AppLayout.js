import React, { useState } from 'react';
import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { formatDate } from '../../utils/format';
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
  { to: '/hr',               label: 'HR portal',        icon: '♦', roles: null },
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
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const { data: notifications } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => api.get('/notifications?unread=true').then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: notificationFeed } = useQuery({
    queryKey: ['notifications-feed'],
    queryFn: () => api.get('/notifications').then(r => r.data),
    enabled: showNotifications,
  });

  const markReadMutation = useMutation({
    mutationFn: id => api.patch(`/notifications/${id}/read`),
    onSuccess: () => {
      qc.invalidateQueries(['notifications-unread']);
      qc.invalidateQueries(['notifications-feed']);
    },
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
          <div className="topbar-right" style={{ position: 'relative' }}>
            <button className="notif-btn" aria-label={`${unreadCount} unread notifications`}
              onClick={() => setShowNotifications(v => !v)}>
              <span aria-hidden="true">◔</span>
              {unreadCount > 0 && (
                <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </button>
            {showNotifications && (
              <div className="notif-panel">
                <div className="notif-panel-header">
                  <strong>Notifications</strong>
                  <button className="notif-panel-close" onClick={() => setShowNotifications(false)} aria-label="Close">×</button>
                </div>
                <div className="notif-panel-list">
                  {!notificationFeed ? (
                    <p className="notif-panel-empty">Loading…</p>
                  ) : notificationFeed.length === 0 ? (
                    <p className="notif-panel-empty">No notifications yet.</p>
                  ) : (
                    notificationFeed.map(n => (
                      <button
                        key={n.id}
                        className={`notif-item ${n.is_read ? '' : 'notif-item--unread'}`}
                        onClick={() => !n.is_read && markReadMutation.mutate(n.id)}
                      >
                        <span className="notif-item-title">{n.title}</span>
                        <span className="notif-item-message">{n.message}</span>
                        <span className="notif-item-date">{formatDate(n.created_at, 'MMM d, h:mm a')}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </header>
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
