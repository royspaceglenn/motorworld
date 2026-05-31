import React, { useEffect, useState } from 'react';
import { usersApi, systemApi, USE_FIRESTORE_ADMIN_DATA, type ApiUser } from '../lib/api/adminData';
import { getStoredActiveShopId } from '../lib/api/client';
import { SHOPS } from '../lib/shops';
import { UserPlus, Trash2, Users, KeyRound } from 'lucide-react';

const WIPE_ALL_BUSINESS_CONFIRM = 'DELETE_ALL_BUSINESS_DATA' as const;

export const ManageUsersView: React.FC = () => {
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [resetUser, setResetUser] = useState<ApiUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [clearShopId, setClearShopId] = useState(() => getStoredActiveShopId());
  const [clearBusy, setClearBusy] = useState(false);
  const [clearMsg, setClearMsg] = useState<string | null>(null);
  const [wipeAllPhrase, setWipeAllPhrase] = useState('');
  const [wipeAllBusy, setWipeAllBusy] = useState(false);
  const [wipeAllMsg, setWipeAllMsg] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    usersApi
      .list()
      .then((res) => setUsers(res.users))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!formEmail.trim() || !formPassword || !formDisplayName.trim()) {
      setFormError('Email, password, and display name required.');
      return;
    }
    setSubmitting(true);
    try {
      await usersApi.create(formEmail.trim(), formPassword, formDisplayName.trim());
      setFormEmail('');
      setFormPassword('');
      setFormDisplayName('');
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Remove this admin account? This cannot be undone.')) return;
    try {
      await usersApi.delete(id);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUser) return;
    setResetError(null);
    if (resetPassword.length < 8) {
      setResetError('Password must be at least 8 characters.');
      return;
    }
    if (resetPassword !== resetConfirm) {
      setResetError('Passwords do not match.');
      return;
    }
    setResetting(true);
    try {
      await usersApi.update(resetUser.id, { password: resetPassword });
      setResetUser(null);
      setResetPassword('');
      setResetConfirm('');
      load();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to reset password.');
    } finally {
      setResetting(false);
    }
  };

  const accounts = users;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Manage Admin Accounts</h2>
          <p className="mt-1 text-sm text-slate-600">
            Each person can have their own account. Administrators can reset another user&apos;s password here;
            everyone can change their own password from the sidebar.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm font-medium"
        >
          <UserPlus className="w-4 h-4" />
          Add Admin
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-800">New Admin</h3>
          {formError && (
            <p className="text-sm text-red-600">{formError}</p>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={formEmail}
              onChange={(e) => setFormEmail(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500"
              placeholder="admin@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              type="password"
              value={formPassword}
              onChange={(e) => setFormPassword(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Display Name</label>
            <input
              type="text"
              value={formDisplayName}
              onChange={(e) => setFormDisplayName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. Admin Isulan"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center gap-2 text-slate-600">
          <Users className="w-5 h-5" />
          <span className="font-medium">Accounts</span>
        </div>
        {loading ? (
          <p className="p-6 text-slate-500">Loading...</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {accounts.map((u) => (
              <li key={u.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-slate-800">{u.displayName}</p>
                  <p className="text-sm text-slate-500">{u.email}</p>
                  <span className="mt-1 inline-flex rounded px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700">
                    Administrator
                  </span>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setResetUser(u);
                      setResetPassword('');
                      setResetConfirm('');
                      setResetError(null);
                    }}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    title="Set new password"
                  >
                    <KeyRound className="h-4 w-4" />
                    Set password
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(u.id)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    title="Delete account"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
            {accounts.length === 0 && (
              <li className="p-8 text-center text-slate-400">No accounts yet.</li>
            )}
          </ul>
        )}
      </div>

      {!USE_FIRESTORE_ADMIN_DATA && (
        <div className="mt-8 rounded-xl border border-red-200 bg-red-50/60 p-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-red-900">Danger zone — clear one store</h3>
          <p className="mt-2 text-sm text-red-800/90">
            Removes inventory, transactions, customers, vehicles, receivables, document archives, and related data for the
            selected store. <strong>User accounts are kept.</strong> This cannot be undone.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase text-red-900/80">Store to clear</label>
              <select
                className="mt-1 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-slate-900"
                value={clearShopId}
                onChange={(e) => setClearShopId(e.target.value)}
              >
                {SHOPS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              disabled={clearBusy}
              onClick={async () => {
                const label = SHOPS.find((s) => s.id === clearShopId)?.shortLabel ?? clearShopId;
                if (
                  !window.confirm(
                    `Permanently delete ALL business data for "${label}"?\n\nType mentally: this cannot be undone.`
                  )
                ) {
                  return;
                }
                setClearBusy(true);
                setClearMsg(null);
                try {
                  const res = await systemApi.clearStoreData(clearShopId);
                  setClearMsg(`Cleared ${res.collectionsRemoved} data bucket(s). Reloading…`);
                  window.setTimeout(() => window.location.reload(), 800);
                } catch (e) {
                  setClearMsg(e instanceof Error ? e.message : 'Clear failed.');
                } finally {
                  setClearBusy(false);
                }
              }}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {clearBusy ? 'Clearing…' : 'Clear selected store'}
            </button>
          </div>
          {clearMsg && <p className="mt-3 text-sm text-red-900">{clearMsg}</p>}
        </div>
      )}

      {!USE_FIRESTORE_ADMIN_DATA && (
        <div className="mt-6 rounded-xl border border-red-900/40 bg-red-950/10 p-6 ring-1 ring-red-900/20">
          <h3 className="text-sm font-bold uppercase tracking-wide text-red-950">
            Danger zone — wipe all inventory and business data
          </h3>
          <p className="mt-2 text-sm text-red-900/95">
            Deletes <strong>everything</strong> for <strong>all stores</strong> (Motor World and ECFP), including any
            legacy unprefixed data: items, stock, transactions, customers, vehicles, expenses, receivables, document
            archives, activity logs, and notifications. <strong>Administrator accounts are kept.</strong> This cannot be
            undone.
          </p>
          <div className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-semibold uppercase text-red-950/90">
                Type exactly: {WIPE_ALL_BUSINESS_CONFIRM}
              </label>
              <input
                type="text"
                className="mt-1 w-full max-w-xl rounded-lg border border-red-400 bg-white px-3 py-2 font-mono text-sm text-slate-900"
                value={wipeAllPhrase}
                onChange={(e) => setWipeAllPhrase(e.target.value)}
                placeholder={WIPE_ALL_BUSINESS_CONFIRM}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <button
              type="button"
              disabled={wipeAllBusy || wipeAllPhrase !== WIPE_ALL_BUSINESS_CONFIRM}
              onClick={async () => {
                if (
                  !window.confirm(
                    'FINAL WARNING: This will permanently delete ALL business data for every store.\n\nAdministrator logins will remain.\n\nContinue?'
                  )
                ) {
                  return;
                }
                setWipeAllBusy(true);
                setWipeAllMsg(null);
                try {
                  const res = await systemApi.clearAllBusinessData(WIPE_ALL_BUSINESS_CONFIRM);
                  const n = res.removed;
                  setWipeAllMsg(
                    n >= 0
                      ? `Removed ${n} data bucket(s). Reloading…`
                      : `Wipe completed (${res.mode}). Reloading…`
                  );
                  window.setTimeout(() => window.location.reload(), 900);
                } catch (e) {
                  setWipeAllMsg(e instanceof Error ? e.message : 'Wipe failed.');
                } finally {
                  setWipeAllBusy(false);
                }
              }}
              className="rounded-lg bg-red-950 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-40"
            >
              {wipeAllBusy ? 'Wiping…' : 'Wipe all business data now'}
            </button>
          </div>
          {wipeAllMsg && <p className="mt-3 text-sm text-red-950">{wipeAllMsg}</p>}
        </div>
      )}

      {resetUser && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={handlePasswordReset}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <h3 className="font-semibold text-slate-900">Set password for {resetUser.displayName}</h3>
            <p className="mt-1 text-sm text-slate-600">{resetUser.email}</p>
            {resetError && <p className="mt-3 text-sm text-red-600">{resetError}</p>}
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">New password</label>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Confirm</label>
                <input
                  type="password"
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                  autoComplete="new-password"
                />
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                type="submit"
                disabled={resetting}
                className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {resetting ? 'Saving…' : 'Save password'}
              </button>
              <button
                type="button"
                onClick={() => setResetUser(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
