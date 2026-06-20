import { useEffect, useState } from "react";
import { LuBan } from "react-icons/lu";
import { Button as AntdButton } from "antd";

import Card from "@components/Card";
import { DEVICE_API } from "@/ui.config";

import api from "../api";

interface BannedIP {
  ip: string;
  bannedAt: string;
}

// 被封禁 IP（封禁规则见后端 ratelimit.go：同一 IP 密码失败 2 次即永久封禁、重启清空）。
// 端点 /auth/banned 为公开端点（登录页也用它），登录后操作页同样可直接拉取。
const fmtTime = (s: string) => {
  const d = new Date(s);
  return isNaN(d.getTime())
    ? s
    : d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
};

export default function BannedIPsButton() {
  const [open, setOpen] = useState(false);
  const [banned, setBanned] = useState<BannedIP[]>([]);

  // 仅在弹窗打开时拉取并每 5 秒刷新，关闭即停。
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => {
      api
        .GET(`${DEVICE_API}/auth/banned`)
        .then(res => (res.ok ? res.json() : { banned: [] }))
        .then(data => {
          if (alive) setBanned(data.banned ?? []);
        })
        .catch(() => {
          /* 静默失败即可 */
        });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open]);

  return (
    <>
      <AntdButton
        type="text"
        className="!rounded-none"
        icon={<LuBan />}
        onClick={() => setOpen(true)}
      >
        Banned IPs
      </AntdButton>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
          onKeyUp={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
          onClick={() => setOpen(false)}
        >
          <div onClick={e => e.stopPropagation()}>
            <Card className="w-[420px] max-w-[90vw] overflow-hidden">
              <div className="flex items-center justify-between border-b border-b-slate-800/20 px-4 py-3 dark:border-slate-300/20">
                <div className="flex items-center gap-x-2 font-semibold text-black dark:text-white">
                  <LuBan className="size-4" />
                  Banned IPs
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-0.5 text-lg leading-none text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <div className="max-h-[60vh] overflow-y-auto px-4 py-3 text-sm">
                {banned.length === 0 ? (
                  <div className="py-4 text-center text-slate-400">None</div>
                ) : (
                  <ul className="space-y-2">
                    <li className="flex justify-between gap-3 pb-1 text-xs font-medium text-slate-400">
                      <span>IP</span>
                      <span>Banned at (JST)</span>
                    </li>
                    {banned.map(b => (
                      <li
                        key={b.ip}
                        className="flex justify-between gap-3 text-slate-700 dark:text-white"
                      >
                        <span className="font-mono">{b.ip}</span>
                        <span className="whitespace-nowrap">{fmtTime(b.bannedAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
