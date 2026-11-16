import { BookOpen, LogOut, Menu, MessageSquarePlus, X } from 'lucide-react';
import { useState } from 'react';
import type { AuthUser } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

export type AppTab = 'dashboard' | 'bible' | 'chat' | 'library' | 'admin';

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
    ...(user.role === 'admin' ? [{ id: 'admin' as AppTab, label: 'Admin Settings' }] : []),
  ];

  const handleNav = (tab: AppTab) => {
    onSelectTab(tab);
    setMobileOpen(false);
  };

  return (
    <header className="sticky top-0 z-30 bg-white/92 backdrop-blur-md border-b border-[#e4e0d8]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element brand wordmark */}
        <button
          type="button"
          onClick={() => handleNav('dashboard')}
          className="flex items-center gap-3 text-left whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#142d4c] rounded-lg cursor-pointer group"
        >
          <span className="w-8 h-8 rounded-lg bg-[#142d4c] text-[#f5e7c6] flex items-center justify-center shadow-xs transition-transform duration-150 group-hover:scale-[1.03]">
            <BookOpen className="w-4 h-4" aria-hidden="true" />
          </span>
          <span className="font-editorial text-lg font-semibold tracking-tight text-[#171614]">
            Qajeelcha Macaafaa
          </span>
        </button>

        {/* Zone 2: Clean single-line navigation links */}
        <nav className="hidden md:flex items-center gap-7" aria-label="Main navigation">
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

        {/* Zone 3: Primary action + account sign-out */}
        <div className="flex items-center gap-2.5 shrink-0">
          <PWAInstallButton />
          <button
            type="button"
            onClick={() => {
              onNewChat();
              setMobileOpen(false);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#142d4c] rounded-lg hover:bg-[#0e2139] shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#142d4c]"
          >
            <MessageSquarePlus className="w-4 h-4 text-[#f5e7c6]" aria-hidden="true" />
            <span>Marii Haaraa</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            title={`${user.fullName} (@${user.username}) — Ba'i`}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#52504b] bg-[#f7f6f2] border border-[#e4e0d8] rounded-lg hover:bg-[#f2efe9] hover:text-[#171614] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span className="max-w-[96px] truncate">{user.username}</span>
            <LogOut className="w-3.5 h-3.5 text-[#76736c]" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="md:hidden p-2 text-[#52504b] hover:text-[#171614] rounded-lg border border-[#e4e0d8] bg-[#f7f6f2]"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile navigation drawer */}
      {mobileOpen && (
        <nav className="md:hidden border-t border-[#e4e0d8] bg-white px-4 py-3 flex flex-col gap-1">
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
