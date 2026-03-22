"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CandlestickChart,
  ListOrdered,
  Brain,
  Bot,
  Settings,
  Sun,
  Moon,
  LogOut,
} from "lucide-react";
import { useTheme } from "@/lib/hooks/useTheme";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "ダッシュボード", icon: LayoutDashboard },
  { href: "/chart", label: "MTFチャート", icon: CandlestickChart },
  { href: "/auto-trade", label: "自動売買", icon: Bot },
  { href: "/trades", label: "取引履歴", icon: ListOrdered },
  { href: "/diagnosis", label: "AI診断", icon: Brain },
  { href: "/settings", label: "設定", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { isDarkMode, toggleTheme } = useTheme();
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden md:flex flex-col w-60 min-h-screen border-r transition-colors ${
          isDarkMode
            ? "bg-dark-bg border-gray-800"
            : "bg-white border-gray-200"
        }`}
      >
        {/* Logo */}
        <div
          className={`flex items-center gap-3 px-5 py-5 border-b ${
            isDarkMode ? "border-gray-800" : "border-gray-200"
          }`}
        >
          <Image src="/logo.png" alt="AATM" width={32} height={32} className="rounded-lg" />
          <span
            className={`text-lg font-extrabold tracking-wider ${
              isDarkMode ? "text-white" : "text-gray-900"
            }`}
          >
            AATM
          </span>
        </div>

        {/* Nav Links */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? isDarkMode
                      ? "bg-blue-600/20 text-blue-400"
                      : "bg-blue-50 text-blue-600"
                    : isDarkMode
                    ? "text-gray-400 hover:text-white hover:bg-white/5"
                    : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom actions */}
        <div
          className={`px-3 py-4 border-t space-y-2 ${
            isDarkMode ? "border-gray-800" : "border-gray-200"
          }`}
        >
          <button
            onClick={toggleTheme}
            className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isDarkMode
                ? "text-yellow-400 hover:bg-white/5"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            {isDarkMode ? "ライトモード" : "ダークモード"}
          </button>
          <button
            onClick={handleLogout}
            className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isDarkMode
                ? "text-gray-400 hover:text-red-400 hover:bg-white/5"
                : "text-gray-500 hover:text-red-600 hover:bg-gray-100"
            }`}
          >
            <LogOut size={18} />
            ログアウト
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Tab Bar */}
      <nav
        className={`md:hidden fixed bottom-0 left-0 right-0 z-50 border-t flex justify-around py-2 ${
          isDarkMode
            ? "bg-dark-bg border-gray-800"
            : "bg-white border-gray-200"
        }`}
      >
        {NAV_ITEMS.slice(0, 5).map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-medium transition-colors ${
                isActive
                  ? isDarkMode
                    ? "text-blue-400"
                    : "text-blue-600"
                  : isDarkMode
                  ? "text-gray-500"
                  : "text-gray-400"
              }`}
            >
              <Icon size={20} />
              {item.label}
            </Link>
          );
        })}
        {/* Theme toggle for mobile */}
        <button
          onClick={toggleTheme}
          className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-medium transition-colors ${
            isDarkMode
              ? "text-yellow-400"
              : "text-gray-400"
          }`}
        >
          {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
          {isDarkMode ? "ライト" : "ダーク"}
        </button>
      </nav>
    </>
  );
}
