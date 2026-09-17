import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Button, Input } from '../../components/ui/UI';
import toast from 'react-hot-toast';
import './LoginPage.css';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async e => {
    e.preventDefault();
    if (!email || !password) { toast.error('Enter your email and password.'); return; }
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Incorrect email or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <span className="login-logo-mark">MT</span>
          <span className="login-logo-name">MetabolicTrack</span>
        </div>
        <h1 className="login-title">Sign in</h1>
        <p className="login-subtitle">Use your @metabolictrack.com email</p>

        <form onSubmit={handleSubmit} className="login-form" noValidate>
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="cb@metabolictrack.com"
            autoComplete="email"
            autoFocus
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
          <Button type="submit" variant="primary" size="lg" loading={loading} style={{ width: '100%', marginTop: '0.5rem' }}>
            Sign in
          </Button>
        </form>
      </div>

      {/* Ambient lab trace lines */}
      <div className="login-bg" aria-hidden="true">
        <div className="trace trace-1" />
        <div className="trace trace-2" />
        <div className="trace trace-3" />
      </div>
    </div>
  );
}
