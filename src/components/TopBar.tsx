import { LogOut, Menu, MessageSquarePlus, X } from 'lucide-react';
import { useState } from 'react';
import type { AuthUser } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

export type AppTab = 'dashboard' | 'bible' | 'chat' | 'library' | 'notes' | 'admin';

interface TopBarProps {
  user: AuthUser;
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  onNewChat: () => void;
  onLogout: () => void;
}

export function TopBar({ user, activeTab, onSelectTab, onNewChat, onLogout }: TopBarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems: Array<{ id: AppTab; label: string }> = [
    { id: 'dashboard', label: 'Kutaa Barataa' },
    { id: 'bible', label: 'Macaafa Qulqulluu' },
    { id: 'chat', label: 'Chatbot' },
    { id: 'library', label: 'Barnootawwan' },
    { id: 'notes', label: user.role === 'admin' ? 'Yaadannoo Admin' : 'Yaadannoo' },
    ...(user.role === 'admin' ? [{ id: 'admin' as AppTab, label: 'Admin Settings' }] : []),
  ];

  const handleNav = (tab: AppTab) => {
    onSelectTab(tab);
    setMobileOpen(false);
  };

  return (
    <header className="sticky top-0 z-30 bg-[#ffffff]/96 border-b-2 border-[#d9d2c4] shadow-[0_6px_18px_-8px_rgba(20,45,76,0.16)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element 3D moving brand wordmark */}
        <button
          type="button"
          onClick={() => handleNav('dashboard')}
          aria-label="Qajeelcha Macaafaa Qulqulluu"
          className="flex items-center gap-3 text-left whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#142d4c] rounded-lg cursor-pointer group"
        >
          <span className="w-10 h-10 rounded-xl overflow-hidden bg-[#142d4c] border-2 border-[#d4a24c] border-b-3 shadow-[0_4px_10px_-2px_rgba(14,33,57,0.42)] transition-transform duration-150 group-hover:-translate-y-0.5 shrink-0">
            <img
              src="/assets/aistudio/image_27ab89bd.png"
              alt="Qajeelcha Macaafaa Qulqulluu Logo"
              className="w-full h-full object-cover object-top"
            />
          </span>
          <span className="brand-3d-viewport w-[185px] sm:w-[245px] py-1 px-1.5 rounded-lg bg-gradient-to-b from-[#faf8f3] to-[#f1ede3] border border-[#e3dccf] shadow-inner">
            <span className="brand-3d-marquee font-editorial text-base sm:text-lg font-extrabold text-3d-brand-sculpture">
              <span>Qajeelcha Macaafaa Qulqulluu</span>
              <span aria-hidden="true" className="text-[#9a6b16]">✦</span>
              <span aria-hidden="true">Qajeelcha Macaafaa Qulqulluu</span>
              <span aria-hidden="true" className="text-[#9a6b16]">✦</span>
            </span>
          </span>
        </button>

        {/* Zone 2: Clean single-line navigation links */}
        <nav className="hidden lg:flex items-center gap-5" aria-label="Main navigation">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`relative py-5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#142d4c] ${
                  active
                    ? 'text-[#142d4c]'
                    : 'text-[#52504b] hover:text-[#171614]'
                }`}
              >
                {item.label}
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-0 bottom-0 h-[2px] rounded-full transition-opacity duration-150 ${
                    active ? 'bg-[#142d4c] opacity-100' : 'bg-[#9a6b16]/40 opacity-0 hover:opacity-100'
                  }`}
                />
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Primary 3D action + account sign-out */}
        <div className="flex items-center gap-2.5 shrink-0">
          <PWAInstallButton />
          <button
            type="button"
            onClick={() => {
              onNewChat();
              setMobileOpen(false);
            }}
            className="btn-3d-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#142d4c]"
          >
            <MessageSquarePlus className="w-4 h-4 text-[#f5e7c6]" aria-hidden="true" />
            <span>Marii Haaraa</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            title={`${user.fullName} (@${user.username}) — Ba'i`}
            className="btn-3d-secondary hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#52504b] hover:text-[#171614] rounded-xl whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span className="max-w-[96px] truncate">{user.username}</span>
            <LogOut className="w-3.5 h-3.5 text-[#76736c]" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="btn-3d-secondary lg:hidden p-2 text-[#52504b] hover:text-[#171614] rounded-xl"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile navigation drawer */}
      {mobileOpen && (
        <nav className="lg:hidden border-t border-[#e4e0d8] bg-white px-4 py-3 flex flex-col gap-1">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`w-full text-left px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active ? 'bg-[#142d4c]/8 text-[#142d4c]' : 'text-[#52504b] hover:bg-[#f7f6f2]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={onLogout}
            className="w-full text-left px-3.5 py-2.5 rounded-lg text-sm font-medium text-red-700 hover:bg-red-50 flex items-center justify-between mt-1 border-t border-[#e4e0d8] pt-3"
          >
            <span>Ba’i ({user.username})</span>
            <LogOut className="w-4 h-4" />
          </button>
        </nav>
      )}
    </header>
  );
}
