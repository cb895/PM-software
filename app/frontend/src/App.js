import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/auth/LoginPage';
import Dashboard from './pages/dashboard/Dashboard';
import PurchaseOrdersPage from './pages/purchase-orders/PurchaseOrdersPage';
import SuppliersPage from './pages/suppliers/SuppliersPage';
import ConsumablesPage from './pages/consumables/ConsumablesPage';
import DailyLogsPage from './pages/daily-logs/DailyLogsPage';
import TasksPage from './pages/tasks/TasksPage';
import BudgetPage from './pages/budget/BudgetPage';
import KpiPage from './pages/kpi/KpiPage';
import ReportsPage  from './pages/reports/ReportsPage';
import AdminPage    from './pages/admin/AdminPage';
import HRPage       from './pages/hr/HRPage';
import ProjectsPage from './pages/projects/ProjectsPage';
import ProfilePage  from './pages/admin/ProfilePage';

function RequireAuth({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading"><span className="spinner" /></div>;
  if (!user)   return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="projects/*"        element={<ProjectsPage />} />
        <Route path="purchase-orders/*" element={<PurchaseOrdersPage />} />
        <Route path="suppliers/*"       element={<SuppliersPage />} />
        <Route path="consumables/*"     element={<ConsumablesPage />} />
        <Route path="daily-logs/*"      element={<DailyLogsPage />} />
        <Route path="tasks/*"           element={<TasksPage />} />
        <Route path="hr/*"              element={
          <RequireAuth roles={['ops_manager','ceo']}>
            <HRPage />
          </RequireAuth>
        } />
        <Route path="budget/*"          element={
          <RequireAuth roles={['ops_manager','ceo']}>
            <BudgetPage />
          </RequireAuth>
        } />
        <Route path="kpi/*"             element={
          <RequireAuth roles={['ops_manager','ceo']}>
            <KpiPage />
          </RequireAuth>
        } />
        <Route path="reports/*"         element={<ReportsPage />} />
        <Route path="profile"           element={<ProfilePage />} />
        <Route path="admin"             element={
          <RequireAuth roles={['ops_manager']}>
            <AdminPage />
          </RequireAuth>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
