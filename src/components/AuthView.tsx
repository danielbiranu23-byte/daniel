import { AlertCircle, BookOpen, CheckCircle2, KeyRound, Loader2, ShieldCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';
import authHeroImg from '../assets/images/bible_god_light_1794765010352.jpg';
import { extractErrorMessage, safeJson, setAuthToken } from '../lib/api';
import {
  ensureFirebaseProfile,
  signInWithGooglePopup,
  signOutFirebase,
} from '../lib/firebase';
import type { AuthUser } from '../types';

interface AuthViewProps {
  onAuthenticated: (user: AuthUser, enteredTab: 'user' | 'admin') => void;
}

type RoleTab = 'user' | 'admin';
type AuthMode = 'login' | 'register' | 'reset';

export function AuthView({ onAuthenticated }: AuthViewProps) {
  const [roleTab, setRoleTab] = useState<RoleTab>('user');
  const [mode, setMode] = useState<AuthMode>('login');

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [imgFailed, setImgFailed] = useState(false);

  const handleGoogleSignIn = async () => {
    setError('');
    setSuccessMsg('');
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

      if (data && !res.ok) {
        await signOutFirebase();
        throw new Error(extractErrorMessage(data.error, 'Google waliin seenuun hin danda’amne.'));
      }

      if (res.ok && data?.token && data?.user) {
        setAuthToken(data.token);
        onAuthenticated(data.user, roleTab);
        return;
      }

      // Firebase Auth + Firestore profile already verified this user cleanly
      const fallbackUser: AuthUser = {
        id: fbUser.uid,
        username: (fbUser.email || fbUser.uid).split('@')[0],
        fullName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Fayyadamaa Google',
        role,
        createdAt: new Date().toISOString(),
      };
      onAuthenticated(fallbackUser, roleTab);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError('Foddaan seenumsa Google cufameera. Irra deebi’ii yaali.');
      } else if (code === 'auth/unauthorized-domain') {
        setError(
          'Domain haaraan kun Firebase Console (Authentication → Settings → Authorized domains) keessatti dabalamuu qaba; yookiin username fi password dhaan seeni.'
        );
      } else if (code === 'auth/popup-blocked') {
        setError(
          'Browseriin kee popup Google cufeera. Maaloo popup hayyami ykn username fi password dhaan seeni.'
        );
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
    setPassword('');
    setConfirmPassword('');
  };

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError('');
    setSuccessMsg('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

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
          body: JSON.stringify({ fullName, username, password }),
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
      const data = await safeJson<{ error?: string; token?: string; user?: AuthUser }>(res);
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
    <div className="min-h-screen bg-[#f7f6f2] flex items-center justify-center p-4 sm:p-6 lg:p-10">
      <div className="w-full max-w-5xl sanctuary-card rounded-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch animate-enter">
        {/* Left Editorial Panel */}
        <div className="lg:col-span-5 relative bg-[#142d4c] text-white flex flex-col justify-between min-h-[280px]">
          {!imgFailed && (
            <img
              src={authHeroImg}
              alt="Macaafa Qulqulluu ifa Waaqayyoo keessatti baname"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
          <div className="relative z-10 p-7 sm:p-10 flex flex-col justify-between h-full bg-gradient-to-t from-[#0b192b]/95 via-[#142d4c]/65 to-[#0b192b]/40">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-white/12 border border-white/20 backdrop-blur-sm flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-[#f5d08a]" aria-hidden="true" />
              </span>
              <span className="font-editorial text-lg font-semibold tracking-tight text-white">
                Qajeelcha Macaafaa
              </span>
            </div>

            <div className="space-y-4 py-8 lg:py-0">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#f5d08a] font-medium">
                Giddugala Barnoota Macaafa Qulqulluu
              </p>
              <h1 className="font-editorial text-2xl sm:text-3xl font-semibold leading-snug text-balance text-white">
                Macaafa Qulqulluu fi Sagalee Waaqayyoo
              </h1>
              <div className="pt-3 border-t border-white/20">
                <p className="text-sm text-zinc-100/95 leading-relaxed">
                  “Ani isinittan hima, Eenyu illee namoota duratti Eenyu akkan ta&apos;e dhugaa ba&apos;ee yoo mul&apos;ise, anis ilmi namaa ergamoota Waaqayyoo duratti akkasuma dhugaa nan ba&apos;aaf.” — <span className="font-mono text-xs text-[#f5d08a]">Luq 12:8</span>
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-200/80 tracking-wide">
              Sagalee Waaqayyoo · Macaafa Qulqulluu
            </p>
          </div>
        </div>

        {/* Right Form Panel */}
        <div className="lg:col-span-7 p-6 sm:p-10 lg:p-12 flex flex-col justify-center space-y-6 bg-white">
          {/* Role Switcher */}
          <div className="flex items-center gap-1 p-1 bg-[#f2efe9] border border-[#e4e0d8] rounded-xl w-full">
            <button
              type="button"
              onClick={() => switchRole('user')}
              className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-all cursor-pointer ${
                roleTab === 'user'
                  ? 'bg-white text-[#142d4c] shadow-xs'
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
                  ? 'bg-white text-[#142d4c] shadow-xs'
                  : 'text-[#52504b] hover:text-[#171614]'
              }`}
            >
              Admin (Admin Login)
            </button>
          </div>

          {/* Heading */}
          <div className="space-y-1.5">
            <h2 className="font-editorial text-2xl sm:text-[26px] font-semibold text-[#171614] tracking-tight">
              {mode === 'login' &&
                (roleTab === 'admin' ? 'Admin Settings Seeni' : 'Kutaa Barataa Seeni')}
              {mode === 'register' && 'Akkaawuntii Barataa Haaraa Uumi'}
              {mode === 'reset' &&
                (roleTab === 'admin'
                  ? 'Password Admin Haaromsi (Reset)'
                  : 'Password Barataa Haaromsi (Reset)')}
            </h2>
            <p className="text-sm text-[#52504b] leading-relaxed">
              {mode === 'login' &&
                (roleTab === 'admin'
                  ? 'Maqaa Admin fi Password galchuun faayiloota barnootaa fi qindaa’ina bulchi.'
                  : 'Maqaa fayyadamaa (barataa ykn Admin) fi Password keetiin seenuun barnoota kee itti fufi.')}
              {mode === 'register' &&
                'Maqaa guutuu, maqaa fayyadamaa (username), fi password galchuun galmaa’i.'}
              {mode === 'reset' &&
                'Yoo password dagatte, maqaa fayyadamaa dura ittiin galmoofte galchuun password haaraa kenni.'}
            </p>
          </div>

          {successMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
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
                className="w-full inline-flex items-center justify-center gap-2.5 py-2.5 px-4 text-sm font-medium text-[#171614] bg-white border border-[#e4e0d8] rounded-lg hover:bg-[#f7f6f2] shadow-xs transition-colors cursor-pointer disabled:opacity-50"
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
                <span>Google Waliin Seeni (Firebase Cloud)</span>
              </button>

              <div className="relative flex items-center py-0.5">
                <div className="flex-grow border-t border-[#e4e0d8]" />
                <span className="flex-shrink mx-3 text-[11px] uppercase tracking-wider text-[#76736c]">
                  ykn username dhaan
                </span>
                <div className="flex-grow border-t border-[#e4e0d8]" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && roleTab === 'user' && (
              <div className="space-y-1.5">
                <label htmlFor="auth-fullname" className="block text-xs font-medium text-[#52504b]">
                  Maqaa Guutuu (Full Name)
                </label>
                <input
                  id="auth-fullname"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Fkn: Caalaa Biraanuu"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#f7f6f2] border border-[#e4e0d8] rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#142d4c] transition-colors"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="auth-username" className="block text-xs font-medium text-[#52504b]">
                {roleTab === 'admin'
                  ? 'Maqaa Admin (Admin Username)'
                  : mode === 'reset'
                    ? 'Maqaa Fayyadamaa Dura Galchite (Registered Username)'
                    : 'Maqaa Fayyadamaa (Username)'}
              </label>
              <input
                id="auth-username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={roleTab === 'admin' ? 'Maqaa Admin galchi' : 'Maqaa fayyadamaa galchi'}
                className="w-full px-3.5 py-2.5 text-sm bg-[#f7f6f2] border border-[#e4e0d8] rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#142d4c] transition-colors"
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
                className="w-full px-3.5 py-2.5 text-sm bg-[#f7f6f2] border border-[#e4e0d8] rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#142d4c] transition-colors"
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
                  className="w-full px-3.5 py-2.5 text-sm bg-[#f7f6f2] border border-[#e4e0d8] rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#142d4c] transition-colors"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-medium text-white bg-[#142d4c] rounded-lg hover:bg-[#0e2139] shadow-xs transition-colors cursor-pointer disabled:opacity-50"
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
                {mode === 'login' && 'Seeni (Login)'}
                {mode === 'register' && 'Galmaa’ii Seeni'}
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
                Password dagadheera? (Maqaadhaan reset godhi)
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

          {/* Scripture verse — Editorial Pull Quote */}
          <div className="py-3.5 px-4 border-y border-[#e4e0d8] bg-[#f7f6f2]/70 text-sm font-editorial italic text-[#171614] text-center">
            “Yesuus karaadha, dhugaadha, jireenya” — <span className="not-italic font-mono text-xs text-[#9a6b16] font-medium">Yohn 14:6</span>
          </div>
        </div>
      </div>
    </div>
  );
}
