import { AlertCircle, CheckCircle2, KeyRound, Loader2, Mail, MapPin, Phone, ShieldCheck, UserPlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { extractErrorMessage, safeJson, setAuthToken } from '../lib/api';
import {
  ensureFirebaseProfile,
  signInWithGooglePopup,
  signOutFirebase,
} from '../lib/firebase';
import type { AuthUser } from '../types';
import { Bible3DShowcase } from './Bible3DShowcase';

interface AuthViewProps {
  onAuthenticated: (user: AuthUser, enteredTab: 'user' | 'admin') => void;
}

type RoleTab = 'user' | 'admin';
type AuthMode = 'login' | 'register' | 'reset';

export function AuthView({ onAuthenticated }: AuthViewProps) {
  const [roleTab, setRoleTab] = useState<RoleTab>('user');
  const [mode, setMode] = useState<AuthMode>('login');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const usernameInputRef = useRef<HTMLInputElement>(null);
  const fullNameInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [popupNotice, setPopupNotice] = useState('');

  const handleGoogleSignIn = async () => {
    setError('');
    setSuccessMsg('');
    setPopupNotice('');
    setGoogleLoading(true);
    try {
      const { user: fbUser, idToken } = await signInWithGooglePopup();
      const { role } = await ensureFirebaseProfile(fbUser);

      if (roleTab === 'admin' && role !== 'admin') {
        await signOutFirebase();
        throw new Error(
          'Akkaawuntiin Google kun aangoo Admin hin qabu. Maaloo tab Barataa irratti seeni.'
        );
      }

      const res = await fetch('/api/auth/firebase', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ idToken, expectedRole: roleTab }),
      });

      const rawText = await res.text();
      const trimmed = rawText.trim();
      let data: { error?: string; token?: string; user?: AuthUser } | null = null;
      if (trimmed && !trimmed.startsWith('<')) {
        try {
          data = JSON.parse(trimmed) as { error?: string; token?: string; user?: AuthUser };
        } catch {
          data = null;
        }
      }

      if (!res.ok || !data?.token || !data?.user) {
        await signOutFirebase();
        throw new Error(
          extractErrorMessage(
            data?.error,
            'Google waliin seenuun hin danda’amne. Email fi Password keetiin Kutaa Barataa seeni.'
          )
        );
      }

      setAuthToken(data.token);
      onAuthenticated(
        data.user,
        (data as { effectiveTab?: 'admin' | 'user' }).effectiveTab ||
          (data.user.role === 'admin' ? 'admin' : 'user')
      );
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError('Foddaan seenumsa Google cufameera. Irra deebi’ii yaali ykn Email fi Password gadiitiin seeni.');
      } else if (code === 'auth/unauthorized-domain' || code === 'auth/popup-blocked') {
        setPopupNotice(
          roleTab === 'admin'
            ? 'Browseriin kee popup Google cufeera. Rakkoo tokko malee gadi bu’iitii Email Admin fi Password dhaan Kutaa Admin seeni.'
            : 'Browseriin kee popup Google cufeera. Rakkoo tokko malee gadi bu’iitii Email fi Password keetiin Kutaa Barataa seeni (ykn "Galmaa’i" tuquun Email haaraa uumi).'
        );
        setTimeout(() => usernameInputRef.current?.focus(), 60);
      } else {
        setError(extractErrorMessage(err, 'Google waliin seenuun hin milkoofne.'));
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const switchRole = (nextRole: RoleTab) => {
    setRoleTab(nextRole);
    setMode('login');
    setError('');
    setSuccessMsg('');
    setPopupNotice('');
    setPassword('');
    setConfirmPassword('');
  };

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError('');
    setSuccessMsg('');
    setPopupNotice('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setPopupNotice('');

    if (mode === 'reset') {
      if (password !== confirmPassword) {
        setError('Password haaraan lamaan wal hin fakkaatu.');
        return;
      }
      setLoading(true);
      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            newPassword: password,
            expectedRole: roleTab,
          }),
        });
        const data = await safeJson<{ error?: string; message?: string }>(res);
        if (!res.ok) {
          throw new Error(extractErrorMessage(data.error, 'Password haaromsuun hin danda’amne.'));
        }
        setSuccessMsg(data.message || 'Password milkaa’inaan haaromfameera.');
        setMode('login');
        setPassword('');
        setConfirmPassword('');
      } catch (err) {
        setError(extractErrorMessage(err, 'Dogoggorri uumameera.'));
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === 'register') {
      setLoading(true);
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName,
            email,
            username: username.trim() || undefined,
            password,
          }),
        });
        const data = await safeJson<{ error?: string; token?: string; user?: AuthUser }>(res);
        if (!res.ok || !data.token || !data.user) {
          throw new Error(extractErrorMessage(data.error, 'Galmaa’uun hin danda’amne.'));
        }
        setAuthToken(data.token);
        onAuthenticated(data.user, 'user');
      } catch (err) {
        setError(extractErrorMessage(err, 'Dogoggorri uumameera.'));
      } finally {
        setLoading(false);
      }
      return;
    }

    // Login mode
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          username,
          password,
          expectedRole: roleTab,
        }),
      });
      const data = await safeJson<{
        error?: string;
        token?: string;
        user?: AuthUser;
        needsRegistration?: boolean;
      }>(res);
      if (res.status === 404 && data.needsRegistration && roleTab === 'user') {
        const typedEmail = username.trim();
        setEmail(typedEmail);
        setUsername('');
        setMode('register');
        setError('');
        setSuccessMsg(
          `Email "${typedEmail}" haaraadha! Maqaa Guutuu kee asitti galchiitii "Galmaa’ii Kutaa Barataa Seeni" tuqi.`
        );
        setTimeout(() => fullNameInputRef.current?.focus(), 60);
        return;
      }
      if (!res.ok || !data.token || !data.user) {
        throw new Error(extractErrorMessage(data.error, 'Seenuun hin danda’amne.'));
      }
      setAuthToken(data.token);
      onAuthenticated(data.user, roleTab);
    } catch (err) {
      setError(extractErrorMessage(err, 'Dogoggorri uumameera.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6 lg:p-10">
      <div className="w-full max-w-5xl sanctuary-card rounded-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch animate-enter">
        {/* Left Interactive 3D Lapis Sanctuary Panel */}
        <div className="lg:col-span-5 relative bg-gradient-to-b from-[#17365d] via-[#122b49] to-[#0b192b] text-white flex flex-col justify-between min-h-[340px] p-7 sm:p-9 overflow-hidden">
          <div className="relative z-10 flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl overflow-hidden border-2 border-[#d4a24c] border-b-3 bg-[#0e2139] shadow-md shrink-0">
              <img
                src="/assets/aistudio/image_27ab89bd.png"
                alt="Qajeelcha Macaafaa Qulqulluu Logo"
                className="w-full h-full object-cover object-top"
              />
            </span>
            <div className="brand-3d-viewport flex-1 min-w-0 py-1 px-2.5 rounded-xl bg-[#0a1728]/65 border border-[#d4a24c]/35">
              <div className="brand-3d-marquee font-editorial text-base sm:text-lg font-extrabold text-3d-brand-sculpture-light">
                <span>Qajeelcha Macaafaa Qulqulluu</span>
                <span aria-hidden="true" className="text-[#d4a24c]">✦</span>
                <span aria-hidden="true">Qajeelcha Macaafaa Qulqulluu</span>
                <span aria-hidden="true" className="text-[#d4a24c]">✦</span>
              </div>
            </div>
          </div>

          {/* Interactive 3D Open Bible Stage */}
          <div className="relative z-10 mt-4 mb-2 h-52 sm:h-56 rounded-2xl border border-white/15 bg-[#0a1728]/55 shadow-inner overflow-hidden">
            <Bible3DShowcase variant="auth" />
          </div>

          {/* Brand Logo + Contact Strip directly under 3D ("3D jala") */}
          <div className="relative z-10 mb-4 p-3 rounded-xl bg-[#0a1728]/70 border border-white/15 flex items-center gap-3">
            <img
              src="/assets/aistudio/image_27ab89bd.png"
              alt="Daniel Biranu — Qajeelcha Macaafaa Qulqulluu"
              className="w-11 h-11 rounded-xl object-cover object-top border-2 border-[#d4a24c] shadow-md shrink-0"
            />
            <div className="min-w-0 text-[11px] leading-snug space-y-0.5">
              <p className="font-semibold text-[#f5d08a] truncate">
                Daniel Biranu · Qajeelcha Macaafaa Qulqulluu
              </p>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-zinc-200">
                <a
                  href="mailto:danielbiranu.23@gmail.com"
                  className="inline-flex items-center gap-1 hover:text-[#f5d08a] transition-colors truncate"
                >
                  <Mail className="w-3 h-3 text-[#f5d08a] shrink-0" aria-hidden="true" />
                  <span>danielbiranu.23@gmail.com</span>
                </a>
                <a
                  href="tel:+251932387559"
                  className="inline-flex items-center gap-1 hover:text-[#f5d08a] transition-colors"
                >
                  <Phone className="w-3 h-3 text-[#f5d08a] shrink-0" aria-hidden="true" />
                  <span>+251932387559</span>
                </a>
              </div>
              <p className="inline-flex items-center gap-1 text-zinc-300">
                <MapPin className="w-3 h-3 text-[#f5d08a] shrink-0" aria-hidden="true" />
                <span>Bale, Oromia</span>
              </p>
            </div>
          </div>

          <div className="relative z-10 space-y-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#f5d08a] font-semibold">
              Giddugala Barnoota Macaafa Qulqulluu · 3D
            </p>
            <h1 className="font-editorial text-2xl sm:text-3xl font-bold leading-snug text-balance text-white text-3d-light">
              Macaafa Qulqulluu fi Sagalee Waaqayyoo
            </h1>
            <div className="pt-3 border-t border-white/20 space-y-2">
              <p className="text-xs sm:text-sm text-zinc-100/95 leading-relaxed">
                “Ani isinittan hima, Eenyu illee namoota duratti Eenyu akkan ta&apos;e dhugaa ba&apos;ee yoo mul&apos;ise, anis ilmi namaa ergamoota Waaqayyoo duratti akkasuma dhugaa nan ba&apos;aaf.” — <span className="font-mono text-xs text-[#f5d08a]">Luq 12:8</span>
              </p>
              <p className="text-[11px] text-zinc-300">
                © 2026 Daniel Biranu. Mirgi hundi eegamaadha!
              </p>
            </div>
          </div>
        </div>

        {/* Right Form Panel */}
        <div className="lg:col-span-7 p-6 sm:p-10 lg:p-12 flex flex-col justify-center space-y-6 bg-white">
          {/* Role Switcher */}
          <div className="tray-3d flex items-center gap-1.5 p-1.5 rounded-xl w-full">
            <button
              type="button"
              onClick={() => switchRole('user')}
              className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-all cursor-pointer ${
                roleTab === 'user'
                  ? 'tab-3d-active text-[#142d4c] font-semibold'
                  : 'text-[#52504b] hover:text-[#171614]'
              }`}
            >
              Barataa (User Login)
            </button>
            <button
              type="button"
              onClick={() => switchRole('admin')}
              className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-all cursor-pointer ${
                roleTab === 'admin'
                  ? 'tab-3d-active text-[#142d4c] font-semibold'
                  : 'text-[#52504b] hover:text-[#171614]'
              }`}
            >
              Admin (Admin Login)
            </button>
          </div>

          {/* Student Email Mode Tabs (Seeni vs Email dhaan Galmaa'i) */}
          {roleTab === 'user' && mode !== 'reset' && (
            <div className="flex items-center gap-2 border-b border-[#e4e0d8] pb-3">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  mode === 'login'
                    ? 'bg-[#142d4c] text-white shadow-sm'
                    : 'bg-[#f4f1ea] text-[#52504b] hover:text-[#171614]'
                }`}
              >
                Email dhaan Seeni
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  mode === 'register'
                    ? 'bg-[#142d4c] text-white shadow-sm'
                    : 'bg-[#f4f1ea] text-[#52504b] hover:text-[#171614]'
                }`}
              >
                Email Haaraan Galmaa’i
              </button>
            </div>
          )}

          {/* Heading */}
          <div className="space-y-1.5">
            <h2 className="font-editorial text-2xl sm:text-[28px] font-bold text-[#171614] text-3d-display tracking-tight">
              {mode === 'login' &&
                (roleTab === 'admin' ? 'Admin Settings Seeni' : 'Kutaa Barataa Seeni')}
              {mode === 'register' && 'Email dhaan Kutaa Barataa Seeni'}
              {mode === 'reset' &&
                (roleTab === 'admin'
                  ? 'Password Admin Haaromsi (Reset)'
                  : 'Password Barataa Haaromsi (Reset)')}
            </h2>
            <p className="text-sm text-[#52504b] leading-relaxed">
              {mode === 'login' &&
                (roleTab === 'admin'
                  ? 'Password Admin fi Username galchuun Kutaa Admin seeni.'
                  : 'Email keessan fi Password galchuun kallattiin Kutaa Barataa seeni. Yoo email haaraa ta’e ofumaan si galmeessa.')}
              {mode === 'register' &&
                'Maqaa guutuu, Email keessan, fi Password galchuun kallattiin Kutaa Barataa seeni.'}
              {mode === 'reset' &&
                'Yoo password dagatte, Email keessan ykn maqaa dura galchite galchuun password haaraa kenni.'}
            </p>
          </div>

          {successMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {popupNotice && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-950 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>{popupNotice}</span>
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {mode !== 'reset' && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading || googleLoading}
                className="btn-3d-secondary w-full inline-flex items-center justify-center gap-2.5 py-2.5 px-4 text-sm font-medium text-[#171614] rounded-xl cursor-pointer disabled:opacity-50"
              >
                {googleLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#142d4c]" />
                ) : (
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                    />
                  </svg>
                )}
                <span>Google Waliin Seeni (Popup)</span>
              </button>

              <div className="relative flex items-center py-0.5">
                <div className="flex-grow border-t border-[#e4e0d8]" />
                <span className="flex-shrink mx-3 text-[11px] uppercase tracking-wider text-[#76736c]">
                  ykn Email fi Password dhaan
                </span>
                <div className="flex-grow border-t border-[#e4e0d8]" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && roleTab === 'user' && (
              <>
                <div className="space-y-1.5">
                  <label htmlFor="auth-fullname" className="block text-xs font-medium text-[#52504b]">
                    Maqaa Guutuu (Full Name)
                  </label>
                  <input
                    ref={fullNameInputRef}
                    id="auth-fullname"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Fkn: Caalaa Biraanuu"
                    className="input-3d w-full px-3.5 py-2.5 text-sm rounded-xl focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="auth-email" className="block text-xs font-medium text-[#52504b]">
                    Email Barataa (Email Address)
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="fkn: caalaa@gmail.com"
                    className="input-3d w-full px-3.5 py-2.5 text-sm rounded-xl focus:outline-none"
                  />
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <label htmlFor="auth-username" className="block text-xs font-medium text-[#52504b]">
                {mode === 'register'
                  ? 'Maqaa Fayyadamaa (Username - dirqama miti)'
                  : roleTab === 'admin'
                    ? 'Email Admin ykn Username'
                    : mode === 'reset'
                      ? 'Email ykn Maqaa Dura Galchite'
                      : 'Email Barataa ykn Username'}
              </label>
              <input
                ref={usernameInputRef}
                id="auth-username"
                type="text"
                autoComplete="email"
                inputMode="email"
                required={mode !== 'register'}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={
                  mode === 'register'
                    ? 'Duwwaa dhiisuu dandeessa (email irraa uuma)'
                    : roleTab === 'admin'
                      ? 'fkn: admin@gmail.com ykn admin'
                      : 'fkn: maqaa@gmail.com'
                }
                className="input-3d w-full px-3.5 py-2.5 text-sm rounded-xl focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="auth-password" className="block text-xs font-medium text-[#52504b]">
                {mode === 'reset' ? 'Password Haaraa (New Password)' : 'Password'}
              </label>
              <input
                id="auth-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input-3d w-full px-3.5 py-2.5 text-sm rounded-xl focus:outline-none"
              />
            </div>

            {mode === 'reset' && (
              <div className="space-y-1.5">
                <label htmlFor="auth-confirm-password" className="block text-xs font-medium text-[#52504b]">
                  Password Haaraa Mirkaneessi (Confirm New Password)
                </label>
                <input
                  id="auth-confirm-password"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-3d w-full px-3.5 py-2.5 text-sm rounded-xl focus:outline-none"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-3d-primary w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-medium rounded-xl cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mode === 'register' ? (
                <UserPlus className="w-4 h-4" />
              ) : mode === 'reset' ? (
                <KeyRound className="w-4 h-4" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              <span>
                {mode === 'login' &&
                  (roleTab === 'admin' ? 'Admin Settings Seeni' : 'Kutaa Barataa Seeni')}
                {mode === 'register' && 'Galmaa’ii Kutaa Barataa Seeni'}
                {mode === 'reset' && 'Password Haaromsi'}
              </span>
            </button>
          </form>

          {/* Footer helper actions */}
          <div className="pt-3 border-t border-[#e4e0d8] flex flex-wrap items-center justify-between gap-3 text-xs">
            {mode !== 'reset' ? (
              <button
                type="button"
                onClick={() => switchMode('reset')}
                className="text-[#142d4c] font-medium hover:underline cursor-pointer"
              >
                Password dagadheera? (Email / Maqaadhaan reset godhi)
              </button>
            ) : (
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-[#142d4c] font-medium hover:underline cursor-pointer"
              >
                Gara seenumsaatti (Login) deebi’i
              </button>
            )}

            {roleTab === 'user' && mode !== 'register' && (
              <button
                type="button"
                onClick={() => switchMode('register')}
                className="text-[#52504b] font-medium hover:text-[#171614] hover:underline cursor-pointer"
              >
                Akkaawuntii haaraa uumi (Galmaa’i)
              </button>
            )}

            {roleTab === 'user' && mode === 'register' && (
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-[#52504b] font-medium hover:text-[#171614] hover:underline cursor-pointer"
              >
                Dura galmoofteettaa? Seeni
              </button>
            )}
          </div>

          {/* Scripture verse — 3D Recessed Quote */}
          <div className="sanctuary-subsurface py-3.5 px-4 rounded-xl text-sm font-editorial italic text-[#171614] text-center">
            “Yesuus karaadha, dhugaadha, jireenya” — <span className="not-italic font-mono text-xs text-[#9a6b16] font-semibold">Yohn 14:6</span>
          </div>
        </div>
      </div>
    </div>
  );
}
