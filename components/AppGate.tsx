import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth/AuthContext';
import { Login } from './Login';
import App from '../App';
import { USE_FIRESTORE_ADMIN_DATA } from '../lib/api/adminData';
import { PublicLanding } from './PublicLanding';
import { isOperationsAppPath } from '../lib/opsPath';

function subscribePath(cb: () => void) {
  window.addEventListener('popstate', cb);
  window.addEventListener('hashchange', cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener('hashchange', cb);
  };
}

/**
 * Firebase: email/password via Firebase Auth.
 * REST API: JWT login — no valid session shows the sign-in screen (API must allow `/api/auth/login`).
 * Public marketing site at `/`; staff app at `/aiosystem` (see `lib/opsPath.ts`).
 */
export const AppGate: React.FC = () => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [, setPathRev] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    return subscribePath(() => setPathRev((n) => n + 1));
  }, []);

  if (typeof window !== 'undefined' && !isOperationsAppPath()) {
    return <PublicLanding />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <p className="text-slate-500">Loading...</p>
      </div>
    );
  }

  if (USE_FIRESTORE_ADMIN_DATA) {
    return isAuthenticated ? <App /> : <Login />;
  }

  if (!user) {
    return <Login />;
  }

  return <App />;
};
